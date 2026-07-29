from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ai_dnd.api.schemas import RealtimeEvent
from ai_dnd.domain.enums import RealtimeAudience
from ai_dnd.infrastructure.models import RealtimeEventModel


@dataclass(slots=True)
class Subscriber:
    audience: RealtimeAudience
    queue: asyncio.Queue[RealtimeEvent]


class RealtimeBroker:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory
        self._subscribers: dict[str, Subscriber] = {}
        self._publish_lock = asyncio.Lock()

    async def publish(
        self,
        *,
        campaign_id: str,
        event_type: str,
        payload: dict[str, Any],
        audience: RealtimeAudience = RealtimeAudience.PUBLIC,
    ) -> RealtimeEvent:
        async with self._publish_lock, self._session_factory() as session:
            sequence = (
                await session.scalar(
                    select(func.max(RealtimeEventModel.sequence)).where(
                        RealtimeEventModel.campaign_id == campaign_id
                    )
                )
                or 0
            ) + 1
            row = RealtimeEventModel(
                campaign_id=campaign_id,
                sequence=sequence,
                event_type=event_type,
                audience=audience.value,
                payload=payload,
            )
            session.add(row)
            await session.commit()
            event = self._view(row)
        for subscriber in tuple(self._subscribers.values()):
            if audience is RealtimeAudience.GM and subscriber.audience is not RealtimeAudience.GM:
                continue
            if subscriber.queue.full():
                with suppress(asyncio.QueueEmpty):
                    subscriber.queue.get_nowait()
            subscriber.queue.put_nowait(event)
        return event

    async def replay(
        self,
        *,
        campaign_id: str,
        after_sequence: int,
        audience: RealtimeAudience,
        limit: int = 500,
    ) -> list[RealtimeEvent]:
        predicate = RealtimeEventModel.audience == RealtimeAudience.PUBLIC.value
        if audience is RealtimeAudience.GM:
            predicate = or_(
                RealtimeEventModel.audience == RealtimeAudience.PUBLIC.value,
                RealtimeEventModel.audience == RealtimeAudience.GM.value,
            )
        async with self._session_factory() as session:
            rows = await session.scalars(
                select(RealtimeEventModel)
                .where(
                    RealtimeEventModel.campaign_id == campaign_id,
                    RealtimeEventModel.sequence > after_sequence,
                    predicate,
                )
                .order_by(RealtimeEventModel.sequence)
                .limit(limit)
            )
            return [self._view(row) for row in rows]

    @asynccontextmanager
    async def subscribe(
        self, audience: RealtimeAudience
    ) -> AsyncIterator[asyncio.Queue[RealtimeEvent]]:
        subscriber_id = str(uuid4())
        subscriber = Subscriber(audience=audience, queue=asyncio.Queue(maxsize=256))
        self._subscribers[subscriber_id] = subscriber
        try:
            yield subscriber.queue
        finally:
            self._subscribers.pop(subscriber_id, None)

    @staticmethod
    def _view(row: RealtimeEventModel) -> RealtimeEvent:
        return RealtimeEvent(
            event_id=row.id,
            campaign_id=row.campaign_id,
            sequence=row.sequence,
            type=row.event_type,
            occurred_at=row.occurred_at,
            payload=row.payload,
        )
