# ruff: noqa: RUF001
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


def _player_prompt(**overrides: object) -> str:
    kwargs: dict[str, object] = {
        "character": {
            "id": "aria",
            "name": "Aria",
            "role": "Разведчица",
            "biography": "A scout.",
            "stats": {
                "hp": {"current": 7, "max": 12},
                "mp": {"current": 2, "max": 5},
                "attributes": {"Ловкость": 16},
                "status_effects": ["Отравление"],
            },
            "inventory": [{"name": "Компас", "quantity": 1, "description": "Странный компас."}],
        },
        "global_chronicle": ["Отряд вошёл в башню."],
        "private_notes": ["The compass is dangerous."],
        "event_history": [
            {
                "sequence": 1,
                "actor": "Aria",
                "action": "Opens the gate.",
                "dice_roll": 17,
                "own_thought": "I should hide it.",
            }
        ],
        "scene_participants": [
            {"id": "aria", "name": "Aria", "category": "player"},
            {"id": "bram", "name": "Bram", "category": "player"},
            {"id": "goblin", "name": "Гоблин", "category": "enemy"},
            {"id": "trader", "name": "Торговец", "category": "npc"},
        ],
        "scene_location": "Заброшенная башня",
    }
    kwargs.update(overrides)
    return build_player_prompt(**kwargs)  # type: ignore[arg-type]


def test_player_prompt_contains_private_notes_only_in_player_context() -> None:
    prompt = _player_prompt()
    assert "The compass is dangerous." in prompt
    assert "Bram" in prompt


def test_player_prompt_contains_all_legacy_blocks() -> None:
    prompt = _player_prompt()
    for block in (
        "--- ИНФОРМАЦИЯ О ПЕРСОНАЖЕ ---",
        "--- СОСТОЯНИЕ ---",
        "--- ПАМЯТЬ ---",
        "--- ТЕКУЩАЯ ЛОКАЦИЯ ---",
        "--- УЧАСТНИКИ СЦЕНЫ ---",
        "--- КОНТЕКСТ ИГРЫ ---",
        "--- ЦЕЛЬ ---",
        "--- ФОРМАТ ОТВЕТА ---",
    ):
        assert block in prompt
    assert prompt.index("--- ЦЕЛЬ ---") < prompt.index("--- ФОРМАТ ОТВЕТА ---")


def test_player_prompt_renders_character_state_and_memory() -> None:
    prompt = _player_prompt()
    assert "Роль: Разведчица" in prompt
    assert "Имя: Aria" in prompt
    assert "Биография: A scout." in prompt
    assert "Здоровье (HP): 7/12 | Мана (MP): 2/5" in prompt
    assert "Атрибуты: Ловкость: 16" in prompt
    assert "Эффекты: Отравление" in prompt
    assert "- Компас (1 шт): Странный компас." in prompt
    assert "Отряд вошёл в башню." in prompt


def test_player_prompt_splits_scene_participants_by_category() -> None:
    prompt = _player_prompt()
    assert "Заброшенная башня" in prompt
    assert "Команда героев: Aria (Вы), Bram" in prompt
    assert "Команда противников: Гоблин" in prompt
    assert "Нейтральные персонажи: Торговец" in prompt


def test_player_prompt_handles_empty_scene_and_history() -> None:
    prompt = _player_prompt(
        character={"name": "Aria"},
        global_chronicle=[],
        private_notes=[],
        event_history=[],
        scene_participants=[],
        scene_location=None,
    )
    assert "Локация не указана." in prompt
    assert "В сцене нет других участников." in prompt
    assert "Событий пока не было." in prompt
    assert "Инвентарь:\nПусто." in prompt
    assert "Эффекты: Нет" in prompt
    assert "Здоровье (HP): ?/? | Мана (MP): ?/?" in prompt


def test_player_prompt_renders_event_log_with_own_thoughts() -> None:
    prompt = _player_prompt()
    assert "[Ход 1] Aria: Opens the gate." in prompt
    assert "Бросок d20: 17" in prompt
    assert "Мои мысли в тот момент: I should hide it." in prompt


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
