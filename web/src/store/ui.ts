import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Боковые колонки консоли тянутся мышью; центр забирает остаток. */
export const MIN_COLUMN_WIDTH = 260;
export const MAX_COLUMN_WIDTH = 640;

export type GmTheme = "dark" | "light";

interface UiState {
  selectedCharacterId: string | null;
  audioEnabled: boolean;
  leftWidth: number;
  rightWidth: number;
  stripCollapsed: boolean;
  theme: GmTheme;
  /** Уходит ли опубликованный ход Наблюдателю на разбор. */
  notifyObserver: boolean;
  selectCharacter: (id: string | null) => void;
  setAudioEnabled: (enabled: boolean) => void;
  setColumnWidth: (side: "left" | "right", width: number) => void;
  toggleStrip: () => void;
  toggleTheme: () => void;
  setNotifyObserver: (enabled: boolean) => void;
}

const clampWidth = (width: number) =>
  Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(width)));

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      selectedCharacterId: null,
      audioEnabled: false,
      leftWidth: 380,
      rightWidth: 380,
      stripCollapsed: false,
      theme: "dark",
      notifyObserver: true,
      selectCharacter: (selectedCharacterId) => set({ selectedCharacterId }),
      setAudioEnabled: (audioEnabled) => set({ audioEnabled }),
      setColumnWidth: (side, width) =>
        set(side === "left" ? { leftWidth: clampWidth(width) } : { rightWidth: clampWidth(width) }),
      toggleStrip: () => set((state) => ({ stripCollapsed: !state.stripCollapsed })),
      toggleTheme: () => set((state) => ({ theme: state.theme === "dark" ? "light" : "dark" })),
      setNotifyObserver: (notifyObserver) => set({ notifyObserver }),
    }),
    {
      name: "ai-dnd-gm-ui",
      /* Переживают перезагрузку настройки раскладки и режим работы ГМ.
         Выбранный персонаж относится к текущей сцене, а разблокировка звука у
         зрителя обязана запрашиваться заново — это требование автоплея в
         браузере. */
      partialize: (state) => ({
        leftWidth: state.leftWidth,
        rightWidth: state.rightWidth,
        stripCollapsed: state.stripCollapsed,
        theme: state.theme,
        notifyObserver: state.notifyObserver,
      }),
    },
  ),
);
