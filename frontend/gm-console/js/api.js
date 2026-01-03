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
 * Отправляет действие персонажа на сервер.
 * @param {string} character_key - Ключ (ID) персонажа.
 * @returns {Promise<object>} Ответ сервера.
 */
export async function postAction(character_key) {
    const response = await fetch(`${API_BASE_URL}/act`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ character_key })
    });
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `Server error: ${response.status}`);
    }
    return await response.json();
}

/**
 * Отправляет действие Мастера Игры на сервер.
 * @param {string} text - Текст действия.
 * @returns {Promise<object>} Ответ сервера.
 */
export async function postGmAction(text) {
    const response = await fetch(`${API_BASE_URL}/api/add_gm_action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
    });
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `Server error: ${response.status}`);
    }
    return await response.json();
}
