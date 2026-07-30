import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CharacterPublic } from "../api/types";
import { CharacterCard } from "./CharacterCard";
import { CharacterDetailsModal } from "./CharacterDetailsModal";

const character: CharacterPublic = {
  id: "aria",
  slug: "aria",
  name: "<img src=x onerror=alert(1)>",
  kind: "player",
  role: "Player",
  biography: "<script>alert(1)</script>",
  model_id: "deepseek/deepseek-v3.2",
  sprite_url: null,
  flip_x: false,
  is_active: true,
  hp_current: 9,
  hp_max: 10,
  mp_current: 3,
  mp_max: 5,
  attributes: { Сила: 14 },
  inventory: [{ id: "item", name: "<b>Меч</b>", quantity: 2, description: "<i>Острый</i>" }],
  status_effects: ["<svg onload=alert(1)>"],
  revision: 1,
};

afterEach(cleanup);

describe("CharacterCard", () => {
  it("renders untrusted content as text rather than markup", () => {
    const { container } = render(<CharacterCard character={character} />);
    expect(screen.getByText(character.name)).toBeInTheDocument();
    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });

  it("shows a short model name and reports a click for the details modal", () => {
    const onOpen = vi.fn();
    render(<CharacterCard character={character} onOpen={onOpen} />);
    expect(screen.getByText("deepseek-v3.2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: `Открыть сведения: ${character.name}` }));
    expect(onOpen).toHaveBeenCalledWith(character);
  });
});

describe("CharacterDetailsModal", () => {
  it("renders full details as text and closes on Escape", () => {
    const onClose = vi.fn();
    const { container } = render(
      <CharacterDetailsModal character={character} onClose={onClose} />,
    );

    expect(screen.getByText(character.biography)).toBeInTheDocument();
    expect(screen.getByText(character.status_effects[0]!)).toBeInTheDocument();
    expect(screen.getByText(character.inventory[0]!.name)).toBeInTheDocument();
    expect(screen.getByText("<i>Острый</i>")).toBeInTheDocument();
    expect(screen.getByText("Сила")).toBeInTheDocument();
    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
