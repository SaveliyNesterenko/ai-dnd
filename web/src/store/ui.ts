import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Боковые колонки консоли тянутся мышью; центр забирает остаток. */
export const MIN_COLUMN_WIDTH = 260;
export const MAX_COLUMN_WIDTH = 640;

interface UiState {
  selectedCharacterId: string | null;
  audioEnabled: boolean;
  leftWidth: number;
  rightWidth: number;
  stripCollapsed: boolean;
  selectCharacter: (id: string | null) => void;
  setAudioEnabled: (enabled: boolean) => void;
  setColumnWidth: (side: "left" | "right", width: number) => void;
  toggleStrip: () => void;
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
      selectCharacter: (selectedCharacterId) => set({ selectedCharacterId }),
      setAudioEnabled: (audioEnabled) => set({ audioEnabled }),
      setColumnWidth: (side, width) =>
        set(side === "left" ? { leftWidth: clampWidth(width) } : { rightWidth: clampWidth(width) }),
      toggleStrip: () => set((state) => ({ stripCollapsed: !state.stripCollapsed })),
    }),
    {
      name: "ai-dnd-gm-ui",
      /* Переживают перезагрузку только настройки раскладки. Выбранный
         персонаж относится к текущей сцене, а разблокировка звука у зрителя
         обязана запрашиваться заново — это требование автоплея в браузере. */
      partialize: (state) => ({
        leftWidth: state.leftWidth,
        rightWidth: state.rightWidth,
        stripCollapsed: state.stripCollapsed,
      }),
    },
  ),
);
