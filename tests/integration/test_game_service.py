from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ai_dnd.api.schemas import (
    AddInventoryItemOperation,
    AddStatusEffectOperation,
    ConfirmEventFinalizationRequest,
    CreateObserverProposalRequest,
    CreateTurnRequest,
    InventoryItem,
    ObserverOperation,
    RemoveInventoryItemOperation,
    RemoveStatusEffectOperation,
    SetAttributeOperation,
    SetResourceOperation,
    UpdateCharacterRequest,
    UpdateInventoryItemOperation,
    UpdateSceneCharacterRequest,
    UpdateSceneRequest,
)
from ai_dnd.application.game_service import GameService
from ai_dnd.domain.errors import ConflictError, StaleRevisionError, ValidationError
from ai_dnd.infrastructure.models import (
    CampaignModel,
    CharacterModel,
    GameEventParticipantModel,
    InventoryItemModel,
    SceneCharacterModel,
    StatusEffectModel,
)


@pytest.mark.asyncio
async def test_campaign_activation_controls_default_order(
    repository_session: AsyncSession,
) -> None:
    service = GameService(repository_session)
    created = await service.create_campaign("main-story", "Main Story")
    activated = await service.activate_campaign(created.id)
    await repository_session.commit()

    campaigns = await service.list_campaigns()
    assert activated.is_active is True
    assert campaigns[0].id == created.id
    assert sum(campaign.is_active for campaign in campaigns) == 1


@pytest.mark.asyncio
async def test_typed_operations_are_atomic_and_revision_guarded(
    repository_session: AsyncSession,
) -> None:
    session = repository_session
    service = GameService(session)
    campaign = await session.scalar(select(CampaignModel))
    character = await session.scalar(
        select(CharacterModel).where(CharacterModel.slug == "aria-vale")
    )
    assert campaign is not None
    assert character is not None

    event = await service.start_event(campaign.id, "Mechanism chamber")
    event_id = event.id
    await session.commit()
    with pytest.raises(ConflictError):
        await service.start_event(campaign.id, "Overlapping event")
    turn = await service.add_turn(
        campaign.id,
        event_id,
        CreateTurnRequest(
            character_id=character.id,
            actor_name=character.name,
            actor_role=character.role,
            action="Aria reaches into the mechanism.",
            dice_roll=14,
        ),
    )
    await session.commit()
    await session.refresh(campaign)
    operations: list[ObserverOperation] = [
        SetResourceOperation(
            op="set_resource",
            character_id=character.id,
            resource="hp",
            current=24,
        ),
        SetAttributeOperation(
            op="set_attribute",
            character_id=character.id,
            attribute="DEX",
            value=15,
        ),
        AddInventoryItemOperation(
            op="add_inventory_item",
            character_id=character.id,
            item=InventoryItem(name="Copper cog", quantity=2, description="Warm to touch."),
        ),
        AddStatusEffectOperation(
            op="add_status_effect",
            character_id=character.id,
            name="Inspired",
        ),
    ]
    proposal = await service.create_proposal(
        campaign.id,
        event_id,
        CreateObserverProposalRequest(
            turn_id=turn.id,
            gm_brief="The mechanism resists but yields a useful part.",
            base_revision=campaign.revision,
            operations=operations,
        ),
    )
    applied = await service.apply_proposal(campaign.id, proposal.id, operations)
    await session.commit()
    assert applied.status == "applied"
    assert (await service.apply_proposal(campaign.id, proposal.id, operations)).id == proposal.id

    item = await session.scalar(
        select(InventoryItemModel).where(
            InventoryItemModel.character_id == character.id,
            InventoryItemModel.name == "Copper cog",
        )
    )
    effect = await session.scalar(
        select(StatusEffectModel).where(
            StatusEffectModel.character_id == character.id,
            StatusEffectModel.name == "Inspired",
        )
    )
    assert item is not None
    assert effect is not None
    await session.refresh(campaign)
    second_operations: list[ObserverOperation] = [
        UpdateInventoryItemOperation(
            op="update_inventory_item",
            character_id=character.id,
            item_id=item.id,
            quantity=1,
            description="One cog was installed.",
        ),
        RemoveInventoryItemOperation(
            op="remove_inventory_item",
            character_id=character.id,
            item_id=item.id,
        ),
        RemoveStatusEffectOperation(
            op="remove_status_effect",
            character_id=character.id,
            status_effect_id=effect.id,
        ),
    ]
    second = await service.create_proposal(
        campaign.id,
        event_id,
        CreateObserverProposalRequest(
            turn_id=turn.id,
            gm_brief="The temporary items and effect are cleared.",
            base_revision=campaign.revision,
            operations=second_operations,
        ),
    )
    await service.apply_proposal(campaign.id, second.id, second_operations)
    await session.commit()
    assert await session.get(InventoryItemModel, item.id) is None
    assert await session.get(StatusEffectModel, effect.id) is None

    await session.refresh(campaign)
    invalid_operations: list[ObserverOperation] = [
        SetResourceOperation(
            op="set_resource",
            character_id=character.id,
            resource="hp",
            current=999,
        )
    ]
    invalid = await service.create_proposal(
        campaign.id,
        event_id,
        CreateObserverProposalRequest(
            turn_id=turn.id,
            gm_brief="Impossible health value.",
            base_revision=campaign.revision,
            operations=invalid_operations,
        ),
    )
    await session.commit()
    revision_before = campaign.revision
    with pytest.raises(ValidationError):
        await service.apply_proposal(campaign.id, invalid.id, invalid_operations)
    await session.rollback()
    await session.refresh(campaign)
    assert campaign.revision == revision_before

    await session.refresh(event)
    finalizing = await service.begin_event_finalization(
        campaign.id,
        event_id,
        base_revision=event.revision,
    )
    assert finalizing.status == "finalizing"
    player_ids = set(
        await session.scalars(
            select(CharacterModel.id).where(
                CharacterModel.campaign_id == campaign.id,
                CharacterModel.kind == "player",
            )
        )
    )
    archived = await service.confirm_event_finalization(
        campaign.id,
        event_id,
        ConfirmEventFinalizationRequest(
            base_revision=finalizing.revision,
            chronicle="The party survived the mechanism chamber.",
            player_notes={character_id: "I remember the mechanism." for character_id in player_ids},
            source="manual",
        ),
    )
    assert archived.status == "archived"
    await session.refresh(campaign)
    assert campaign.is_active is True


