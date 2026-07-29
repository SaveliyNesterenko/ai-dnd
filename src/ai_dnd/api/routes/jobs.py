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
    CreateTurnRequest,
    GenerateObserverJobRequest,
    GenerateTurnJobRequest,
)
from ai_dnd.application.game_service import GameService
from ai_dnd.application.prompts import build_observer_prompt, build_player_prompt
from ai_dnd.domain.enums import RealtimeAudience
from ai_dnd.domain.errors import NotFoundError
from ai_dnd.infrastructure.models import (
    BackgroundJobModel,
    CampaignModel,
    CharacterModel,
    GameEventModel,
    TurnModel,
)
from ai_dnd.integrations.llm import ModelProfile

router = APIRouter(prefix="/campaigns/{campaign_id}/jobs", tags=["background jobs"])


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
    character_snapshot = {
        "id": character.id,
        "name": character.name,
        "biography": character.biography,
        "stats": {
            "hp": {"current": character.hp_current, "max": character.hp_max},
            "mp": {"current": character.mp_current, "max": character.mp_max},
            "attributes": character.attributes,
        },
    }
    private_notes = list(character.private_notes)
    global_chronicle = list(campaign.global_chronicle)
    model_id = character.model_id or settings.default_model
    actor = {
        "id": character.id,
        "name": character.name,
        "role": character.role,
    }
    event_id = event.id

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
                }
                for turn in history_rows
            ],
        )
        output = await llm.generate_player_turn(
            profile=ModelProfile(model_id=model_id),
            system_prompt="You are an actor in a tabletop role-playing game.",
            prompt=prompt,
        )
        async with factory() as job_session:
            turn = await GameService(job_session).add_turn(
                campaign_id,
                event_id,
                CreateTurnRequest(
                    character_id=actor["id"],
                    actor_name=actor["name"],
                    actor_role=actor["role"],
                    thought=output.thought,
                    action=output.action,
                ),
            )
            await job_session.commit()
        public_payload = {
            "id": turn.id,
            "sequence": turn.sequence,
            "character_id": turn.character_id,
            "actor_name": turn.actor_name,
            "actor_role": turn.actor_role,
            "action": turn.action,
            "dice_roll": turn.dice_roll,
        }
        await broker.publish(
            campaign_id=campaign_id,
            event_type="turn.created",
            payload=public_payload,
        )
        return {"turn_id": turn.id}

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
