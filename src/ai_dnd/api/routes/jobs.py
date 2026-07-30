# ruff: noqa: RUF001
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from ai_dnd.api.dependencies import (
    BrokerDep,
    GMDep,
    JobManagerDep,
    LLMProviderDep,
    SessionDep,
    SettingsDep,
)
from ai_dnd.api.schemas import (
    BackgroundJobView,
    CreateObserverProposalRequest,
    GenerateContextCompressionJobRequest,
    GenerateEventFinalizationJobRequest,
    GenerateObserverJobRequest,
    GenerateTurnJobRequest,
    ObserverProposalView,
)
from ai_dnd.application.game_service import GameService
from ai_dnd.application.jobs import DegradedJobError
from ai_dnd.application.prompts import (
    build_archivist_prompt,
    build_context_compression_prompt,
    build_observer_prompt,
    build_player_prompt,
    build_player_recollection_prompt,
)
from ai_dnd.domain.enums import EventStatus, RealtimeAudience
from ai_dnd.domain.errors import ConflictError, NotFoundError, StaleRevisionError
from ai_dnd.infrastructure.models import (
    BackgroundJobModel,
    CampaignModel,
    CharacterModel,
    GameEventModel,
    TurnModel,
)
from ai_dnd.integrations.llm import LLMUnavailableError, ModelProfile

router = APIRouter(prefix="/campaigns/{campaign_id}/jobs", tags=["background jobs"])


def _effective_event_history(
    turns: list[TurnModel],
    *,
    context_summary: str | None = None,
    context_summary_through_sequence: int | None = None,
    own_thought_character_id: str | None = None,
) -> list[dict[str, Any]]:
    history: list[dict[str, Any]] = []
    through_sequence = context_summary_through_sequence or 0
    if context_summary:
        history.append(
            {
                "sequence": f"1-{through_sequence}",
                "actor": "Game Master",
                "role": "gm",
                "action": context_summary,
                "dice_roll": None,
            }
        )
    for turn in turns:
        if turn.sequence <= through_sequence:
            continue
        item: dict[str, Any] = {
            "sequence": turn.sequence,
            "actor": turn.actor_name,
            "role": turn.actor_role,
            "action": turn.action,
            "dice_roll": turn.dice_roll,
        }
        if (
            own_thought_character_id is not None
            and turn.character_id == own_thought_character_id
            and turn.thought
        ):
            item["own_thought"] = turn.thought
        history.append(item)
    return history


