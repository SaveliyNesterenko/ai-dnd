import json
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ai_dnd.application.legacy import LegacyDataService, inspect_legacy_source
from ai_dnd.core.settings import Settings
from ai_dnd.infrastructure.models import AssetModel, CampaignModel, CharacterModel


def _write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def _legacy_source(tmp_path: Path) -> Path:
    source = tmp_path / "data"
    source.mkdir()
    assets = tmp_path / "assets"
    (assets / "characters").mkdir(parents=True)
    (assets / "voices").mkdir()
    (assets / "locations").mkdir()
    (assets / "audio" / "music").mkdir(parents=True)
    (assets / "characters" / "hero.png").write_bytes(b"character-image")
    (assets / "voices" / "hero.wav").write_bytes(b"voice-sample")
    (assets / "locations" / "ruins.png").write_bytes(b"location-image")
    (assets / "audio" / "music" / "theme.mp3").write_bytes(b"music-track")
    _write_json(
        source / "characters.json",
        {
            "hero": {
                "meta": {
                    "role": "Player",
                    "sprite_id": "hero.png",
                    "voice_sample": "assets/voices/hero.wav",
                },
                "identity": {"name": "Hero", "bio": "A test adventurer."},
                "stats": {
                    "hp": {"current": 10, "max": 12},
                    "mp": {"current": 3, "max": 5},
                    "attributes": {"STR": 8},
                    "status_effects": [],
                },
                "memory": {
                    "global_chronicle": ["The hero reached the ruins."],
                    "private_notes": ["A private note."],
                },
                "inventory": [],
            }
        },
    )
    _write_json(source / "npc.json", {})
    _write_json(source / "active_characters.json", {"characters_id": ["hero"]})
    _write_json(
        source / "locations.json",
        {"locations": {"Ruins": "../assets/locations/ruins.png"}},
    )
    _write_json(
        source / "public_state.json",
        {
            "current_location": {"id": "Ruins", "name": "Ruins"},
            "music": {
                "track_id": "theme.mp3",
                "url": "assets/audio/music/theme.mp3",
                "is_playing": False,
            },
        },
    )
    _write_json(source / "event_log.json", {"history": []})
    return source


def test_legacy_data_passes_dry_run(tmp_path: Path) -> None:
    _, report = inspect_legacy_source(_legacy_source(tmp_path))
    assert report.dry_run is True
    assert report.characters == 1
    assert report.active_characters == 1
    assert report.locations == 1
    assert report.missing_assets == []


@pytest.mark.asyncio
async def test_legacy_import_and_versioned_export(
    repository_session: AsyncSession,
    settings: Settings,
    tmp_path: Path,
) -> None:
    service = LegacyDataService(repository_session, settings)
    report = await service.import_source(
        _legacy_source(tmp_path),
        dry_run=False,
        campaign_name="Imported test campaign",
    )
    assert report.campaign_id is not None
    assert report.backup_dir is not None
    assert (Path(report.backup_dir) / "characters.json").is_file()
    assert report.characters == 1

    campaign = await repository_session.get(CampaignModel, report.campaign_id)
    assert campaign is not None
    assert campaign.is_active is True
    assert campaign.world_state["location"]["name"] == "Ruins"
    assert campaign.world_state["location"]["image_url"].startswith("/api/v1/assets/")
    assert campaign.world_state["music"]["url"].startswith("/api/v1/assets/")
    scene_assets = list(
        await repository_session.scalars(
            select(AssetModel).where(
                AssetModel.campaign_id == report.campaign_id,
                AssetModel.kind.in_(["location", "music"]),
            )
        )
    )
    assert {asset.kind for asset in scene_assets} == {"location", "music"}
    assert all(
        (settings.data_dir / "assets" / asset.relative_path).is_file() for asset in scene_assets
    )

    exported = await service.export_campaign(report.campaign_id)
    assert exported.schema_version == 1
    assert exported.campaign["name"] == "Imported test campaign"
    assert len(exported.characters) == 1

    character = await repository_session.scalar(
        select(CharacterModel).where(
            CharacterModel.campaign_id == report.campaign_id,
            CharacterModel.slug == "hero",
        )
    )
    assert character is not None
    character.global_chronicle = []
    character.private_notes = []
    character.avatar_asset_id = None
    await repository_session.commit()

    dry_sync = await service.sync_campaign(
        report.campaign_id,
        tmp_path / "data",
        dry_run=True,
    )
    assert dry_sync.matched_characters == 1
    assert dry_sync.updated_characters == 0
    assert dry_sync.missing_assets == []

    applied_sync = await service.sync_campaign(
        report.campaign_id,
        tmp_path / "data",
        dry_run=False,
    )
    assert applied_sync.updated_characters == 1
    await repository_session.refresh(character)
    assert character.global_chronicle == ["The hero reached the ruins."]
    assert character.private_notes == ["A private note."]
    assert character.avatar_asset_id is not None
