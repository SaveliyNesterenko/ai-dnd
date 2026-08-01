from __future__ import annotations

import hashlib
import io
import json
import zipfile


def _pack(
    *,
    version: str = "0.1.0",
    corrupt_hash: bool = False,
    duplicate: bool = False,
    undeclared_asset: bool = False,
) -> bytes:
    assets = {
        "assets/characters/siliya-portrait.png": b"\x89PNG\r\n\x1a\nportrait",
        "assets/characters/siliya-avatar.png": b"\x89PNG\r\n\x1a\navatar",
        "assets/characters/siliya.wav": b"RIFF\x04\x00\x00\x00WAVE",
        "assets/locations/crossroads.png": b"\x89PNG\r\n\x1a\nlocation",
        "assets/music/atmosphere.ogg": b"OggSsound",
        "assets/music/tension.mp3": b"ID3sound",
        "assets/music/finale.mp3": b"ID3finale",
    }
    declared = []
    for path, content in assets.items():
        media_type = (
            "image/png"
            if path.endswith(".png")
            else "audio/wav"
            if path.endswith(".wav")
            else "audio/ogg"
            if path.endswith(".ogg")
            else "audio/mpeg"
        )
        declared.append(
            {
                "path": path,
                "kind": "fixture",
                "media_type": media_type,
                "sha256": hashlib.sha256(content).hexdigest(),
                "license": "CC0-1.0",
            }
        )
    if corrupt_hash:
        declared[0]["sha256"] = "0" * 64
    characters = []
    for slug, kind in [
        ("siliya", "player"),
        ("kael-roan", "player"),
        ("guide", "npc"),
        ("trader", "npc"),
        ("raider", "enemy"),
        ("wraith", "enemy"),
    ]:
        characters.append(
            {
                "slug": "siliya" if duplicate and slug == "kael-roan" else slug,
                "name": slug,
                "kind": kind,
                "role": kind,
                "assets": {
                    "portrait": "assets/characters/siliya-portrait.png",
                    "avatar": "assets/characters/siliya-avatar.png",
                    "voice": "assets/characters/siliya.wav",
                },
                "is_active": kind == "player",
                "stats": {"hp_current": 10, "hp_max": 10},
                "scene": {"is_visible": kind == "player"},
            }
        )
    manifest = {
        "format": "ai-dnd-campaign-pack/v1",
        "minimum_app_version": version,
        "campaign": {"slug": "trial-pack", "name": "Trial pack"},
        "assets": declared,
        "characters": characters,
        "locations": [
            {"slug": "crossroads", "name": "Crossroads", "asset": "assets/locations/crossroads.png"}
        ],
        "music_tracks": [
            {"slug": "atmosphere", "name": "Atmosphere", "asset": "assets/music/atmosphere.ogg"},
            {"slug": "tension", "name": "Tension", "asset": "assets/music/tension.mp3"},
            {"slug": "finale", "name": "Finale", "asset": "assets/music/finale.mp3"},
        ],
        "scene": {
            "location_slug": "crossroads",
            "music_track_slug": "atmosphere",
            "music_is_playing": True,
        },
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        archive.writestr("README.md", "Run it manually.")
        archive.writestr("ASSET_GUIDE.md", "Guide")
        archive.writestr("LICENSES.md", "\n".join(assets))
        for path, content in assets.items():
            archive.writestr(path, content)
        if undeclared_asset:
            archive.writestr("assets/extra.png", b"\x89PNG\r\n\x1a\nextra")
    return buffer.getvalue()


def test_import_campaign_pack_activates_complete_scene(authenticated_client) -> None:
    response = authenticated_client.post(
        "/api/v1/campaign-packs/import", files={"file": ("trial.zip", _pack(), "application/zip")}
    )
    assert response.status_code == 201, response.text
    imported = response.json()
    snapshot = authenticated_client.get(
        f"/api/v1/campaigns/{imported['campaign_id']}/gm-snapshot"
    ).json()
    assert len(snapshot["characters"]) == 6
    assert len(snapshot["scene"]["music_tracks"]) == 3
    assert snapshot["scene"]["music_is_playing"] is True
    assert sum(state["is_visible"] for state in snapshot["scene"]["characters"]) == 2


def test_campaign_pack_rejects_bad_input(authenticated_client) -> None:
    for name, payload in [
        ("broken.zip", b"no zip"),
        ("bad-hash.zip", _pack(corrupt_hash=True)),
        ("old.zip", _pack(version="9.9.9")),
        ("duplicate.zip", _pack(duplicate=True)),
        ("undeclared.zip", _pack(undeclared_asset=True)),
    ]:
        response = authenticated_client.post(
            "/api/v1/campaign-packs/import", files={"file": (name, payload, "application/zip")}
        )
        assert response.status_code == 422, response.text


def test_campaign_pack_has_its_own_upload_limit(authenticated_client) -> None:
    payload = _pack()
    authenticated_client.app.state.settings.max_campaign_pack_bytes = len(payload) - 1

    response = authenticated_client.post(
        "/api/v1/campaign-packs/import",
        files={"file": ("trial.zip", payload, "application/zip")},
    )

    assert response.status_code == 413
    assert response.json()["detail"] == "Пакет кампании превышает допустимый размер."


def test_campaign_pack_accepts_an_older_minimum_app_version(authenticated_client) -> None:
    response = authenticated_client.post(
        "/api/v1/campaign-packs/import",
        files={"file": ("compatible.zip", _pack(version="0.0.1"), "application/zip")},
    )

    assert response.status_code == 201, response.text
