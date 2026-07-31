import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { DraggableSpectatorAvatar } from "./DraggableSpectatorAvatar";

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;

  constructor(type: string, init: MouseEventInit & { pointerId?: number }) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}

beforeAll(() => {
  Object.defineProperty(window, "PointerEvent", {
    configurable: true,
    value: TestPointerEvent,
  });
});

afterEach(cleanup);

function renderAvatar(canDrag = true) {
  const onPositionChange = vi.fn().mockResolvedValue(undefined);
  const result = render(
    <div>
      <DraggableSpectatorAvatar
        canDrag={canDrag}
        initialPosition={{ x: 50, y: 40 }}
        isSpeaking={false}
        name="Ария"
        onPositionChange={onPositionChange}
        width={270}
        zIndex={2}
      >
        <img src="/aria.png" alt="Ария" />
      </DraggableSpectatorAvatar>
    </div>,
  );
  const avatar = result.container.querySelector("figure")!;
  Object.defineProperty(avatar.parentElement, "getBoundingClientRect", {
    value: () => ({
      width: 200,
      height: 100,
      top: 0,
      right: 200,
      bottom: 100,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    }),
  });
  return { avatar, onPositionChange, ...result };
}

describe("DraggableSpectatorAvatar", () => {
  it("moves from its scene position and persists the result", async () => {
    const { avatar, onPositionChange } = renderAvatar();

    expect(avatar).toHaveAccessibleName("Перетащить персонажа Ария");
    fireEvent.pointerDown(avatar, {
      button: 0,
      clientX: 100,
      clientY: 40,
      pointerId: 1,
    });
    fireEvent.pointerMove(avatar, {
      clientX: 120,
      clientY: 60,
      pointerId: 1,
    });

    expect(avatar).toHaveStyle({ left: "60%", top: "60%" });
    expect(avatar).toHaveClass("spectator-avatar--dragging");

    fireEvent.pointerUp(avatar, { pointerId: 1 });
    expect(avatar).not.toHaveClass("spectator-avatar--dragging");
    await waitFor(() => {
      expect(onPositionChange).toHaveBeenCalledWith({ x: 60, y: 60 });
    });
  });

  it("keeps the avatar fully inside the stage", async () => {
    const sizes = new Map([
      ["FIGURE", { width: 100, height: 80 }],
      ["DIV", { width: 200, height: 100 }],
    ]);
    const rects = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const size = sizes.get(this.tagName) ?? { width: 0, height: 0 };
        return {
          ...size,
          top: 0,
          left: 0,
          right: size.width,
          bottom: size.height,
          x: 0,
          y: 0,
          toJSON: () => undefined,
        };
      });
    const onPositionChange = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <div>
        <DraggableSpectatorAvatar
          canDrag
          initialPosition={{ x: 50, y: 40 }}
          isSpeaking={false}
          name="Ария"
          onPositionChange={onPositionChange}
          width={100}
          zIndex={2}
        >
          <img src="/aria.png" alt="Ария" />
        </DraggableSpectatorAvatar>
      </div>,
    );
    const avatar = container.querySelector("figure")!;

    // Аватар занимает 80% высоты сцены, поэтому его опора не может быть выше 80%.
    expect(avatar).toHaveStyle({ top: "80%" });

    fireEvent.pointerDown(avatar, { button: 0, clientX: 100, clientY: 80, pointerId: 1 });
    fireEvent.pointerMove(avatar, { clientX: 0, clientY: -200, pointerId: 1 });
    expect(avatar).toHaveStyle({ left: "25%", top: "80%" });

    fireEvent.pointerUp(avatar, { pointerId: 1 });
    await waitFor(() => {
      expect(onPositionChange).toHaveBeenCalledWith({ x: 25, y: 80 });
    });
    rects.mockRestore();
  });

  it("ignores non-primary mouse buttons", () => {
    const { avatar, onPositionChange } = renderAvatar();

    fireEvent.pointerDown(avatar, {
      button: 2,
      clientX: 100,
      clientY: 40,
      pointerId: 1,
    });
    fireEvent.pointerMove(avatar, {
      clientX: 120,
      clientY: 60,
      pointerId: 1,
    });

    expect(avatar).toHaveStyle({ left: "50%", top: "40%" });
    expect(avatar).not.toHaveClass("spectator-avatar--dragging");
    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it("does not expose dragging to a regular spectator", () => {
    const { avatar, onPositionChange } = renderAvatar(false);

    fireEvent.pointerDown(avatar, {
      button: 0,
      clientX: 100,
      clientY: 40,
      pointerId: 1,
    });
    fireEvent.pointerMove(avatar, {
      clientX: 120,
      clientY: 60,
      pointerId: 1,
    });
    fireEvent.pointerUp(avatar, { pointerId: 1 });

    expect(avatar).not.toHaveAttribute("aria-label");
    expect(avatar).not.toHaveClass("spectator-avatar--draggable");
    expect(avatar).toHaveStyle({ left: "50%", top: "40%" });
    expect(onPositionChange).not.toHaveBeenCalled();
  });
});
