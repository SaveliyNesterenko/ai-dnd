from pathlib import Path

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

from ai_dnd.api.dependencies import SessionDep, SettingsDep
from ai_dnd.infrastructure.models import AssetModel

router = APIRouter(prefix="/assets", tags=["assets"])


@router.get("/{asset_id}")
async def get_asset(asset_id: str, session: SessionDep, settings: SettingsDep) -> FileResponse:
    asset = await session.get(AssetModel, asset_id)
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found.")
    asset_root = (settings.data_dir / "assets").resolve()
    path = (asset_root / asset.relative_path).resolve()
    if asset_root not in path.parents or not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset file not found.")
    return FileResponse(
        Path(path),
        media_type=asset.media_type,
        filename=path.name,
        content_disposition_type="inline",
    )
