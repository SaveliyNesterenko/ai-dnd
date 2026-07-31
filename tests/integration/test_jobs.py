# ruff: noqa: RUF001
from __future__ import annotations

import time

from fastapi.testclient import TestClient

from ai_dnd.api.schemas import (
    ArchivistOutput,
    ContextSummaryOutput,
    ObserverOutput,
    PlayerRecollectionOutput,
    PlayerTurnOutput,
    SetResourceOperation,
)
from ai_dnd.integrations.llm import ModelProfile


class StubLLMProvider:
    def __init__(self, character_id: str) -> None:
        self.character_id = character_id
        self.recollection_models: list[str] = []

    async def generate_player_turn(
        self,
        *,
        profile: ModelProfile,
        system_prompt: str,
        prompt: str,
    ) -> PlayerTurnOutput:
        assert profile.model_id
        assert system_prompt
        assert "--- КОНТЕКСТ ИГРЫ ---" in prompt
        assert "--- УЧАСТНИКИ СЦЕНЫ ---" in prompt
        return PlayerTurnOutput(
            thought="The gears follow a repeating interval.",
            action="Aria marks the safe interval for Bram.",
        )

    async def generate_observer_proposal(
        self,
        *,
        profile: ModelProfile,
        system_prompt: str,
        prompt: str,
    ) -> ObserverOutput:
        assert profile.model_id
        assert system_prompt
        assert "campaign_revision" in prompt
        return ObserverOutput(
            gm_brief="Aria spends one mana to understand the mechanism.",
            operations=[
                SetResourceOperation(
                    op="set_resource",
                    character_id=self.character_id,
                    resource="mp",
                    current=13,
                )
            ],
        )

    async def generate_archivist_result(
        self,
        *,
        profile: ModelProfile,
        system_prompt: str,
        prompt: str,
    ) -> ArchivistOutput:
        assert profile.model_id
        assert "chronicle_versions" in prompt
        assert "prior_private_notes" not in prompt
        return ArchivistOutput(chronicle="The party documented the mechanism.")

    async def generate_player_recollection(
        self,
        *,
        profile: ModelProfile,
        system_prompt: str,
        prompt: str,
    ) -> PlayerRecollectionOutput:
        assert system_prompt
        assert "prior_private_notes" in prompt
        self.recollection_models.append(profile.model_id)
        return PlayerRecollectionOutput(note=f"Memory written by {profile.model_id}.")

    async def generate_context_summary(
        self,
        *,
        profile: ModelProfile,
        system_prompt: str,
        prompt: str,
    ) -> ContextSummaryOutput:
        assert profile.model_id
        assert "event_history" in prompt
        return ContextSummaryOutput(summary="The party completed the early steps.")


def _wait_for_job(client: TestClient, url: str) -> dict[str, object]:
    result: dict[str, object] = {}
    for _ in range(50):
        response = client.get(url)
        assert response.status_code == 200
        result = response.json()
        if result["status"] not in {"queued", "running"}:
            return result
        time.sleep(0.01)
    raise AssertionError("Background job did not finish.")


