from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from ai_dnd.application.legacy import LegacyDataService, inspect_legacy_source
from ai_dnd.core.settings import Settings

LEGACY_SOURCE = Path(__file__).resolve().parents[2] / "data"


def test_existing_legacy_data_passes_dry_run() -> None:
    _, report = inspect_legacy_source(LEGACY_SOURCE)
    assert report.dry_run is True
    assert report.characters == 40
    assert report.active_characters >= 1


@pytest.mark.asyncio
async def test_legacy_import_and_versioned_export(
    repository_session: AsyncSession,
    settings: Settings,
) -> None:
    service = LegacyDataService(repository_session, settings)
    report = await service.import_source(
        LEGACY_SOURCE,
        dry_run=False,
        campaign_name="Imported test campaign",
    )
    assert report.campaign_id is not None
    assert report.backup_dir is not None
    assert (Path(report.backup_dir) / "characters.json").is_file()
    assert report.characters == 40

    exported = await service.export_campaign(report.campaign_id)
    assert exported.schema_version == 1
    assert exported.campaign["name"] == "Imported test campaign"
    assert len(exported.characters) == 40