@pytest.mark.asyncio
async def test_deleting_a_turn_stops_at_the_compressed_part_of_the_log(
    repository_session: AsyncSession,
) -> None:
    session = repository_session
    service = GameService(session)
    campaign = await session.scalar(select(CampaignModel))
    player = await session.scalar(select(CharacterModel).where(CharacterModel.kind == "player"))
    assert campaign is not None
    assert player is not None
    event = await service.start_event(campaign.id, "Compressed log")
    turns = [
        await service.add_turn(
            campaign.id,
            event.id,
            CreateTurnRequest(
                character_id=player.id,
                actor_name=player.name,
                actor_role=player.role,
                action=f"Step {index}.",
            ),
        )
        for index in range(2)
    ]
    await session.commit()

    await service.apply_context_summary(
        campaign.id,
        event.id,
        base_revision=event.revision,
        summary="The party stepped once.",
        through_sequence=turns[0].sequence,
    )
    await session.commit()

    # Свёрнутый ход уже пересказан сводкой: удаление оставило бы в контексте
    # пересказ того, чего в логе нет.
    with pytest.raises(ConflictError):
        await service.delete_turn(campaign.id, turns[0].id)

    await service.delete_turn(campaign.id, turns[1].id)
    await session.commit()
    snapshot = await service.get_snapshot(campaign.id, gm_view=True)
    assert snapshot.active_event is not None
    assert [turn.id for turn in snapshot.active_event.turns] == [turns[0].id]

    await service.begin_event_finalization(
        campaign.id,
        event.id,
        base_revision=snapshot.active_event.revision,
    )
    await session.commit()
    with pytest.raises(ConflictError):
        await service.delete_turn(campaign.id, turns[0].id)


