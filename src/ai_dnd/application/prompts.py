from __future__ import annotations

import json
from typing import Any

PLAYER_PROMPT_VERSION = "player-turn/v2"
OBSERVER_PROMPT_VERSION = "observer/v1"
ARCHIVIST_PROMPT_VERSION = "archivist/v1"


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


def build_archivist_prompt(
    *,
    event: dict[str, Any],
    chronicle_versions: list[list[str]],
    players: list[dict[str, Any]],
    event_history: list[dict[str, Any]],
) -> str:
    context = {
        "event": event,
        "chronicle_versions": chronicle_versions,
        "players": players,
        "event_history": event_history,
    }
    return (
        f"Prompt version: {ARCHIVIST_PROMPT_VERSION}\n"
        "Finalize a tabletop game event without inventing facts. Create one consolidated "
        "chronicle that merges all supplied prior chronicle versions with the factual public "
        "actions of this event. Create one private recollection for every supplied player, keyed "
        "exactly by character id. A player's recollection may use only that player's prior private "
        "notes, that player's own thoughts, and public actions. Never reveal one player's private "
        "notes or thoughts in another player's recollection. Preserve important relationships, "
        "discoveries, decisions, consequences, inventory changes, injuries, and unresolved goals. "
        "Return the complete replacement chronicle and complete replacement player recollections.\n"
        f"Context:\n{json.dumps(context, ensure_ascii=False)}"
    )
