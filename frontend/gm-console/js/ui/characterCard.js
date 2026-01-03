import { state, addVisibleCharacter, removeVisibleCharacter, setSelectedCharacterCard } from '../state.js';

/**
 * Устанавливает персонажа как "выбранного".
 * Обновляет класс 'active' на карточке и вносит ID в соответствующее поле ввода.
 * @param {HTMLElement | null} cardElement - DOM-элемент карточки персонажа или null для сброса выбора.
 */
export function selectCharacter(cardElement) {
    setSelectedCharacterCard(cardElement);

    const charKeyInput = document.getElementById('charKey');
    if (charKeyInput) {
        charKeyInput.value = cardElement ? cardElement.dataset.charKey : '';
    }
}

/**
 * Переключает видимость карточки персонажа на нижней панели.
 * Если карточка видима - скрывает. Если скрыта - создает и показывает.
 * @param {string} characterId - ID персонажа для переключения.
 */
export function toggleCharacterCard(characterId) {
    const container = document.querySelector('#bottom-panel .characters-container');
    if (!container || !characterId) return;

    const selectElements = [document.getElementById('character-select'), document.getElementById('npc-select')];
    selectElements.forEach(select => {
        if (select) select.selectedIndex = 0;
    });

    if (state.visibleCharacterIds.has(characterId)) {
        const cardToRemove = container.querySelector(`[data-char-key="${characterId}"]`);
        if (cardToRemove) {
            if (state.selectedCharacterCard === cardToRemove) {
                selectCharacter(null); // Сбрасываем выбор, если карточка была выбрана
            }
            container.removeChild(cardToRemove);
        }
        removeVisibleCharacter(characterId);
    } else {
        const charData = state.allCharactersData[characterId];
        if (!charData) return;

        const card = document.createElement('div');
        card.className = 'character-card';
        card.dataset.charKey = characterId;

        if (charData.meta && charData.meta.sprite_id) {
            card.style.backgroundImage = `url(../../assets/characters/${charData.meta.sprite_id}.png)`;
        }

        const name = charData.identity ? charData.identity.name : 'Unknown';
        const role = charData.meta ? charData.meta.role : 'No Role';
        
        let statsHtml = '';
        if (charData.stats) {
            const hp = charData.stats.hp ? `${charData.stats.hp.current} / ${charData.stats.hp.max}` : 'N/A';
            const mp = charData.stats.mp ? `${charData.stats.mp.current} / ${charData.stats.mp.max}` : 'N/A';
            statsHtml = `
                <div class="stat-item"><span>HP</span><span>${hp}</span></div>
                <div class="stat-item"><span>MP</span><span>${mp}</span></div>
            `;
        }

        card.innerHTML = `
            <div class="card-content">
                <h3>${name}</h3>
                <p class="role">${role}</p>
                <div class="stats-grid">
                    ${statsHtml}
                </div>
                <div class="card-buttons">
                    <button class="card-btn" title="Attributes">&#9733;</button>
                    <button class="card-btn" title="Status Effects">&#9881;</button>
                    <button class="card-btn" title="Inventory">&#127890;</button>
                </div>
            </div>
        `;
        
        container.appendChild(card);
        addVisibleCharacter(characterId);
    }
}
