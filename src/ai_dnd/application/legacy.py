from __future__ import annotations

import hashlib
import json
import re
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ai_dnd.api.schemas import LegacyExportV1, LegacyImportReport, LegacySyncReport
from ai_dnd.core.settings import Settings
from ai_dnd.domain.errors import ConflictError, ValidationError
from ai_dnd.infrastructure.models import (
    AssetModel,
    CampaignModel,
    CharacterModel,
    GameEventModel,
    GameEventParticipantModel,
    InventoryItemModel,
    LocationModel,
    MusicTrackModel,
    SceneCharacterModel,
    SceneModel,
    StatusEffectModel,
    TurnModel,
)

EXPECTED_FILES = (
    "characters.json",
    "npc.json",
    "active_characters.json",
    "locations.json",
    "public_state.json",
    "event_log.json",
)


def _load_document(source: Path, filename: str) -> dict[str, Any]:
    path = source / filename
    if not path.is_file():
        raise ValidationError(f"Required legacy file is missing: {filename}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValidationError(f"Invalid legacy JSON file: {filename}") from error
    if not isinstance(value, dict):
        raise ValidationError(f"Legacy file must contain a JSON object: {filename}")
    return value


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:72] or f"campaign-{uuid4().hex[:8]}"


def _resolve_legacy_asset(source: Path, raw_path: str) -> Path:
    normalized = raw_path.replace("\\", "/").lstrip("./")
    candidates = [source / normalized, source.parent / normalized, Path.cwd() / normalized]
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved.is_file():
            return resolved
    return candidates[0].resolve()


def _character_kind(role: object) -> str:
    normalized = str(role or "").strip().lower()
    if normalized == "player":
        return "player"
    if normalized == "enemy":
        return "enemy"
    return "npc"


def _legacy_avatar_path(source: Path, character_id: str, meta: dict[str, Any]) -> str:
    primary = f"assets/characters/{character_id}.png"
    if _resolve_legacy_asset(source, primary).is_file():
        return primary
    base_character_id = re.sub(r"_\d+$", "", character_id)
    duplicate_fallback = f"assets/characters/{base_character_id}.png"
    if _resolve_legacy_asset(source, duplicate_fallback).is_file():
        return duplicate_fallback
    sprite_name = Path(str(meta.get("sprite_id") or "")).stem
    if sprite_name.endswith("_portrait"):
        fallback = f"assets/characters/{sprite_name.removesuffix('_portrait')}.png"
        if _resolve_legacy_asset(source, fallback).is_file():
            return fallback
    return primary


def inspect_legacy_source(source_dir: Path) -> tuple[dict[str, dict[str, Any]], LegacyImportReport]:
    source = source_dir.resolve()
    documents = {filename: _load_document(source, filename) for filename in EXPECTED_FILES}
    characters = {
        **documents["characters.json"],
        **documents["npc.json"],
    }
    active = documents["active_characters.json"].get("characters_id", [])
    locations = documents["locations.json"].get("locations", {})
    history = documents["event_log.json"].get("history", [])
    if (
        not isinstance(active, list)
        or not isinstance(locations, dict)
        or not isinstance(history, list)
    ):
        raise ValidationError("Legacy state has an invalid collection shape.")

    missing_assets: set[str] = set()
    warnings: list[str] = []
    for character_id, data in characters.items():
        if not isinstance(data, dict):
            raise ValidationError(f"Character '{character_id}' must be an object.")
        meta = data.get("meta", {})
        sprite = meta.get("sprite_id")
        if sprite:
            sprite_name = str(sprite)
            if not Path(sprite_name).suffix:
                sprite_name += ".png"
            raw_sprite_path = f"assets/characters/{sprite_name}"
            if not _resolve_legacy_asset(source, raw_sprite_path).is_file():
                missing_assets.add(raw_sprite_path)
        voice = meta.get("voice_sample")
        if voice and not _resolve_legacy_asset(source, str(voice)).is_file():
            missing_assets.add(str(voice))
        avatar_path = _legacy_avatar_path(source, str(character_id), meta)
        if not _resolve_legacy_asset(source, avatar_path).is_file():
            missing_assets.add(avatar_path)
    for location_path in locations.values():
        normalized = str(location_path).replace("../", "")
        if not _resolve_legacy_asset(source, normalized).is_file():
            missing_assets.add(normalized)
    unknown_active = sorted(set(map(str, active)) - set(characters))
    if unknown_active:
        warnings.append(f"Unknown active character ids: {', '.join(unknown_active)}")

    report = LegacyImportReport(
        source_dir=str(source),
        dry_run=True,
        characters=len(characters),
        active_characters=len(active),
        locations=len(locations),
        events=len(history),
        missing_assets=sorted(missing_assets),
        warnings=warnings,
    )
    return documents, report