@pytest.mark.asyncio
async def test_finalization_preserves_log_until_atomic_memory_commit(
    repository_session: AsyncSession,
) -> None:
    session = repository_session
    service = GameService(session)
    campaign = await session.scalar(select(CampaignModel))
    players = list(
        await session.scalars(
            select(CharacterModel)
            .where(CharacterModel.kind == "player")
            .order_by(CharacterModel.name)
        )
    )
    assert campaign is not None
    event = await service.start_event(campaign.id, "Memory contract")
    await service.add_turn(
        campaign.id,
        event.id,
        CreateTurnRequest(
            character_id=players[0].id,
            actor_name=players[0].name,
            actor_role=players[0].role,
            thought="Only my recollection may use this.",
            action="The party opens the sealed door.",
        ),
    )
    await session.commit()
    previous_memory = {player.id: list(player.private_notes) for player in players}

    finalizing = await service.begin_event_finalization(
        campaign.id,
        event.id,
        base_revision=event.revision,
    )
    await session.commit()
    snapshot = await service.get_snapshot(campaign.id, gm_view=True)
    assert snapshot.active_event is not None
    assert snapshot.active_event.status == "finalizing"
    assert len(snapshot.active_event.turns) == 1
    for player in players:
        await session.refresh(player)
        assert player.private_notes == previous_memory[player.id]

    request = ConfirmEventFinalizationRequest(
        base_revision=finalizing.revision,
        chronicle="The shared chronicle now includes the sealed door.",
        player_notes={
            players[0].id: "I opened the sealed door.",
            players[1].id: "I watched the door open.",
        },
        source="manual",
    )
    archived = await service.confirm_event_finalization(campaign.id, event.id, request)
    await session.commit()
    archived_revision = archived.revision
    assert (await service.get_snapshot(campaign.id, gm_view=True)).active_event is None
    for player in players:
        await session.refresh(player)
        assert player.global_chronicle == [request.chronicle]
        assert player.private_notes == [request.player_notes[player.id]]

    repeated = await service.confirm_event_finalization(campaign.id, event.id, request)
    assert repeated.revision == archived_revision


@pytest.mark.asyncio
async def test_scene_membership_tracks_event_participants_and_optional_d20(
    repository_session: AsyncSession,
) -> None:
    session = repository_session
    service = GameService(session)
    campaign = await session.scalar(select(CampaignModel))
    characters = list(await session.scalars(select(CharacterModel).order_by(CharacterModel.name)))
    assert campaign is not None
    assert len(characters) == 2
    first, second = characters

    second_state = await session.get(
        SceneCharacterModel,
        {"campaign_id": campaign.id, "character_id": second.id},
    )
    assert second_state is not None
    await service.update_scene_character(
        campaign.id,
        second.id,
        UpdateSceneCharacterRequest(
            is_visible=False,
            base_revision=second_state.revision,
        ),
    )
    await session.commit()

    event = await service.start_event(campaign.id, "Tracked participants")
    await session.flush()
    initial_participants = set(
        await session.scalars(
            select(GameEventParticipantModel.character_id).where(
                GameEventParticipantModel.event_id == event.id
            )
        )
    )
    assert first.id in initial_participants
    assert second.id not in initial_participants

    await session.refresh(second_state)
    await service.update_scene_character(
        campaign.id,
        second.id,
        UpdateSceneCharacterRequest(
            is_visible=True,
            base_revision=second_state.revision,
        ),
    )
    await session.flush()
    assert (
        await session.get(
            GameEventParticipantModel,
            {"event_id": event.id, "character_id": second.id},
        )
        is not None
    )

    await session.refresh(second_state)
    await service.update_scene_character(
        campaign.id,
        second.id,
        UpdateSceneCharacterRequest(
            is_visible=False,
            base_revision=second_state.revision,
        ),
    )
    await session.flush()
    assert (
        await session.get(
            GameEventParticipantModel,
            {"event_id": event.id, "character_id": second.id},
        )
        is None
    )

    await session.refresh(second_state)
    await service.update_scene_character(
        campaign.id,
        second.id,
        UpdateSceneCharacterRequest(
            is_visible=True,
            base_revision=second_state.revision,
        ),
    )
    turn = await service.add_turn(
        campaign.id,
        event.id,
        CreateTurnRequest(
            character_id=second.id,
            actor_name=second.name,
            actor_role=second.role,
            thought="A thought visible to spectators.",
            action="Acts after entering the scene.",
        ),
    )
    assert turn.dice_roll is None

    rolled_turn = await service.add_turn(
        campaign.id,
        event.id,
        CreateTurnRequest(
            character_id=second.id,
            actor_name=second.name,
            actor_role=second.role,
            action="Attempts a risky action.",
            roll_dice=True,
        ),
    )
    assert 1 <= (rolled_turn.dice_roll or 0) <= 20

    await session.refresh(second_state)
    await service.update_scene_character(
        campaign.id,
        second.id,
        UpdateSceneCharacterRequest(
            is_visible=False,
            base_revision=second_state.revision,
        ),
    )
    await session.commit()
    assert (
        await session.get(
            GameEventParticipantModel,
            {"event_id": event.id, "character_id": second.id},
        )
        is not None
    )


