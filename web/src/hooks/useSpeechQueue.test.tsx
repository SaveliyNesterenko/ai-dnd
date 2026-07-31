import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BackgroundJobView, TurnView } from "../api/generated/types.gen";
import { useSpeechQueue } from "./useSpeechQueue";

const speechJobs = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    speechJobs: (campaignId: string) => speechJobs(campaignId) as unknown,
  },
}));

function job(overrides: Partial<BackgroundJobView> = {}): BackgroundJobView {
  return {
    id: "job-1",
    campaign_id: "campaign-1",
    kind: "speech_synthesis",
    status: "succeeded",
    input_data: { turn_id: "turn-1", character_id: "aria", actor_name: "Aria" },
    output_data: null,
    error_code: null,
    created_at: "2026-07-30T10:00:00Z",
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

function turn(overrides: Partial<TurnView> = {}): TurnView {
  return {
    id: "turn-1",
    sequence: 1,
    character_id: "aria",
    actor_name: "Aria",
    actor_role: "Player",
    thought: "I should inspect the gears.",
    action: "I inspect the mechanism.",
    dice_roll: null,
    audio_url: null,
    thought_audio_url: null,
    action_audio_url: null,
    created_at: "2026-07-30T10:00:00Z",
    ...overrides,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderQueue() {
  return renderHook(() => useSpeechQueue("campaign-1"), { wrapper });
}

beforeEach(() => {
  speechJobs.mockReset();
});

describe("useSpeechQueue", () => {
  it("reads the queue oldest first and names who is being voiced", async () => {
    speechJobs.mockResolvedValue([
      job({ id: "job-2", status: "queued", input_data: { turn_id: "turn-2", actor_name: "Brint" } }),
      job({ id: "job-1", status: "running" }),
    ]);
    const { result } = renderQueue();

    await waitFor(() => expect(result.current.current).not.toBeNull());
    expect(result.current.current?.actorName).toBe("Aria");
    expect(result.current.waiting).toBe(1);
  });

  it("marks a turn as pending while its job is unfinished", async () => {
    speechJobs.mockResolvedValue([job({ status: "running" })]);
    const { result } = renderQueue();

    await waitFor(() => expect(result.current.current).not.toBeNull());
    expect(result.current.cueStatus(turn(), "action").state).toBe("pending");
    /* Переозвучка уже озвученного хода тоже «синтезируется», иначе она
       выглядит как бездействие. */
    const voiced = turn({ action_audio_url: "/api/v1/assets/generated-audio/turn-1-action.wav" });
    expect(result.current.cueStatus(voiced, "action").state).toBe("pending");
  });

  it("explains why a finished cue stayed silent", async () => {
    speechJobs.mockResolvedValue([
      job({ output_data: { reasons: { thought: "thoughts_muted" } } }),
    ]);
    const { result } = renderQueue();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const voiced = turn({ action_audio_url: "/api/v1/assets/generated-audio/turn-1-action.wav" });
    expect(result.current.cueStatus(voiced, "action").state).toBe("voiced");
    expect(result.current.cueStatus(voiced, "thought")).toMatchObject({
      state: "silent",
      reason: "Мысли не озвучиваются",
    });
  });

  it("surfaces the last broken job so the GM can revoice it", async () => {
    speechJobs.mockResolvedValue([job({ status: "failed", error_code: "RuntimeError" })]);
    const { result } = renderQueue();

    await waitFor(() => expect(result.current.lastFailure).not.toBeNull());
    expect(result.current.lastFailure?.turnId).toBe("turn-1");
    expect(result.current.current).toBeNull();
  });
});
