const API_BASE_URL = 'http://127.0.0.1:8000';

// ... (все функции fetch остаются без изменений)

export async function activateCharacter(characterId) {
    const response = await fetch(`${API_BASE_URL}/api/characters/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ character_id: characterId }),
    });
    if (!response.ok) throw new Error((await response.json()).detail || 'Failed to activate');
    return await response.json();
}

export async function deactivateCharacter(characterId) {
    const response = await fetch(`${API_BASE_URL}/api/characters/deactivate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ character_id: characterId }),
    });
    if (!response.ok) throw new Error((await response.json()).detail || 'Failed to deactivate');
    return await response.json();
}

export async function postAction(characterKey) {
    const response = await fetch(`${API_BASE_URL}/act`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ character_key: characterKey }),
    });
    if (!response.ok) throw new Error((await response.json()).detail || 'Failed to act');
    return await response.json();
}

export async function postGmAction(text) {
    const response = await fetch(`${API_BASE_URL}/api/add_gm_action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text }),
    });
    if (!response.ok) throw new Error((await response.json()).detail || 'Failed to post GM action');
    return await response.json();
}

export async function updateActiveCharacters(data) {
    const response = await fetch(`${API_BASE_URL}/api/update_active_characters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error((await response.json()).detail || 'Failed to update active characters');
    return await response.json();
}

export async function setLocation(locationId) {
    const response = await fetch(`${API_BASE_URL}/api/set_location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location_id: locationId }),
    });
    if (!response.ok) throw new Error((await response.json()).detail || 'Failed to set location');
    return await response.json();
}

export async function getObserverAnalysis(action, diceRoll, characterId) {
    const response = await fetch(`${API_BASE_URL}/api/observer_analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action, character_id: characterId, dice_roll: diceRoll }),
    });
    if (!response.ok) throw new Error((await response.json()).detail || 'Observer analysis failed');
    return await response.json();
}

export async function applyJsonPatch(patch) {
    const response = await fetch(`${API_BASE_URL}/api/apply_json_patch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch: patch }),
    });
    if (!response.ok) throw new Error((await response.json()).detail || 'Failed to apply patch');
    return await response.json();
}

export async function updateAvatarSize(size) {
    const response = await fetch(`${API_BASE_URL}/api/settings/avatar-size`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar_size: size }),
    });
    if (!response.ok) throw new Error((await response.json()).detail || 'Failed to update avatar size');
    return await response.json();
}

export async function fetchAllCharacters() {
    const response = await fetch(`${API_BASE_URL}/api/all_characters`);
    if (!response.ok) throw new Error('Failed to fetch all characters');
    return await response.json();
}

export async function fetchCharacters() {
    const response = await fetch(`${API_BASE_URL}/api/characters`);
    if (!response.ok) throw new Error('Failed to load characters');
    return await response.json();
}

export async function fetchNpcs() {
    const response = await fetch(`${API_BASE_URL}/api/npcs`);
    if (!response.ok) throw new Error('Failed to load NPCs');
    return await response.json();
}

export async function fetchLocations() {
    const response = await fetch(`${API_BASE_URL}/api/locations`);
    if (!response.ok) throw new Error('Failed to load locations');
    return await response.json();
}

export async function fetchEventLog() {
    const response = await fetch(`${API_BASE_URL}/api/event_log`);
    if (!response.ok) throw new Error('Failed to load event log');
    return await response.json();
}

export async function fetchMusicList() {
    const response = await fetch(`${API_BASE_URL}/api/music`);
    if (!response.ok) throw new Error('Failed to load music list');
    return await response.json();
}

export async function playMusic(trackId, volume) {
    const response = await fetch(`${API_BASE_URL}/api/music/play`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track_id: trackId, volume: volume }),
    });
    if (!response.ok) throw new Error((await response.json()).detail || 'Failed to play music');
    return await response.json();
}

export async function stopMusic() {
    const response = await fetch(`${API_BASE_URL}/api/music/stop`, { method: 'POST' });
    if (!response.ok) throw new Error((await response.json()).detail || 'Failed to stop music');
    return await response.json();
}

export async function setMusicVolume(volume) {
    const response = await fetch(`${API_BASE_URL}/api/music/volume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volume: volume }),
    });
    if (!response.ok) throw new Error((await response.json()).detail || 'Failed to set music volume');
    return await response.json();
}

