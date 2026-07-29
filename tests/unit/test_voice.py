from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from ai_dnd.api.routes.voice import _has_valid_signature
from ai_dnd.core.settings import Settings
from ai_dnd.integrations import voice
from ai_dnd.integrations.voice import (
    CoquiTTSWorker,
    DisabledSTTProvider,
    DisabledTTSWorker,
    NexaraSTTProvider,
    create_stt_provider,
    create_tts_worker,
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


def test_generated_speech_audio_is_served_from_runtime_storage(
    client: Any,
    settings: Settings,
) -> None:
    settings.ensure_directories()
    audio_path = settings.data_dir / "generated-audio" / "turn-thought.wav"
    audio_path.write_bytes(b"RIFF\x04\x00\x00\x00WAVE")

    response = client.get("/api/v1/assets/generated-audio/turn-thought.wav")

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert response.content == audio_path.read_bytes()
    assert client.get("/api/v1/assets/generated-audio/not-a-wave.mp3").status_code == 404
    assert client.get("/api/v1/assets/generated-audio/missing.wav").status_code == 404


def test_tts_factory_enables_lazy_coqui_worker(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(voice, "find_spec", lambda _module: object())

    worker = create_tts_worker(Settings(environment="development", data_dir=tmp_path))

    assert isinstance(worker, CoquiTTSWorker)
