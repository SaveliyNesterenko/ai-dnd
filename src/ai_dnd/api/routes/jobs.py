from __future__ import annotations

from typing import Any

from fastapi import APIRouter, status
from sqlalchemy import select

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
    GenerateEventFinalizationJobRequest,
    GenerateObserverJobRequest,
    GenerateTurnJobRequest,
)
from ai_dnd.application.game_service import GameService
from ai_dnd.application.jobs import DegradedJobError
from ai_dnd.application.prompts import (
    build_archivist_prompt,
    build_observer_prompt,
    build_player_prompt,
)
from ai_dnd.domain.enums import RealtimeAudience
from ai_dnd.domain.errors import NotFoundError
from ai_dnd.infrastructure.models import (
    BackgroundJobModel,
    CampaignModel,
    CharacterModel,
    GameEventModel,
    TurnModel,
)
from ai_dnd.integrations.llm import LLMUnavailableError, ModelProfile

router = APIRouter(prefix="/campaigns/{campaign_id}/jobs", tags=["background jobs"])


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
    model_id = request.model_id or settings.default_model

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

        chronicle_versions: list[list[str]] = []
        seen_versions: set[tuple[str, ...]] = set()
        for character in participants:
            version = tuple(character.global_chronicle)
            if version not in seen_versions:
                chronicle_versions.append(list(version))
                seen_versions.add(version)
        event_history = [
            {
                "sequence": turn.sequence,
                "actor": turn.actor_name,
                "role": turn.actor_role,
                "action": turn.action,
                "dice_roll": turn.dice_roll,
            }
            for turn in current_event.turns
        ]
        players = [
            {
                "id": character.id,
                "name": character.name,
                "biography": character.biography,
                "prior_private_notes": list(character.private_notes),
                "own_thoughts": [
                    {
                        "sequence": turn.sequence,
                        "thought": turn.thought,
                    }
                    for turn in current_event.turns
                    if turn.character_id == character.id and turn.thought
                ],
            }
            for character in participants
            if character.kind == "player"
        ]
        prompt = build_archivist_prompt(
            event={
                "id": current_event.id,
                "title": current_event.title,
                "started_at": (
                    current_event.started_at.isoformat()
                    if current_event.started_at
                    else None
                ),
            },
            chronicle_versions=chronicle_versions,
            players=players,
            event_history=event_history,
        )
        try:
            output = await llm.generate_archivist_result(
                profile=ModelProfile(model_id=model_id, temperature=0.2),
                system_prompt=(
                    "You are the Archivist for a tabletop campaign. You consolidate durable "
                    "campaign memory and private player recollections."
                ),
                prompt=prompt,
            )
        except LLMUnavailableError as error:
            raise DegradedJobError(
                "Archivist is unavailable. The GM can retry or enter the result manually."
            ) from error
        expected_player_ids = {player["id"] for player in players}
        if set(output.player_notes) != expected_player_ids:
            raise ValueError("Archivist returned notes for an unexpected set of players.")
        await broker.publish(
            campaign_id=campaign_id,
            event_type="event.finalization_draft_ready",
            audience=RealtimeAudience.GM,
            payload={"event_id": event_id},
        )
        return {
            "event_id": event_id,
            "chronicle": output.chronicle,
            "player_notes": output.player_notes,
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
            event_history=[
                {
                    "actor": turn.actor_name,
                    "role": turn.actor_role,
                    "action": turn.action,
                    "dice_roll": turn.dice_roll,
                    **(
                        {"own_thought": turn.thought}
                        if turn.character_id == actor["id"] and turn.thought
                        else {}
                    ),
                }
                for turn in history_rows
            ],
            scene_participants=scene_participants,
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
    public_snapshot = await GameService(session).get_snapshot(campaign_id, gm_view=False)
    public_characters = [
        character.model_dump(mode="json") for character in public_snapshot.characters
    ]
    action = turn.action
    dice_roll = turn.dice_roll
    base_revision = campaign.revision
    model_id = request.model_id or settings.default_model

    async def runner() -> dict[str, Any]:
        prompt = build_observer_prompt(
            action=action,
            dice_roll=dice_roll,
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
        return {"proposal_id": proposal.id}

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
