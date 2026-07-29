from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from ai_dnd.api.routes.voice import _has_valid_signature
from ai_dnd.core.settings import Settings
from ai_dnd.integrations import voice
from ai_dnd.integrations.voice import (
    DisabledSTTProvider,
    DisabledTTSWorker,
    NexaraSTTProvider,
    create_stt_provider,
)


@pytest.mark.parametrize(
    ("media_type", "payload"),
    [
        ("audio/wav", b"RIFF\x04\x00\x00\x00WAVE"),
        ("audio/webm", b"\x1a\x45\xdf\xa3data"),
        ("video/webm", b"\x1a\x45\xdf\xa3data"),
        ("audio/ogg", b"OggSdata"),
        ("audio/mpeg", b"ID3data"),
        ("audio/mp4", b"\x00\x00\x00\x10ftypM4A "),
    ],
)
def test_audio_signatures(media_type: str, payload: bytes) -> None:
    assert _has_valid_signature(payload, media_type)
    assert not _has_valid_signature(b"invalid", media_type)


class FakeResponse:
    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, str]:
        return {"text": "  Проверка связи  "}


class FakeAsyncClient:
    def __init__(self, **_kwargs: Any) -> None:
        self.request: dict[str, Any] | None = None

    async def __aenter__(self) -> FakeAsyncClient:
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    async def post(self, url: str, **kwargs: Any) -> FakeResponse:
        self.request = {"url": url, **kwargs}
        return FakeResponse()


@pytest.mark.asyncio
async def test_nexara_adapter_returns_only_transcript(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(voice.httpx, "AsyncClient", FakeAsyncClient)
    settings = Settings(stt_api_key="test", data_dir=tmp_path)
    provider = NexaraSTTProvider(settings)
    transcript = await provider.transcribe(
        audio=b"RIFF\x04\x00\x00\x00WAVE",
        media_type="audio/wav",
    )
    assert transcript == "Проверка связи"
    assert isinstance(create_stt_provider(Settings(data_dir=tmp_path)), DisabledSTTProvider)


@pytest.mark.asyncio
async def test_disabled_voice_capabilities_are_explicit(tmp_path: Path) -> None:
    stt = DisabledSTTProvider()
    tts = DisabledTTSWorker()
    with pytest.raises(RuntimeError):
        await stt.transcribe(audio=b"", media_type="audio/wav")
    with pytest.raises(RuntimeError):
        await tts.synthesize(text="test", voice_asset=tmp_path, output_path=tmp_path)
    assert await tts.health() is False
