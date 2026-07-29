from ai_dnd.application.prompts import (
    build_archivist_prompt,
    build_observer_prompt,
    build_player_prompt,
)


def test_observer_prompt_contains_no_private_context() -> None:
    prompt = build_observer_prompt(
        action="Open the door",
        dice_roll=14,
        public_characters=[{"name": "Aria", "hp_current": 10}],
        campaign_revision=3,
    )
    assert "Open the door" in prompt
    assert "private_notes" not in prompt
    assert "private thought" not in prompt.lower()


def test_player_prompt_contains_private_notes_only_in_player_context() -> None:
    prompt = build_player_prompt(
        character={"name": "Aria"},
        global_chronicle=[],
        private_notes=["The compass is dangerous."],
        event_history=[],
        scene_participants=[{"name": "Bram", "category": "player"}],
    )
    assert "The compass is dangerous." in prompt
    assert "Bram" in prompt


def test_archivist_prompt_scopes_private_thoughts_to_their_player() -> None:
    prompt = build_archivist_prompt(
        event={"id": "event-1", "title": "Tower"},
        chronicle_versions=[["Aria entered the tower."], ["Bram guarded the gate."]],
        players=[
            {
                "id": "aria",
                "name": "Aria",
                "prior_private_notes": ["The compass is dangerous."],
                "own_thoughts": [{"sequence": 1, "thought": "I should hide it."}],
            },
            {
                "id": "bram",
                "name": "Bram",
                "prior_private_notes": ["Protect Aria."],
                "own_thoughts": [],
            },
        ],
        event_history=[{"sequence": 1, "actor": "Aria", "action": "Opens the gate."}],
    )
    assert "The compass is dangerous." in prompt
    assert "I should hide it." in prompt
    assert "keyed exactly by character id" in prompt
