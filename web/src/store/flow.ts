import { create } from "zustand";

import type { FlowBusy } from "../components/gm/TurnFlowStrip";

/**
 * Отдельный стор, чтобы тикающий счётчик долгой задачи перерисовывал только
 * полосу состояния, а не всю консоль вместе с логом и лентой карточек.
 */
interface FlowState {
  busy: FlowBusy | null;
  setBusy: (busy: FlowBusy | null) => void;
}

export const useFlowStore = create<FlowState>((set) => ({
  busy: null,
  setBusy: (busy) => set({ busy }),
}));
