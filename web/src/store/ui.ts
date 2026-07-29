import { create } from "zustand";

interface UiState {
  selectedCharacterId: string | null;
  audioEnabled: boolean;
  selectCharacter: (id: string | null) => void;
  setAudioEnabled: (enabled: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  selectedCharacterId: null,
  audioEnabled: false,
  selectCharacter: (selectedCharacterId) => set({ selectedCharacterId }),
  setAudioEnabled: (audioEnabled) => set({ audioEnabled }),
}));
