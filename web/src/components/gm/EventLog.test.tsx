import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GameStateSnapshot } from "../../api/types";
import type { SpeechQueue } from "../../hooks/useSpeechQueue";
import { EventLog } from "./EventLog";

const speech = {
  entries: [],
  current: null,
  waiting: 0,
  lastFailure: null,
  isLoading: false,
  refresh: vi.fn(),
  cueStatus: () => ({ state: "silent" as const, audioUrl: null, reason: null }),
} as unknown as SpeechQueue;

function snapshotWith(status: string): GameStateSnapshot {
  return {
    active_event: {
      id: "event-1",
      title: "Пролог",
      status,
      revision: 3,
      participant_ids: [],
      context_summary: null,
      context_summary_through_sequence: null,
      turns: [
        {
          id: "turn-1",
          sequence: 1,
          character_id: null,
          actor_name: "Мастер",
          actor_role: "gm",
          thought: null,
          action: "Дверь скрипит.",
          dice_roll: null,
          audio_url: null,
          thought_audio_url: null,
          action_audio_url: null,
          created_at: "2026-07-31T10:00:00Z",
        },
      ],
    },
  } as unknown as GameStateSnapshot;
}

function renderLog(status = "active") {
  const onDelete = vi.fn();
  render(
    <EventLog
      snapshot={snapshotWith(status)}
      characters={[]}
      compressing={false}
      onCompress={vi.fn()}
      speech={speech}
      onRevoice={vi.fn()}
      onDelete={onDelete}
    />,
  );
  return { onDelete };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EventLog", () => {
  it("deletes a turn only after the GM confirms", () => {
    const { onDelete } = renderLog();

    fireEvent.click(screen.getByRole("button", { name: "Удалить ход 1" }));
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    expect(onDelete).toHaveBeenCalledWith("turn-1");
  });

  it("keeps the turn when the confirmation is dismissed", () => {
    const { onDelete } = renderLog();

    fireEvent.click(screen.getByRole("button", { name: "Удалить ход 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Удалить ход 1" })).toBeInTheDocument();
  });

  /* Событие в архивации уже ушло к Архивариусу: удалять из него нечего, и
     кнопка не должна обещать обратное. */
  it("hides deletion once the event leaves the active state", () => {
    renderLog("finalizing");

    expect(screen.queryByRole("button", { name: "Удалить ход 1" })).toBeNull();
  });
});
