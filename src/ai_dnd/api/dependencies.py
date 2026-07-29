from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Annotated, cast

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ai_dnd.application.jobs import BackgroundJobManager
from ai_dnd.application.realtime import RealtimeBroker
from ai_dnd.core.settings import Settings
from ai_dnd.infrastructure.security import SecurityManager
from ai_dnd.integrations.llm import LLMProvider
from ai_dnd.integrations.voice import STTProvider, TTSWorker


def get_settings_from_app(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


def get_session_factory(request: Request) -> async_sessionmaker[AsyncSession]:
    return cast(async_sessionmaker[AsyncSession], request.app.state.session_factory)


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    factory = get_session_factory(request)
    async with factory() as session:
        yield session


def get_security(request: Request) -> SecurityManager:
    return cast(SecurityManager, request.app.state.security)


def require_gm(request: Request) -> None:
    security_manager = get_security(request)
    if not security_manager.verify_gm_session(request.cookies.get("ai_dnd_gm")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="GM authentication is required.",
        )


def get_broker(request: Request) -> RealtimeBroker:
    return cast(RealtimeBroker, request.app.state.realtime)


def get_job_manager(request: Request) -> BackgroundJobManager:
    return cast(BackgroundJobManager, request.app.state.jobs)


def get_llm_provider(request: Request) -> LLMProvider:
    return cast(LLMProvider, request.app.state.llm)


def get_stt_provider(request: Request) -> STTProvider:
    return cast(STTProvider, request.app.state.stt)


def get_tts_worker(request: Request) -> TTSWorker:
    return cast(TTSWorker, request.app.state.tts)


def get_speech_lock(request: Request) -> asyncio.Lock:
    return cast(asyncio.Lock, request.app.state.speech_lock)


SessionDep = Annotated[AsyncSession, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings_from_app)]
SecurityDep = Annotated[SecurityManager, Depends(get_security)]
BrokerDep = Annotated[RealtimeBroker, Depends(get_broker)]
JobManagerDep = Annotated[BackgroundJobManager, Depends(get_job_manager)]
LLMProviderDep = Annotated[LLMProvider, Depends(get_llm_provider)]
STTProviderDep = Annotated[STTProvider, Depends(get_stt_provider)]
TTSWorkerDep = Annotated[TTSWorker, Depends(get_tts_worker)]
SpeechLockDep = Annotated[asyncio.Lock, Depends(get_speech_lock)]
GMDep = Annotated[None, Depends(require_gm)]
