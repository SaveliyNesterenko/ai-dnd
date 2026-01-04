import { state, addVisibleCharacter, removeVisibleCharacter, setSelectedCharacterCard } from '../state.js';
import { showInventoryModal } from './inventoryModal.js';

/**
 * Обновляет существующую карточку персонажа новыми данными.
 * @param {HTMLElement} cardElement - DOM-элемент карточки для обновления.
 * @param {object} charData - Новые данные персонажа.
 */
export function updateCharacterCard(cardElement, charData) {
    if (!cardElement || !charData) return;

    // Обновление имени и роли
    cardElement.querySelector('h3').textContent = charData.identity ? charData.identity.name : 'Unknown';
    cardElement.querySelector('.role').textContent = charData.meta ? charData.meta.role : 'No Role';

    // Обновление HP и MP
    if (charData.stats) {
        const hp = charData.stats.hp ? `${charData.stats.hp.current} / ${charData.stats.hp.max}` : 'N/A';
        const mp = charData.stats.mp ? `${charData.stats.mp.current} / ${charData.stats.mp.max}` : 'N/A';
        cardElement.querySelector('.stats-grid').innerHTML = `
            <div class="stat-item"><span>HP</span><span>${hp}</span></div>
            <div class="stat-item"><span>MP</span><span>${mp}</span></div>
        `;
    }

    // Обновление атрибутов на обратной стороне
    let attributesHtml = '<div class="attributes-grid">';
    if (charData.stats && charData.stats.attributes) {
        for (const attr in charData.stats.attributes) {
            attributesHtml += `<div class="attribute-item"><span>${attr}</span><span>${charData.stats.attributes[attr]}</span></div>`;
        }
    }
    attributesHtml += '</div>';
    const attributesContent = cardElement.querySelector('.attributes-content');
    if (attributesContent) {
        attributesContent.innerHTML = attributesHtml;
    }

    // Обновление эффектов статуса на обратной стороне
    let statusEffectsHtml = '<div class="status-effects-list">';
    if (charData.stats && charData.stats.status_effects && charData.stats.status_effects.length > 0) {
        charData.stats.status_effects.forEach(effect => {
            statusEffectsHtml += `<div class="status-effect-item">${effect}</div>`;
        });
    } else {
        statusEffectsHtml += '<p>No active effects</p>';
    }
    statusEffectsHtml += '</div>';
    const statusEffectsContent = cardElement.querySelector('.status-effects-content');
    if (statusEffectsContent) {
        statusEffectsContent.innerHTML = statusEffectsHtml;
    }
}


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

        // HTML для Атрибутов
        let attributesHtml = '<div class="attributes-content hidden"><div class="attributes-grid">';
        if (charData.stats && charData.stats.attributes) {
            for (const attr in charData.stats.attributes) {
                attributesHtml += `<div class="attribute-item"><span>${attr}</span><span>${charData.stats.attributes[attr]}</span></div>`;
            }
        }
        attributesHtml += '</div></div>';

        // HTML для Эффектов
        let statusEffectsHtml = '<div class="status-effects-content hidden"><div class="status-effects-list">';
        if (charData.stats && charData.stats.status_effects && charData.stats.status_effects.length > 0) {
            charData.stats.status_effects.forEach(effect => {
                statusEffectsHtml += `<div class="status-effect-item">${effect}</div>`;
            });
        } else {
            statusEffectsHtml += '<p>No active effects</p>';
        }
        statusEffectsHtml += '</div></div>';

        card.innerHTML = `
            <div class="card-inner">
                <div class="card-front">
                    <div class="card-content">
                        <h3>${name}</h3>
                        <p class="role">${role}</p>
                        <div class="stats-grid">
                            ${statsHtml}
                        </div>
                        <div class="card-buttons">
                            <button class="card-btn attributes-btn" title="Attributes">&#9733;</button>
                            <button class="card-btn status-effects-btn" title="Status Effects">&#9881;</button>
                            <button class="card-btn inventory-btn" title="Inventory">&#127890;</button>
                        </div>
                    </div>
                </div>
                <div class="card-back">
                    <h3 class="card-back-title"></h3>
                    ${attributesHtml}
                    ${statusEffectsHtml}
                </div>
            </div>
        `;
        
        container.appendChild(card);
        addVisibleCharacter(characterId);

        // Получаем элементы для управления контентом на обратной стороне
        const attributesButton = card.querySelector('.attributes-btn');
        const statusEffectsButton = card.querySelector('.status-effects-btn');
        const inventoryButton = card.querySelector('.inventory-btn');
        const cardBack = card.querySelector('.card-back');
        const cardBackTitle = card.querySelector('.card-back-title');
        const attributesContent = card.querySelector('.attributes-content');
        const statusEffectsContent = card.querySelector('.status-effects-content');

        // Клик на "Attributes"
        attributesButton.addEventListener('click', (event) => {
            event.stopPropagation();
            cardBackTitle.textContent = 'Attributes';
            attributesContent.classList.remove('hidden');
            statusEffectsContent.classList.add('hidden');
            card.classList.add('flipped');
        });

        // Клик на "Status Effects"
        statusEffectsButton.addEventListener('click', (event) => {
            event.stopPropagation();
            cardBackTitle.textContent = 'Status Effects';
            statusEffectsContent.classList.remove('hidden');
            attributesContent.classList.add('hidden');
            card.classList.add('flipped');
        });

        // Клик на "Inventory"
        inventoryButton.addEventListener('click', (event) => {
            event.stopPropagation();
            const inventoryData = charData.inventory || [];
            showInventoryModal(inventoryData);
        });

        // Клик на обратной стороне для возврата
        cardBack.addEventListener('click', (event) => {
            event.stopPropagation();
            card.classList.remove('flipped');
        });
    }
}