@router.post(
    "/event-finalization",
    response_model=BackgroundJobView,
    status_code=status.HTTP_202_ACCEPTED,
)
async def generate_event_finalization(
    campaign_id: str,
    request: GenerateEventFinalizationJobRequest,
    session: SessionDep,
    settings: SettingsDep,
    jobs: JobManagerDep,
    llm: LLMProviderDep,
    broker: BrokerDep,
    gm: GMDep,
) -> BackgroundJobModel:
    del gm
    service = GameService(session)
    event = await service.begin_event_finalization(
        campaign_id,
        request.event_id,
        base_revision=request.base_revision,
    )
    await session.commit()
    event_id = event.id
    archivist_model_id = request.model_id or settings.default_model

    async def runner() -> dict[str, Any]:
        factory = jobs.session_factory
        async with factory() as job_session:
            current_event = await job_session.scalar(
                select(GameEventModel).where(
                    GameEventModel.id == event_id,
                    GameEventModel.campaign_id == campaign_id,
                )
            )
            if not current_event:
                raise NotFoundError("Game event not found.")
            await job_session.refresh(
                current_event,
                attribute_names=["turns", "participants"],
            )
            participant_ids = [
                participant.character_id for participant in current_event.participants
            ]
            participants = list(
                await job_session.scalars(
                    select(CharacterModel)
                    .where(
                        CharacterModel.campaign_id == campaign_id,
                        CharacterModel.id.in_(participant_ids),
                    )
                    .order_by(CharacterModel.name)
                )
            )
            turns = list(current_event.turns)
            context_summary = current_event.context_summary
            context_summary_through_sequence = current_event.context_summary_through_sequence
            participant_data: list[dict[str, Any]] = [
                {
                    "id": character.id,
                    "name": character.name,
                    "biography": character.biography,
                    "kind": character.kind,
                    "model_id": character.model_id,
                    "global_chronicle": list(character.global_chronicle),
                    "private_notes": list(character.private_notes),
                }
                for character in participants
            ]

        public_history = _effective_event_history(
            turns,
            context_summary=context_summary,
            context_summary_through_sequence=context_summary_through_sequence,
        )
        chronicle_versions: list[list[str]] = []
        seen_versions: set[tuple[str, ...]] = set()
        for character in participant_data:
            version = tuple(character["global_chronicle"])
            if version not in seen_versions:
                chronicle_versions.append(list(version))
                seen_versions.add(version)
        try:
            archivist_output = await llm.generate_archivist_result(
                profile=ModelProfile(model_id=archivist_model_id, temperature=0.2),
                system_prompt=(
                    "Ты — Синтезатор Хроники кампании D&D. Веди только общую "
                    "фактологическую летопись."
                ),
                prompt=build_archivist_prompt(
                    chronicle_versions=chronicle_versions,
                    event_history=public_history,
                ),
            )
            player_notes: dict[str, str] = {}
            for character in participant_data:
                if character["kind"] != "player":
                    continue
                recollection = await llm.generate_player_recollection(
                    profile=ModelProfile(model_id=character["model_id"] or settings.default_model),
                    system_prompt=(
                        "Ты — актёр, исполняющий роль своего персонажа. Веди личный "
                        "дневник только от его лица."
                    ),
                    prompt=build_player_recollection_prompt(
                        character={
                            "id": character["id"],
                            "name": character["name"],
                            "biography": character["biography"],
                        },
                        prior_private_notes=character["private_notes"],
                        event_history=_effective_event_history(
                            turns,
                            context_summary=context_summary,
                            context_summary_through_sequence=(context_summary_through_sequence),
                            own_thought_character_id=str(character["id"]),
                        ),
                    ),
                )
                player_notes[str(character["id"])] = recollection.note
        except LLMUnavailableError as error:
            raise DegradedJobError(
                "Archivist or a player model is unavailable. The GM can retry or enter "
                "the result manually."
            ) from error
        await broker.publish(
            campaign_id=campaign_id,
            event_type="event.finalization_draft_ready",
            audience=RealtimeAudience.GM,
            payload={"event_id": event_id},
        )
        return {
            "event_id": event_id,
            "chronicle": archivist_output.chronicle,
            "player_notes": player_notes,
            "validation_status": "valid",
        }

    job = await jobs.submit(
        kind="event_finalization",
        campaign_id=campaign_id,
        input_data={"event_id": event_id, "base_revision": event.revision},
        runner=runner,
    )
    await GameService(session).attach_finalization_job(campaign_id, event_id, job.id)
    await session.commit()
    await broker.publish(
        campaign_id=campaign_id,
        event_type="event.finalizing",
        payload={"event_id": event_id, "job_id": job.id},
    )
    return job


@router.post(
    "/context-compression",
    response_model=BackgroundJobView,
    status_code=status.HTTP_202_ACCEPTED,
)
async def generate_context_compression(
    campaign_id: str,
    request: GenerateContextCompressionJobRequest,
    session: SessionDep,
    settings: SettingsDep,
    jobs: JobManagerDep,
    llm: LLMProviderDep,
    broker: BrokerDep,
    gm: GMDep,
) -> BackgroundJobModel:
    del gm
    event = await session.get(GameEventModel, request.event_id)
    if not event or event.campaign_id != campaign_id:
        raise NotFoundError("Game event not found.")
    if event.status != EventStatus.ACTIVE.value:
        raise ConflictError("Only an active game event can be compressed.")
    if event.revision != request.base_revision:
        raise StaleRevisionError("Game event changed since it was loaded.")
    event_id = event.id
    base_revision = event.revision
    model_id = request.model_id or settings.default_model

    async def runner() -> dict[str, Any]:
        factory = jobs.session_factory
        async with factory() as job_session:
            current_event = await job_session.scalar(
                select(GameEventModel)
                .options(selectinload(GameEventModel.turns))
                .where(
                    GameEventModel.id == event_id,
                    GameEventModel.campaign_id == campaign_id,
                )
            )
            if not current_event:
                raise NotFoundError("Game event not found.")
            through_sequence = current_event.context_summary_through_sequence or 0
            uncompressed_turns = [
                turn for turn in current_event.turns if turn.sequence > through_sequence
            ]
            if len(uncompressed_turns) <= 10:
                return {
                    "event_id": event_id,
                    "status": "skipped",
                    "message": "Недостаточно новых событий для сжатия (нужно больше 10).",
                }
            turns_to_compress = uncompressed_turns[:-10]
            compression_history = _effective_event_history(
                turns_to_compress,
                context_summary=current_event.context_summary,
                context_summary_through_sequence=(current_event.context_summary_through_sequence),
            )
            compressed_through_sequence = turns_to_compress[-1].sequence
        try:
            output = await llm.generate_context_summary(
                profile=ModelProfile(model_id=model_id, temperature=0.2),
                system_prompt=(
                    "Ты — Синтезатор Хроники. Сжимай старую часть текущего игрового лога."
                ),
                prompt=build_context_compression_prompt(event_history=compression_history),
            )
        except LLMUnavailableError as error:
            raise DegradedJobError(
                "Context compression is unavailable. The event log was not changed."
            ) from error
        async with factory() as job_session:
            await GameService(job_session).apply_context_summary(
                campaign_id,
                event_id,
                base_revision=base_revision,
                summary=output.summary,
                through_sequence=compressed_through_sequence,
            )
            await job_session.commit()
        await broker.publish(
            campaign_id=campaign_id,
            event_type="event.context_compressed",
            audience=RealtimeAudience.GM,
            payload={
                "event_id": event_id,
                "through_sequence": compressed_through_sequence,
            },
        )
        return {
            "event_id": event_id,
            "status": "succeeded",
            "summary": output.summary,
            "through_sequence": compressed_through_sequence,
        }

    return await jobs.submit(
        kind="context_compression",
        campaign_id=campaign_id,
        input_data={"event_id": event_id, "base_revision": base_revision},
        runner=runner,
    )


