from __future__ import annotations

from datetime import UTC, datetime
from secrets import randbelow
from typing import Any, cast

from sqlalchemy import Select, func, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ai_dnd.api.schemas import (
    AddInventoryItemOperation,
    AddStatusEffectOperation,
    AdjustInventoryItemOperation,
    CampaignSummary,
    CharacterGM,
    CharacterPublic,
    ConfirmEventFinalizationRequest,
    CreateObserverProposalRequest,
    CreateTurnRequest,
    GameEventView,
    GameStateSnapshot,
    InventoryItem,
    LocationView,
    MusicTrackView,
    ObserverOperation,
    RemoveInventoryItemOperation,
    RemoveStatusEffectOperation,
    SceneCharacterView,
    SceneView,
    SetAttributeOperation,
    SetResourceOperation,
    TurnView,
    UpdateCharacterRequest,
    UpdateInventoryItemOperation,
    UpdateSceneCharacterRequest,
    UpdateSceneRequest,
)
from ai_dnd.domain.enums import EventStatus, ProposalStatus
from ai_dnd.domain.errors import ConflictError, NotFoundError, StaleRevisionError, ValidationError
from ai_dnd.domain.state_machine import ensure_event_transition
from ai_dnd.infrastructure.models import (
    CampaignModel,
    CharacterModel,
    GameEventModel,
    GameEventParticipantModel,
    InventoryItemModel,
    LocationModel,
    MusicTrackModel,
    ObserverProposalModel,
    RealtimeEventModel,
    SceneCharacterModel,
    SceneModel,
    StatusEffectModel,
    TurnModel,
)


def utc_now() -> datetime:
    return datetime.now(UTC)


def _character_query() -> Select[tuple[CharacterModel]]:
    return select(CharacterModel).options(
        selectinload(CharacterModel.inventory),
        selectinload(CharacterModel.status_effects),
    )


def _campaign_summary(campaign: CampaignModel) -> CampaignSummary:
    return CampaignSummary(
        id=campaign.id,
        slug=campaign.slug,
        name=campaign.name,
        revision=campaign.revision,
        is_active=campaign.is_active,
        speech_enabled=campaign.speech_enabled,
        speech_speak_thoughts=campaign.speech_speak_thoughts,
    )


