from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header, HTTPException, Query, Request, status
from sqlalchemy.exc import IntegrityError

from ai_dnd.api.dependencies import BrokerDep, GMDep, SecurityDep, SessionDep
from ai_dnd.api.schemas import (
    ApplyObserverProposalRequest,
    CampaignSummary,
    CreateCampaignRequest,
    CreateObserverProposalRequest,
    CreateTurnRequest,
    GameStateSnapshot,
    ObserverProposalView,
    StartEventRequest,
)
from ai_dnd.application.game_service import GameService
from ai_dnd.domain.enums import RealtimeAudience
from ai_dnd.domain.errors import ConflictError
from ai_dnd.infrastructure.models import IdempotencyRecordModel

router = APIRouter(prefix="/campaigns", tags=["campaigns"])


async def _cached_response(
    session: SessionDep, key: str | None, scope: str
) -> dict[str, Any] | None:
    if not key:
        return None
    row = await session.get(IdempotencyRecordModel, {"key": key, "scope": scope})
    return row.response_body if row else None


async def _save_response(
    session: SessionDep,
    key: str | None,
    scope: str,
    body: dict[str, Any],
    status_code: int,
) -> None:
    if not key:
        return
    session.add(
        IdempotencyRecordModel(
            key=key,
            scope=scope,
            response_body=body,
            status_code=status_code,
        )
    )
    await session.flush()


async def _commit_response(
    session: SessionDep,
    key: str | None,
    scope: str,
    body: dict[str, Any],
    status_code: int,
) -> dict[str, Any] | None:
    try:
        await _save_response(session, key, scope, body, status_code)
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        cached = await _cached_response(session, key, scope)
        if cached:
            return cached
        raise ConflictError("A concurrent command changed the same resource.") from error
    return None


@router.get("", response_model=list[CampaignSummary])
async def list_campaigns(session: SessionDep) -> list[CampaignSummary]:
    return await GameService(session).list_campaigns()


@router.post("", response_model=CampaignSummary, status_code=status.HTTP_201_CREATED)
async def create_campaign(
    request: CreateCampaignRequest, session: SessionDep, gm: GMDep
) -> CampaignSummary:
    del gm
    campaign = await GameService(session).create_campaign(request.slug, request.name)
    await session.commit()
    return campaign


@router.post("/{campaign_id}/activate", response_model=CampaignSummary)
async def activate_campaign(
    campaign_id: str,
    session: SessionDep,
    gm: GMDep,
) -> CampaignSummary:
    del gm
    campaign = await GameService(session).activate_campaign(campaign_id)
    await session.commit()
    return campaign


@router.get("/{campaign_id}/snapshot", response_model=GameStateSnapshot)
async def snapshot(
    campaign_id: str,
    session: SessionDep,
    security_manager: SecurityDep,
    request: Request,
    view: str = Query(default="public", pattern="^(public|gm)$"),
    spectator_code: str | None = Query(default=None),
) -> GameStateSnapshot:
    if view == "gm":
        # GM snapshot is only available through the authenticated web session.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use the authenticated GM snapshot endpoint.",
        )
    is_gm = security_manager.verify_gm_session(request.cookies.get("ai_dnd_gm"))
    if not is_gm and not security_manager.verify_spectator_code(spectator_code):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid join code.")
    return await GameService(session).get_snapshot(campaign_id, gm_view=False)


@router.get("/{campaign_id}/gm-snapshot", response_model=GameStateSnapshot)
async def gm_snapshot(campaign_id: str, session: SessionDep, gm: GMDep) -> GameStateSnapshot:
    del gm
    return await GameService(session).get_snapshot(campaign_id, gm_view=True)


