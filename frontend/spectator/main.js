import { subscribeToSpectatorStream, fetchInitialData } from './js/api.js';
import { updateBackground, updateMusic, addOrUpdateCharacterCard, renderAvatars } from './js/ui.js';
import { handleSpeechEvent, handleDiceRollEvent } from './js/state.js';
import { makeDraggable } from './js/drag.js';

async function main() {
    console.log("Spectator screen initializing...");

    const { initialState, initialCharacterIds } = await fetchInitialData();
    updateBackground(initialState);
    if (initialCharacterIds) {
        renderAvatars(initialCharacterIds, makeDraggable);
    }

    // Подписываемся на события от сервера, передавая новые коллбэки
    subscribeToSpectatorStream({
        onGameStateUpdate: (state) => { updateBackground(state); updateMusic(state); },
        onActiveCharactersUpdate: (characterIds) => renderAvatars(characterIds, makeDraggable),
        onCharacterFullUpdate: addOrUpdateCharacterCard,
        onDiceRoll: handleDiceRollEvent,
        // *** ИСПОЛЬЗУЕМ НОВЫЙ, ЕДИНЫЙ ОБРАБОТЧИК РЕПЛИК ***
        onSpeech: handleSpeechEvent 
    });

    console.log("Spectator screen initialized and connected to the unified stream.");
}

main();