def test_player_and_observer_jobs(
    authenticated_client: TestClient,
    demo_campaign_id: str,
) -> None:
    snapshot = authenticated_client.get(f"/api/v1/campaigns/{demo_campaign_id}/gm-snapshot").json()
    character_id = snapshot["characters"][0]["id"]
    authenticated_client.app.state.llm = StubLLMProvider(character_id)
    event = authenticated_client.post(
        f"/api/v1/campaigns/{demo_campaign_id}/events",
        json={"title": "Automated agent turn"},
    ).json()

    accepted = authenticated_client.post(
        f"/api/v1/campaigns/{demo_campaign_id}/jobs/player-turn",
        json={"event_id": event["id"], "character_id": character_id},
    )
    assert accepted.status_code == 202
    player_job = _wait_for_job(
        authenticated_client,
        f"/api/v1/campaigns/{demo_campaign_id}/jobs/{accepted.json()['id']}",
    )
    assert player_job["status"] == "succeeded"
    draft = player_job["output_data"]
    assert isinstance(draft, dict)
    assert draft["thought"] == "The gears follow a repeating interval."

    updated = authenticated_client.get(f"/api/v1/campaigns/{demo_campaign_id}/gm-snapshot").json()
    assert updated["active_event"]["turns"] == []
    published = authenticated_client.post(
        f"/api/v1/campaigns/{demo_campaign_id}/events/{event['id']}/turns",
        json={
            "character_id": character_id,
            "actor_name": draft["actor_name"],
            "actor_role": draft["actor_role"],
            "thought": draft["thought"],
            "action": draft["action"],
            "roll_dice": True,
        },
    )
    assert published.status_code == 201
    updated = authenticated_client.get(f"/api/v1/campaigns/{demo_campaign_id}/gm-snapshot").json()
    generated_turn = updated["active_event"]["turns"][-1]
    assert generated_turn["thought"] == "The gears follow a repeating interval."
    assert 1 <= generated_turn["dice_roll"] <= 20

    observer = authenticated_client.post(
        f"/api/v1/campaigns/{demo_campaign_id}/jobs/observer",
        json={"event_id": event["id"], "turn_id": generated_turn["id"]},
    )
    assert observer.status_code == 202
    observer_job = _wait_for_job(
        authenticated_client,
        f"/api/v1/campaigns/{demo_campaign_id}/jobs/{observer.json()['id']}",
    )
    assert observer_job["status"] == "succeeded"
    assert "proposal_id" in observer_job["output_data"]
    assert observer_job["output_data"]["proposal"]["gm_brief"].startswith("Aria spends")


def test_archivist_uses_each_player_model_and_context_can_be_compressed(
    authenticated_client: TestClient,
    demo_campaign_id: str,
) -> None:
    snapshot = authenticated_client.get(f"/api/v1/campaigns/{demo_campaign_id}/gm-snapshot").json()
    players = [character for character in snapshot["characters"] if character["kind"] == "player"]
    provider = StubLLMProvider(players[0]["id"])
    authenticated_client.app.state.llm = provider
    event = authenticated_client.post(
        f"/api/v1/campaigns/{demo_campaign_id}/events",
        json={"title": "Long event"},
    ).json()
    for index in range(11):
        character = players[index % len(players)]
        response = authenticated_client.post(
            f"/api/v1/campaigns/{demo_campaign_id}/events/{event['id']}/turns",
            json={
                "character_id": character["id"],
                "actor_name": character["name"],
                "actor_role": character["role"],
                "action": f"Action {index + 1}",
            },
        )
        assert response.status_code == 201

    current = authenticated_client.get(f"/api/v1/campaigns/{demo_campaign_id}/gm-snapshot").json()
    compression = authenticated_client.post(
        f"/api/v1/campaigns/{demo_campaign_id}/jobs/context-compression",
        json={
            "event_id": event["id"],
            "base_revision": current["active_event"]["revision"],
        },
    )
    assert compression.status_code == 202
    compression_job = _wait_for_job(
        authenticated_client,
        f"/api/v1/campaigns/{demo_campaign_id}/jobs/{compression.json()['id']}",
    )
    assert compression_job["status"] == "succeeded"
    assert compression_job["output_data"]["through_sequence"] == 1

    compressed = authenticated_client.get(
        f"/api/v1/campaigns/{demo_campaign_id}/gm-snapshot"
    ).json()
    assert compressed["active_event"]["context_summary"] == ("The party completed the early steps.")
    finalization = authenticated_client.post(
        f"/api/v1/campaigns/{demo_campaign_id}/jobs/event-finalization",
        json={
            "event_id": event["id"],
            "base_revision": compressed["active_event"]["revision"],
        },
    )
    assert finalization.status_code == 202
    finalization_job = _wait_for_job(
        authenticated_client,
        f"/api/v1/campaigns/{demo_campaign_id}/jobs/{finalization.json()['id']}",
    )
    assert finalization_job["status"] == "succeeded"
    assert set(finalization_job["output_data"]["player_notes"]) == {
        player["id"] for player in players
    }
    assert len(provider.recollection_models) == len(players)
    expected_models = {
        player["model_id"] or authenticated_client.app.state.settings.default_model
        for player in players
    }
    assert set(provider.recollection_models) == expected_models
