import { useRef } from "react";

import { MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from "../../store/ui";

const KEYBOARD_STEP = 16;

/** Разделитель колонок: тянется мышью и двигается стрелками с клавиатуры. */
export function ColumnResizer({
  side,
  width,
  onResize,
}: {
  side: "left" | "right";
  width: number;
  onResize: (width: number) => void;
}) {
  const dragRef = useRef<{ pointerX: number; width: number } | null>(null);
  // Правая колонка растёт влево, поэтому знак смещения у неё обратный.
  const direction = side === "left" ? 1 : -1;

  return (
    <div
      className="column-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={side === "left" ? "Ширина левой колонки" : "Ширина правой колонки"}
      aria-valuenow={width}
      aria-valuemin={MIN_COLUMN_WIDTH}
      aria-valuemax={MAX_COLUMN_WIDTH}
      tabIndex={0}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { pointerX: event.clientX, width };
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag) return;
        onResize(drag.width + (event.clientX - drag.pointerX) * direction);
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        dragRef.current = null;
      }}
      onLostPointerCapture={() => {
        dragRef.current = null;
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const step = event.key === "ArrowLeft" ? -KEYBOARD_STEP : KEYBOARD_STEP;
        onResize(width + step * direction);
      }}
    />
  );
}
