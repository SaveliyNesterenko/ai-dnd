import { state, addVisibleCharacter, removeVisibleCharacter, setSelectedCharacterCard } from '../state.js';
import { applyJsonPatch } from '../api.js';
import { showInventoryModal } from './inventoryModal.js';

const getSafeNumber = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const getStatsDisplay = (stats, key) => {
    if (!stats || !stats[key]) return 'N/A';
    const current = stats[key].current ?? 0;
    const max = stats[key].max ?? 0;
    return `${current} / ${max}`;
};

const deepMerge = (target, source) => {
    for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) && target[key]) {
            deepMerge(target[key], source[key]);
        } else {
            target[key] = source[key];
        }
    }
    return target;
};

const renderStatsGrid = (charData) => {
    const stats = charData?.stats || {};
    const hp = getStatsDisplay(stats, 'hp');
    const mp = getStatsDisplay(stats, 'mp');
    return `
        <div class="stat-item"><span>HP</span><span>${hp}</span></div>
        <div class="stat-item"><span>MP</span><span>${mp}</span></div>
    `;
};

const renderAttributes = (charData) => {
    let attributesHtml = '<div class="attributes-grid">';
    if (charData?.stats?.attributes) {
        for (const attr in charData.stats.attributes) {
            attributesHtml += `<div class="attribute-item"><span>${attr}</span><span>${charData.stats.attributes[attr]}</span></div>`;
        }
    }
    attributesHtml += '</div>';
    return attributesHtml;
};

const renderStatusEffects = (charData) => {
    const effects = charData?.stats?.status_effects || [];
    let listHtml = '<div class="status-effects-list">';
    if (effects.length > 0) {
        effects.forEach((effect, index) => {
            listHtml += `
                <div class="status-effect-item">
                    <span class="status-effect-text">${effect}</span>
                    <button class="status-effect-remove-btn" data-index="${index}" type="button">x</button>
                </div>
            `;
        });
    } else {
        listHtml += '<p>No active effects</p>';
    }
    listHtml += '</div>';

    const editorHtml = `
        <div class="status-effects-edit">
            <input class="status-effect-input" type="text" placeholder="Add effect" />
            <button class="status-effect-add-btn" type="button">Add</button>
        </div>
    `;

    return `${listHtml}${editorHtml}`;
};

const setStatsEditValues = (cardElement, charData) => {
    const stats = charData?.stats || {};
    const hpCurrent = stats.hp?.current ?? 0;
    const hpMax = stats.hp?.max ?? 0;
    const mpCurrent = stats.mp?.current ?? 0;
    const mpMax = stats.mp?.max ?? 0;

    const hpCurrentInput = cardElement.querySelector('.stats-edit .hp-current');
    const hpMaxInput = cardElement.querySelector('.stats-edit .hp-max');
    const mpCurrentInput = cardElement.querySelector('.stats-edit .mp-current');
    const mpMaxInput = cardElement.querySelector('.stats-edit .mp-max');

    if (hpCurrentInput) hpCurrentInput.value = hpCurrent;
    if (hpMaxInput) hpMaxInput.value = hpMax;
    if (mpCurrentInput) mpCurrentInput.value = mpCurrent;
    if (mpMaxInput) mpMaxInput.value = mpMax;
};

const setStatsEditMode = (cardElement, enabled) => {
    const statsGrid = cardElement.querySelector('.stats-grid');
    const statsEdit = cardElement.querySelector('.stats-edit');
    if (!statsGrid || !statsEdit) return;
    if (enabled) {
        statsGrid.classList.add('hidden');
        statsEdit.classList.remove('hidden');
    } else {
        statsEdit.classList.add('hidden');
        statsGrid.classList.remove('hidden');
    }
};

const applyCharacterPatch = async (charId, patch) => {
    await applyJsonPatch({ [charId]: patch });
    if (state.allCharactersData[charId]) {
        deepMerge(state.allCharactersData[charId], patch);
    }
};

export function updateCharacterCard(cardElement, charData) {
    if (!cardElement || !charData) return;

    cardElement.querySelector('h3').textContent = charData.identity ? charData.identity.name : 'Unknown';
    cardElement.querySelector('.role').textContent = charData.meta ? charData.meta.role : 'No Role';

    const statsGrid = cardElement.querySelector('.stats-grid');
    if (statsGrid) {
        statsGrid.innerHTML = renderStatsGrid(charData);
    }

    const statsEdit = cardElement.querySelector('.stats-edit');
    const isEditing = statsEdit && !statsEdit.classList.contains('hidden');
    if (!isEditing) {
        setStatsEditValues(cardElement, charData);
    }

    const attributesContent = cardElement.querySelector('.attributes-content');
    if (attributesContent) {
        attributesContent.innerHTML = renderAttributes(charData);
    }

    const statusEffectsContent = cardElement.querySelector('.status-effects-content');
    if (statusEffectsContent) {
        statusEffectsContent.innerHTML = renderStatusEffects(charData);
    }
}

