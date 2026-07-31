import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CharacterGM } from "../../api/types";
import { useUiStore } from "../../store/ui";
import { ToastProvider } from "../ui/ToastProvider";
import { TurnComposer } from "./TurnComposer";

const createTurn = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    createTurn: (campaignId: string, eventId: string, input: unknown) =>
      createTurn(campaignId, eventId, input) as unknown,
  },
}));

const character = { id: "gareth", name: "Гарет", role: "player" } as CharacterGM;

function renderComposer() {
  const onTurnPublished = vi.fn();
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <TurnComposer
          campaignId="camp-1"
          eventId="event-1"
          character={character}
          onTurnPublished={onTurnPublished}
          onChanged={vi.fn()}
          onPickCharacter={vi.fn()}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Написать ход вручную" }));
  fireEvent.change(screen.getByLabelText("Публичное действие"), {
    target: { value: "Гарет бьёт гоблина." },
  });
  return { onTurnPublished, ...result };
}

beforeEach(() => {
  useUiStore.setState({ notifyObserver: true });
  createTurn.mockResolvedValue({ id: "turn-1" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TurnComposer", () => {
  it("passes the turn to the observer while the toggle is on", async () => {
    const { onTurnPublished } = renderComposer();

    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    await waitFor(() => {
      expect(onTurnPublished).toHaveBeenCalledWith("turn-1", true);
    });
  });

  it("publishes without the observer once the toggle is off", async () => {
    const { onTurnPublished } = renderComposer();
    const toggle = screen.getByRole("switch", { name: "Отправлять ход Наблюдателю" });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("button", { name: "Отправить с броском d20" }));

    await waitFor(() => {
      expect(onTurnPublished).toHaveBeenCalledWith("turn-1", false);
    });
    /* Публикация хода не зависит от тумблера: он режет только разбор. */
    expect(createTurn).toHaveBeenCalledWith("camp-1", "event-1", {
      character_id: "gareth",
      actor_name: "Гарет",
      actor_role: "player",
      thought: undefined,
      action: "Гарет бьёт гоблина.",
      roll_dice: true,
    });
  });
});
