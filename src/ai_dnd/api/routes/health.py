from fastapi import APIRouter
from sqlalchemy import text

from ai_dnd import __version__
from ai_dnd.api.dependencies import SessionDep, SettingsDep
from ai_dnd.api.schemas import CapabilityView, TTSCapabilityView
from ai_dnd.integrations.voice import describe_tts_capability

router = APIRouter(tags=["system"])


@router.get("/health/live")
async def live() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/ready")
async def ready(session: SessionDep) -> dict[str, str]:
    await session.execute(text("SELECT 1"))
    return {"status": "ready"}


@router.get("/version")
async def version() -> dict[str, str]:
    return {"version": __version__}


@router.get("/capabilities", response_model=CapabilityView)
async def capabilities(settings: SettingsDep) -> CapabilityView:
    tts = describe_tts_capability(settings)
    return CapabilityView(
        llm_enabled=bool(settings.openai_api_key),
        stt_enabled=bool(settings.stt_api_key),
        tts_enabled=tts.enabled,
        tts=TTSCapabilityView(status=tts.status, detail=tts.detail),
    )
