import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { useFocusTrap } from "../../hooks/useFocusTrap";

const VIEWPORT_MARGIN = 10;
const ANCHOR_GAP = 6;

interface PopoverProps {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  /** Доступное имя всплывающей панели. */
  label: string;
  width?: number;
  /** К какому краю якоря прижимать панель. */
  align?: "start" | "end";
  children: ReactNode;
}

export function Popover({
  anchorRef,
  open,
  onClose,
  label,
  width = 340,
  align = "start",
  children,
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);

  /* Позиция считается после отрисовки: до неё неизвестна высота панели, а от
     высоты зависит, откроется панель вниз или вверх. Пишем прямо в стиль узла —
     через состояние это стоило бы лишнего рендера на каждый скролл. */
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const rect = anchor.getBoundingClientRect();
      const height = panel.offsetHeight;
      const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
      const left = align === "end" ? rect.right - width : rect.left;
      const below = rect.bottom + ANCHOR_GAP;
      const fitsBelow = below + height <= window.innerHeight - VIEWPORT_MARGIN;
      panel.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(left, maxLeft))}px`;
      panel.style.top = `${
        fitsBelow ? below : Math.max(VIEWPORT_MARGIN, rect.top - ANCHOR_GAP - height)
      }px`;
      panel.style.visibility = "visible";
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [align, anchorRef, open, width]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [anchorRef, onClose, open]);

  if (!open) return null;

  return createPortal(
    <div
      ref={panelRef}
      className="popover"
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      // До первого замера панель не должна мигнуть в левом верхнем углу.
      style={{ width, left: 0, top: 0, visibility: "hidden" }}
    >
      {children}
    </div>,
    document.body,
  );
}