@router.post("/{campaign_id}/events", status_code=status.HTTP_201_CREATED)
async def start_event(
    campaign_id: str,
    request: StartEventRequest,
    session: SessionDep,
    broker: BrokerDep,
    gm: GMDep,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict[str, Any]:
    del gm
    scope = f"start-event:{campaign_id}"
    if cached := await _cached_response(session, idempotency_key, scope):
        return cached
    event = await GameService(session).start_event(campaign_id, request.title)
    body = {"id": event.id, "title": event.title, "status": event.status}
    if concurrent := await _commit_response(
        session,
        idempotency_key,
        scope,
        body,
        status.HTTP_201_CREATED,
    ):
        return concurrent
    await broker.publish(
        campaign_id=campaign_id,
        event_type="event.started",
        payload=body,
    )
    return body


@router.post("/{campaign_id}/events/{event_id}/turns", status_code=status.HTTP_201_CREATED)
async def create_turn(
    campaign_id: str,
    event_id: str,
    request: CreateTurnRequest,
    session: SessionDep,
    broker: BrokerDep,
    gm: GMDep,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict[str, Any]:
    del gm
    scope = f"create-turn:{campaign_id}:{event_id}"
    if cached := await _cached_response(session, idempotency_key, scope):
        return cached
    turn = await GameService(session).add_turn(campaign_id, event_id, request)
    body = {
        "id": turn.id,
        "sequence": turn.sequence,
        "character_id": turn.character_id,
        "actor_name": turn.actor_name,
        "actor_role": turn.actor_role,
        "thought": turn.thought,
        "action": turn.action,
        "dice_roll": turn.dice_roll,
    }
    if concurrent := await _commit_response(
        session,
        idempotency_key,
        scope,
        body,
        status.HTTP_201_CREATED,
    ):
        return concurrent
    public_body = {key: value for key, value in body.items() if key != "thought"}
    await broker.publish(
        campaign_id=campaign_id,
        event_type="turn.created",
        payload=public_body,
    )
    return body


@router.post(
    "/{campaign_id}/events/{event_id}/observer-proposals",
    response_model=ObserverProposalView,
    status_code=status.HTTP_201_CREATED,
)
async def create_proposal(
    campaign_id: str,
    event_id: str,
    request: CreateObserverProposalRequest,
    session: SessionDep,
    broker: BrokerDep,
    gm: GMDep,
) -> ObserverProposalView:
    del gm
    proposal = await GameService(session).create_proposal(campaign_id, event_id, request)
    await session.commit()
    await broker.publish(
        campaign_id=campaign_id,
        event_type="observer.proposal_created",
        audience=RealtimeAudience.GM,
        payload={"proposal_id": proposal.id, "turn_id": proposal.turn_id},
    )
    return ObserverProposalView.model_validate(proposal)


@router.post(
    "/{campaign_id}/observer-proposals/{proposal_id}/apply",
    response_model=ObserverProposalView,
)
async def apply_proposal(
    campaign_id: str,
    proposal_id: str,
    request: ApplyObserverProposalRequest,
    session: SessionDep,
    broker: BrokerDep,
    gm: GMDep,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> ObserverProposalView:
    del gm
    scope = f"apply-proposal:{campaign_id}:{proposal_id}"
    if idempotency_key:
        cached = await session.get(
            IdempotencyRecordModel,
            {"key": idempotency_key, "scope": scope},
        )
        if cached:
            return ObserverProposalView.model_validate(cached.response_body)
    proposal = await GameService(session).apply_proposal(
        campaign_id, proposal_id, request.operations
    )
    view = ObserverProposalView.model_validate(proposal)
    if concurrent := await _commit_response(
        session,
        idempotency_key,
        scope,
        view.model_dump(mode="json"),
        200,
    ):
        return ObserverProposalView.model_validate(concurrent)
    await broker.publish(
        campaign_id=campaign_id,
        event_type="observer.proposal_applied",
        payload={"proposal_id": proposal.id},
    )
    return view


@router.post("/{campaign_id}/events/{event_id}/archive")
async def archive_event(
    campaign_id: str,
    event_id: str,
    session: SessionDep,
    broker: BrokerDep,
    gm: GMDep,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict[str, str]:
    del gm
    scope = f"archive-event:{campaign_id}:{event_id}"
    if cached := await _cached_response(session, idempotency_key, scope):
        return {str(key): str(value) for key, value in cached.items()}
    event = await GameService(session).archive_event(campaign_id, event_id)
    body = {"id": event.id, "status": event.status}
    if concurrent := await _commit_response(
        session,
        idempotency_key,
        scope,
        body,
        200,
    ):
        return {str(key): str(value) for key, value in concurrent.items()}
    await broker.publish(
        campaign_id=campaign_id,
        event_type="event.archived",
        payload=body,
    )
    return body
