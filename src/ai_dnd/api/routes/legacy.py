from pathlib import Path

from fastapi import APIRouter

from ai_dnd.api.dependencies import GMDep, SessionDep, SettingsDep
from ai_dnd.api.schemas import LegacyExportV1, LegacyImportReport, LegacyImportRequest
from ai_dnd.application.legacy import LegacyDataService

router = APIRouter(prefix="/legacy", tags=["legacy migration"])


@router.post("/import", response_model=LegacyImportReport)
async def import_legacy(
    request: LegacyImportRequest,
    session: SessionDep,
    settings: SettingsDep,
    gm: GMDep,
) -> LegacyImportReport:
    del gm
    return await LegacyDataService(session, settings).import_source(
        Path(request.source_dir),
        dry_run=request.dry_run,
    )


@router.get("/campaigns/{campaign_id}/export", response_model=LegacyExportV1)
async def export_campaign(
    campaign_id: str,
    session: SessionDep,
    settings: SettingsDep,
    gm: GMDep,
) -> LegacyExportV1:
    del gm
    return await LegacyDataService(session, settings).export_campaign(campaign_id)
