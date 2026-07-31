import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useFocusTrap } from "../../hooks/useFocusTrap";

export type DialogSize = "s" | "m" | "l";

interface DialogProps {
  /** Строка становится заголовком и доступным именем диалога. */
  title: string;
  /** Надстрочная метка: роль, которой принадлежит диалог. */
  eyebrow?: string;
  /** Правый слот шапки — статусы и вспомогательные действия. */
  headerExtra?: ReactNode;
  size?: DialogSize;
  tone?: "neutral" | "archivist";
  footer?: ReactNode;
  children: ReactNode;
  onClose: () => void;
}

export function Dialog({
  title,
  eyebrow,
  headerExtra,
  size = "m",
  tone = "neutral",
  footer,
  children,
  onClose,
}: DialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`dialog dialog--${size} dialog--${tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="dialog__header">
          <div className="dialog__heading">
            {eyebrow && <span className="dialog__eyebrow">{eyebrow}</span>}
            <h2 id={titleId}>{title}</h2>
          </div>
          {headerExtra}
          <button
            className="dialog__close"
            type="button"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M5 5l14 14" />
              <path d="M19 5L5 19" />
            </svg>
          </button>
        </header>
        <div className="dialog__body">{children}</div>
        {footer && <footer className="dialog__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
