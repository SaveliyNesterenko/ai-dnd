import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import type { RealtimeEvent } from "../api/types";

export const TEXT_ONLY_CUE_DURATION_MS = 15_000;
export const DICE_ROLL_DURATION_MS = 4_000;

export type SpeechCueKind = "thought" | "action";

export interface SpeechCue {
  id: string;
  turnId: string;
  characterId: string;
  actorName: string;
  kind: SpeechCueKind;
  text: string;
  audioUrl: string | null;
  diceRoll: number | null;
}

interface SpeechPlayback {
  activeCue: SpeechCue | null;
  diceRoll: number | null;
  enqueueRealtimeEvent: (event: RealtimeEvent) => void;
  completeActiveCue: (cueId: string) => void;
}

interface PlaybackQueue {
  campaignId: string | undefined;
  activeCue: SpeechCue | null;
  pendingCues: SpeechCue[];
}

type PlaybackAction =
  | { type: "enqueue"; campaignId: string | undefined; cue: SpeechCue }
  | { type: "complete"; campaignId: string | undefined; cueId: string }
  | { type: "skip"; campaignId: string | undefined; turnId: string | null };

function reducePlaybackQueue(state: PlaybackQueue, action: PlaybackAction): PlaybackQueue {
  const current =
    state.campaignId === action.campaignId
      ? state
      : { campaignId: action.campaignId, activeCue: null, pendingCues: [] };

  if (action.type === "enqueue") {
    if (!current.activeCue) return { ...current, activeCue: action.cue };
    return { ...current, pendingCues: [...current.pendingCues, action.cue] };
  }
  /* Пропуск от ГМ-а снимает и оставшиеся реплики того же хода: обрывать одну
     мысль, чтобы следом зазвучало действие, — не то, что он просил. */
  if (action.type === "skip") {
    if (!current.activeCue) return current;
    if (action.turnId !== null && current.activeCue.turnId !== action.turnId) return current;
    const pendingCues =
      action.turnId === null
        ? current.pendingCues
        : current.pendingCues.filter((cue) => cue.turnId !== action.turnId);
    return { ...current, activeCue: pendingCues[0] ?? null, pendingCues: pendingCues.slice(1) };
  }
  if (!current.activeCue || current.activeCue.id !== action.cueId) return current;

  const nextCue = current.pendingCues[0] ?? null;
  return {
    ...current,
    activeCue: nextCue,
    pendingCues: current.pendingCues.slice(1),
  };
}

export function speechCueFromRealtimeEvent(event: RealtimeEvent): SpeechCue | null {
  if (event.type !== "speech.ready") return null;

  const turnId = event.payload.turn_id;
  const characterId = event.payload.character_id;
  const actorName = event.payload.actor_name;
  const kind = event.payload.kind;
  const text = event.payload.text;
  const audioUrl = event.payload.audio_url;
  const diceRoll = event.payload.dice_roll;

  if (
    typeof turnId !== "string" ||
    typeof characterId !== "string" ||
    typeof actorName !== "string" ||
    (kind !== "thought" && kind !== "action") ||
    typeof text !== "string" ||
    !text.trim()
  ) {
    return null;
  }

  return {
    id: event.event_id,
    turnId,
    characterId,
    actorName,
    kind,
    text: text.trim(),
    audioUrl: typeof audioUrl === "string" && audioUrl ? audioUrl : null,
    diceRoll:
      kind === "action" && typeof diceRoll === "number" && Number.isInteger(diceRoll)
        ? diceRoll
        : null,
  };
}

export function useSpeechPlayback(campaignId: string | undefined): SpeechPlayback {
  const [queue, dispatch] = useReducer(reducePlaybackQueue, {
    campaignId,
    activeCue: null,
    pendingCues: [],
  });
  const [diceState, setDiceState] = useState<{
    campaignId: string | undefined;
    value: number | null;
  }>({ campaignId, value: null });
  const seenEventIds = useRef(new Set<string>());
  const seenCampaignId = useRef(campaignId);
  const diceTimer = useRef<number | null>(null);

  const activeCue = queue.campaignId === campaignId ? queue.activeCue : null;
  const diceRoll = diceState.campaignId === campaignId ? diceState.value : null;

  const enqueueRealtimeEvent = useCallback(
    (event: RealtimeEvent) => {
      if (seenCampaignId.current !== campaignId) {
        seenCampaignId.current = campaignId;
        seenEventIds.current.clear();
        if (diceTimer.current !== null) {
          window.clearTimeout(diceTimer.current);
          diceTimer.current = null;
        }
        setDiceState({ campaignId, value: null });
      }
      if (seenEventIds.current.has(event.event_id)) return;

      if (event.type === "speech.skip") {
        seenEventIds.current.add(event.event_id);
        const turnId = event.payload.turn_id;
        dispatch({ type: "skip", campaignId, turnId: typeof turnId === "string" ? turnId : null });
        return;
      }

      const cue = speechCueFromRealtimeEvent(event);
      if (!cue) return;

      seenEventIds.current.add(event.event_id);
      dispatch({ type: "enqueue", campaignId, cue });
    },
    [campaignId],
  );

  const completeActiveCue = useCallback(
    (cueId: string) => {
      if (!activeCue || activeCue.id !== cueId) return;

      if (activeCue.kind === "action" && activeCue.diceRoll !== null) {
        setDiceState({ campaignId, value: activeCue.diceRoll });
        if (diceTimer.current !== null) window.clearTimeout(diceTimer.current);
        diceTimer.current = window.setTimeout(() => {
          setDiceState({ campaignId, value: null });
          diceTimer.current = null;
        }, DICE_ROLL_DURATION_MS);
      }
      dispatch({ type: "complete", campaignId, cueId });
    },
    [activeCue, campaignId],
  );

  useEffect(
    () => () => {
      if (diceTimer.current !== null) window.clearTimeout(diceTimer.current);
    },
    [],
  );

  return { activeCue, diceRoll, enqueueRealtimeEvent, completeActiveCue };
}