export async function archiveEvent() {
    const response = await fetch(`${API_BASE_URL}/api/archive_event`, { method: 'POST' });
    if (!response.ok) throw new Error((await response.json()).detail || 'Failed to archive event');
    return await response.json();
}

export async function generatePlayerNotes() {
    const response = await fetch(`${API_BASE_URL}/api/generate_player_notes`, { method: 'POST' });
    if (!response.ok) throw new Error((await response.json()).detail || 'Failed to generate player notes');
    return await response.json();
}

export async function compressContext() {
    const response = await fetch(`${API_BASE_URL}/api/compress_context`, { method: 'POST' });
    if (!response.ok) throw new Error((await response.json()).detail || 'Failed to compress context');
    return await response.json();
}

export async function broadcastDiceRoll(roll) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/broadcast_dice_roll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roll: roll }),
        });
        if (!response.ok) {
            // Пытаемся получить осмысленное сообщение об ошибке от сервера
            const errorData = await response.json().catch(() => null); // .json() может упасть, если тело пустое
            const errorMessage = errorData ? errorData.detail : `HTTP error! status: ${response.status}`;
            console.error('Failed to broadcast dice roll:', errorMessage);
            throw new Error(errorMessage);
        }
        return await response.json();
    } catch (error) {
        console.error('Error in broadcastDiceRoll:', error);
        // Пробрасываем ошибку, чтобы вызывающий код мог отреагировать
        throw error;
    }
}

export async function triggerSpeechPlayback() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/trigger_speech_playback`, {
            method: 'POST',
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => null);
            const errorMessage = errorData ? errorData.detail : `HTTP error! status: ${response.status}`;
            console.error('Failed to trigger speech playback:', errorMessage);
            throw new Error(errorMessage);
        }
        return await response.json();
    } catch (error) {
        console.error('Error in triggerSpeechPlayback:', error);
        throw error;
    }
}


/**
 * Единая подписка на SSE для консоли GM.
 * Подписывается на общий поток и вызывает соответствующие коллбэки.
 * @param {function(object): void} onLogUpdate - Коллбэк для обновления лога событий.
 * @param {function(object): void} onCharUpdate - Коллбэк для обновления данных персонажа.
 */
export function subscribeToGmStream(onLogUpdate, onCharUpdate) {
    let eventSource = null;
    let retryTimer = null;
    let retryDelayMs = 1000;
    const maxRetryDelayMs = 30000;

    const connect = () => {
        console.log("Connecting to the unified GM stream...");
        eventSource = new EventSource(`${API_BASE_URL}/api/gm_stream`);

        eventSource.onopen = async () => {
            retryDelayMs = 1000;
            try {
                const log = await fetchEventLog();
                onLogUpdate(log);
                const allChars = await fetchAllCharacters();
                for (const [id, data] of Object.entries(allChars || {})) {
                    onCharUpdate({ id, data });
                }
            } catch (e) {
                console.error("Failed to restore GM state:", e);
            }
        };

        // Слушаем событие обновления лога событий
        eventSource.addEventListener('event_log_update', function(event) {
            const eventData = JSON.parse(event.data);
            onLogUpdate(eventData);
        });

        // Слушаем событие обновления данных персонажа
        eventSource.addEventListener('character_update', function(event) {
            const charData = JSON.parse(event.data);
            onCharUpdate(charData);
        });

        eventSource.onerror = function(err) {
            console.error("GM Stream EventSource failed:", err);
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
