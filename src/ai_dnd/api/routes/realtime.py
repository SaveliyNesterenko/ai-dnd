from __future__ import annotations

import asyncio

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status

from ai_dnd.domain.enums import RealtimeAudience

router = APIRouter(tags=["realtime"])


@router.websocket("/realtime")
async def realtime(
    websocket: WebSocket,
    campaign_id: str = Query(),
    last_sequence: int = Query(default=0, ge=0),
    join_code: str | None = Query(default=None),
) -> None:
    security = websocket.app.state.security
    is_gm = security.verify_gm_session(websocket.cookies.get("ai_dnd_gm"))
    is_spectator = security.verify_spectator_code(join_code)
    if not is_gm and not is_spectator:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    audience = RealtimeAudience.GM if is_gm else RealtimeAudience.PUBLIC
    broker = websocket.app.state.realtime
    await websocket.accept()
    try:
        for event in await broker.replay(
            campaign_id=campaign_id,
            after_sequence=last_sequence,
            audience=audience,
        ):
            await websocket.send_json(event.model_dump(mode="json"))
        async with broker.subscribe(audience) as queue:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=20)
                except TimeoutError:
                    await websocket.send_json({"type": "system.ping"})
                    continue
                if event.campaign_id == campaign_id:
                    await websocket.send_json(event.model_dump(mode="json"))
    except WebSocketDisconnect:
        return
