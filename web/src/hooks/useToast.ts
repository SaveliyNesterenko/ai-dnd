import { useContext } from "react";

import { ToastContext } from "../components/ui/toastContext";

export function useToast() {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast вызван вне ToastProvider.");
  return api;
}
