export const API_BASE_URL = 'http://127.0.0.1:8000';

export function subscribeToSpectatorStream(callbacks) {
    console.log("Connecting to the unified spectator stream...");
    const eventSource = new EventSource(`${API_BASE_URL}/api/spectator_stream`);

    eventSource.addEventListener('game_state_update', (e) => callbacks.onGameStateUpdate(JSON.parse(e.data)));
    eventSource.addEventListener('active_characters_update', (e) => callbacks.onActiveCharactersUpdate(JSON.parse(e.data)));
    eventSource.addEventListener('character_full_update', (e) => { const u = JSON.parse(e.data); callbacks.onCharacterFullUpdate(u.id, u.data); });
    eventSource.addEventListener('dice_roll', (e) => callbacks.onDiceRoll(JSON.parse(e.data).roll));
    eventSource.addEventListener('text_update', (e) => callbacks.onTextUpdate(JSON.parse(e.data)));
    eventSource.addEventListener('audio_update', (e) => callbacks.onAudioUpdate(JSON.parse(e.data)));

    eventSource.onerror = (err) => { console.error("SSE failed:", err); eventSource.close(); };
}

export async function fetchInitialData() {
    try {
        const [gameStateRes, activeCharsRes] = await Promise.all([
            fetch(`${API_BASE_URL}/api/game_state`),
            fetch(`${API_BASE_URL}/api/active_characters`)
        ]);
        const initialState = await gameStateRes.json();
        const initialCharacterIds = await activeCharsRes.json();
        return { initialState, initialCharacterIds };
    } catch (error) {
        console.error("Failed to fetch initial data:", error);
        return { initialState: null, initialCharacterIds: [] };
    }
}

export async function fetchCharacterData(charId) {
    const response = await fetch(`${API_BASE_URL}/api/all_characters`);
    const allChars = await response.json();
    return allChars[charId];
}