class GameService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_campaigns(self) -> list[CampaignSummary]:
        rows = await self.session.scalars(
            select(CampaignModel).order_by(CampaignModel.is_active.desc(), CampaignModel.name)
        )
        return [_campaign_summary(row) for row in rows]

    async def activate_campaign(self, campaign_id: str) -> CampaignSummary:
        campaign = await self.session.get(CampaignModel, campaign_id)
        if not campaign:
            raise NotFoundError("Campaign not found.")
        await self.session.execute(
            update(CampaignModel)
            .where(CampaignModel.id != campaign_id, CampaignModel.is_active.is_(True))
            .values(is_active=False)
        )
        if not campaign.is_active:
            campaign.is_active = True
            campaign.revision += 1
        await self.session.flush()
        return _campaign_summary(campaign)

    async def create_campaign(self, slug: str, name: str) -> CampaignSummary:
        existing = await self.session.scalar(
            select(CampaignModel.id).where(CampaignModel.slug == slug)
        )
        if existing:
            raise ConflictError(f"Campaign slug '{slug}' already exists.")
        campaign = CampaignModel(slug=slug, name=name)
        self.session.add(campaign)
        try:
            await self.session.flush()
        except IntegrityError as error:
            await self.session.rollback()
            raise ConflictError(f"Campaign slug '{slug}' already exists.") from error
        return _campaign_summary(campaign)

    async def get_campaign(self, campaign_id: str) -> CampaignModel:
        campaign = await self.session.get(CampaignModel, campaign_id)
        if not campaign:
            raise NotFoundError("Campaign not found.")
        return campaign

    async def update_speech_settings(
        self,
        campaign_id: str,
        *,
        speech_enabled: bool | None,
        speech_speak_thoughts: bool | None,
    ) -> CampaignSummary:
        campaign = await self.get_campaign(campaign_id)
        if speech_enabled is not None:
            campaign.speech_enabled = speech_enabled
        if speech_speak_thoughts is not None:
            campaign.speech_speak_thoughts = speech_speak_thoughts
        await self.session.flush()
        return _campaign_summary(campaign)

    async def get_snapshot(self, campaign_id: str, *, gm_view: bool) -> GameStateSnapshot:
        campaign = await self.get_campaign(campaign_id)
        scene = await self._get_or_create_scene(campaign_id)
        characters = list(
            await self.session.scalars(
                _character_query()
                .where(CharacterModel.campaign_id == campaign_id)
                .order_by(CharacterModel.name)
            )
        )
        active_event = await self.session.scalar(
            select(GameEventModel)
            .options(
                selectinload(GameEventModel.turns),
                selectinload(GameEventModel.participants),
            )
            .where(
                GameEventModel.campaign_id == campaign_id,
                GameEventModel.status.in_(
                    [
                        EventStatus.DRAFT.value,
                        EventStatus.ACTIVE.value,
                        EventStatus.FINALIZING.value,
                    ]
                ),
            )
            .order_by(GameEventModel.created_at.desc())
        )
        locations = list(
            await self.session.scalars(
                select(LocationModel)
                .where(LocationModel.campaign_id == campaign_id)
                .order_by(LocationModel.sort_order, LocationModel.name)
            )
        )
        music_tracks = list(
            await self.session.scalars(
                select(MusicTrackModel)
                .where(MusicTrackModel.campaign_id == campaign_id)
                .order_by(MusicTrackModel.sort_order, MusicTrackModel.name)
            )
        )
        scene_characters = list(
            await self.session.scalars(
                select(SceneCharacterModel)
                .where(SceneCharacterModel.campaign_id == campaign_id)
                .order_by(SceneCharacterModel.order)
            )
        )
        sequence_query = select(func.max(RealtimeEventModel.sequence)).where(
            RealtimeEventModel.campaign_id == campaign_id
        )
        if not gm_view:
            sequence_query = sequence_query.where(RealtimeEventModel.audience == "public")
        last_sequence = (await self.session.scalar(sequence_query)) or 0

        character_views: list[CharacterPublic | CharacterGM] = []
        for character in characters:
            common: dict[str, Any] = {
                "id": character.id,
                "slug": character.slug,
                "name": character.name,
                "kind": character.kind,
                "role": character.role,
                "biography": character.biography,
                "model_id": character.model_id,
                "portrait_url": (
                    f"/api/v1/assets/{character.portrait_asset_id}"
                    if character.portrait_asset_id
                    else None
                ),
                "avatar_url": (
                    f"/api/v1/assets/{character.avatar_asset_id}"
                    if character.avatar_asset_id
                    else None
                ),
                "sprite_url": (
                    f"/api/v1/assets/{character.portrait_asset_id or character.sprite_asset_id}"
                    if character.portrait_asset_id or character.sprite_asset_id
                    else None
                ),
                "flip_x": next(
                    (item.flip_x for item in scene_characters if item.character_id == character.id),
                    character.flip_x,
                ),
                "is_active": next(
                    (
                        item.is_visible
                        for item in scene_characters
                        if item.character_id == character.id
                    ),
                    character.is_active,
                ),
                "hp_current": character.hp_current,
                "hp_max": character.hp_max,
                "mp_current": character.mp_current,
                "mp_max": character.mp_max,
                "attributes": character.attributes,
                "inventory": [
                    InventoryItem(
                        id=item.id,
                        name=item.name,
                        quantity=item.quantity,
                        description=item.description,
                    )
                    for item in character.inventory
                ],
                "status_effects": [effect.name for effect in character.status_effects],
                "revision": character.revision,
            }
            if gm_view:
                character_views.append(
                    CharacterGM(
                        **common,
                        voice_asset_id=character.voice_asset_id,
                        global_chronicle=character.global_chronicle,
                        private_notes=character.private_notes,
                    )
                )
            else:
                character_views.append(CharacterPublic(**common))

        event_view = None
        if active_event:
            event_view = GameEventView(
                id=active_event.id,
                title=active_event.title,
                status=active_event.status,
                revision=active_event.revision,
                participant_ids=[
                    participant.character_id for participant in active_event.participants
                ],
                finalization_job_id=active_event.finalization_job_id if gm_view else None,
                context_summary=active_event.context_summary,
                context_summary_through_sequence=(active_event.context_summary_through_sequence),
                turns=[
                    TurnView(
                        id=turn.id,
                        sequence=turn.sequence,
                        character_id=turn.character_id,
                        actor_name=turn.actor_name,
                        actor_role=turn.actor_role,
                        thought=turn.thought,
                        action=turn.action,
                        dice_roll=turn.dice_roll,
                        audio_url=turn.audio_url,
                        thought_audio_url=turn.thought_audio_url,
                        action_audio_url=turn.action_audio_url,
                        created_at=turn.created_at,
                    )
                    for turn in active_event.turns
                ],
            )

        return GameStateSnapshot(
            campaign=_campaign_summary(campaign),
            world_state=campaign.world_state,
            global_chronicle=campaign.global_chronicle if gm_view else None,
            scene=SceneView(
                location_id=scene.location_id,
                music_track_id=scene.music_track_id,
                music_is_playing=scene.music_is_playing,
                music_volume=scene.music_volume,
                avatar_size=scene.avatar_size,
                revision=scene.revision,
                locations=[
                    LocationView(
                        id=location.id,
                        slug=location.slug,
                        name=location.name,
                        image_url=f"/api/v1/assets/{location.asset_id}",
                    )
                    for location in locations
                ],
                music_tracks=[
                    MusicTrackView(
                        id=track.id,
                        slug=track.slug,
                        name=track.name,
                        audio_url=f"/api/v1/assets/{track.asset_id}",
                    )
                    for track in music_tracks
                ],
                characters=[
                    SceneCharacterView(
                        character_id=item.character_id,
                        is_visible=item.is_visible,
                        x=item.x,
                        y=item.y,
                        order=item.order,
                        flip_x=item.flip_x,
                        scale=item.scale,
                        revision=item.revision,
                    )
                    for item in scene_characters
                ],
            ),
            active_event=event_view,
            characters=character_views,
            last_sequence=last_sequence,
        )

    async def _get_or_create_scene(self, campaign_id: str) -> SceneModel:
        scene = await self.session.get(SceneModel, campaign_id)
        if scene:
            return scene
        scene = SceneModel(campaign_id=campaign_id)
        self.session.add(scene)
        await self.session.flush()
        characters = list(
            await self.session.scalars(
                select(CharacterModel)
                .where(CharacterModel.campaign_id == campaign_id)
                .order_by(CharacterModel.name)
            )
        )
        for order, character in enumerate(characters):
            self.session.add(
                SceneCharacterModel(
                    campaign_id=campaign_id,
                    character_id=character.id,
                    is_visible=character.is_active,
                    order=order,
                    flip_x=character.flip_x,
                )
            )
        await self.session.flush()
        return scene

    async def start_event(self, campaign_id: str, title: str) -> GameEventModel:
        campaign = await self.get_campaign(campaign_id)
        current = await self.session.scalar(
            select(GameEventModel).where(
                GameEventModel.campaign_id == campaign_id,
                GameEventModel.status.in_(
                    [
                        EventStatus.DRAFT.value,
                        EventStatus.ACTIVE.value,
                        EventStatus.FINALIZING.value,
                    ]
                ),
            )
        )
        if current:
            raise ConflictError("Campaign already has an active game event.")
        event = GameEventModel(
            campaign_id=campaign_id,
            title=title,
            status=EventStatus.DRAFT.value,
        )
        self.session.add(event)
        await self.session.flush()
        ensure_event_transition(EventStatus(event.status), EventStatus.ACTIVE)
        event.status = EventStatus.ACTIVE.value
        event.started_at = utc_now()
        campaign.is_active = True
        campaign.revision += 1
        scene = await self._get_or_create_scene(campaign_id)
        visible_character_ids = list(
            await self.session.scalars(
                select(SceneCharacterModel.character_id).where(
                    SceneCharacterModel.campaign_id == scene.campaign_id,
                    SceneCharacterModel.is_visible.is_(True),
                )
            )
        )
        self.session.add_all(
            [
                GameEventParticipantModel(event_id=event.id, character_id=character_id)
                for character_id in visible_character_ids
            ]
        )
        try:
            await self.session.flush()
        except IntegrityError as error:
            await self.session.rollback()
            raise ConflictError("Campaign already has an active game event.") from error
        return event

    async def add_turn(
        self, campaign_id: str, event_id: str, request: CreateTurnRequest
    ) -> TurnModel:
        event = await self.session.get(GameEventModel, event_id)
        if not event or event.campaign_id != campaign_id:
            raise NotFoundError("Game event not found.")
        if event.status != EventStatus.ACTIVE.value:
            raise ConflictError("Turns can only be added to an active event.")
        if request.character_id:
            character = await self.session.get(CharacterModel, request.character_id)
            if not character or character.campaign_id != campaign_id:
                raise NotFoundError("Character not found in campaign.")
        sequence = (
            await self.session.scalar(
                select(func.max(TurnModel.sequence)).where(TurnModel.event_id == event_id)
            )
            or 0
        ) + 1
        turn = TurnModel(
            event_id=event_id,
            character_id=request.character_id,
            sequence=sequence,
            actor_name=request.actor_name,
            actor_role=request.actor_role,
            thought=request.thought,
            action=request.action,
            dice_roll=(
                request.dice_roll
                if request.dice_roll is not None
                else randbelow(20) + 1
                if request.roll_dice
                else None
            ),
        )
        self.session.add(turn)
        event.revision += 1
        try:
            await self.session.flush()
        except IntegrityError as error:
            await self.session.rollback()
            raise ConflictError("A concurrent turn was created; retry the command.") from error
        return turn

    async def delete_turn(self, campaign_id: str, turn_id: str) -> TurnModel:
        """Убрать ход из лога активного события.

        Номера ходов не пересчитываются: на них ссылаются сводка Архивариуса и
        заявки Наблюдателя, поэтому дырка в нумерации честнее тихого сдвига.
        """
        turn = await self.session.get(TurnModel, turn_id)
        event = await self.session.get(GameEventModel, turn.event_id) if turn else None
        if not turn or not event or event.campaign_id != campaign_id:
            raise NotFoundError("Turn not found in campaign.")
        if event.status != EventStatus.ACTIVE.value:
            raise ConflictError("Turns can only be deleted from an active event.")
        if turn.sequence <= (event.context_summary_through_sequence or 0):
            raise ConflictError("Turn is already folded into the context summary.")
        await self.session.delete(turn)
        event.revision += 1
        await self.session.flush()
        return turn

    async def update_scene(
        self,
        campaign_id: str,
        request: UpdateSceneRequest,
    ) -> SceneModel:
        await self.get_campaign(campaign_id)
        scene = await self._get_or_create_scene(campaign_id)
        values: dict[str, Any] = {"revision": SceneModel.revision + 1}
        if request.location_id is not None:
            location = await self.session.get(LocationModel, request.location_id)
            if not location or location.campaign_id != campaign_id:
                raise NotFoundError("Location not found in campaign.")
            values["location_id"] = location.id
        if request.music_track_id is not None:
            track = await self.session.get(MusicTrackModel, request.music_track_id)
            if not track or track.campaign_id != campaign_id:
                raise NotFoundError("Music track not found in campaign.")
            values["music_track_id"] = track.id
        for field_name in ("music_is_playing", "music_volume", "avatar_size"):
            value = getattr(request, field_name)
            if value is not None:
                values[field_name] = value
        result = cast(
            CursorResult[Any],
            await self.session.execute(
                update(SceneModel)
                .where(
                    SceneModel.campaign_id == campaign_id,
                    SceneModel.revision == request.base_revision,
                )
                .values(**values)
            ),
        )
        if result.rowcount != 1:
            raise StaleRevisionError("Scene changed after it was loaded.")
        await self.session.flush()
        await self.session.refresh(scene)
        return scene

    async def update_scene_character(
        self,
        campaign_id: str,
        character_id: str,
        request: UpdateSceneCharacterRequest,
    ) -> SceneCharacterModel:
        character = await self._get_character(campaign_id, character_id)
        await self._get_or_create_scene(campaign_id)
        state = await self.session.get(
            SceneCharacterModel,
            {"campaign_id": campaign_id, "character_id": character_id},
        )
        if not state:
            state = SceneCharacterModel(campaign_id=campaign_id, character_id=character_id)
            self.session.add(state)
            await self.session.flush()
        values: dict[str, Any] = {"revision": SceneCharacterModel.revision + 1}
        for field_name in ("is_visible", "x", "y", "order", "flip_x"):
            value = getattr(request, field_name)
            if value is not None:
                values[field_name] = value
        result = cast(
            CursorResult[Any],
            await self.session.execute(
                update(SceneCharacterModel)
                .where(
                    SceneCharacterModel.campaign_id == campaign_id,
                    SceneCharacterModel.character_id == character_id,
                    SceneCharacterModel.revision == request.base_revision,
                )
                .values(**values)
            ),
        )
        if result.rowcount != 1:
            raise StaleRevisionError("Character scene state changed after it was loaded.")
        if request.is_visible is not None:
            character.is_active = request.is_visible
            active_event_id = await self.session.scalar(
                select(GameEventModel.id).where(
                    GameEventModel.campaign_id == campaign_id,
                    GameEventModel.status == EventStatus.ACTIVE.value,
                )
            )
            if active_event_id:
                participant = await self.session.get(
                    GameEventParticipantModel,
                    {"event_id": active_event_id, "character_id": character_id},
                )
                if request.is_visible and not participant:
                    self.session.add(
                        GameEventParticipantModel(
                            event_id=active_event_id,
                            character_id=character_id,
                        )
                    )
                elif not request.is_visible and participant:
                    has_turn = await self.session.scalar(
                        select(TurnModel.id).where(
                            TurnModel.event_id == active_event_id,
                            TurnModel.character_id == character_id,
                        )
                    )
                    if not has_turn:
                        await self.session.delete(participant)
        await self.session.flush()
        await self.session.refresh(state)
        return state

    async def update_character(
        self,
        campaign_id: str,
        character_id: str,
        request: UpdateCharacterRequest,
    ) -> CharacterModel:
        campaign = await self.get_campaign(campaign_id)
        character = await self.session.scalar(
            _character_query().where(
                CharacterModel.id == character_id,
                CharacterModel.campaign_id == campaign_id,
            )
        )
        if not character:
            raise NotFoundError("Character not found in campaign.")
        if character.revision != request.base_revision:
            raise StaleRevisionError("Character changed since it was loaded.")

        hp_current = request.hp_current
        hp_max = request.hp_max
        mp_current = request.mp_current
        mp_max = request.mp_max
        next_hp_current = character.hp_current if hp_current is None else hp_current
        next_hp_max = character.hp_max if hp_max is None else hp_max
        next_mp_current = character.mp_current if mp_current is None else mp_current
        next_mp_max = character.mp_max if mp_max is None else mp_max
        if next_hp_current > next_hp_max:
            raise ValidationError("Current HP cannot exceed maximum HP.")
        if next_mp_current > next_mp_max:
            raise ValidationError("Current MP cannot exceed maximum MP.")

        values: dict[str, Any] = {
            "revision": request.base_revision + 1,
            "hp_current": next_hp_current,
            "hp_max": next_hp_max,
            "mp_current": next_mp_current,
            "mp_max": next_mp_max,
        }
        if request.biography is not None:
            values["biography"] = request.biography
        if request.attributes is not None:
            values["attributes"] = request.attributes
        changed = await self.session.execute(
            update(CharacterModel)
            .where(
                CharacterModel.id == character_id,
                CharacterModel.campaign_id == campaign_id,
                CharacterModel.revision == request.base_revision,
            )
            .values(**values)
        )
        result = cast(CursorResult[Any], changed)
        if result.rowcount != 1:
            raise StaleRevisionError("Character changed during the update.")

        if request.inventory is not None:
            current_items = {item.id: item for item in character.inventory}
            retained_ids: set[str] = set()
            for item in request.inventory:
                if item.id:
                    current = current_items.get(item.id)
                    if not current:
                        raise ValidationError(
                            "Inventory contains an item that does not belong to this character."
                        )
                    current.name = item.name
                    current.quantity = item.quantity
                    current.description = item.description
                    retained_ids.add(current.id)
                else:
                    self.session.add(
                        InventoryItemModel(
                            character_id=character_id,
                            name=item.name,
                            quantity=item.quantity,
                            description=item.description,
                        )
                    )
            for item_id, existing_item in current_items.items():
                if item_id not in retained_ids:
                    await self.session.delete(existing_item)

        if request.status_effects is not None:
            for effect in list(character.status_effects):
                await self.session.delete(effect)
            self.session.add_all(
                [
                    StatusEffectModel(character_id=character_id, name=name)
                    for name in request.status_effects
                ]
            )

        campaign.revision += 1
        await self.session.flush()
        refreshed = await self.session.scalar(
            _character_query()
            .execution_options(populate_existing=True)
            .where(CharacterModel.id == character_id)
        )
        assert refreshed is not None
        return refreshed

    async def create_proposal(
        self, campaign_id: str, event_id: str, request: CreateObserverProposalRequest
    ) -> ObserverProposalModel:
        campaign = await self.get_campaign(campaign_id)
        event = await self.session.get(GameEventModel, event_id)
        if not event or event.campaign_id != campaign_id:
            raise NotFoundError("Game event not found.")
        if event.status != EventStatus.ACTIVE.value:
            raise ConflictError("Observer proposals require an active game event.")
        turn = await self.session.get(TurnModel, request.turn_id)
        if not turn or turn.event_id != event_id:
            raise NotFoundError("Turn not found in game event.")
        if request.base_revision != campaign.revision:
            raise StaleRevisionError(
                "Observer proposal was created from a stale campaign revision."
            )
        proposal = ObserverProposalModel(
            campaign_id=campaign_id,
            event_id=event_id,
            turn_id=request.turn_id,
            gm_brief=request.gm_brief,
            base_revision=request.base_revision,
            operations=[operation.model_dump(mode="json") for operation in request.operations],
            status=ProposalStatus.PENDING.value,
        )
        self.session.add(proposal)
        await self.session.flush()
        return proposal

    async def get_proposal(self, campaign_id: str, proposal_id: str) -> ObserverProposalModel:
        proposal = await self.session.get(ObserverProposalModel, proposal_id)
        if not proposal or proposal.campaign_id != campaign_id:
            raise NotFoundError("Observer proposal not found.")
        return proposal

    async def apply_proposal(
        self,
        campaign_id: str,
        proposal_id: str,
        operations: list[ObserverOperation],
        *,
        gm_brief: str | None = None,
    ) -> ObserverProposalModel:
        proposal = await self.session.get(ObserverProposalModel, proposal_id)
        if not proposal or proposal.campaign_id != campaign_id:
            raise NotFoundError("Observer proposal not found.")
        if proposal.status == ProposalStatus.APPLIED.value:
            return proposal
        if proposal.status != ProposalStatus.PENDING.value:
            raise ConflictError("Observer proposal is not pending.")
        event = await self.session.get(GameEventModel, proposal.event_id)
        if not event or event.status != EventStatus.ACTIVE.value:
            raise ConflictError("Observer proposals require an active game event.")

        revision_update = cast(
            CursorResult[Any],
            await self.session.execute(
                update(CampaignModel)
                .where(
                    CampaignModel.id == campaign_id,
                    CampaignModel.revision == proposal.base_revision,
                )
                .values(revision=CampaignModel.revision + 1, updated_at=utc_now())
            ),
        )
        if revision_update.rowcount != 1:
            proposal.status = ProposalStatus.STALE.value
            await self.session.flush()
            raise StaleRevisionError("Campaign changed after this proposal was created.")

        for operation in operations:
            await self._apply_operation(campaign_id, operation)

        proposal.operations = [operation.model_dump(mode="json") for operation in operations]
        if gm_brief is not None:
            proposal.gm_brief = gm_brief
        proposal.status = ProposalStatus.APPLIED.value
        proposal.resolved_at = utc_now()
        await self.session.flush()
        return proposal

    async def _get_character(self, campaign_id: str, character_id: str) -> CharacterModel:
        character = await self.session.get(CharacterModel, character_id)
        if not character or character.campaign_id != campaign_id:
            raise NotFoundError("Character not found in campaign.")
        return character

    async def _get_inventory_item(
        self,
        character_id: str,
        *,
        item_id: str | None,
        item_name: str | None,
    ) -> InventoryItemModel:
        item = None
        if item_id is not None:
            item = await self.session.get(InventoryItemModel, item_id)
        elif item_name is not None:
            item = await self.session.scalar(
                select(InventoryItemModel).where(
                    InventoryItemModel.character_id == character_id,
                    InventoryItemModel.name == item_name,
                )
            )
        if not item or item.character_id != character_id:
            raise NotFoundError("Inventory item not found.")
        return item

    async def _apply_operation(self, campaign_id: str, operation: ObserverOperation) -> None:
        character = await self._get_character(campaign_id, operation.character_id)
        if isinstance(operation, SetResourceOperation):
            maximum_name = f"{operation.resource}_max"
            current_name = f"{operation.resource}_current"
            maximum = (
                operation.maximum
                if operation.maximum is not None
                else int(getattr(character, maximum_name))
            )
            if operation.current > maximum:
                raise ValidationError("Resource current value cannot exceed maximum.")
            setattr(character, maximum_name, maximum)
            setattr(character, current_name, operation.current)
        elif isinstance(operation, SetAttributeOperation):
            attributes = dict(character.attributes)
            attributes[operation.attribute] = operation.value
            character.attributes = attributes
        elif isinstance(operation, AddInventoryItemOperation):
            self.session.add(
                InventoryItemModel(
                    character_id=character.id,
                    name=operation.item.name,
                    quantity=operation.item.quantity,
                    description=operation.item.description,
                )
            )
        elif isinstance(operation, UpdateInventoryItemOperation):
            item = await self._get_inventory_item(
                character.id,
                item_id=operation.item_id,
                item_name=operation.item_name,
            )
            for field_name in ("name", "quantity", "description"):
                value = getattr(operation, field_name)
                if value is not None:
                    setattr(item, field_name, value)
        elif isinstance(operation, RemoveInventoryItemOperation):
            item = await self._get_inventory_item(
                character.id,
                item_id=operation.item_id,
                item_name=operation.name,
            )
            await self.session.delete(item)
        elif isinstance(operation, AdjustInventoryItemOperation):
            item = await self._get_inventory_item(
                character.id,
                item_id=operation.item_id,
                item_name=operation.name,
            )
            new_quantity = item.quantity + operation.quantity_delta
            if new_quantity <= 0:
                await self.session.delete(item)
            else:
                item.quantity = new_quantity
        elif isinstance(operation, AddStatusEffectOperation):
            self.session.add(StatusEffectModel(character_id=character.id, name=operation.name))
        elif isinstance(operation, RemoveStatusEffectOperation):
            effect = None
            if operation.status_effect_id is not None:
                effect = await self.session.get(StatusEffectModel, operation.status_effect_id)
            elif operation.name is not None:
                effect = await self.session.scalar(
                    select(StatusEffectModel).where(
                        StatusEffectModel.character_id == character.id,
                        StatusEffectModel.name == operation.name,
                    )
                )
            if not effect or effect.character_id != character.id:
                raise NotFoundError("Status effect not found.")
            await self.session.delete(effect)
        character.revision += 1

    async def apply_context_summary(
        self,
        campaign_id: str,
        event_id: str,
        *,
        base_revision: int,
        summary: str,
        through_sequence: int,
    ) -> GameEventModel:
        campaign = await self.get_campaign(campaign_id)
        event = await self.session.get(GameEventModel, event_id)
        if not event or event.campaign_id != campaign_id:
            raise NotFoundError("Game event not found.")
        if event.status != EventStatus.ACTIVE.value:
            raise ConflictError("Only an active game event can be compressed.")
        if event.revision != base_revision:
            raise StaleRevisionError("Game event changed while context was compressed.")
        event.context_summary = summary
        event.context_summary_through_sequence = through_sequence
        event.revision += 1
        campaign.revision += 1
        await self.session.flush()
        return event

    async def begin_event_finalization(
        self,
        campaign_id: str,
        event_id: str,
        *,
        base_revision: int,
    ) -> GameEventModel:
        await self.get_campaign(campaign_id)
        event = await self.session.get(GameEventModel, event_id)
        if not event or event.campaign_id != campaign_id:
            raise NotFoundError("Game event not found.")
        if event.status == EventStatus.ARCHIVED.value:
            raise ConflictError("Game event is already archived.")
        if event.revision != base_revision:
            raise StaleRevisionError("Game event changed since it was loaded.")
        if event.status == EventStatus.FINALIZING.value:
            return event
        ensure_event_transition(EventStatus(event.status), EventStatus.FINALIZING)
        event.status = EventStatus.FINALIZING.value
        event.finalization_started_at = utc_now()
        event.revision += 1
        await self.session.flush()
        return event

    async def attach_finalization_job(
        self,
        campaign_id: str,
        event_id: str,
        job_id: str,
    ) -> GameEventModel:
        event = await self.session.get(GameEventModel, event_id)
        if (
            not event
            or event.campaign_id != campaign_id
            or event.status != EventStatus.FINALIZING.value
        ):
            raise ConflictError("Game event is not waiting for finalization.")
        event.finalization_job_id = job_id
        await self.session.flush()
        return event

    async def confirm_event_finalization(
        self,
        campaign_id: str,
        event_id: str,
        request: ConfirmEventFinalizationRequest,
    ) -> GameEventModel:
        campaign = await self.get_campaign(campaign_id)
        event = await self.session.scalar(
            select(GameEventModel)
            .options(selectinload(GameEventModel.participants))
            .where(
                GameEventModel.id == event_id,
                GameEventModel.campaign_id == campaign_id,
            )
        )
        if not event:
            raise NotFoundError("Game event not found.")
        if event.status == EventStatus.ARCHIVED.value:
            if (
                event.archive_chronicle == request.chronicle
                and event.archive_player_notes == request.player_notes
            ):
                return event
            raise ConflictError("Game event has already been finalized with another result.")
        if event.status != EventStatus.FINALIZING.value:
            raise ConflictError("Game event must enter finalization before it can be archived.")
        if event.revision != request.base_revision:
            raise StaleRevisionError("Game event changed since the finalization draft was loaded.")

        participant_ids = {participant.character_id for participant in event.participants}
        participants = list(
            await self.session.scalars(
                select(CharacterModel).where(
                    CharacterModel.campaign_id == campaign_id,
                    CharacterModel.id.in_(participant_ids),
                )
            )
        )
        if len(participants) != len(participant_ids):
            raise ValidationError("One or more event participants no longer exist.")
        player_ids = {character.id for character in participants if character.kind == "player"}
        supplied_player_ids = set(request.player_notes)
        if supplied_player_ids != player_ids:
            missing = sorted(player_ids - supplied_player_ids)
            unexpected = sorted(supplied_player_ids - player_ids)
            details: list[str] = []
            if missing:
                details.append(f"missing player notes: {', '.join(missing)}")
            if unexpected:
                details.append(f"unexpected player notes: {', '.join(unexpected)}")
            raise ValidationError("; ".join(details))

        transition = await self.session.execute(
            update(GameEventModel)
            .where(
                GameEventModel.id == event_id,
                GameEventModel.status == EventStatus.FINALIZING.value,
                GameEventModel.revision == request.base_revision,
            )
            .values(
                status=EventStatus.ARCHIVED.value,
                revision=request.base_revision + 1,
                archived_at=utc_now(),
                archive_chronicle=request.chronicle,
                archive_player_notes=request.player_notes,
                finalization_source=request.source,
            )
        )
        result = cast(CursorResult[Any], transition)
        if result.rowcount != 1:
            raise StaleRevisionError("Game event changed during finalization.")

        for character in participants:
            character.global_chronicle = [request.chronicle]
            if character.id in player_ids:
                character.private_notes = [request.player_notes[character.id]]
            character.revision += 1
        campaign.global_chronicle = [request.chronicle]
        campaign.revision += 1
        await self.session.flush()
        refreshed = await self.session.get(
            GameEventModel,
            event_id,
            populate_existing=True,
        )
        assert refreshed is not None
        return refreshed
