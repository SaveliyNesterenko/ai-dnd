import { subscribeToSpectatorStream, fetchInitialData } from './js/api.js';
import { updateBackground, addOrUpdateCharacterCard, renderAvatars, showDiceRoll } from './js/ui.js';
import { addTextUpdate, addAudioUpdate } from './js/state.js';
import { makeDraggable } from './js/drag.js';

async function main() {
    console.log("Spectator screen initializing...");

    const { initialState, initialCharacterIds } = await fetchInitialData();
    updateBackground(initialState);
    if (initialCharacterIds) {
        renderAvatars(initialCharacterIds, makeDraggable);
    }

    subscribeToSpectatorStream({
        onGameStateUpdate: updateBackground,
        onActiveCharactersUpdate: (characterIds) => renderAvatars(characterIds, makeDraggable),
        onCharacterFullUpdate: addOrUpdateCharacterCard,
        onDiceRoll: showDiceRoll,
        onTextUpdate: addTextUpdate,
        onAudioUpdate: addAudioUpdate
    });

    console.log("Spectator screen initialized and connected to stream.");
}

main();
