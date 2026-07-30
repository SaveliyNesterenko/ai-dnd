import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";

import {
  TOAST_LIMIT,
  TOAST_TTL_MS,
  ToastContext,
  type ToastInput,
  type ToastRecord,
} from "./toastContext";

/**
 * Один адрес для статусов и ошибок. Раньше сообщения печатались инлайн в шести
 * местах и сдвигали вёрстку панели прямо во время хода.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (input: ToastInput) => {
      const id = crypto.randomUUID();
      setToasts((current) => [...current, { ...input, id }].slice(-TOAST_LIMIT));
      if (input.tone !== "error") {
        timers.current.set(id, window.setTimeout(() => dismiss(id), TOAST_TTL_MS));
      }
    },
    [dismiss],
  );

  const api = useMemo(() => ({ push, dismiss }), [dismiss, push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="region" aria-label="Уведомления">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast toast--${toast.tone}`}
            role={toast.tone === "error" ? "alert" : "status"}
          >
            <div className="toast__text">
              <strong>{toast.title}</strong>
              {toast.description && <p>{toast.description}</p>}
            </div>
            <button
              className="toast__close"
              type="button"
              aria-label="Закрыть уведомление"
              onClick={() => dismiss(toast.id)}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M5 5l14 14" />
                <path d="M19 5L5 19" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
