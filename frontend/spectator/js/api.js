export const API_BASE_URL = 'http://127.0.0.1:8000';

export function subscribeToSpectatorStream(callbacks) {
    let eventSource = null;
    let retryTimer = null;
    let retryDelayMs = 1000;
    const maxRetryDelayMs = 30000;

    const connect = () => {
        console.log("Connecting to the unified spectator stream...");
        eventSource = new EventSource(`${API_BASE_URL}/api/spectator_stream`);

        eventSource.onopen = async () => {
            retryDelayMs = 1000;
            try {
                const { initialState, initialCharacterIds } = await fetchInitialData();
                if (initialState) callbacks.onGameStateUpdate(initialState);
                if (initialCharacterIds) {
                    callbacks.onActiveCharactersUpdate(initialCharacterIds);
                    for (const charId of initialCharacterIds) {
                        const charData = await fetchCharacterData(charId);
                        if (charData) callbacks.onCharacterFullUpdate(charId, charData);
                    }
                }
            } catch (e) {
                console.error("Failed to restore spectator state:", e);
            }
        };

        // Стандартные обработчики состояния
        eventSource.addEventListener('game_state_update', (e) => callbacks.onGameStateUpdate(JSON.parse(e.data)));
        eventSource.addEventListener('active_characters_update', (e) => callbacks.onActiveCharactersUpdate(JSON.parse(e.data)));
        eventSource.addEventListener('character_full_update', (e) => { const u = JSON.parse(e.data); callbacks.onCharacterFullUpdate(u.id, u.data); });
        eventSource.addEventListener('dice_roll', (e) => callbacks.onDiceRoll(JSON.parse(e.data).roll));

        // Обработчик событий реплик
        eventSource.addEventListener('speech', (e) => callbacks.onSpeech(JSON.parse(e.data)));
        eventSource.addEventListener('speech_playback_trigger', (e) => callbacks.onSpeechPlaybackTrigger(JSON.parse(e.data)));

        eventSource.onerror = (err) => {
            console.error("SSE connection failed:", err);
            try { eventSource.close(); } catch (e) {}
            if (retryTimer) return;
            const delay = retryDelayMs;
            retryDelayMs = Math.min(retryDelayMs * 2, maxRetryDelayMs);
            retryTimer = setTimeout(() => {
                retryTimer = null;
                connect();
            }, delay);
        };
    };

    connect();

    return {
        close: () => {
            if (retryTimer) {
                clearTimeout(retryTimer);
                retryTimer = null;
            }
            if (eventSource) {
                try { eventSource.close(); } catch (e) {}
            }
        }
    };
}

export async function fetchInitialData() {
    try {
        const [gameStateRes, activeCharsRes] = await Promise.all([
            fetch(`${API_BASE_URL}/api/game_state`),
            fetch(`${API_BASE_URL}/api/active_characters`)
        ]);
        if (!gameStateRes.ok || !activeCharsRes.ok) {
            throw new Error(`HTTP error! status: ${gameStateRes.status} or ${activeCharsRes.status}`);
        }
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
    if (!response.ok) {
        console.error(`Failed to fetch all characters: ${response.status}`);
        return null;
    }
    const allChars = await response.json();
    return allChars[charId];
}