export function selectCharacter(cardElement) {
    setSelectedCharacterCard(cardElement);

    const charKeyInput = document.getElementById('charKey');
    if (charKeyInput) {
        charKeyInput.value = cardElement ? cardElement.dataset.charKey : '';
    }
}

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
                selectCharacter(null);
            }
            container.removeChild(cardToRemove);
        }
        removeVisibleCharacter(characterId);
        return;
    }

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

    const statsHtml = renderStatsGrid(charData);
    const attributesHtml = `<div class="attributes-content hidden">${renderAttributes(charData)}</div>`;
    const statusEffectsHtml = `<div class="status-effects-content hidden">${renderStatusEffects(charData)}</div>`;

    card.innerHTML = `
        <div class="card-inner">
            <div class="card-front">
                <div class="card-content">
                    <h3>${name}</h3>
                    <p class="role">${role}</p>
                    <div class="stats-grid">
                        ${statsHtml}
                    </div>
                    <div class="stats-edit hidden">
                        <div class="stat-edit-row">
                            <span>HP</span>
                            <input class="hp-current" type="number" min="0" />
                            <span class="stat-edit-divider">/</span>
                            <input class="hp-max" type="number" min="0" />
                        </div>
                        <div class="stat-edit-row">
                            <span>MP</span>
                            <input class="mp-current" type="number" min="0" />
                            <span class="stat-edit-divider">/</span>
                            <input class="mp-max" type="number" min="0" />
                        </div>
                        <div class="stat-edit-actions">
                            <button class="stats-save-btn" type="button">Save</button>
                            <button class="stats-cancel-btn" type="button">Cancel</button>
                        </div>
                    </div>
                    <div class="card-buttons">
                        <button class="card-btn stats-edit-btn" title="Edit HP/MP">E</button>
                        <button class="card-btn attributes-btn" title="Attributes">*</button>
                        <button class="card-btn status-effects-btn" title="Status Effects">S</button>
                        <button class="card-btn inventory-btn" title="Inventory">I</button>
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
    setStatsEditValues(card, charData);

    const attributesButton = card.querySelector('.attributes-btn');
    const statusEffectsButton = card.querySelector('.status-effects-btn');
    const inventoryButton = card.querySelector('.inventory-btn');
    const cardBack = card.querySelector('.card-back');
    const cardBackTitle = card.querySelector('.card-back-title');
    const attributesContent = card.querySelector('.attributes-content');
    const statusEffectsContent = card.querySelector('.status-effects-content');

    attributesButton.addEventListener('click', (event) => {
        event.stopPropagation();
        cardBackTitle.textContent = 'Attributes';
        attributesContent.classList.remove('hidden');
        statusEffectsContent.classList.add('hidden');
        card.classList.add('flipped');
    });

    statusEffectsButton.addEventListener('click', (event) => {
        event.stopPropagation();
        cardBackTitle.textContent = 'Status Effects';
        statusEffectsContent.classList.remove('hidden');
        attributesContent.classList.add('hidden');
        card.classList.add('flipped');
    });

    inventoryButton.addEventListener('click', (event) => {
        event.stopPropagation();
        const inventoryData = charData.inventory || [];
        showInventoryModal(characterId, inventoryData);
    });

    cardBack.addEventListener('click', (event) => {
        const isControlClick = event.target.closest('.status-effects-content')
            && (event.target.tagName === 'BUTTON' || event.target.tagName === 'INPUT');
        if (isControlClick) return;
        event.stopPropagation();
        card.classList.remove('flipped');
    });

    card.addEventListener('click', async (event) => {
        const editBtn = event.target.closest('.stats-edit-btn');
        if (editBtn) {
            event.stopPropagation();
            setStatsEditValues(card, state.allCharactersData[characterId]);
            setStatsEditMode(card, true);
            return;
        }

        const saveBtn = event.target.closest('.stats-save-btn');
        if (saveBtn) {
            event.stopPropagation();
            const hpCurrent = getSafeNumber(card.querySelector('.hp-current')?.value, 0);
            const hpMax = getSafeNumber(card.querySelector('.hp-max')?.value, 0);
            const mpCurrent = getSafeNumber(card.querySelector('.mp-current')?.value, 0);
            const mpMax = getSafeNumber(card.querySelector('.mp-max')?.value, 0);

            if (hpCurrent > hpMax || mpCurrent > mpMax) {
                alert('Max must be >= current.');
                return;
            }

            try {
                await applyCharacterPatch(characterId, {
                    stats: {
                        hp: { current: hpCurrent, max: hpMax },
                        mp: { current: mpCurrent, max: mpMax }
                    }
                });
                updateCharacterCard(card, state.allCharactersData[characterId]);
                setStatsEditMode(card, false);
            } catch (error) {
                alert(`Failed to save stats: ${error.message}`);
            }
            return;
        }

        const cancelBtn = event.target.closest('.stats-cancel-btn');
        if (cancelBtn) {
            event.stopPropagation();
            setStatsEditMode(card, false);
            return;
        }

        const addEffectBtn = event.target.closest('.status-effect-add-btn');
        if (addEffectBtn) {
            event.stopPropagation();
            const input = card.querySelector('.status-effect-input');
            const value = input?.value.trim();
            if (!value) return;
            const current = state.allCharactersData[characterId]?.stats?.status_effects || [];
            const updated = [...current, value];
            try {
                await applyCharacterPatch(characterId, { stats: { status_effects: updated } });
                if (input) input.value = '';
                updateCharacterCard(card, state.allCharactersData[characterId]);
            } catch (error) {
                alert(`Failed to add effect: ${error.message}`);
            }
            return;
        }

        const removeEffectBtn = event.target.closest('.status-effect-remove-btn');
        if (removeEffectBtn) {
            event.stopPropagation();
            const index = Number.parseInt(removeEffectBtn.dataset.index, 10);
            if (!Number.isFinite(index)) return;
            const current = state.allCharactersData[characterId]?.stats?.status_effects || [];
            const updated = current.filter((_, idx) => idx !== index);
            try {
                await applyCharacterPatch(characterId, { stats: { status_effects: updated } });
                updateCharacterCard(card, state.allCharactersData[characterId]);
            } catch (error) {
                alert(`Failed to remove effect: ${error.message}`);
            }
        }
    });
}
