const API_BASE_URL = 'http://127.0.0.1:8000';

/**
 * Отправляет действие персонажа на сервер для генерации ответа модели.
 * @param {string} characterKey - Ключ персонажа, который совершает действие.
 * @returns {Promise<object>} Ответ от сервера.
 */
export async function postAction(characterKey) {
    const response = await fetch(`${API_BASE_URL}/act`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ character_key: characterKey }),
    });
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to post action');
    }
    return await response.json();
}

/**
 * Отправляет действие от имени Game Master.
 * @param {string} text - Текст действия или реплики.
 * @returns {Promise<object>} Ответ от сервера.
 */
export async function postGmAction(text) {
    const response = await fetch(`${API_BASE_URL}/api/add_gm_action`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: text }),
    });
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to post GM action');
    }
    return await response.json();
}

/**
 * Обновляет список активных персонажей на сервере.
 * @param {object} data - Данные для отправки (например, { characters_id: [...] }).
 * @returns {Promise<object>} Ответ от сервера.
 */
export async function updateActiveCharacters(data) {
    const response = await fetch(`${API_BASE_URL}/api/update_active_characters`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
    });
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to update active characters');
    }
    return await response.json();
}

/**
 * Отправляет данные для анализа "Наблюдателем".
 * @param {string} action - Строка действия.
 * @param {number|null} diceRoll - Результат броска кубика d20 (или null).
 * @returns {Promise<object>} Ответ от сервера с анализом.
 */
export async function getObserverAnalysis(action, diceRoll) {
    const payload = { action, dice_roll: diceRoll };
    const response = await fetch(`${API_BASE_URL}/api/observer_analysis`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to get observer analysis');
    }
    return await response.json();
}

/**
 * Отправляет JSON Patch на сервер для обновления данных персонажей.
 * @param {object} patch - JSON Patch объект.
 * @returns {Promise<object>} Ответ от сервера.
 */
export async function applyJsonPatch(patch) {
    const response = await fetch(`${API_BASE_URL}/api/apply_json_patch`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ patch: patch }),
    });
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to apply JSON patch');
    }
    return await response.json();
}

/**
 * Запрашивает и возвращает данные всех персонажей.
 * @returns {Promise<object>} Данные всех персонажей.
 */
export async function fetchAllCharacters() {
    const response = await fetch(`${API_BASE_URL}/api/all_characters`);
    if (!response.ok) throw new Error('Failed to cache character data');
    return await response.json();
}

/**
 * Запрашивает и возвращает данные игровых персонажей (PCs).
 * @returns {Promise<object>} Данные PC.
 */
export async function fetchCharacters() {
    const response = await fetch(`${API_BASE_URL}/api/characters`);
    if (!response.ok) throw new Error('Failed to load characters');
    return await response.json();
}

/**
 * Запрашивает и возвращает данные неигровых персонажей (NPCs).
 * @returns {Promise<object>} Данные NPC.
 */
export async function fetchNpcs() {
    const response = await fetch(`${API_BASE_URL}/api/npcs`);
    if (!response.ok) throw new Error('Failed to load NPCs');
    return await response.json();
}

/**
 * Запрашивает и возвращает данные о локациях.
 * @returns {Promise<object>} Данные о локациях.
 */
export async function fetchLocations() {
    const response = await fetch(`${API_BASE_URL}/api/locations`);
    if (!response.ok) throw new Error('Failed to load locations');
    return await response.json();
}

/**
 * Запрашивает и возвращает историю событий. (Используется для первоначальной загрузки)
 * @returns {Promise<object>} История событий.
 */
export async function fetchEventLog() {
    const response = await fetch(`${API_BASE_URL}/api/event_log`);
    if (!response.ok) throw new Error('Failed to load event log');
    return await response.json();
}

/**
 * Подписывается на обновления журнала событий с сервера.
 * @param {function(object): void} onUpdate - Колбэк-функция, которая будет вызываться с новыми данными журнала.
 */
export function subscribeToEventLog(onUpdate) {
    const eventSource = new EventSource(`${API_BASE_URL}/api/event_stream`);

    eventSource.onmessage = function(event) {
        const eventData = JSON.parse(event.data);
        onUpdate(eventData);
    };

    eventSource.onerror = function(err) {
        console.error("EventSource failed:", err);
        // Можно добавить логику переподключения здесь
        eventSource.close();
    };

    // Возвращаем объект EventSource, чтобы можно было закрыть соединение при необходимости
    return eventSource;
}

/**
 * Подписывается на обновления данных персонажей с сервера.
 * @param {function(object): void} onUpdate - Колбэк-функция для обработки обновлений.
 */
export function subscribeToCharacterUpdates(onUpdate) {
    const eventSource = new EventSource(`${API_BASE_URL}/api/character_stream`);

    eventSource.onmessage = function(event) {
        const characterData = JSON.parse(event.data);
        onUpdate(characterData);
    };

    eventSource.onerror = function(err) {
        console.error("Character update EventSource failed:", err);
        eventSource.close();
    };

    return eventSource;
}

/**
 * Отправляет запрос на архивацию текущего события.
 * @returns {Promise<object>} Ответ от сервера.
 */
export async function archiveEvent() {
    const response = await fetch(`${API_BASE_URL}/archive_event`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
    });
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to archive event');
    }
    return await response.json();
}
