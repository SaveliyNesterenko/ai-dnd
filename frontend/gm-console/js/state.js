/**
 * Глобальное состояние приложения.
 * @property {object} allCharactersData - Кэш данных всех персонажей (PC и NPC).
 * @property {Set<string>} visibleCharacterIds - ID персонажей, карточки которых видимы в данный момент.
 * @property {HTMLElement|null} selectedCharacterCard - DOM-элемент выбранной карточки персонажа.
 */
export const state = {
    allCharactersData: {},
    visibleCharacterIds: new Set(),
    selectedCharacterCard: null,
};

/**
 * Кэширует данные всех персонажей.
 * @param {object} data - Объект с данными персонажей.
 */
export function cacheAllCharacters(data) {
    state.allCharactersData = data;
}

/**
 * Добавляет ID персонажа в набор видимых.
 * @param {string} id - ID персонажа.
 */
export function addVisibleCharacter(id) {
    state.visibleCharacterIds.add(id);
}

/**
 * Удаляет ID персонажа из набора видимых.
 * @param {string} id - ID персонажа.
 */
export function removeVisibleCharacter(id) {
    state.visibleCharacterIds.delete(id);
}

/**
 * Устанавливает выбранную карточку персонажа.
 * Снимает выделение с предыдущей карточки и выделяет новую.
 * @param {HTMLElement} cardElement - DOM-элемент карточки персонажа.
 */
export function setSelectedCharacterCard(cardElement) {
    if (state.selectedCharacterCard) {
        state.selectedCharacterCard.classList.remove('active');
    }
    state.selectedCharacterCard = cardElement;
    if (state.selectedCharacterCard) {
        state.selectedCharacterCard.classList.add('active');
    }
}
