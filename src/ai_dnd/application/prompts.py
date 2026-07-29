# ruff: noqa: RUF001
from __future__ import annotations

import json
from typing import Any

PLAYER_PROMPT_VERSION = "player-turn/v2"
OBSERVER_PROMPT_VERSION = "observer/v2"
ARCHIVIST_PROMPT_VERSION = "archivist/v2"
PLAYER_RECOLLECTION_PROMPT_VERSION = "player-recollection/v1"
CONTEXT_COMPRESSION_PROMPT_VERSION = "context-compression/v1"


def build_player_prompt(
    *,
    character: dict[str, Any],
    global_chronicle: list[str],
    private_notes: list[str],
    event_history: list[dict[str, Any]],
    scene_participants: list[dict[str, Any]],
) -> str:
    context = {
        "character": character,
        "global_chronicle": global_chronicle,
        "private_notes": private_notes,
        "scene_participants": scene_participants,
        "event_history": event_history,
    }
    return (
        f"Prompt version: {PLAYER_PROMPT_VERSION}\n"
        "Play only the assigned character. Produce an internal thought and a public action. "
        "The thought is shown to spectators and retained for this same character, but it is never "
        "shared with other player models. Do not control other characters and do not invent "
        "changes to statistics or inventory.\n"
        f"Context:\n{json.dumps(context, ensure_ascii=False)}"
    )


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
        "Разрешённые операции: set_resource для полного нового значения HP/MP; "
        "set_attribute; add_inventory_item; update_inventory_item; remove_inventory_item; "
        "adjust_inventory_item с quantity_delta; add_status_effect; remove_status_effect. "
        "Для существующих предметов и эффектов предпочитай переданные id, но допустимо "
        "адресовать их по имени. Возвращай только реально изменившиеся значения. Если "
        "механических изменений нет, верни пустой список operations.\n"
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
