from __future__ import annotations

import json
from typing import Any

PLAYER_PROMPT_VERSION = "player-turn/v1"
OBSERVER_PROMPT_VERSION = "observer/v1"


def build_player_prompt(
    *,
    character: dict[str, Any],
    global_chronicle: list[str],
    private_notes: list[str],
    event_history: list[dict[str, Any]],
) -> str:
    context = {
        "character": character,
        "global_chronicle": global_chronicle,
        "private_notes": private_notes,
        "event_history": event_history,
    }
    return (
        f"Prompt version: {PLAYER_PROMPT_VERSION}\n"
        "Play the assigned character. Produce a private thought and a public action. "
        "Do not invent changes to statistics or inventory.\n"
        f"Context:\n{json.dumps(context, ensure_ascii=False)}"
    )


def build_observer_prompt(
    *,
    action: str,
    dice_roll: int | None,
    public_characters: list[dict[str, Any]],
    campaign_revision: int,
) -> str:
    context = {
        "action": action,
        "dice_roll": dice_roll,
        "characters": public_characters,
        "campaign_revision": campaign_revision,
    }
    return (
        f"Prompt version: {OBSERVER_PROMPT_VERSION}\n"
        "Act as a deterministic tabletop rules assistant. Return a concise GM brief and only "
        "the allowed typed operations. Use only the supplied public action and character state.\n"
        f"Context:\n{json.dumps(context, ensure_ascii=False)}"
    )
