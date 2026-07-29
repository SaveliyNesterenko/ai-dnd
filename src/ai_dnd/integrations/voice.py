from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import ClassVar, Protocol
from uuid import uuid4

import httpx

from ai_dnd.core.settings import Settings


class STTProvider(Protocol):
    async def transcribe(self, *, audio: bytes, media_type: str) -> str: ...


class TTSWorker(Protocol):
    async def synthesize(self, *, text: str, voice_asset: Path, output_path: Path) -> Path: ...

    async def health(self) -> bool: ...


@dataclass(frozen=True, slots=True)
class VoiceCapability:
    enabled: bool
    status: str
    detail: str | None = None


class DisabledSTTProvider:
    async def transcribe(self, *, audio: bytes, media_type: str) -> str:
        raise RuntimeError("STT provider is not configured.")


class DisabledTTSWorker:
    async def synthesize(self, *, text: str, voice_asset: Path, output_path: Path) -> Path:
        raise RuntimeError("TTS worker is not configured.")

    async def health(self) -> bool:
        return False


class NexaraSTTProvider:
    _EXTENSIONS: ClassVar[dict[str, str]] = {
        "audio/wav": ".wav",
        "audio/webm": ".webm",
        "video/webm": ".webm",
        "audio/ogg": ".ogg",
        "audio/mpeg": ".mp3",
        "audio/mp4": ".m4a",
    }

    def __init__(self, settings: Settings) -> None:
        if not settings.stt_api_key:
            raise ValueError("stt_api_key is required")
        self._api_key = settings.stt_api_key
        self._base_url = settings.stt_base_url.rstrip("/")
        self._timeout = settings.stt_timeout_seconds

    async def transcribe(self, *, audio: bytes, media_type: str) -> str:
        extension = self._EXTENSIONS.get(media_type)
        if not extension:
            raise ValueError("Unsupported audio media type.")
        filename = f"{uuid4()}{extension}"
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(
                f"{self._base_url}/audio/transcriptions",
                headers={"Authorization": f"Bearer {self._api_key}"},
                files={"file": (filename, audio, media_type)},
                data={"response_format": "json", "language": "ru"},
            )
        response.raise_for_status()
        try:
            payload = response.json()
        except json.JSONDecodeError as error:
            raise RuntimeError("STT provider returned invalid JSON.") from error
        text = payload.get("text") if isinstance(payload, dict) else None
        if not isinstance(text, str) or not text.strip():
            raise RuntimeError("STT provider returned an empty transcript.")
        return text.strip()


def create_stt_provider(settings: Settings) -> STTProvider:
    if not settings.stt_api_key:
        return DisabledSTTProvider()
    return NexaraSTTProvider(settings)
