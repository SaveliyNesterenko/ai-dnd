import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RealtimeEvent } from "../api/types";
import {
  DICE_ROLL_DURATION_MS,
  speechCueFromRealtimeEvent,
  useSpeechPlayback,
} from "./useSpeechPlayback";

function speechReady(
  kind: "thought" | "action",
  overrides: Partial<RealtimeEvent> = {},
): RealtimeEvent {
  return {
    event_id: `speech-${kind}`,
    campaign_id: "campaign-1",
    sequence: kind === "thought" ? 2 : 3,
    type: "speech.ready",
    occurred_at: "2026-07-30T10:00:00Z",
    payload: {
      turn_id: "turn-1",
      character_id: "aria",
      actor_name: "Aria",
      kind,
      text: kind === "thought" ? "I should inspect the gears." : "I inspect the mechanism.",
      audio_url: `/api/v1/assets/generated-audio/turn-1-${kind}.wav`,
      dice_roll: kind === "action" ? 17 : null,
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("speechCueFromRealtimeEvent", () => {
  it("maps a ready speech event with its own audio", () => {
    expect(speechCueFromRealtimeEvent(speechReady("thought"))).toMatchObject({
      kind: "thought",
      characterId: "aria",
      audioUrl: "/api/v1/assets/generated-audio/turn-1-thought.wav",
      diceRoll: null,
    });
  });

  it("ignores turn updates and invalid speech payloads", () => {
    expect(speechCueFromRealtimeEvent(speechReady("thought", { type: "turn.created" }))).toBeNull();
    expect(
      speechCueFromRealtimeEvent(speechReady("thought", { payload: { kind: "thought" } })),
    ).toBeNull();
  });
});

describe("useSpeechPlayback", () => {
  it("replaces thought with action and shows the die after action completion", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSpeechPlayback("campaign-1"));

    act(() => {
      result.current.enqueueRealtimeEvent(speechReady("thought"));
      result.current.enqueueRealtimeEvent(speechReady("action"));
    });
    await act(async () => {});
    expect(result.current.activeCue?.kind).toBe("thought");

    act(() => result.current.completeActiveCue("speech-thought"));
    await act(async () => {});
    expect(result.current.activeCue?.kind).toBe("action");

    act(() => result.current.completeActiveCue("speech-action"));
    expect(result.current.activeCue).toBeNull();
    expect(result.current.diceRoll).toBe(17);

    act(() => {
      vi.advanceTimersByTime(DICE_ROLL_DURATION_MS);
    });
    expect(result.current.diceRoll).toBeNull();
  });

  it("deduplicates replayed realtime speech events", async () => {
    const { result } = renderHook(() => useSpeechPlayback("campaign-1"));
    const thought = speechReady("thought");

    act(() => {
      result.current.enqueueRealtimeEvent(thought);
      result.current.enqueueRealtimeEvent(thought);
    });
    await act(async () => {});
    expect(result.current.activeCue?.id).toBe("speech-thought");

    act(() => result.current.completeActiveCue("speech-thought"));
    await act(async () => {});
    expect(result.current.activeCue).toBeNull();
  });
});
