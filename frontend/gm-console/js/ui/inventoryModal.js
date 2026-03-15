import { state } from '../state.js';
import { applyJsonPatch } from '../api.js';

/**
 * Creates and displays the inventory modal with edit controls.
 * @param {string} characterId - ID персонажа.
 * @param {Array} inventoryData - Массив предметов инвентаря.
 */
export function showInventoryModal(characterId, inventoryData) {
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
    title.textContent = 'Inventory';

    const statusMessage = document.createElement('div');
    statusMessage.className = 'inventory-status';

    const table = document.createElement('table');
    table.className = 'inventory-table';

    const thead = document.createElement('thead');
    thead.innerHTML = `
        <tr>
            <th>Name</th>
            <th>Quantity</th>
            <th>Description</th>
            <th>Actions</th>
        </tr>
    `;

    const tbody = document.createElement('tbody');

    const addRow = (item = { name: '', quantity: 1, description: '' }) => {
        const row = document.createElement('tr');
        row.dataset.row = 'inventory';

        const nameCell = document.createElement('td');
        const nameInput = document.createElement('input');
        nameInput.className = 'inventory-input inventory-name';
        nameInput.type = 'text';
        nameInput.value = item.name || '';
        nameCell.appendChild(nameInput);

        const qtyCell = document.createElement('td');
        const qtyInput = document.createElement('input');
        qtyInput.className = 'inventory-input inventory-qty';
        qtyInput.type = 'number';
        qtyInput.min = '0';
        qtyInput.value = Number.isFinite(item.quantity) ? item.quantity : 1;
        qtyCell.appendChild(qtyInput);

        const descCell = document.createElement('td');
        const descInput = document.createElement('input');
        descInput.className = 'inventory-input inventory-desc';
        descInput.type = 'text';
        descInput.value = item.description || '';
        descInput.title = item.description || '';
        descInput.addEventListener('input', () => {
            descInput.title = descInput.value;
        });
        descCell.appendChild(descInput);

        const actionsCell = document.createElement('td');
        actionsCell.className = 'inventory-row-actions';
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'inventory-remove-btn';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => row.remove());
        actionsCell.appendChild(removeBtn);

        row.appendChild(nameCell);
        row.appendChild(qtyCell);
        row.appendChild(descCell);
        row.appendChild(actionsCell);
        tbody.appendChild(row);
    };

    if (Array.isArray(inventoryData) && inventoryData.length > 0) {
        inventoryData.forEach(item => addRow(item));
    } else {
        addRow();
    }

    table.appendChild(thead);
    table.appendChild(tbody);

    const actionsBar = document.createElement('div');
    actionsBar.className = 'inventory-actions';

    const addItemBtn = document.createElement('button');
    addItemBtn.type = 'button';
    addItemBtn.className = 'inventory-add-btn';
    addItemBtn.textContent = 'Add Item';
    addItemBtn.addEventListener('click', () => addRow());

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'inventory-save-btn';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async () => {
        statusMessage.textContent = '';
        statusMessage.classList.remove('inventory-status--error');

        const items = [];
        tbody.querySelectorAll('tr[data-row="inventory"]').forEach(row => {
            const name = row.querySelector('.inventory-name')?.value.trim() || '';
            const qtyRaw = row.querySelector('.inventory-qty')?.value;
            const qty = parseInt(qtyRaw, 10);
            const desc = row.querySelector('.inventory-desc')?.value.trim() || '';
            if (!name) return;
            items.push({
                name,
                quantity: Number.isFinite(qty) && qty >= 0 ? qty : 1,
                description: desc
            });
        });

        try {
            await applyJsonPatch({ [characterId]: { inventory: items } });
            if (state.allCharactersData[characterId]) {
                state.allCharactersData[characterId].inventory = items;
            }
            statusMessage.textContent = 'Saved.';
        } catch (error) {
            statusMessage.textContent = `Save failed: ${error.message}`;
            statusMessage.classList.add('inventory-status--error');
        }
    });

    actionsBar.appendChild(addItemBtn);
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
