# ruff: noqa: RUF001
from __future__ import annotations

import hashlib
import io
import json
import re
import zipfile
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ai_dnd import __version__
from ai_dnd.core.settings import Settings
from ai_dnd.domain.errors import ValidationError
from ai_dnd.infrastructure.models import (
    AssetModel,
    CampaignModel,
    CharacterModel,
    InventoryItemModel,
    LocationModel,
    MusicTrackModel,
    SceneCharacterModel,
    SceneModel,
    StatusEffectModel,
)

PACK_FORMAT = "ai-dnd-campaign-pack/v1"
REQUIRED_DOCUMENTS = {"manifest.json", "README.md", "LICENSES.md", "ASSET_GUIDE.md"}
MAX_UNCOMPRESSED_PACK_BYTES = 256 * 1024 * 1024
MEDIA_TYPES = {
    ".png": "image/png",
    ".webp": "image/webp",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
}


def _matches_media_signature(media_type: str, data: bytes) -> bool:
    if media_type == "image/png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if media_type == "image/webp":
        return len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    if media_type == "audio/wav":
        return len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WAVE"
    if media_type == "audio/ogg":
        return data.startswith(b"OggS")
    return data.startswith(b"ID3") or (
        len(data) >= 2 and data[0] == 0xFF and data[1] & 0xE0 == 0xE0
    )


@dataclass(frozen=True)
class PackInspection:
    manifest: dict[str, Any]
    asset_bytes: dict[str, bytes]


def _slug(value: object, label: str) -> str:
    value = str(value)
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,78}[a-z0-9]|[a-z0-9]", value):
        raise ValidationError(f"Некорректный slug ({label}): {value!r}")
    return value


def _entry_path(value: object) -> str:
    path = PurePosixPath(str(value))
    if (
        path.is_absolute()
        or ".." in path.parts
        or str(path) == "."
        or not str(path).startswith("assets/")
    ):
        raise ValidationError(f"Некорректный путь к ассету: {value!r}")
    return str(path)


def _version_tuple(value: object, label: str) -> tuple[int, int, int]:
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", str(value))
    if not match:
        raise ValidationError(f"Некорректная версия {label}: {value!r}")
    return tuple(map(int, match.groups()))  # type: ignore[return-value]


