from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ai_dnd.core.logging import get_logger
from ai_dnd.domain.enums import JobStatus
from ai_dnd.infrastructure.models import BackgroundJobModel

JobRunner = Callable[[], Awaitable[dict[str, Any]]]


def utc_now() -> datetime:
    return datetime.now(UTC)


class DegradedJobError(RuntimeError):
    def __init__(self, message: str, *, output_data: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.output_data = output_data


class BackgroundJobManager:
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        *,
        concurrency: int,
    ) -> None:
        self._session_factory = session_factory
        self._semaphore = asyncio.Semaphore(concurrency)
        self._tasks: set[asyncio.Task[None]] = set()
        self._closing = False

    @property
    def session_factory(self) -> async_sessionmaker[AsyncSession]:
        return self._session_factory

    async def submit(
        self,
        *,
        kind: str,
        campaign_id: str | None,
        input_data: dict[str, Any],
        runner: JobRunner,
    ) -> BackgroundJobModel:
        if self._closing:
            raise RuntimeError("Job manager is shutting down.")
        async with self._session_factory() as session:
            job = BackgroundJobModel(
                kind=kind,
                campaign_id=campaign_id,
                status=JobStatus.QUEUED.value,
                input_data=input_data,
            )
            session.add(job)
            await session.commit()
            await session.refresh(job)
        task = asyncio.create_task(self._run(job.id, runner), name=f"ai-dnd-job-{job.id}")
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return job

    async def _run(self, job_id: str, runner: JobRunner) -> None:
        async with self._semaphore:
            async with self._session_factory() as session:
                job = await session.get(BackgroundJobModel, job_id)
                if not job:
                    return
                job.status = JobStatus.RUNNING.value
                job.started_at = utc_now()
                await session.commit()
            try:
                result = await runner()
            except asyncio.CancelledError:
                async with self._session_factory() as session:
                    job = await session.get(BackgroundJobModel, job_id)
                    if job:
                        job.status = JobStatus.CANCELLED.value
                        job.finished_at = utc_now()
                        await session.commit()
                raise
            except DegradedJobError as error:
                async with self._session_factory() as session:
                    job = await session.get(BackgroundJobModel, job_id)
                    if job:
                        job.status = JobStatus.DEGRADED.value
                        job.output_data = error.output_data
                        job.error_code = "capability_unavailable"
                        job.finished_at = utc_now()
                        await session.commit()
            except Exception as error:
                get_logger().exception("background_job_failed", job_id=job_id)
                async with self._session_factory() as session:
                    job = await session.get(BackgroundJobModel, job_id)
                    if job:
                        job.status = JobStatus.FAILED.value
                        job.error_code = error.__class__.__name__
                        job.finished_at = utc_now()
                        await session.commit()
            else:
                async with self._session_factory() as session:
                    job = await session.get(BackgroundJobModel, job_id)
                    if job:
                        job.status = JobStatus.SUCCEEDED.value
                        job.output_data = result
                        job.finished_at = utc_now()
                        await session.commit()

    async def shutdown(self) -> None:
        self._closing = True
        for task in tuple(self._tasks):
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
