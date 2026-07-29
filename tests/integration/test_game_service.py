from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ai_dnd.api.schemas import (
    AddInventoryItemOperation,
    AddStatusEffectOperation,
    CreateObserverProposalRequest,
    CreateTurnRequest,
    InventoryItem,
    ObserverOperation,
    RemoveInventoryItemOperation,
    RemoveStatusEffectOperation,
    SetAttributeOperation,
    SetResourceOperation,
    UpdateInventoryItemOperation,
)
from ai_dnd.application.game_service import GameService
from ai_dnd.domain.errors import ConflictError, ValidationError
from ai_dnd.infrastructure.models import (
    CampaignModel,
    CharacterModel,
    InventoryItemModel,
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

    archived = await service.archive_event(campaign.id, event_id)
    assert archived.status == "archived"
    assert (await service.archive_event(campaign.id, event_id)).status == "archived"
