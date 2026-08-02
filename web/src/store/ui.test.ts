import { beforeEach, describe, expect, it } from "vitest";

import { useUiStore } from "./ui";

describe("GM theme preference", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ theme: "dark" });
  });

  it("switches themes and persists the choice", () => {
    useUiStore.getState().toggleTheme();

    expect(useUiStore.getState().theme).toBe("light");
    const persisted = JSON.parse(localStorage.getItem("ai-dnd-gm-ui") ?? "{}") as {
      state?: { theme?: unknown };
    };
    expect(persisted.state?.theme).toBe("light");

    useUiStore.getState().toggleTheme();
    expect(useUiStore.getState().theme).toBe("dark");
  });
});
