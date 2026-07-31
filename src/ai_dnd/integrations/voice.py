# ruff: noqa: RUF001, RUF002
from __future__ import annotations

import json
import os
from asyncio import Lock, to_thread
from dataclasses import dataclass
from importlib import import_module
from importlib.util import find_spec
from pathlib import Path
from typing import Any, ClassVar, Literal, Protocol
from uuid import uuid4

import httpx

from ai_dnd.core.settings import Settings


class STTProvider(Protocol):
    async def transcribe(self, *, audio: bytes, media_type: str) -> str: ...


class TTSWorker(Protocol):
    async def synthesize(self, *, text: str, voice_asset: Path, output_path: Path) -> Path: ...

    async def health(self) -> bool: ...


TTSStatus = Literal["ready", "off", "unavailable"]


@dataclass(frozen=True, slots=True)
class VoiceCapability:
    enabled: bool
    status: TTSStatus
    detail: str | None = None


def describe_tts_capability(settings: Settings) -> VoiceCapability:
    """Почему озвучка недоступна — вопрос ГМ-а, а не разработчика.

    Причин ровно три, и лечатся они по-разному: настройкой, установкой пакетов
    или ничем. Консоль показывает эту строку в подсказке индикатора, поэтому
    она на русском, как и остальной текст, доходящий до экрана.
    """
    if not settings.tts_enabled:
        return VoiceCapability(
            enabled=False,
            status="off",
            detail="Выключена настройкой tts_enabled.",
        )
    if settings.environment == "test":
        return VoiceCapability(
            enabled=False,
            status="off",
            detail="В тестовом окружении синтез не запускается.",
        )
    if find_spec("TTS") is None or find_spec("torch") is None:
        # Команда в подсказке не для красоты: обычный `uv run` пересобирает
        # окружение без extra и молча выносит озвучку, так что чаще всего этот
        # статус означает именно «поставьте пакеты обратно».
        return VoiceCapability(
            enabled=False,
            status="unavailable",
            detail="Пакеты не установлены: uv sync --locked --extra voice",
        )
    return VoiceCapability(enabled=True, status="ready")


class DisabledSTTProvider:
    async def transcribe(self, *, audio: bytes, media_type: str) -> str:
        raise RuntimeError("STT provider is not configured.")


class DisabledTTSWorker:
    async def synthesize(self, *, text: str, voice_asset: Path, output_path: Path) -> Path:
        raise RuntimeError("TTS worker is not configured.")

    async def health(self) -> bool:
        return False


class CoquiTTSWorker:
    def __init__(self, settings: Settings) -> None:
        self._model_name = settings.tts_model
        self._language = settings.tts_language
        self._temperature = settings.tts_temperature
        self._model: Any | None = None
        self._load_lock = Lock()
        self._synthesis_lock = Lock()
        self._fallback_data_dir = settings.data_dir

    async def _get_model(self) -> Any:
        if self._model is not None:
            return self._model
        async with self._load_lock:
            if self._model is None:
                self._model = await to_thread(self._load_model)
        return self._model

    def _load_model(self) -> Any:
        if os.name == "nt" and "TTS_HOME" not in os.environ:
            os.environ["TTS_HOME"] = os.environ.get(
                "LOCALAPPDATA",
                str(self._fallback_data_dir),
            )
        torch = import_module("torch")
        tts_class = import_module("TTS.api").TTS
        device = "cuda" if torch.cuda.is_available() else "cpu"
        return tts_class(self._model_name).to(device)

    async def synthesize(self, *, text: str, voice_asset: Path, output_path: Path) -> Path:
        def prepare_paths() -> None:
            if not voice_asset.is_file():
                raise FileNotFoundError("Character voice sample is missing.")
            output_path.parent.mkdir(parents=True, exist_ok=True)

        await to_thread(prepare_paths)
        async with self._synthesis_lock:
            model = await self._get_model()
            await to_thread(
                model.tts_to_file,
                text=text,
                speaker_wav=str(voice_asset),
                language=self._language,
                file_path=str(output_path),
                temperature=self._temperature,
            )
        if not await to_thread(output_path.is_file):
            raise RuntimeError("TTS worker did not create an audio file.")
        return output_path

    async def health(self) -> bool:
        return find_spec("TTS") is not None and find_spec("torch") is not None


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


def create_tts_worker(settings: Settings) -> TTSWorker:
    if not describe_tts_capability(settings).enabled:
        return DisabledTTSWorker()
    return CoquiTTSWorker(settings)
