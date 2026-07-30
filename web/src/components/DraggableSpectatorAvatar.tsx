import { useRef, useState } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";

export interface SpectatorAvatarPosition {
  x: number;
  y: number;
}

interface DragState {
  basePosition: SpectatorAvatarPosition;
  pointerId: number;
  clientX: number;
  clientY: number;
  position: SpectatorAvatarPosition;
  latestPosition: SpectatorAvatarPosition;
}

interface PositionOverride {
  basePosition: SpectatorAvatarPosition;
  position: SpectatorAvatarPosition;
}

interface DraggableSpectatorAvatarProps {
  canDrag: boolean;
  children: ReactNode;
  initialPosition: SpectatorAvatarPosition;
  isSpeaking: boolean;
  name: string;
  onPositionChange: (position: SpectatorAvatarPosition) => Promise<void>;
  width: number;
  zIndex: number;
}

function clampPercentage(value: number) {
  return Math.min(100, Math.max(0, value));
}

export function DraggableSpectatorAvatar({
  canDrag,
  children,
  initialPosition,
  isSpeaking,
  name,
  onPositionChange,
  width,
  zIndex,
}: DraggableSpectatorAvatarProps) {
  const [positionOverride, setPositionOverride] = useState<PositionOverride | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const overrideMatchesServerPosition =
    positionOverride?.basePosition.x === initialPosition.x &&
    positionOverride.basePosition.y === initialPosition.y;
  const position =
    canDrag && overrideMatchesServerPosition ? positionOverride.position : initialPosition;
  const activelyDragging = canDrag && isDragging;

  const finishDrag = (event: PointerEvent<HTMLElement>, save: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const moved =
      drag.latestPosition.x !== drag.position.x || drag.latestPosition.y !== drag.position.y;
    if (!save || !canDrag || !moved) {
      if (!save || !canDrag) setPositionOverride(null);
      return;
    }

    const savedPosition = {
      x: Math.round(drag.latestPosition.x),
      y: Math.round(drag.latestPosition.y),
    };
    setPositionOverride({
      basePosition: drag.basePosition,
      position: savedPosition,
    });
    setIsSaving(true);
    void onPositionChange(savedPosition)
      .catch(() => setPositionOverride(null))
      .finally(() => setIsSaving(false));
  };

  const classNames = [
    "spectator-avatar",
    canDrag && "spectator-avatar--draggable",
    isSpeaking && "spectator-avatar--speaking",
    activelyDragging && "spectator-avatar--dragging",
    isSaving && "spectator-avatar--saving",
  ]
    .filter(Boolean)
    .join(" ");

  const style: CSSProperties = {
    left: `${position.x}%`,
    top: `${position.y}%`,
    zIndex: activelyDragging ? 1100 : zIndex,
    width: `${width}px`,
    transform: "translate(-50%, -100%)",
  };

  return (
    <figure
      aria-label={canDrag ? `Перетащить персонажа ${name}` : undefined}
      className={classNames}
      style={style}
      onPointerDown={(event) => {
        if (!canDrag || isSaving || event.button !== 0) return;
        event.preventDefault();
        dragRef.current = {
          basePosition: initialPosition,
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          position,
          latestPosition: position,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setIsDragging(true);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const container = event.currentTarget.parentElement;
        if (!container) return;
        const bounds = container.getBoundingClientRect();
        if (bounds.width === 0 || bounds.height === 0) return;
        event.preventDefault();
        const nextPosition = {
          x: clampPercentage(
            drag.position.x + ((event.clientX - drag.clientX) / bounds.width) * 100,
          ),
          y: clampPercentage(
            drag.position.y + ((event.clientY - drag.clientY) / bounds.height) * 100,
          ),
        };
        drag.latestPosition = nextPosition;
        setPositionOverride({
          basePosition: drag.basePosition,
          position: nextPosition,
        });
      }}
      onPointerUp={(event) => finishDrag(event, true)}
      onPointerCancel={(event) => finishDrag(event, false)}
      onLostPointerCapture={() => {
        if (!dragRef.current) return;
        dragRef.current = null;
        setIsDragging(false);
        setPositionOverride(null);
      }}
    >
      {children}
    </figure>
  );
}
