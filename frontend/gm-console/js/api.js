const API_BASE_URL = 'http://127.0.0.1:8000';

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
