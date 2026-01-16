import { updateAvatarSize } from './api.js';

/**
 * Глобальное состояние приложения.
 * @property {object} allCharactersData - Кэш данных всех персонажей (PC и NPC).
 * @property {Set<string>} visibleCharacterIds - ID персонажей, карточки которых видимы в данный момент.
 * @property {HTMLElement|null} selectedCharacterCard - DOM-элемент выбранной карточки персонажа.
 * @property {string|null} lastAction - Последнее действие, отправленное на анализ "Наблюдателю".
 * @property {number|null} lastDiceRoll - Последний бросок кубика, отправленный на анализ "Наблюдателю".
 */
export const state = {
    allCharactersData: {},
    visibleCharacterIds: new Set(),
    selectedCharacterCard: null,
    lastAction: null,
    lastDiceRoll: null,
};

document.addEventListener('DOMContentLoaded', () => {
    const avatarSizeSlider = document.getElementById('avatar-size-slider');
    const avatarSizeValue = document.getElementById('avatar-size-value');

    if (avatarSizeSlider && avatarSizeValue) {
        avatarSizeSlider.addEventListener('input', () => {
            const size = avatarSizeSlider.value;
            avatarSizeValue.textContent = `${size}px`;
        });

        avatarSizeSlider.addEventListener('change', () => {
            const size = avatarSizeSlider.value;
            updateAvatarSize(size).catch(error => console.error('Failed to update avatar size:', error));
        });
    }
});

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

/**
 * Сохраняет последние данные, отправленные "Наблюдателю".
 * @param {string} action - Действие.
 * @param {number|null} diceRoll - Бросок кубика.
 */
export function setLastObserverRequest(action, diceRoll) {
    state.lastAction = action;
    state.lastDiceRoll = diceRoll;
}
