from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, cast

from sqlalchemy import Select, func, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ai_dnd.api.schemas import (
    AddInventoryItemOperation,
    AddStatusEffectOperation,
    CampaignSummary,
    CharacterGM,
    CharacterPublic,
    CreateObserverProposalRequest,
    CreateTurnRequest,
    GameEventView,
    GameStateSnapshot,
    InventoryItem,
    ObserverOperation,
    RemoveInventoryItemOperation,
    RemoveStatusEffectOperation,
    SetAttributeOperation,
    SetResourceOperation,
    TurnView,
    UpdateInventoryItemOperation,
)
from ai_dnd.domain.enums import EventStatus, ProposalStatus
from ai_dnd.domain.errors import ConflictError, NotFoundError, StaleRevisionError, ValidationError
from ai_dnd.domain.state_machine import ensure_event_transition
from ai_dnd.infrastructure.models import (
    CampaignModel,
    CharacterModel,
    GameEventModel,
    InventoryItemModel,
    ObserverProposalModel,
    RealtimeEventModel,
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


class GameService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_campaigns(self) -> list[CampaignSummary]:
        rows = await self.session.scalars(select(CampaignModel).order_by(CampaignModel.name))
        return [
            CampaignSummary(
                id=row.id,
                slug=row.slug,
                name=row.name,
                revision=row.revision,
                is_active=row.is_active,
            )
            for row in rows
        ]

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
        return CampaignSummary(
            id=campaign.id,
            slug=campaign.slug,
            name=campaign.name,
            revision=campaign.revision,
            is_active=campaign.is_active,
        )

    async def get_campaign(self, campaign_id: str) -> CampaignModel:
        campaign = await self.session.get(CampaignModel, campaign_id)
        if not campaign:
            raise NotFoundError("Campaign not found.")
        return campaign

    async def get_snapshot(self, campaign_id: str, *, gm_view: bool) -> GameStateSnapshot:
        campaign = await self.get_campaign(campaign_id)
        characters = list(
            await self.session.scalars(
                _character_query()
                .where(CharacterModel.campaign_id == campaign_id)
                .order_by(CharacterModel.name)
            )
        )
        active_event = await self.session.scalar(
            select(GameEventModel)
            .options(selectinload(GameEventModel.turns))
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
                "sprite_url": (
                    f"/api/v1/assets/{character.sprite_asset_id}"
                    if character.sprite_asset_id
                    else None
                ),
                "flip_x": character.flip_x,
                "is_active": character.is_active,
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
                        model_id=character.model_id,
                        voice_asset_id=character.voice_asset_id,
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
                turns=[
                    TurnView(
                        id=turn.id,
                        sequence=turn.sequence,
                        character_id=turn.character_id,
                        actor_name=turn.actor_name,
                        actor_role=turn.actor_role,
                        thought=turn.thought if gm_view else None,
                        action=turn.action,
                        dice_roll=turn.dice_roll,
                        audio_url=turn.audio_url,
                        created_at=turn.created_at,
                    )
                    for turn in active_event.turns
                ],
            )

        return GameStateSnapshot(
            campaign=CampaignSummary(
                id=campaign.id,
                slug=campaign.slug,
                name=campaign.name,
                revision=campaign.revision,
                is_active=campaign.is_active,
            ),
            world_state=campaign.world_state,
            global_chronicle=campaign.global_chronicle if gm_view else None,
            active_event=event_view,
            characters=character_views,
            last_sequence=last_sequence,
        )

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
            dice_roll=request.dice_roll,
        )
        self.session.add(turn)
        event.revision += 1
        try:
            await self.session.flush()
        except IntegrityError as error:
            await self.session.rollback()
            raise ConflictError("A concurrent turn was created; retry the command.") from error
        return turn

    async def create_proposal(
        self, campaign_id: str, event_id: str, request: CreateObserverProposalRequest
    ) -> ObserverProposalModel:
        campaign = await self.get_campaign(campaign_id)
        event = await self.session.get(GameEventModel, event_id)
        if not event or event.campaign_id != campaign_id:
            raise NotFoundError("Game event not found.")
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

    async def apply_proposal(
        self,
        campaign_id: str,
        proposal_id: str,
        operations: list[ObserverOperation],
    ) -> ObserverProposalModel:
        proposal = await self.session.get(ObserverProposalModel, proposal_id)
        if not proposal or proposal.campaign_id != campaign_id:
            raise NotFoundError("Observer proposal not found.")
        if proposal.status == ProposalStatus.APPLIED.value:
            return proposal
        if proposal.status != ProposalStatus.PENDING.value:
            raise ConflictError("Observer proposal is not pending.")

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
        proposal.status = ProposalStatus.APPLIED.value
        proposal.resolved_at = utc_now()
        await self.session.flush()
        return proposal

    async def _get_character(self, campaign_id: str, character_id: str) -> CharacterModel:
        character = await self.session.get(CharacterModel, character_id)
        if not character or character.campaign_id != campaign_id:
            raise NotFoundError("Character not found in campaign.")
        return character

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
            item = await self.session.get(InventoryItemModel, operation.item_id)
            if not item or item.character_id != character.id:
                raise NotFoundError("Inventory item not found.")
            for field_name in ("name", "quantity", "description"):
                value = getattr(operation, field_name)
                if value is not None:
                    setattr(item, field_name, value)
        elif isinstance(operation, RemoveInventoryItemOperation):
            item = await self.session.get(InventoryItemModel, operation.item_id)
            if not item or item.character_id != character.id:
                raise NotFoundError("Inventory item not found.")
            await self.session.delete(item)
        elif isinstance(operation, AddStatusEffectOperation):
            self.session.add(StatusEffectModel(character_id=character.id, name=operation.name))
        elif isinstance(operation, RemoveStatusEffectOperation):
            effect = await self.session.get(StatusEffectModel, operation.status_effect_id)
            if not effect or effect.character_id != character.id:
                raise NotFoundError("Status effect not found.")
            await self.session.delete(effect)
        character.revision += 1

    async def archive_event(self, campaign_id: str, event_id: str) -> GameEventModel:
        campaign = await self.get_campaign(campaign_id)
        event = await self.session.get(GameEventModel, event_id)
        if not event or event.campaign_id != campaign_id:
            raise NotFoundError("Game event not found.")
        if event.status == EventStatus.ARCHIVED.value:
            return event
        ensure_event_transition(EventStatus(event.status), EventStatus.FINALIZING)
        event.status = EventStatus.FINALIZING.value
        ensure_event_transition(EventStatus(event.status), EventStatus.ARCHIVED)
        event.status = EventStatus.ARCHIVED.value
        event.archived_at = utc_now()
        event.revision += 1
        campaign.is_active = False
        campaign.revision += 1
        await self.session.flush()
        return event
