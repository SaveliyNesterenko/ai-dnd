from __future__ import annotations

from typing import Annotated, Final

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from ai_dnd.api.dependencies import (
    GMDep,
    JobManagerDep,
    SessionDep,
    SettingsDep,
    STTProviderDep,
)
from ai_dnd.api.schemas import BackgroundJobView
from ai_dnd.application.jobs import DegradedJobError
from ai_dnd.domain.errors import NotFoundError
from ai_dnd.infrastructure.models import BackgroundJobModel
from ai_dnd.integrations.voice import DisabledSTTProvider

router = APIRouter(prefix="/voice/jobs", tags=["voice"])

ALLOWED_MEDIA_TYPES: Final = {
    "audio/wav",
    "audio/webm",
    "video/webm",
    "audio/ogg",
    "audio/mpeg",
    "audio/mp4",
}


def _has_valid_signature(audio: bytes, media_type: str) -> bool:
    if media_type == "audio/wav":
        return len(audio) >= 12 and audio[:4] == b"RIFF" and audio[8:12] == b"WAVE"
    if media_type in {"audio/webm", "video/webm"}:
        return audio.startswith(b"\x1a\x45\xdf\xa3")
    if media_type == "audio/ogg":
        return audio.startswith(b"OggS")
    if media_type == "audio/mpeg":
        return audio.startswith(b"ID3") or (
            len(audio) >= 2 and audio[0] == 0xFF and audio[1] & 0xE0 == 0xE0
        )
    if media_type == "audio/mp4":
        return len(audio) >= 12 and audio[4:8] == b"ftyp"
    return False


@router.post(
    "/transcription",
    response_model=BackgroundJobView,
    status_code=status.HTTP_202_ACCEPTED,
)
async def transcribe_audio(
    settings: SettingsDep,
    jobs: JobManagerDep,
    stt: STTProviderDep,
    gm: GMDep,
    file: Annotated[UploadFile, File()],
) -> BackgroundJobModel:
    del gm
    media_type = (file.content_type or "").split(";", 1)[0].strip().lower()
    if media_type not in ALLOWED_MEDIA_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Unsupported audio media type.",
        )
    audio = await file.read(settings.max_upload_bytes + 1)
    await file.close()
    if not audio:
        raise HTTPException(status_code=400, detail="Audio payload is empty.")
    if len(audio) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="Audio payload is too large.")
    if not _has_valid_signature(audio, media_type):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Audio content does not match its declared media type.",
        )

    async def runner() -> dict[str, str]:
        if isinstance(stt, DisabledSTTProvider):
            raise DegradedJobError(
                "STT provider is not configured.",
                output_data={"transcript": ""},
            )
        transcript = await stt.transcribe(audio=audio, media_type=media_type)
        return {"transcript": transcript}

    return await jobs.submit(
        kind="transcription",
        campaign_id=None,
        input_data={"media_type": media_type, "size_bytes": len(audio)},
        runner=runner,
    )


@router.get("/{job_id}", response_model=BackgroundJobView)
async def get_voice_job(
    job_id: str,
    session: SessionDep,
    gm: GMDep,
) -> BackgroundJobModel:
    del gm
    job = await session.get(BackgroundJobModel, job_id)
    if not job or job.kind != "transcription":
        raise NotFoundError("Voice job not found.")
    return job
