import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { CharacterPublic } from "../api/types";
import { CharacterCard } from "./CharacterCard";

const character: CharacterPublic = {
  id: "aria",
  slug: "aria",
  name: "<img src=x onerror=alert(1)>",
  kind: "player",
  role: "Player",
  biography: "<script>alert(1)</script>",
  sprite_url: null,
  flip_x: false,
  is_active: true,
  hp_current: 9,
  hp_max: 10,
  mp_current: 3,
  mp_max: 5,
  attributes: {},
  inventory: [],
  status_effects: ["<svg onload=alert(1)>"],
  revision: 1,
};

describe("CharacterCard", () => {
  it("renders untrusted content as text rather than markup", () => {
    const { container } = render(<CharacterCard character={character} />);
    expect(screen.getByText(character.name)).toBeInTheDocument();
    expect(screen.getByText(character.status_effects[0]!)).toBeInTheDocument();
    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });
});