class LegacyDataService:
    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self.session = session
        self.settings = settings

    async def import_source(
        self,
        source_dir: Path,
        *,
        dry_run: bool,
        campaign_name: str | None = None,
    ) -> LegacyImportReport:
        documents, report = inspect_legacy_source(source_dir)
        if dry_run:
            return report

        backup_dir = (
            self.settings.data_dir
            / "backups"
            / f"legacy-{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}-{uuid4().hex[:8]}"
        )
        backup_dir.mkdir(parents=True, exist_ok=False)
        source = Path(report.source_dir)
        for filename in EXPECTED_FILES:
            shutil.copy2(source / filename, backup_dir / filename)
        report.backup_dir = str(backup_dir)

        name = campaign_name or f"Imported campaign {datetime.now().date().isoformat()}"
        base_slug = _slugify(name)
        slug = base_slug
        suffix = 2
        while await self.session.scalar(select(CampaignModel.id).where(CampaignModel.slug == slug)):
            slug = f"{base_slug}-{suffix}"
            suffix += 1

        active_list = list(map(str, documents["active_characters.json"].get("characters_id", [])))
        active_ids = set(active_list)
        world_state = dict(documents["public_state.json"])
        await self.session.execute(
            update(CampaignModel).where(CampaignModel.is_active.is_(True)).values(is_active=False)
        )
        campaign = CampaignModel(
            slug=slug,
            name=name,
            world_state={},
            is_active=True,
        )
        self.session.add(campaign)
        await self.session.flush()

        imported_locations: dict[str, dict[str, str]] = {}
        location_models: dict[str, LocationModel] = {}
        location_paths = documents["locations.json"].get("locations", {})
        for sort_order, (location_id, raw_path) in enumerate(location_paths.items()):
            asset_id = await self._import_asset(
                campaign.id,
                source,
                str(raw_path).replace("../", ""),
                "location",
            )
            imported_locations[str(location_id)] = {
                "id": str(location_id),
                "name": str(location_id),
                "image_url": f"/api/v1/assets/{asset_id}" if asset_id else "",
            }
            if asset_id:
                location = LocationModel(
                    campaign_id=campaign.id,
                    slug=str(location_id),
                    name=str(location_id),
                    asset_id=asset_id,
                    sort_order=sort_order,
                )
                self.session.add(location)
                await self.session.flush()
                location_models[str(location_id)] = location
        legacy_location = world_state.pop("current_location", {})
        current_location_id = (
            str(legacy_location.get("id", "")) if isinstance(legacy_location, dict) else ""
        )
        current_location = imported_locations.get(current_location_id)
        if current_location:
            world_state["location"] = current_location
        world_state["locations"] = imported_locations

        music_track: MusicTrackModel | None = None
        music = world_state.get("music")
        if isinstance(music, dict) and music.get("url"):
            music_asset_id = await self._import_asset(
                campaign.id,
                source,
                str(music["url"]),
                "music",
            )
            music["url"] = f"/api/v1/assets/{music_asset_id}" if music_asset_id else ""
            if music_asset_id:
                music_slug = str(music.get("track_id") or Path(str(music["url"])).name)
                music_track = MusicTrackModel(
                    campaign_id=campaign.id,
                    slug=music_slug,
                    name=Path(music_slug).stem.replace("_", " ").strip() or music_slug,
                    asset_id=music_asset_id,
                )
                self.session.add(music_track)
                await self.session.flush()
        campaign.world_state = world_state
        scene = SceneModel(
            campaign_id=campaign.id,
            location_id=(
                location_models[current_location_id].id
                if current_location_id in location_models
                else None
            ),
            music_track_id=music_track.id if music_track else None,
            music_is_playing=bool(music.get("is_playing", False))
            if isinstance(music, dict)
            else False,
            music_volume=round(float(music.get("volume", 0.5)) * 100)
            if isinstance(music, dict)
            else 50,
            avatar_size=int(world_state.get("avatar_size", 270)),
        )
        self.session.add(scene)
        await self.session.flush()

        legacy_characters = {
            **documents["characters.json"],
            **documents["npc.json"],
        }
        id_map: dict[str, str] = {}
        active_order = {character_id: index for index, character_id in enumerate(active_list)}
        visible_count = max(1, len(active_ids))
        for fallback_order, (legacy_id, data) in enumerate(legacy_characters.items()):
            meta = data.get("meta", {})
            identity = data.get("identity", {})
            stats = data.get("stats", {})
            hp = stats.get("hp", {})
            mp = stats.get("mp", {})
            memory = data.get("memory", {})
            character = CharacterModel(
                campaign_id=campaign.id,
                slug=str(legacy_id),
                name=str(identity.get("name") or legacy_id),
                kind=_character_kind(meta.get("role")),
                role=str(meta.get("role") or "npc"),
                biography=str(identity.get("bio") or ""),
                model_id=str(meta["model_id"]) if meta.get("model_id") else None,
                flip_x=bool(meta.get("flip_x", False)),
                is_active=str(legacy_id) in active_ids,
                hp_current=int(hp.get("current", 0)),
                hp_max=int(hp.get("max", 0)),
                mp_current=int(mp.get("current", 0)),
                mp_max=int(mp.get("max", 0)),
                attributes={
                    str(key): int(value) for key, value in stats.get("attributes", {}).items()
                },
                global_chronicle=[
                    str(entry)
                    for entry in memory.get("global_chronicle", [])
                    if isinstance(entry, str)
                ],
                private_notes=[
                    str(note) for note in memory.get("private_notes", []) if isinstance(note, str)
                ],
            )
            self.session.add(character)
            await self.session.flush()
            id_map[str(legacy_id)] = character.id

            for item in data.get("inventory", []):
                if not isinstance(item, dict) or not item.get("name"):
                    continue
                self.session.add(
                    InventoryItemModel(
                        character_id=character.id,
                        name=str(item["name"]),
                        quantity=max(0, int(item.get("quantity", 1))),
                        description=str(item.get("description", "")),
                    )
                )
            for effect in stats.get("status_effects", []):
                if effect:
                    self.session.add(StatusEffectModel(character_id=character.id, name=str(effect)))

            sprite = meta.get("sprite_id")
            if sprite:
                sprite_name = str(sprite)
                if not Path(sprite_name).suffix:
                    sprite_name += ".png"
                character.portrait_asset_id = await self._import_asset(
                    campaign.id,
                    source,
                    f"assets/characters/{sprite_name}",
                    "character",
                )
                character.sprite_asset_id = character.portrait_asset_id
            character.avatar_asset_id = await self._import_asset(
                campaign.id,
                source,
                _legacy_avatar_path(source, str(legacy_id), meta),
                "character_avatar",
            )
            voice = meta.get("voice_sample")
            if voice:
                character.voice_asset_id = await self._import_asset(
                    campaign.id, source, str(voice), "voice"
                )
            is_visible = str(legacy_id) in active_ids
            visible_order = active_order.get(str(legacy_id), fallback_order)
            self.session.add(
                SceneCharacterModel(
                    campaign_id=campaign.id,
                    character_id=character.id,
                    is_visible=is_visible,
                    x=(
                        round(((visible_order + 1) / (visible_count + 1)) * 100)
                        if is_visible
                        else 50
                    ),
                    y=75,
                    order=visible_order,
                    flip_x=bool(meta.get("flip_x", False)),
                )
            )

        history = documents["event_log.json"].get("history", [])
        if history:
            event = GameEventModel(
                campaign_id=campaign.id,
                title="Imported active event",
                status="active",
                started_at=datetime.now(UTC),
            )
            self.session.add(event)
            await self.session.flush()
            self.session.add_all(
                [
                    GameEventParticipantModel(
                        event_id=event.id,
                        character_id=id_map[legacy_id],
                    )
                    for legacy_id in active_list
                    if legacy_id in id_map
                ]
            )
            for index, item in enumerate(history, start=1):
                if not isinstance(item, dict):
                    continue
                legacy_character_id = str(item.get("id", ""))
                self.session.add(
                    TurnModel(
                        event_id=event.id,
                        character_id=id_map.get(legacy_character_id),
                        sequence=index,
                        actor_name=str(item.get("name") or "Game Master"),
                        actor_role=str(item.get("role") or "gm"),
                        thought=str(item["thoughts"]) if item.get("thoughts") else None,
                        action=str(item.get("action") or ""),
                    )
                )

        await self.session.commit()
        report.dry_run = False
        report.campaign_id = campaign.id
        return report

    async def _import_asset(
        self, campaign_id: str, source: Path, raw_path: str, kind: str
    ) -> str | None:
        source_path = _resolve_legacy_asset(source, raw_path)
        if not source_path.is_file():
            return None
        digest = hashlib.sha256(source_path.read_bytes()).hexdigest()
        extension = source_path.suffix.lower()
        destination_name = f"{digest[:20]}{extension}"
        destination_relative = f"{campaign_id}/{destination_name}"
        destination = self.settings.data_dir / "assets" / destination_relative
        existing = await self.session.scalar(
            select(AssetModel).where(AssetModel.relative_path == destination_relative)
        )
        if existing:
            return existing.id
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists():
            shutil.copy2(source_path, destination)
        asset = AssetModel(
            campaign_id=campaign_id,
            kind=kind,
            relative_path=destination_relative,
            media_type=_media_type(extension),
            sha256=digest,
            license_name=None,
        )
        self.session.add(asset)
        await self.session.flush()
        return asset.id

    async def sync_campaign(
        self,
        campaign_id: str,
        source_dir: Path,
        *,
        dry_run: bool,
    ) -> LegacySyncReport:
        documents, inspection = inspect_legacy_source(source_dir)
        campaign = await self.session.get(CampaignModel, campaign_id)
        if not campaign:
            raise ConflictError("Campaign not found.")
        source_characters = {
            **documents["characters.json"],
            **documents["npc.json"],
        }
        campaign_characters = list(
            await self.session.scalars(
                select(CharacterModel).where(CharacterModel.campaign_id == campaign_id)
            )
        )
        by_slug = {character.slug: character for character in campaign_characters}
        matched = sorted(set(source_characters) & set(by_slug))
        report = LegacySyncReport(
            source_dir=inspection.source_dir,
            campaign_id=campaign_id,
            dry_run=dry_run,
            matched_characters=len(matched),
            updated_characters=0,
            missing_campaign_characters=sorted(set(source_characters) - set(by_slug)),
            missing_source_characters=sorted(set(by_slug) - set(source_characters)),
            missing_assets=inspection.missing_assets,
        )
        if dry_run:
            return report

        for slug in matched:
            source_data = source_characters[slug]
            character = by_slug[slug]
            meta = source_data.get("meta", {})
            memory = source_data.get("memory", {})
            character.kind = _character_kind(meta.get("role"))
            character.role = str(meta.get("role") or character.role)
            character.global_chronicle = [
                str(entry)
                for entry in memory.get("global_chronicle", [])
                if isinstance(entry, str)
            ]
            character.private_notes = [
                str(entry)
                for entry in memory.get("private_notes", [])
                if isinstance(entry, str)
            ]
            sprite = meta.get("sprite_id")
            if sprite:
                sprite_name = str(sprite)
                if not Path(sprite_name).suffix:
                    sprite_name += ".png"
                character.portrait_asset_id = await self._import_asset(
                    campaign_id,
                    source_dir,
                    f"assets/characters/{sprite_name}",
                    "character_portrait",
                )
                character.sprite_asset_id = character.portrait_asset_id
            character.avatar_asset_id = await self._import_asset(
                campaign_id,
                source_dir,
                _legacy_avatar_path(source_dir, slug, meta),
                "character_avatar",
            )
            voice = meta.get("voice_sample")
            if voice:
                character.voice_asset_id = await self._import_asset(
                    campaign_id,
                    source_dir,
                    str(voice),
                    "voice",
                )
            character.revision += 1
            report.updated_characters += 1
        await self.session.commit()
        return report

    async def export_campaign(self, campaign_id: str) -> LegacyExportV1:
        campaign = await self.session.get(CampaignModel, campaign_id)
        if not campaign:
            raise ConflictError("Campaign not found.")
        characters = list(
            await self.session.scalars(
                select(CharacterModel)
                .options(
                    selectinload(CharacterModel.inventory),
                    selectinload(CharacterModel.status_effects),
                )
                .where(CharacterModel.campaign_id == campaign_id)
            )
        )
        events = list(
            await self.session.scalars(
                select(GameEventModel)
                .options(selectinload(GameEventModel.turns))
                .where(GameEventModel.campaign_id == campaign_id)
            )
        )
        return LegacyExportV1(
            exported_at=datetime.now(UTC),
            campaign={
                "id": campaign.id,
                "slug": campaign.slug,
                "name": campaign.name,
                "revision": campaign.revision,
                "global_chronicle": campaign.global_chronicle,
                "world_state": campaign.world_state,
            },
            characters=[
                {
                    "id": character.id,
                    "slug": character.slug,
                    "name": character.name,
                    "kind": character.kind,
                    "role": character.role,
                    "biography": character.biography,
                    "model_id": character.model_id,
                    "stats": {
                        "hp": {"current": character.hp_current, "max": character.hp_max},
                        "mp": {"current": character.mp_current, "max": character.mp_max},
                        "attributes": character.attributes,
                        "status_effects": [effect.name for effect in character.status_effects],
                    },
                    "inventory": [
                        {
                            "id": item.id,
                            "name": item.name,
                            "quantity": item.quantity,
                            "description": item.description,
                        }
                        for item in character.inventory
                    ],
                    "private_notes": character.private_notes,
                    "global_chronicle": character.global_chronicle,
                    "portrait_asset_id": character.portrait_asset_id,
                    "avatar_asset_id": character.avatar_asset_id,
                }
                for character in characters
            ],
            events=[
                {
                    "id": event.id,
                    "title": event.title,
                    "status": event.status,
                    "turns": [
                        {
                            "id": turn.id,
                            "sequence": turn.sequence,
                            "character_id": turn.character_id,
                            "actor_name": turn.actor_name,
                            "actor_role": turn.actor_role,
                            "thought": turn.thought,
                            "action": turn.action,
                            "dice_roll": turn.dice_roll,
                        }
                        for turn in event.turns
                    ],
                }
                for event in events
            ],
        )


def _media_type(extension: str) -> str:
    return {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".ogg": "audio/ogg",
    }.get(extension, "application/octet-stream")
