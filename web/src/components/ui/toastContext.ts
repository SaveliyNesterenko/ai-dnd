import { createContext } from "react";

export type ToastTone = "success" | "error" | "observer" | "archivist";

export interface ToastInput {
  tone: ToastTone;
  title: string;
  description?: string;
}

export interface ToastRecord extends ToastInput {
  id: string;
}

export interface ToastApi {
  push: (toast: ToastInput) => void;
  dismiss: (id: string) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

/** Ошибки живут до закрытия: их читают, а не замечают краем глаза. */
export const TOAST_TTL_MS = 6_000;
export const TOAST_LIMIT = 3;
