# ruff: noqa: RUF001
from __future__ import annotations

import json
from typing import Any

PLAYER_PROMPT_VERSION = "player-turn/v3"
OBSERVER_PROMPT_VERSION = "observer/v3"
ARCHIVIST_PROMPT_VERSION = "archivist/v2"
PLAYER_RECOLLECTION_PROMPT_VERSION = "player-recollection/v1"
CONTEXT_COMPRESSION_PROMPT_VERSION = "context-compression/v1"


_PLAYER_HERO_CATEGORY = "player"
_PLAYER_ENEMY_CATEGORY = "enemy"

_PLAYER_GOAL_BLOCK = (
    "Твоя задача — отыгрывать роль своего персонажа в рамках кампании D&D, опираясь на его "
    "характер, состояние, память и историю событий. Играй только за назначенного персонажа: "
    "не управляй другими участниками сцены и не описывай их реакции. Результат твоих действий "
    "(попадание, урон, смерть врага) определит ГМ и кубики после твоего хода, поэтому не "
    "объявляй исход сам и не выдумывай изменений характеристик или инвентаря."
)

_PLAYER_FORMAT_BLOCK = (
    "Верни JSON-объект строго с двумя полями в указанном порядке:\n"
    "thought — твои внутренние рассуждения: оценка ситуации и формирование плана действий. "
    "Мысль видят зрители, и она сохранится в памяти этого же персонажа, но другим игрокам она "
    "никогда не передаётся.\n"
    "action — твои действия, описанные от первого лица: прямая речь, движения, применение "
    "заклинаний или предметов. Это то, что видят и слышат другие."
)


def _format_character_block(character: dict[str, Any]) -> str:
    stats = character.get("stats") or {}
    hp = stats.get("hp") or {}
    mp = stats.get("mp") or {}
    attributes = stats.get("attributes") or {}
    status_effects = stats.get("status_effects") or []
    inventory = character.get("inventory") or []

    attributes_str = ", ".join(f"{key}: {value}" for key, value in attributes.items()) or "Нет"
    effects_str = ", ".join(str(effect) for effect in status_effects) or "Нет"
    if inventory:
        inventory_str = "\n".join(
            f"- {item.get('name', 'Без названия')} ({item.get('quantity', '?')} шт): "
            f"{item.get('description', '')}"
            for item in inventory
        )
    else:
        inventory_str = "Пусто."

    return (
        "--- ИНФОРМАЦИЯ О ПЕРСОНАЖЕ ---\n"
        f"Роль: {character.get('role', 'Unknown')}\n"
        f"Имя: {character.get('name', 'Unknown')}\n"
        f"Биография: {character.get('biography', '')}\n"
        "\n"
        "--- СОСТОЯНИЕ ---\n"
        f"Здоровье (HP): {hp.get('current', '?')}/{hp.get('max', '?')} | "
        f"Мана (MP): {mp.get('current', '?')}/{mp.get('max', '?')}\n"
        f"Атрибуты: {attributes_str}\n"
        f"Эффекты: {effects_str}\n"
        f"Инвентарь:\n{inventory_str}"
    )


def _format_memory_block(global_chronicle: list[str], private_notes: list[str]) -> str:
    global_str = "\n".join(global_chronicle) or "Пусто."
    private_str = "\n".join(private_notes) or "Пусто."
    return f"--- ПАМЯТЬ ---\nГлобальные знания:\n{global_str}\n\nЛичные заметки:\n{private_str}"


def _format_scene_participants_block(
    scene_participants: list[dict[str, Any]],
    *,
    own_name: str,
) -> str:
    heroes: list[str] = []
    enemies: list[str] = []
    neutrals: list[str] = []
    for participant in scene_participants:
        name = participant.get("name")
        if not name:
            continue
        display_name = f"{name} (Вы)" if name == own_name else str(name)
        category = str(participant.get("category", "npc")).lower()
        if category == _PLAYER_HERO_CATEGORY:
            heroes.append(display_name)
        elif category == _PLAYER_ENEMY_CATEGORY:
            enemies.append(display_name)
        else:
            neutrals.append(display_name)

    lines = ["--- УЧАСТНИКИ СЦЕНЫ ---"]
    if heroes:
        lines.append(f"Команда героев: {', '.join(heroes)}")
    if enemies:
        lines.append(f"Команда противников: {', '.join(enemies)}")
    if neutrals:
        lines.append(f"Нейтральные персонажи: {', '.join(neutrals)}")
    if len(lines) == 1:
        lines.append("В сцене нет других участников.")
    return "\n".join(lines)


