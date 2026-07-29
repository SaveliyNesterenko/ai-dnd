from ai_dnd.application.prompts import (
    build_archivist_prompt,
    build_context_compression_prompt,
    build_observer_prompt,
    build_player_prompt,
    build_player_recollection_prompt,
)


def test_observer_prompt_contains_no_private_context() -> None:
    prompt = build_observer_prompt(
        action="Open the door",
        dice_roll=14,
        actor_name="Aria",
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


def test_archivist_prompt_contains_only_public_chronicle_context() -> None:
    prompt = build_archivist_prompt(
        chronicle_versions=[["Aria entered the tower."], ["Bram guarded the gate."]],
        event_history=[{"sequence": 1, "actor": "Aria", "action": "Opens the gate."}],
    )
    assert "Aria entered the tower." in prompt
    assert "Opens the gate." in prompt
    assert "private_notes" not in prompt
    assert "own_thought" not in prompt


def test_player_recollection_uses_only_own_private_context() -> None:
    prompt = build_player_recollection_prompt(
        character={"id": "aria", "name": "Aria", "biography": "A scout."},
        prior_private_notes=["The compass is dangerous."],
        event_history=[
            {
                "sequence": 1,
                "actor": "Aria",
                "action": "Opens the gate.",
                "own_thought": "I should hide it.",
            }
        ],
    )
    assert "The compass is dangerous." in prompt
    assert "I should hide it." in prompt
    assert "поле note" in prompt


def test_context_compression_prompt_contains_old_history() -> None:
    prompt = build_context_compression_prompt(
        event_history=[{"sequence": 1, "actor": "Aria", "action": "Opens the gate."}]
    )
    assert "Opens the gate." in prompt
    assert "summary" in prompt
