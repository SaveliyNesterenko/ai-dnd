import { state } from '../state.js';
import { applyJsonPatch } from '../api.js';

/**
 * Creates and displays the status effects modal with edit controls.
 * @param {string} characterId - ID персонажа.
 * @param {Array} statusEffectsData - Массив статус-эффектов.
 */
export function showStatusEffectsModal(characterId, statusEffectsData) {
    const modalContainer = document.getElementById('modal-container');
    if (!modalContainer) {
        console.error('Modal container not found!');
        return;
    }

    modalContainer.innerHTML = '';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';

    const closeButton = document.createElement('button');
    closeButton.className = 'modal-close-btn';
    closeButton.innerHTML = '&times;';
    closeButton.onclick = () => {
        modalContainer.innerHTML = '';
    };

    const title = document.createElement('h2');
    title.textContent = 'Status Effects';

    const statusMessage = document.createElement('div');
    statusMessage.className = 'status-effects-status';

    const table = document.createElement('table');
    table.className = 'status-effects-table';

    const thead = document.createElement('thead');
    thead.innerHTML = `
        <tr>
            <th>Effect</th>
            <th>Actions</th>
        </tr>
    `;

    const tbody = document.createElement('tbody');

    const addRow = (effect = '') => {
        const row = document.createElement('tr');
        row.dataset.row = 'status-effect';

        const effectCell = document.createElement('td');
        const effectInput = document.createElement('input');
        effectInput.className = 'status-effects-input';
        effectInput.type = 'text';
        effectInput.value = effect || '';
        effectCell.appendChild(effectInput);

        const actionsCell = document.createElement('td');
        actionsCell.className = 'status-effects-row-actions';
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'status-effects-remove-btn';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => row.remove());
        actionsCell.appendChild(removeBtn);

        row.appendChild(effectCell);
        row.appendChild(actionsCell);
        tbody.appendChild(row);
    };

    if (Array.isArray(statusEffectsData) && statusEffectsData.length > 0) {
        statusEffectsData.forEach(effect => addRow(effect));
    } else {
        addRow();
    }

    table.appendChild(thead);
    table.appendChild(tbody);

    const actionsBar = document.createElement('div');
    actionsBar.className = 'status-effects-actions';

    const addEffectBtn = document.createElement('button');
    addEffectBtn.type = 'button';
    addEffectBtn.className = 'status-effects-add-btn';
    addEffectBtn.textContent = 'Add Effect';
    addEffectBtn.addEventListener('click', () => addRow());

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'status-effects-save-btn';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async () => {
        statusMessage.textContent = '';
        statusMessage.classList.remove('status-effects-status--error');

        const effects = [];
        tbody.querySelectorAll('tr[data-row="status-effect"]').forEach(row => {
            const value = row.querySelector('.status-effects-input')?.value.trim() || '';
            if (!value) return;
            effects.push(value);
        });

        try {
            await applyJsonPatch({ [characterId]: { stats: { status_effects: effects } } });
            if (state.allCharactersData[characterId]) {
                if (!state.allCharactersData[characterId].stats) {
                    state.allCharactersData[characterId].stats = {};
                }
                state.allCharactersData[characterId].stats.status_effects = effects;
            }
            statusMessage.textContent = 'Saved.';
        } catch (error) {
            statusMessage.textContent = `Save failed: ${error.message}`;
            statusMessage.classList.add('status-effects-status--error');
        }
    });

    actionsBar.appendChild(addEffectBtn);
    actionsBar.appendChild(saveBtn);

    modalContent.appendChild(closeButton);
    modalContent.appendChild(title);
    modalContent.appendChild(statusMessage);
    modalContent.appendChild(table);
    modalContent.appendChild(actionsBar);
    overlay.appendChild(modalContent);
    modalContainer.appendChild(overlay);

    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            modalContainer.innerHTML = '';
        }
    });
}