def _format_event_history_block(event_history: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for event in event_history:
        actor = event.get("actor", "N/A")
        sequence = event.get("sequence", "N/A")
        line = f"[Ход {sequence}] {actor}: {event.get('action', '')}"
        dice_roll = event.get("dice_roll")
        if dice_roll is not None:
            line += f"\nБросок d20: {dice_roll}"
        own_thought = event.get("own_thought")
        if own_thought:
            line += f"\nМои мысли в тот момент: {own_thought}"
        lines.append(line)
    body = "\n".join(lines) or "Событий пока не было."
    return f"--- КОНТЕКСТ ИГРЫ ---\nИстория событий (Лог):\n{body}"


def build_player_prompt(
    *,
    character: dict[str, Any],
    global_chronicle: list[str],
    private_notes: list[str],
    event_history: list[dict[str, Any]],
    scene_participants: list[dict[str, Any]],
    scene_location: str | None = None,
) -> str:
    own_name = str(character.get("name", ""))
    blocks = [
        _format_character_block(character),
        _format_memory_block(global_chronicle, private_notes),
        f"--- ТЕКУЩАЯ ЛОКАЦИЯ ---\n{scene_location or 'Локация не указана.'}",
        _format_scene_participants_block(scene_participants, own_name=own_name),
        _format_event_history_block(event_history),
        f"--- ЦЕЛЬ ---\n{_PLAYER_GOAL_BLOCK}",
        f"--- ФОРМАТ ОТВЕТА ---\n{_PLAYER_FORMAT_BLOCK}",
    ]
    return f"Prompt version: {PLAYER_PROMPT_VERSION}\n\n" + "\n\n".join(blocks)


def build_observer_prompt(
    *,
    action: str,
    dice_roll: int | None,
    actor_name: str,
    public_characters: list[dict[str, Any]],
    campaign_revision: int,
) -> str:
    context = {
        "actor_name": actor_name,
        "action": action,
        "dice_roll": dice_roll,
        "characters": public_characters,
        "campaign_revision": campaign_revision,
    }
    return (
        f"Prompt version: {OBSERVER_PROMPT_VERSION}\n"
        "Ты — Процессор Игровой Логики и эксперт по механикам D&D 5e. Проверь "
        "допустимость публичного действия, учти результат d20, рассчитай технические "
        "последствия и верни краткий gm_brief для мастера вместе с operations.\n"
        "Используй только публичное действие и переданные stats/inventory/status_effects. "
        "Мысли и личная память персонажей тебе недоступны. Не придумывай отсутствующие "
        "ресурсы или предметы.\n"
        "Возвращай только реально изменившиеся значения. Если механических изменений "
        "нет, верни пустой список operations.\n"
        "Каждый элемент operations — объект, вид которого задаётся полем «op». Поле "
        "называется именно op: варианты operation, type, action, kind недопустимы и "
        "приведут к отказу. Набор полей по видам:\n"
        "- set_resource: character_id, resource ('hp' или 'mp'), current — полное новое "
        "значение (целое ≥ 0, не дельта), maximum — целое, необязательно;\n"
        "- set_attribute: character_id, attribute — имя из латинских букв, цифр и "
        "подчёркиваний (до 32 символов, ровно как в переданных stats), value — целое;\n"
        "- add_inventory_item: character_id, item — объект с полями name, quantity, "
        "description;\n"
        "- update_inventory_item: character_id, item_id или item_name для поиска предмета "
        "и хотя бы одно из name, quantity, description;\n"
        "- remove_inventory_item: character_id, item_id или name;\n"
        "- adjust_inventory_item: character_id, item_id или name, quantity_delta — целое "
        "со знаком;\n"
        "- add_status_effect: character_id, name;\n"
        "- remove_status_effect: character_id, status_effect_id или name.\n"
        "Для существующих предметов и эффектов предпочитай переданные id, но допустимо "
        "адресовать их по имени.\n"
        f"Context:\n{json.dumps(context, ensure_ascii=False)}"
    )


def build_archivist_prompt(
    *,
    chronicle_versions: list[list[str]],
    event_history: list[dict[str, Any]],
) -> str:
    context = {
        "chronicle_versions": chronicle_versions,
        "event_history": event_history,
    }
    return (
        f"Prompt version: {ARCHIVIST_PROMPT_VERSION}\n"
        "Ты — Синтезатор Хроники кампании D&D. Создай одну полную, единую и "
        "непротиворечивую хронику: объедини все переданные версии прежней хроники и "
        "фактологические публичные события нового лога. Если прежних версий нет, начни "
        "хронику с новых событий. Устрани расхождения между версиями, не придумывая фактов. "
        "Отрази только ключевые факты, решения и последствия. Пиши в прошедшем времени от "
        "третьего лица. Верни полный текст хроники в поле chronicle. Не создавай личные "
        "заметки и не пытайся рассуждать от лица игроков.\n"
        f"Context:\n{json.dumps(context, ensure_ascii=False)}"
    )


def build_player_recollection_prompt(
    *,
    character: dict[str, Any],
    prior_private_notes: list[str],
    event_history: list[dict[str, Any]],
) -> str:
    context = {
        "character": character,
        "prior_private_notes": prior_private_notes,
        "event_history": event_history,
    }
    return (
        f"Prompt version: {PLAYER_RECOLLECTION_PROMPT_VERSION}\n"
        "Ты играешь только указанного персонажа. От его первого лица полностью перепиши "
        "личные заметки после произошедшего события. Сохрани важные прежние мысли и добавь "
        "новые наблюдения, которые помогут ориентироваться в мире, взаимодействовать с "
        "компаньонами и продвигаться по сюжету. Это личный дневник, а не фактологический "
        "конспект. Используй публичные действия всех участников и только собственные мысли "
        "этого персонажа, отмеченные own_thought. Никогда не выдумывай и не используй мысли "
        "других персонажей. Верни полный итоговый текст заметки в поле note.\n"
        f"Context:\n{json.dumps(context, ensure_ascii=False)}"
    )


def build_context_compression_prompt(*, event_history: list[dict[str, Any]]) -> str:
    return (
        f"Prompt version: {CONTEXT_COMPRESSION_PROMPT_VERSION}\n"
        "Ты — Синтезатор Хроники. Сделай краткий фактологический конспект переданной "
        "старой части текущего лога игрового события. Сохрани значимые действия, решения "
        "и последствия, не добавляй новых фактов. Верни только конспект в поле summary.\n"
        f"Context:\n{json.dumps({'event_history': event_history}, ensure_ascii=False)}"
    )
