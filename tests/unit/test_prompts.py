from ai_dnd.application.prompts import build_observer_prompt, build_player_prompt


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
    )
    assert "The compass is dangerous." in prompt
