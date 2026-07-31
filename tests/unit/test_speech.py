from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, cast

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine

from ai_dnd.api.schemas import CreateTurnRequest
from ai_dnd.application.demo import seed_demo_if_empty
from ai_dnd.application.game_service import GameService
from ai_dnd.application.realtime import RealtimeBroker
from ai_dnd.application.speech import synthesize_turn_speech
from ai_dnd.core.settings import Settings
from ai_dnd.infrastructure.database import create_engine, create_session_factory
from ai_dnd.infrastructure.models import AssetModel, Base, CampaignModel, CharacterModel, TurnModel


class FakeBroker:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    async def publish(self, **event: Any) -> None:
        self.events.append(event)


class FakeTTS:
    def __init__(self, *, available: bool) -> None:
        self.available = available
        self.calls: list[str] = []

    async def health(self) -> bool:
        return self.available

    async def synthesize(self, *, text: str, voice_asset: Path, output_path: Path) -> Path:
        def write_audio() -> None:
            assert voice_asset.is_file()
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_bytes(b"RIFF\x04\x00\x00\x00WAVE")

        await asyncio.to_thread(write_audio)
        self.calls.append(text)
        return output_path


async def _create_turn(
    settings: Settings,
    *,
    with_voice: bool,
    speech_enabled: bool = True,
    speak_thoughts: bool = True,
) -> tuple[AsyncEngine, str, str]:
    settings.ensure_directories()
    engine = create_engine(settings)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = create_session_factory(engine)
    async with factory() as session:
        await seed_demo_if_empty(session)
        campaign = await session.scalar(select(CampaignModel))
        character = await session.scalar(select(CharacterModel))
        assert campaign is not None and character is not None
        if with_voice:
            voice_path = settings.data_dir / "assets" / "voice.wav"
            voice_path.write_bytes(b"RIFF\x04\x00\x00\x00WAVE")
            asset = AssetModel(
                campaign_id=campaign.id,
                kind="voice",
                relative_path="voice.wav",
                media_type="audio/wav",
                sha256="0" * 64,
            )
            session.add(asset)
            await session.flush()
            character.voice_asset_id = asset.id
        character.is_active = True
        campaign.speech_enabled = speech_enabled
        campaign.speech_speak_thoughts = speak_thoughts
        await session.commit()

        service = GameService(session)
        event = await service.start_event(campaign.id, "Speech test")
        await session.commit()
        turn = await service.add_turn(
            campaign.id,
            event.id,
            request=CreateTurnRequest(
                character_id=character.id,
                actor_name=character.name,
                actor_role=character.role,
                thought="A private thought.",
                action="A public action.",
                dice_roll=12,
            ),
        )
        await session.commit()
        return engine, campaign.id, turn.id


@pytest.mark.asyncio
async def test_speech_falls_back_to_text_when_tts_is_unavailable(settings: Settings) -> None:
    engine, campaign_id, turn_id = await _create_turn(settings, with_voice=False)
    factory = create_session_factory(engine)
    broker = FakeBroker()

    result = await synthesize_turn_speech(
        session_factory=factory,
        broker=cast(RealtimeBroker, broker),
        tts=FakeTTS(available=False),
        settings=settings,
        campaign_id=campaign_id,
        turn_id=turn_id,
    )

    assert result["generated_audio"] == []
    assert [event["payload"]["kind"] for event in broker.events] == ["thought", "action"]
    assert all(event["payload"]["audio_url"] is None for event in broker.events)
    # Без образца голоса движок даже не спрашивают: чинить надо персонажа.
    assert result["reasons"] == {"thought": "no_voice_sample", "action": "no_voice_sample"}
    await engine.dispose()


@pytest.mark.asyncio
async def test_speech_reports_why_a_cue_stayed_silent(settings: Settings) -> None:
    engine, campaign_id, turn_id = await _create_turn(settings, with_voice=True)
    factory = create_session_factory(engine)
    broker = FakeBroker()

    result = await synthesize_turn_speech(
        session_factory=factory,
        broker=cast(RealtimeBroker, broker),
        tts=FakeTTS(available=False),
        settings=settings,
        campaign_id=campaign_id,
        turn_id=turn_id,
    )

    assert result["reasons"] == {"thought": "tts_unavailable", "action": "tts_unavailable"}
    assert [event["payload"]["reason"] for event in broker.events] == [
        "tts_unavailable",
        "tts_unavailable",
    ]
    await engine.dispose()


@pytest.mark.asyncio
async def test_campaign_switch_keeps_text_but_drops_audio(settings: Settings) -> None:
    engine, campaign_id, turn_id = await _create_turn(
        settings,
        with_voice=True,
        speech_enabled=False,
    )
    factory = create_session_factory(engine)
    broker = FakeBroker()
    tts = FakeTTS(available=True)

    result = await synthesize_turn_speech(
        session_factory=factory,
        broker=cast(RealtimeBroker, broker),
        tts=tts,
        settings=settings,
        campaign_id=campaign_id,
        turn_id=turn_id,
    )

    assert tts.calls == []
    assert result["reasons"] == {"thought": "speech_disabled", "action": "speech_disabled"}
    # Реплики всё равно доезжают до зрителя — просто текстом.
    assert [event["payload"]["kind"] for event in broker.events] == ["thought", "action"]
    await engine.dispose()


@pytest.mark.asyncio
async def test_muted_thoughts_still_reach_the_spectator_as_text(settings: Settings) -> None:
    engine, campaign_id, turn_id = await _create_turn(
        settings,
        with_voice=True,
        speak_thoughts=False,
    )
    factory = create_session_factory(engine)
    broker = FakeBroker()
    tts = FakeTTS(available=True)

    result = await synthesize_turn_speech(
        session_factory=factory,
        broker=cast(RealtimeBroker, broker),
        tts=tts,
        settings=settings,
        campaign_id=campaign_id,
        turn_id=turn_id,
    )

    assert tts.calls == ["A public action."]
    assert result["generated_audio"] == ["action"]
    assert result["reasons"] == {"thought": "thoughts_muted"}
    assert [event["payload"]["kind"] for event in broker.events] == ["thought", "action"]
    await engine.dispose()


@pytest.mark.asyncio
async def test_speech_generates_and_persists_audio_for_each_cue(settings: Settings) -> None:
    engine, campaign_id, turn_id = await _create_turn(settings, with_voice=True)
    factory = create_session_factory(engine)
    broker = FakeBroker()
    tts = FakeTTS(available=True)

    result = await synthesize_turn_speech(
        session_factory=factory,
        broker=cast(RealtimeBroker, broker),
        tts=tts,
        settings=settings,
        campaign_id=campaign_id,
        turn_id=turn_id,
    )

    assert result["generated_audio"] == ["thought", "action"]
    assert tts.calls == ["A private thought.", "A public action."]
    async with factory() as session:
        turn = await session.get(TurnModel, turn_id)
        assert turn is not None
        assert turn.thought_audio_url and turn.thought_audio_url.endswith("-thought.wav")
        assert turn.action_audio_url and turn.action_audio_url.endswith("-action.wav")
        assert turn.audio_url == turn.action_audio_url
    assert [event["payload"]["kind"] for event in broker.events] == ["thought", "action"]
    await engine.dispose()