@router.post("/player-turn", response_model=BackgroundJobView, status_code=status.HTTP_202_ACCEPTED)
async def generate_player_turn(
    campaign_id: str,
    request: GenerateTurnJobRequest,
    session: SessionDep,
    settings: SettingsDep,
    jobs: JobManagerDep,
    llm: LLMProviderDep,
    broker: BrokerDep,
    gm: GMDep,
) -> BackgroundJobModel:
    del gm
    character = await session.get(CharacterModel, request.character_id)
    event = await session.get(GameEventModel, request.event_id)
    campaign = await session.get(CampaignModel, campaign_id)
    if not character or character.campaign_id != campaign_id:
        raise NotFoundError("Character not found in campaign.")
    if not event or event.campaign_id != campaign_id:
        raise NotFoundError("Game event not found.")
    if not campaign:
        raise NotFoundError("Campaign not found.")
    await session.refresh(character, attribute_names=["inventory", "status_effects"])
    character_snapshot = {
        "id": character.id,
        "name": character.name,
        "role": character.role,
        "biography": character.biography,
        "stats": {
            "hp": {"current": character.hp_current, "max": character.hp_max},
            "mp": {"current": character.mp_current, "max": character.mp_max},
            "attributes": character.attributes,
            "status_effects": [effect.name for effect in character.status_effects],
        },
        "inventory": [
            {
                "name": item.name,
                "quantity": item.quantity,
                "description": item.description,
            }
            for item in character.inventory
        ],
    }
    private_notes = list(character.private_notes)
    global_chronicle = list(character.global_chronicle)
    model_id = character.model_id or settings.default_model
    actor = {
        "id": character.id,
        "name": character.name,
        "role": character.role,
    }
    event_id = event.id
    context_summary = event.context_summary
    context_summary_through_sequence = event.context_summary_through_sequence
    public_snapshot = await GameService(session).get_snapshot(campaign_id, gm_view=False)
    scene_participants = [
        {
            "id": item.id,
            "name": item.name,
            "category": item.kind,
        }
        for item in public_snapshot.characters
        if item.is_active
    ]
    scene_location = next(
        (
            location.name
            for location in public_snapshot.scene.locations
            if location.id == public_snapshot.scene.location_id
        ),
        None,
    )

    async def runner() -> dict[str, Any]:
        factory = jobs.session_factory
        async with factory() as job_session:
            history_rows = list(
                await job_session.scalars(
                    select(TurnModel)
                    .where(TurnModel.event_id == event_id)
                    .order_by(TurnModel.sequence)
                )
            )
        prompt = build_player_prompt(
            character=character_snapshot,
            global_chronicle=global_chronicle,
            private_notes=private_notes,
            event_history=_effective_event_history(
                history_rows,
                context_summary=context_summary,
                context_summary_through_sequence=context_summary_through_sequence,
                own_thought_character_id=character.id,
            ),
            scene_participants=scene_participants,
            scene_location=scene_location,
        )
        output = await llm.generate_player_turn(
            profile=ModelProfile(model_id=model_id),
            system_prompt="You are an actor in a tabletop role-playing game.",
            prompt=prompt,
        )
        await broker.publish(
            campaign_id=campaign_id,
            event_type="turn.draft_ready",
            audience=RealtimeAudience.GM,
            payload={"event_id": event_id, "character_id": actor["id"]},
        )
        return {
            "event_id": event_id,
            "character_id": actor["id"],
            "actor_name": actor["name"],
            "actor_role": actor["role"],
            "thought": output.thought,
            "action": output.action,
            "validation_status": "valid",
        }

    return await jobs.submit(
        kind="player_turn",
        campaign_id=campaign_id,
        input_data={"event_id": request.event_id, "character_id": request.character_id},
        runner=runner,
    )


