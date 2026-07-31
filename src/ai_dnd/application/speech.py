from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, Literal

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ai_dnd.application.jobs import BackgroundJobManager
from ai_dnd.application.realtime import RealtimeBroker
from ai_dnd.core.logging import get_logger
from ai_dnd.core.settings import Settings
from ai_dnd.infrastructure.models import (
    AssetModel,
    BackgroundJobModel,
    CampaignModel,
    CharacterModel,
    TurnModel,
)
from ai_dnd.integrations.voice import TTSWorker

SPEECH_JOB_KIND = "speech_synthesis"

# Почему реплика ушла без звука. Единственный источник правды для консоли: без
# этого поля она не отличает выключенную озвучку от сломанного синтеза.
SpeechReason = Literal[
    "speech_disabled",
    "thoughts_muted",
    "no_voice_sample",
    "tts_unavailable",
    "synthesis_failed",
]


def _resolve_voice_asset(settings: Settings, asset: AssetModel | None) -> Path | None:
    if asset is None:
        return None
    asset_root = (settings.data_dir / "assets").resolve()
    path = (asset_root / asset.relative_path).resolve()
    if asset_root not in path.parents or not path.is_file():
        return None
    return path


async def submit_speech_job(
    *,
    jobs: BackgroundJobManager,
    broker: RealtimeBroker,
    tts: TTSWorker,
    settings: Settings,
    speech_lock: asyncio.Lock,
    campaign_id: str,
    turn_id: str,
    character_id: str | None,
    actor_name: str,
) -> BackgroundJobModel:
    """Синтез идёт по одной реплике за раз, поэтому очередь реальна и её видно
    в консоли: имя персонажа кладём в input_data, чтобы список задач читался
    без похода за каждым ходом отдельно."""

    async def run_speech_synthesis() -> dict[str, Any]:
        async with speech_lock:
            return await synthesize_turn_speech(
                session_factory=jobs.session_factory,
                broker=broker,
                tts=tts,
                settings=settings,
                campaign_id=campaign_id,
                turn_id=turn_id,
            )

    return await jobs.submit(
        kind=SPEECH_JOB_KIND,
        campaign_id=campaign_id,
        input_data={
            "turn_id": turn_id,
            "character_id": character_id,
            "actor_name": actor_name,
        },
        runner=run_speech_synthesis,
    )


async def synthesize_turn_speech(
    *,
    session_factory: async_sessionmaker[AsyncSession],
    broker: RealtimeBroker,
    tts: TTSWorker,
    settings: Settings,
    campaign_id: str,
    turn_id: str,
) -> dict[str, Any]:
    async with session_factory() as session:
        turn = await session.get(TurnModel, turn_id)
        if not turn or not turn.character_id:
            return {"turn_id": turn_id, "cues": []}
        character = await session.get(CharacterModel, turn.character_id)
        voice_asset = (
            await session.get(AssetModel, character.voice_asset_id)
            if character and character.voice_asset_id
            else None
        )
        campaign = await session.get(CampaignModel, campaign_id)
        speech_enabled = campaign.speech_enabled if campaign else True
        speak_thoughts = campaign.speech_speak_thoughts if campaign else True
        voice_path = _resolve_voice_asset(settings, voice_asset)
        actor_name = turn.actor_name
        character_id = turn.character_id
        thought = turn.thought
        action = turn.action
        dice_roll = turn.dice_roll

    tts_available = False
    if speech_enabled and voice_path is not None:
        try:
            tts_available = await tts.health()
        except Exception:
            get_logger().exception("tts_health_check_failed", turn_id=turn_id)

    def blocked_reason(kind: str) -> SpeechReason | None:
        """Проверки идут в порядке «что чинить первым»: общий тумблер, затем
        образец голоса, затем движок, и только потом частный запрет мыслей."""
        if not speech_enabled:
            return "speech_disabled"
        if voice_path is None:
            return "no_voice_sample"
        if not tts_available:
            return "tts_unavailable"
        if kind == "thought" and not speak_thoughts:
            return "thoughts_muted"
        return None

    generated: list[str] = []
    reasons: dict[str, str] = {}
    cues = (("thought", thought), ("action", action))
    for kind, text in cues:
        if not text:
            continue

        audio_url: str | None = None
        reason = blocked_reason(kind)
        if reason is None and voice_path is not None:
            filename = f"{turn_id}-{kind}.wav"
            output_path = settings.data_dir / "generated-audio" / filename
            try:
                audio_path = await tts.synthesize(
                    text=text,
                    voice_asset=voice_path,
                    output_path=output_path,
                )
                audio_url = f"/api/v1/assets/generated-audio/{audio_path.name}"
                field_name = f"{kind}_audio_url"
                async with session_factory() as session:
                    current_turn = await session.get(TurnModel, turn_id)
                    if current_turn:
                        setattr(current_turn, field_name, audio_url)
                        if kind == "action":
                            current_turn.audio_url = audio_url
                        await session.commit()
                generated.append(kind)
            except Exception:
                get_logger().exception(
                    "speech_synthesis_failed",
                    turn_id=turn_id,
                    cue_kind=kind,
                )
                reason = "synthesis_failed"

        if reason is not None:
            reasons[kind] = reason

        await broker.publish(
            campaign_id=campaign_id,
            event_type="speech.ready",
            payload={
                "turn_id": turn_id,
                "character_id": character_id,
                "actor_name": actor_name,
                "kind": kind,
                "text": text,
                "audio_url": audio_url,
                "reason": reason,
                "dice_roll": dice_roll if kind == "action" else None,
            },
        )

    return {
        "turn_id": turn_id,
        "cues": [kind for kind, text in cues if text],
        "generated_audio": generated,
        "reasons": reasons,
    }