def inspect_campaign_pack(payload: bytes) -> PackInspection:
    try:
        archive = zipfile.ZipFile(io.BytesIO(payload))
    except zipfile.BadZipFile as error:
        raise ValidationError("Пакет кампании не является корректным ZIP-архивом.") from error
    with archive:
        entries = archive.infolist()
        raw_names = [entry.filename for entry in entries]
        names = set(raw_names)
        if len(names) != len(raw_names):
            raise ValidationError("Архив кампании содержит повторяющиеся пути.")
        if sum(entry.file_size for entry in entries) > MAX_UNCOMPRESSED_PACK_BYTES:
            raise ValidationError("Распакованный архив кампании превышает допустимый размер.")
        missing = REQUIRED_DOCUMENTS - names
        if missing:
            raise ValidationError(
                f"В пакете кампании отсутствуют файлы: {', '.join(sorted(missing))}"
            )
        if any(
            PurePosixPath(name).is_absolute() or ".." in PurePosixPath(name).parts for name in names
        ):
            raise ValidationError("Пакет кампании содержит небезопасный путь.")
        try:
            manifest = json.loads(archive.read("manifest.json"))
        except (KeyError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValidationError("manifest.json должен быть корректным JSON в UTF-8.") from error
        if not isinstance(manifest, dict) or manifest.get("format") != PACK_FORMAT:
            raise ValidationError(f"Формат пакета не поддерживается; ожидается {PACK_FORMAT}.")
        minimum_version = _version_tuple(manifest.get("minimum_app_version"), "пакета")
        current_version = _version_tuple(__version__, "приложения")
        if minimum_version > current_version:
            raise ValidationError(
                f"Пакету кампании требуется версия приложения "
                f"{manifest.get('minimum_app_version')}; установлена версия {__version__}."
            )
        assets = manifest.get("assets")
        if not isinstance(assets, list) or not assets:
            raise ValidationError("В пакете кампании должен быть указан хотя бы один ассет.")
        asset_bytes: dict[str, bytes] = {}
        for asset in assets:
            if not isinstance(asset, dict):
                raise ValidationError("Каждое описание ассета должно быть объектом.")
            path = _entry_path(asset.get("path"))
            if path in asset_bytes or path not in names:
                raise ValidationError(f"Ассет отсутствует или указан дважды: {path}")
            extension = PurePosixPath(path).suffix.lower()
            media_type = MEDIA_TYPES.get(extension)
            if not media_type or asset.get("media_type") != media_type:
                raise ValidationError(f"Тип медиа не поддерживается или не совпадает: {path}")
            if not isinstance(asset.get("license"), str) or not asset["license"].strip():
                raise ValidationError(f"Для ассета не указана лицензия: {path}")
            data = archive.read(path)
            if not _matches_media_signature(media_type, data):
                raise ValidationError(f"Содержимое ассета не соответствует типу медиа: {path}")
            if hashlib.sha256(data).hexdigest() != asset.get("sha256"):
                raise ValidationError(f"SHA-256 не совпадает: {path}")
            if path not in archive.read("LICENSES.md").decode("utf-8", errors="replace"):
                raise ValidationError(f"Ассет не описан в LICENSES.md: {path}")
            asset_bytes[path] = data
        packed_assets = {
            name for name in names if name.startswith("assets/") and not name.endswith("/")
        }
        undeclared = packed_assets - set(asset_bytes)
        if undeclared:
            raise ValidationError(
                f"В архиве есть незаявленные ассеты: {', '.join(sorted(undeclared))}"
            )
    _validate_manifest_references(manifest, asset_bytes)
    return PackInspection(manifest=manifest, asset_bytes=asset_bytes)


def _validate_manifest_references(manifest: dict[str, Any], assets: dict[str, bytes]) -> None:
    campaign = manifest.get("campaign")
    if not isinstance(campaign, dict) or not str(campaign.get("name", "")).strip():
        raise ValidationError("Не указано название кампании.")
    _slug(campaign.get("slug"), "campaign")
    characters = manifest.get("characters")
    locations = manifest.get("locations")
    tracks = manifest.get("music_tracks")
    scene = manifest.get("scene")
    if (
        not isinstance(characters, list)
        or not isinstance(locations, list)
        or not isinstance(tracks, list)
    ):
        raise ValidationError("characters, locations и music_tracks должны быть массивами.")
    if not isinstance(scene, dict):
        raise ValidationError("Не указана стартовая сцена.")
    for collection, label in (
        (characters, "character"),
        (locations, "location"),
        (tracks, "music"),
    ):
        slugs = [_slug(item.get("slug"), label) for item in collection if isinstance(item, dict)]
        if len(slugs) != len(collection) or len(slugs) != len(set(slugs)):
            raise ValidationError(f"Slug элементов категории {label} должны быть уникальными.")
    for character in characters:
        if character.get("kind") not in {"player", "npc", "enemy"}:
            raise ValidationError(f"Некорректный тип персонажа: {character.get('slug')!r}")
        for key in ("portrait", "avatar", "voice"):
            if _entry_path(character.get("assets", {}).get(key)) not in assets:
                raise ValidationError(
                    f"У персонажа {character.get('slug')!r} отсутствует ассет {key}."
                )
    for item, key in [(location, "asset") for location in locations] + [
        (track, "asset") for track in tracks
    ]:
        if _entry_path(item.get(key)) not in assets:
            raise ValidationError(f"Отсутствует ассет для {item.get('slug')!r}")
    if scene.get("location_slug") not in {item["slug"] for item in locations}:
        raise ValidationError("Стартовая сцена ссылается на неизвестную локацию.")
    if scene.get("music_track_slug") not in {item["slug"] for item in tracks}:
        raise ValidationError("Стартовая сцена ссылается на неизвестный музыкальный трек.")


class CampaignPackService:
    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self.session = session
        self.settings = settings

    async def import_payload(self, payload: bytes) -> dict[str, Any]:
        inspection = inspect_campaign_pack(payload)
        manifest = inspection.manifest
        campaign_data = manifest["campaign"]
        created_files: list[PurePosixPath] = []
        try:
            await self.session.execute(
                update(CampaignModel)
                .where(CampaignModel.is_active.is_(True))
                .values(is_active=False)
            )
            campaign = CampaignModel(
                slug=await self._unique_slug(_slug(campaign_data["slug"], "campaign")),
                name=str(campaign_data["name"]),
                is_active=True,
                global_chronicle=[str(item) for item in campaign_data.get("global_chronicle", [])],
                world_state=dict(campaign_data.get("world_state", {})),
            )
            self.session.add(campaign)
            await self.session.flush()
            declared_assets = {item["path"]: item for item in manifest["assets"]}
            assets = await self._store_assets(
                campaign.id, inspection.asset_bytes, declared_assets, created_files
            )
            locations: dict[str, LocationModel] = {}
            for order, item in enumerate(manifest["locations"]):
                location = LocationModel(
                    campaign_id=campaign.id,
                    slug=item["slug"],
                    name=item["name"],
                    asset_id=assets[item["asset"]].id,
                    sort_order=order,
                )
                self.session.add(location)
                await self.session.flush()
                locations[item["slug"]] = location
            tracks: dict[str, MusicTrackModel] = {}
            for order, item in enumerate(manifest["music_tracks"]):
                track = MusicTrackModel(
                    campaign_id=campaign.id,
                    slug=item["slug"],
                    name=item["name"],
                    asset_id=assets[item["asset"]].id,
                    sort_order=order,
                )
                self.session.add(track)
                await self.session.flush()
                tracks[item["slug"]] = track
            scene_data = manifest["scene"]
            self.session.add(
                SceneModel(
                    campaign_id=campaign.id,
                    location_id=locations[scene_data["location_slug"]].id,
                    music_track_id=tracks[scene_data["music_track_slug"]].id,
                    music_is_playing=bool(scene_data.get("music_is_playing", False)),
                    music_volume=int(scene_data.get("music_volume", 50)),
                    avatar_size=int(scene_data.get("avatar_size", 270)),
                )
            )
            for fallback_order, item in enumerate(manifest["characters"]):
                stats = item.get("stats", {})
                character = CharacterModel(
                    campaign_id=campaign.id,
                    slug=item["slug"],
                    name=item["name"],
                    kind=item["kind"],
                    role=str(item.get("role", item["kind"])),
                    biography=str(item.get("biography", "")),
                    model_id=item.get("model_id"),
                    is_active=bool(item.get("is_active", False)),
                    hp_current=int(stats.get("hp_current", 0)),
                    hp_max=int(stats.get("hp_max", 0)),
                    mp_current=int(stats.get("mp_current", 0)),
                    mp_max=int(stats.get("mp_max", 0)),
                    attributes=dict(stats.get("attributes", {})),
                    global_chronicle=[str(v) for v in item.get("global_chronicle", [])],
                    private_notes=[str(v) for v in item.get("private_notes", [])],
                    portrait_asset_id=assets[item["assets"]["portrait"]].id,
                    avatar_asset_id=assets[item["assets"]["avatar"]].id,
                    voice_asset_id=assets[item["assets"]["voice"]].id,
                )
                self.session.add(character)
                await self.session.flush()
                self.session.add_all(
                    [
                        InventoryItemModel(
                            character_id=character.id,
                            name=str(v["name"]),
                            quantity=int(v.get("quantity", 1)),
                            description=str(v.get("description", "")),
                        )
                        for v in item.get("inventory", [])
                        if isinstance(v, dict) and v.get("name")
                    ]
                )
                self.session.add_all(
                    [
                        StatusEffectModel(character_id=character.id, name=str(v))
                        for v in stats.get("status_effects", [])
                        if str(v).strip()
                    ]
                )
                position = item.get("scene", {})
                self.session.add(
                    SceneCharacterModel(
                        campaign_id=campaign.id,
                        character_id=character.id,
                        is_visible=bool(position.get("is_visible", item.get("is_active", False))),
                        x=int(position.get("x", 50)),
                        y=int(position.get("y", 75)),
                        order=int(position.get("order", fallback_order)),
                        flip_x=bool(position.get("flip_x", False)),
                        scale=int(position.get("scale", 100)),
                    )
                )
            await self.session.commit()
            return {
                "campaign_id": campaign.id,
                "campaign_name": campaign.name,
                "characters": len(manifest["characters"]),
                "locations": len(locations),
                "music_tracks": len(tracks),
            }
        except Exception:
            await self.session.rollback()
            for path in created_files:
                (self.settings.data_dir / "assets" / path).unlink(missing_ok=True)
            raise

    async def _unique_slug(self, base: str) -> str:
        slug, suffix = base, 2
        while await self.session.scalar(select(CampaignModel.id).where(CampaignModel.slug == slug)):
            slug = f"{base[:75]}-{suffix}"
            suffix += 1
        return slug

    async def _store_assets(
        self,
        campaign_id: str,
        values: dict[str, bytes],
        declarations: dict[str, dict[str, Any]],
        created: list[PurePosixPath],
    ) -> dict[str, AssetModel]:
        result: dict[str, AssetModel] = {}
        for path, data in values.items():
            declaration = declarations[path]
            extension = PurePosixPath(path).suffix.lower()
            relative = (
                PurePosixPath(campaign_id) / f"{hashlib.sha256(data).hexdigest()[:20]}{extension}"
            )
            destination = self.settings.data_dir / "assets" / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            created.append(relative)
            model = AssetModel(
                campaign_id=campaign_id,
                kind=str(declaration.get("kind", "campaign_pack")),
                relative_path=str(relative),
                media_type=declaration["media_type"],
                sha256=declaration["sha256"],
                license_name=declaration["license"],
            )
            self.session.add(model)
            await self.session.flush()
            result[path] = model
        return result