@router.post("/observer", response_model=BackgroundJobView, status_code=status.HTTP_202_ACCEPTED)
async def generate_observer_proposal(
    campaign_id: str,
    request: GenerateObserverJobRequest,
    session: SessionDep,
    settings: SettingsDep,
    jobs: JobManagerDep,
    llm: LLMProviderDep,
    broker: BrokerDep,
    gm: GMDep,
) -> BackgroundJobModel:
    del gm
    turn = await session.get(TurnModel, request.turn_id)
    event = await session.get(GameEventModel, request.event_id)
    campaign = await session.get(CampaignModel, campaign_id)
    if not turn or turn.event_id != request.event_id:
        raise NotFoundError("Turn not found in game event.")
    if not event or event.campaign_id != campaign_id or not campaign:
        raise NotFoundError("Campaign or game event not found.")
    await session.refresh(event, attribute_names=["participants"])
    participant_ids = [participant.character_id for participant in event.participants]
    participant_models = list(
        await session.scalars(
            select(CharacterModel)
            .options(
                selectinload(CharacterModel.inventory),
                selectinload(CharacterModel.status_effects),
            )
            .where(
                CharacterModel.campaign_id == campaign_id,
                CharacterModel.id.in_(participant_ids),
            )
            .order_by(CharacterModel.name)
        )
    )
    public_characters = [
        {
            "id": character.id,
            "name": character.name,
            "role": character.role,
            "stats": {
                "hp": {"current": character.hp_current, "max": character.hp_max},
                "mp": {"current": character.mp_current, "max": character.mp_max},
                "attributes": character.attributes,
                "status_effects": [
                    {"id": effect.id, "name": effect.name} for effect in character.status_effects
                ],
            },
            "inventory": [
                {
                    "id": item.id,
                    "name": item.name,
                    "quantity": item.quantity,
                    "description": item.description,
                }
                for item in character.inventory
            ],
        }
        for character in participant_models
    ]
    action = turn.action
    dice_roll = turn.dice_roll
    actor_name = turn.actor_name
    base_revision = campaign.revision
    model_id = request.model_id or settings.default_model

    async def runner() -> dict[str, Any]:
        prompt = build_observer_prompt(
            action=action,
            dice_roll=dice_roll,
            actor_name=actor_name,
            public_characters=public_characters,
            campaign_revision=base_revision,
        )
        output = await llm.generate_observer_proposal(
            profile=ModelProfile(model_id=model_id),
            system_prompt="You are a deterministic tabletop game mechanics processor.",
            prompt=prompt,
        )
        factory = jobs.session_factory
        async with factory() as job_session:
            proposal = await GameService(job_session).create_proposal(
                campaign_id,
                request.event_id,
                CreateObserverProposalRequest(
                    turn_id=request.turn_id,
                    gm_brief=output.gm_brief,
                    base_revision=base_revision,
                    operations=output.operations,
                ),
            )
            await job_session.commit()
        await broker.publish(
            campaign_id=campaign_id,
            event_type="observer.proposal_created",
            audience=RealtimeAudience.GM,
            payload={"proposal_id": proposal.id, "turn_id": proposal.turn_id},
        )
        proposal_view = ObserverProposalView.model_validate(proposal)
        return {
            "proposal_id": proposal.id,
            "proposal": proposal_view.model_dump(mode="json"),
        }

    return await jobs.submit(
        kind="observer",
        campaign_id=campaign_id,
        input_data={"event_id": request.event_id, "turn_id": request.turn_id},
        runner=runner,
    )


@router.get("/{job_id}", response_model=BackgroundJobView)
async def get_job(
    campaign_id: str, job_id: str, session: SessionDep, gm: GMDep
) -> BackgroundJobModel:
    del gm
    job = await session.get(BackgroundJobModel, job_id)
    if not job or job.campaign_id != campaign_id:
        raise NotFoundError("Background job not found.")
    return job