@pytest.mark.asyncio
async def test_scene_settings_use_optimistic_revision(
    repository_session: AsyncSession,
) -> None:
    service = GameService(repository_session)
    campaign = await repository_session.scalar(select(CampaignModel))
    assert campaign is not None
    snapshot = await service.get_snapshot(campaign.id, gm_view=True)
    updated = await service.update_scene(
        campaign.id,
        UpdateSceneRequest(
            music_is_playing=True,
            music_volume=35,
            avatar_size=320,
            base_revision=snapshot.scene.revision,
        ),
    )
    assert updated.music_is_playing is True
    assert updated.music_volume == 35
    assert updated.avatar_size == 320
    with pytest.raises(StaleRevisionError):
        await service.update_scene(
            campaign.id,
            UpdateSceneRequest(
                music_is_playing=False,
                base_revision=snapshot.scene.revision,
            ),
        )


@pytest.mark.asyncio
async def test_character_card_editors_update_resources_inventory_and_effects(
    repository_session: AsyncSession,
) -> None:
    session = repository_session
    service = GameService(session)
    campaign = await session.scalar(select(CampaignModel))
    character = await session.scalar(
        select(CharacterModel).where(CharacterModel.slug == "aria-vale")
    )
    assert campaign is not None
    assert character is not None
    await session.refresh(character, attribute_names=["inventory", "status_effects"])
    existing_item = character.inventory[0]

    updated = await service.update_character(
        campaign.id,
        character.id,
        UpdateCharacterRequest(
            base_revision=character.revision,
            biography="Updated safely from the GM card.",
            hp_current=20,
            hp_max=25,
            mp_current=8,
            mp_max=12,
            attributes={"STR": 9, "INT": 18},
            inventory=[
                InventoryItem(
                    id=existing_item.id,
                    name="Calibrated compass",
                    quantity=1,
                    description="The needle now tracks the tower.",
                ),
                InventoryItem(
                    name="Clockwork key",
                    quantity=2,
                    description="Recovered during play.",
                ),
            ],
            status_effects=["Inspired", "Alert"],
        ),
    )
    await session.commit()
    assert updated.biography == "Updated safely from the GM card."
    assert (updated.hp_current, updated.hp_max) == (20, 25)
    assert (updated.mp_current, updated.mp_max) == (8, 12)
    assert updated.attributes == {"STR": 9, "INT": 18}
    assert {item.name for item in updated.inventory} == {
        "Calibrated compass",
        "Clockwork key",
    }
    assert {effect.name for effect in updated.status_effects} == {"Inspired", "Alert"}

    retained = next(item for item in updated.inventory if item.name == "Clockwork key")
    reduced = await service.update_character(
        campaign.id,
        character.id,
        UpdateCharacterRequest(
            base_revision=updated.revision,
            inventory=[
                InventoryItem(
                    id=retained.id,
                    name=retained.name,
                    quantity=3,
                    description=retained.description,
                )
            ],
        ),
    )
    await session.commit()
    assert [(item.name, item.quantity) for item in reduced.inventory] == [("Clockwork key", 3)]

    with pytest.raises(StaleRevisionError):
        await service.update_character(
            campaign.id,
            character.id,
            UpdateCharacterRequest(
                base_revision=1,
                hp_current=1,
            ),
        )
    with pytest.raises(ValidationError):
        await service.update_character(
            campaign.id,
            character.id,
            UpdateCharacterRequest(
                base_revision=reduced.revision,
                mp_current=99,
            ),
        )
    with pytest.raises(ValidationError):
        await service.update_character(
            campaign.id,
            character.id,
            UpdateCharacterRequest(
                base_revision=reduced.revision,
                inventory=[
                    InventoryItem(
                        id="not-owned",
                        name="Foreign item",
                        quantity=1,
                    )
                ],
            ),
        )
