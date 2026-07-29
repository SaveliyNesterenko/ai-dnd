from __future__ import annotations

import time
from uuid import uuid4

from fastapi.testclient import TestClient


def _gm_snapshot(client: TestClient, campaign_id: str) -> dict[str, object]:
    response = client.get(f"/api/v1/campaigns/{campaign_id}/gm-snapshot")
    assert response.status_code == 200
    return response.json()


def _start_event(client: TestClient, campaign_id: str) -> dict[str, object]:
    response = client.post(
        f"/api/v1/campaigns/{campaign_id}/events",
        json={"title": "The first gear"},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 201
    return response.json()


def _create_turn(
    client: TestClient,
    campaign_id: str,
    event_id: str,
    character_id: str,
) -> dict[str, object]:
    response = client.post(
        f"/api/v1/campaigns/{campaign_id}/events/{event_id}/turns",
        json={
            "character_id": character_id,
            "actor_name": "<img src=x onerror=alert(1)>",
            "actor_role": "Player",
            "thought": "This remains a turn thought, not a private memory.",
            "action": "<script>alert('xss')</script>",
            "dice_roll": 17,
        },
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert response.status_code == 201
    return response.json()


def test_health_and_capabilities(client: TestClient) -> None:
    assert client.get("/api/v1/health/live").json() == {"status": "ok"}
    assert client.get("/api/v1/health/ready").json() == {"status": "ready"}
    assert client.get("/api/v1/capabilities").json() == {
        "llm_enabled": False,
        "stt_enabled": False,
        "tts_enabled": False,
    }


def test_gm_bootstrap_token_is_single_use(client: TestClient) -> None:
    token = client.app.state.security.bootstrap_token
    first = client.get(
        f"/api/v1/auth/gm/bootstrap?token={token}",
        follow_redirects=False,
    )
    second = client.get(
        f"/api/v1/auth/gm/bootstrap?token={token}",
        follow_redirects=False,
    )
    assert first.status_code == 303
    assert second.status_code == 401


def test_mutations_require_gm(client: TestClient, demo_campaign_id: str) -> None:
    response = client.post(
        f"/api/v1/campaigns/{demo_campaign_id}/events",
        json={"title": "Unauthorized"},
    )
    assert response.status_code == 401
    assert response.headers["content-type"].startswith("application/problem+json")


def test_public_projection_hides_private_fields(
    client: TestClient,
    authenticated_client: TestClient,
    demo_campaign_id: str,
) -> None:
    session_response = authenticated_client.get("/api/v1/auth/session")
    spectator_code = session_response.json()["spectator_code"]
    gm = _gm_snapshot(authenticated_client, demo_campaign_id)
    public_response = client.get(
        f"/api/v1/campaigns/{demo_campaign_id}/snapshot",
        params={"spectator_code": spectator_code},
    )
    assert public_response.status_code == 200
    public = public_response.json()
    assert "private_notes" in gm["characters"][0]
    assert "model_id" in gm["characters"][0]
    assert "private_notes" not in public["characters"][0]
    assert "model_id" not in public["characters"][0]
    assert public["global_chronicle"] is None


def test_event_turn_and_idempotency(
    authenticated_client: TestClient,
    demo_campaign_id: str,
) -> None:
    key = str(uuid4())
    first = authenticated_client.post(
        f"/api/v1/campaigns/{demo_campaign_id}/events",
        json={"title": "One event"},
        headers={"Idempotency-Key": key},
    )
    second = authenticated_client.post(
        f"/api/v1/campaigns/{demo_campaign_id}/events",
        json={"title": "Duplicate click"},
        headers={"Idempotency-Key": key},
    )
    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]

    snapshot = _gm_snapshot(authenticated_client, demo_campaign_id)
    character_id = snapshot["characters"][0]["id"]
    turn = _create_turn(
        authenticated_client,
        demo_campaign_id,
        first.json()["id"],
        character_id,
    )
    assert turn["action"] == "<script>alert('xss')</script>"


def test_public_turn_projection_includes_spectator_thought(
    authenticated_client: TestClient,
    demo_campaign_id: str,
) -> None:
    event = _start_event(authenticated_client, demo_campaign_id)
    gm_snapshot = _gm_snapshot(authenticated_client, demo_campaign_id)
    character_id = str(gm_snapshot["characters"][0]["id"])
    _create_turn(
        authenticated_client,
        demo_campaign_id,
        str(event["id"]),
        character_id,
    )
    code = authenticated_client.get("/api/v1/auth/session").json()["spectator_code"]
    public = authenticated_client.get(
        f"/api/v1/campaigns/{demo_campaign_id}/snapshot",
        params={"spectator_code": code},
    ).json()
    assert (
        public["active_event"]["turns"][0]["thought"]
        == "This remains a turn thought, not a private memory."
    )

    with authenticated_client.websocket_connect(
        f"/api/v1/realtime?campaign_id={demo_campaign_id}&last_sequence=1&join_code={code}"
    ) as websocket:
        realtime_turn = websocket.receive_json()
        assert realtime_turn["type"] == "turn.created"
        assert (
            realtime_turn["payload"]["thought"]
            == "This remains a turn thought, not a private memory."
        )


def test_scene_character_updates_are_public_and_revision_guarded(
    authenticated_client: TestClient,
    demo_campaign_id: str,
) -> None:
    snapshot = _gm_snapshot(authenticated_client, demo_campaign_id)
    character = snapshot["characters"][0]
    scene = snapshot["scene"]
    scene_character = next(
        item for item in scene["characters"] if item["character_id"] == character["id"]
    )
    response = authenticated_client.patch(
        f"/api/v1/campaigns/{demo_campaign_id}/scene/characters/{character['id']}",
        json={
            "is_visible": False,
            "order": scene_character["order"],
            "base_revision": scene_character["revision"],
        },
    )
    assert response.status_code == 200
    updated = next(
        item
        for item in response.json()["characters"]
        if item["character_id"] == character["id"]
    )
    assert updated["is_visible"] is False
    assert (updated["x"], updated["y"], updated["scale"]) == (
        scene_character["x"],
        scene_character["y"],
        scene_character["scale"],
    )

    stale = authenticated_client.patch(
        f"/api/v1/campaigns/{demo_campaign_id}/scene/characters/{character['id']}",
        json={"is_visible": True, "base_revision": scene_character["revision"]},
    )
    assert stale.status_code == 409
    assert stale.json()["code"] == "stale_revision"

    movement = authenticated_client.patch(
        f"/api/v1/campaigns/{demo_campaign_id}/scene/characters/{character['id']}",
        json={"x": 40, "base_revision": updated["revision"]},
    )
    assert movement.status_code == 422

    code = authenticated_client.get("/api/v1/auth/session").json()["spectator_code"]
    public = authenticated_client.get(
        f"/api/v1/campaigns/{demo_campaign_id}/snapshot",
        params={"spectator_code": code},
    ).json()
    public_character = next(item for item in public["characters"] if item["id"] == character["id"])
    assert public_character["is_active"] is False
    assert public_character["flip_x"] is scene_character["flip_x"]


def test_gm_can_edit_character_card_with_optimistic_revision(
    authenticated_client: TestClient,
    demo_campaign_id: str,
) -> None:
    snapshot = _gm_snapshot(authenticated_client, demo_campaign_id)
    character = snapshot["characters"][0]
    response = authenticated_client.patch(
        f"/api/v1/campaigns/{demo_campaign_id}/characters/{character['id']}",
        json={
            "base_revision": character["revision"],
            "hp_current": 7,
            "hp_max": 12,
            "mp_current": 3,
            "mp_max": 9,
            "inventory": [
                {
                    "name": "Edited item",
                    "quantity": 2,
                    "description": "Saved from the GM card.",
                }
            ],
            "status_effects": ["Inspired"],
        },
    )
    assert response.status_code == 200
    updated = response.json()
    assert (updated["hp_current"], updated["hp_max"]) == (7, 12)
    assert updated["inventory"][0]["name"] == "Edited item"
    assert updated["status_effects"] == ["Inspired"]

    stale = authenticated_client.patch(
        f"/api/v1/campaigns/{demo_campaign_id}/characters/{character['id']}",
        json={
            "base_revision": character["revision"],
            "hp_current": 6,
        },
    )
    assert stale.status_code == 409
    assert stale.json()["code"] == "stale_revision"

    invalid = authenticated_client.patch(
        f"/api/v1/campaigns/{demo_campaign_id}/characters/{character['id']}",
        json={
            "base_revision": updated["revision"],
            "hp_current": 20,
            "hp_max": 10,
        },
    )
    assert invalid.status_code == 422


def test_typed_observer_proposal_and_stale_revision(
    authenticated_client: TestClient,
    demo_campaign_id: str,
) -> None:
    event = _start_event(authenticated_client, demo_campaign_id)
    snapshot = _gm_snapshot(authenticated_client, demo_campaign_id)
    character = snapshot["characters"][0]
    turn = _create_turn(
        authenticated_client,
        demo_campaign_id,
        str(event["id"]),
        str(character["id"]),
    )
    base_revision = snapshot["campaign"]["revision"]
    proposal_body = {
        "turn_id": turn["id"],
        "gm_brief": "The mechanism causes minor damage.",
        "base_revision": base_revision,
        "operations": [
            {
                "op": "set_resource",
                "character_id": character["id"],
                "resource": "hp",
                "current": character["hp_current"] - 1,
            }
        ],
    }
    first = authenticated_client.post(
        f"/api/v1/campaigns/{demo_campaign_id}/events/{event['id']}/observer-proposals",
        json=proposal_body,
    )
    second = authenticated_client.post(
        f"/api/v1/campaigns/{demo_campaign_id}/events/{event['id']}/observer-proposals",
        json=proposal_body,
    )
    assert first.status_code == 201
    assert second.status_code == 201
    fetched = authenticated_client.get(
        f"/api/v1/campaigns/{demo_campaign_id}/observer-proposals/{first.json()['id']}"
    )
    assert fetched.status_code == 200
    assert fetched.json()["gm_brief"] == proposal_body["gm_brief"]

    apply_body = {
        "gm_brief": "Edited by the GM.",
        "operations": proposal_body["operations"],
    }
    applied = authenticated_client.post(
        f"/api/v1/campaigns/{demo_campaign_id}/observer-proposals/{first.json()['id']}/apply",
        json=apply_body,
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert applied.status_code == 200
    assert applied.json()["gm_brief"] == "Edited by the GM."
    stale = authenticated_client.post(
        f"/api/v1/campaigns/{demo_campaign_id}/observer-proposals/{second.json()['id']}/apply",
        json=apply_body,
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert stale.status_code == 409
    assert stale.json()["code"] == "stale_revision"


def test_realtime_replays_to_multiple_spectators(
    authenticated_client: TestClient,
    demo_campaign_id: str,
) -> None:
    code = authenticated_client.get("/api/v1/auth/session").json()["spectator_code"]
    event = _start_event(authenticated_client, demo_campaign_id)
    url = f"/api/v1/realtime?campaign_id={demo_campaign_id}&last_sequence=0&join_code={code}"
    with (
        authenticated_client.websocket_connect(url) as first,
        authenticated_client.websocket_connect(url) as second,
    ):
        first_event = first.receive_json()
        second_event = second.receive_json()
        assert first_event["type"] == "event.started"
        assert second_event["type"] == "event.started"
        assert first_event["payload"]["id"] == event["id"]
        assert second_event["sequence"] == first_event["sequence"]


def test_archivist_outage_keeps_event_log_until_manual_confirmation(
    authenticated_client: TestClient,
    demo_campaign_id: str,
) -> None:
    event = _start_event(authenticated_client, demo_campaign_id)
    before = _gm_snapshot(authenticated_client, demo_campaign_id)
    players = [
        character for character in before["characters"] if character["kind"] == "player"
    ]
    _create_turn(
        authenticated_client,
        demo_campaign_id,
        str(event["id"]),
        str(players[0]["id"]),
    )
    current = _gm_snapshot(authenticated_client, demo_campaign_id)
    active_event = current["active_event"]
    response = authenticated_client.post(
        f"/api/v1/campaigns/{demo_campaign_id}/jobs/event-finalization",
        json={
            "event_id": event["id"],
            "base_revision": active_event["revision"],
        },
    )
    assert response.status_code == 202
    job = response.json()
    for _ in range(30):
        job = authenticated_client.get(
            f"/api/v1/campaigns/{demo_campaign_id}/jobs/{job['id']}"
        ).json()
        if job["status"] not in {"queued", "running"}:
            break
        time.sleep(0.01)
    assert job["status"] == "degraded"

    waiting = _gm_snapshot(authenticated_client, demo_campaign_id)
    assert waiting["active_event"]["status"] == "finalizing"
    assert len(waiting["active_event"]["turns"]) == 1
    assert {
        character["id"]: character["private_notes"] for character in waiting["characters"]
    } == {
        character["id"]: character["private_notes"] for character in before["characters"]
    }

    confirm = authenticated_client.post(
        (
            f"/api/v1/campaigns/{demo_campaign_id}/events/{event['id']}"
            "/finalization/confirm"
        ),
        json={
            "base_revision": waiting["active_event"]["revision"],
            "chronicle": "The party documented the first gear.",
            "player_notes": {
                character["id"]: f"{character['name']} remembers the first gear."
                for character in players
            },
            "source": "manual",
        },
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert confirm.status_code == 200
    assert confirm.json()["status"] == "archived"
    assert _gm_snapshot(authenticated_client, demo_campaign_id)["active_event"] is None


def test_openapi_contains_versioned_contract(client: TestClient) -> None:
    schema = client.get("/api/openapi.json")
    assert schema.status_code == 200
    paths = schema.json()["paths"]
    assert "/api/v1/campaigns/{campaign_id}/gm-snapshot" in paths
    assert "/api/v1/campaigns/{campaign_id}/events" in paths


def test_stt_upload_validation_and_degraded_job(
    authenticated_client: TestClient,
) -> None:
    invalid = authenticated_client.post(
        "/api/v1/voice/jobs/transcription",
        files={"file": ("payload.wav", b"not-a-wave", "audio/wav")},
    )
    assert invalid.status_code == 415

    wave_header = b"RIFF\x04\x00\x00\x00WAVE"
    accepted = authenticated_client.post(
        "/api/v1/voice/jobs/transcription",
        files={"file": ("ignored-name.wav", wave_header, "audio/wav")},
    )
    assert accepted.status_code == 202
    job_id = accepted.json()["id"]
    result = accepted.json()
    for _ in range(20):
        result = authenticated_client.get(f"/api/v1/voice/jobs/{job_id}").json()
        if result["status"] not in {"queued", "running"}:
            break
        time.sleep(0.01)
    assert result["status"] == "degraded"
    assert result["error_code"] == "capability_unavailable"
