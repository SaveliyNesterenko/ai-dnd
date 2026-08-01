from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from ai_dnd.api.dependencies import GMDep, SessionDep, SettingsDep
from ai_dnd.api.schemas import CampaignPackImportReport
from ai_dnd.application.campaign_pack import CampaignPackService
from ai_dnd.domain.errors import ValidationError

router = APIRouter(prefix="/campaign-packs", tags=["campaign packs"])


@router.post(
    "/import",
    response_model=CampaignPackImportReport,
    status_code=status.HTTP_201_CREATED,
)
async def import_campaign_pack(
    session: SessionDep,
    settings: SettingsDep,
    gm: GMDep,
    file: Annotated[UploadFile, File()],
) -> CampaignPackImportReport:
    del gm
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise ValidationError("Выберите пакет кампании в формате ZIP.")
    payload = await file.read(settings.max_campaign_pack_bytes + 1)
    await file.close()
    if not payload:
        raise ValidationError("Пакет кампании пуст.")
    if len(payload) > settings.max_campaign_pack_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="Пакет кампании превышает допустимый размер.",
        )
    result = await CampaignPackService(session, settings).import_payload(payload)
    return CampaignPackImportReport.model_validate(result)
