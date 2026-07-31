import { useLayoutEffect, useRef, useState } from "react";
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

/** Доля аватара в размере сцены, в процентах: нужна, чтобы он не уходил за края. */
interface AvatarExtent {
  width: number;
  height: number;
}

function clampWithin(value: number, min: number, max: number) {
  // Аватар крупнее сцены: центрируем то, что не помещается.
  if (min > max) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}

/**
 * Позиция — точка под ногами аватара (он отрисован вверх от неё). Ограничиваем
 * её так, чтобы фигура целиком оставалась в кадре и её всегда можно было взять.
 */
function clampToStage(
  position: SpectatorAvatarPosition,
  extent: AvatarExtent,
): SpectatorAvatarPosition {
  return {
    x: clampWithin(position.x, extent.width / 2, 100 - extent.width / 2),
    y: clampWithin(position.y, extent.height, 100),
  };
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
  const [extent, setExtent] = useState<AvatarExtent>({ width: 0, height: 0 });
  const figureRef = useRef<HTMLElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const overrideMatchesServerPosition =
    positionOverride?.basePosition.x === initialPosition.x &&
    positionOverride.basePosition.y === initialPosition.y;
  const storedPosition =
    canDrag && overrideMatchesServerPosition ? positionOverride.position : initialPosition;
  // Сохранённая позиция тоже приводится в кадр: иначе аватар, уехавший за край
  // раньше, остался бы недосягаемым для мыши.
  const position = clampToStage(storedPosition, extent);
  const activelyDragging = canDrag && isDragging;

  useLayoutEffect(() => {
    const element = figureRef.current;
    const stage = element?.parentElement;
    if (!element || !stage) return;

    const measure = () => {
      const box = element.getBoundingClientRect();
      const area = stage.getBoundingClientRect();
      if (!area.width || !area.height) return;
      setExtent({
        width: (box.width / area.width) * 100,
        height: (box.height / area.height) * 100,
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(stage);
    // ResizeObserver не доставляет колбэк, пока вкладка не отрисовывается,
    // поэтому размер картинки перепроверяем ещё и по её загрузке.
    element.addEventListener("load", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      element.removeEventListener("load", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [width]);

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

  // Ширину задаём картинке, а не фигуре: тогда фигура обтягивает аватар и
  // область захвата совпадает с ним даже после ограничения по высоте кадра.
  const style = {
    left: `${position.x}%`,
    top: `${position.y}%`,
    zIndex: activelyDragging ? 1100 : zIndex,
    "--avatar-width": `${width}px`,
    transform: "translate(-50%, -100%)",
  } as CSSProperties;

  return (
    <figure
      ref={figureRef}
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
        const nextPosition = clampToStage(
          {
            x: drag.position.x + ((event.clientX - drag.clientX) / bounds.width) * 100,
            y: drag.position.y + ((event.clientY - drag.clientY) / bounds.height) * 100,
          },
          extent,
        );
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
