import { subscribeToSpectatorStream, fetchInitialData } from './js/api.js';
import { updateBackground, addOrUpdateCharacterCard, renderAvatars, showDiceRoll } from './js/ui.js';
import { handleSpeechEvent } from './js/state.js';
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
        onGameStateUpdate: updateBackground,
        onActiveCharactersUpdate: (characterIds) => renderAvatars(characterIds, makeDraggable),
        onCharacterFullUpdate: addOrUpdateCharacterCard,
        onDiceRoll: showDiceRoll,
        // *** ИСПОЛЬЗУЕМ НОВЫЙ, ЕДИНЫЙ ОБРАБОТЧИК РЕПЛИК ***
        onSpeech: handleSpeechEvent 
    });

    console.log("Spectator screen initialized and connected to the unified stream.");
}

main();
