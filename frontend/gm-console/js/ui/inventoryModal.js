/**
 * Создает и отображает модальное окно с инвентарем персонажа.
 * @param {Array} inventoryData - Массив объектов, представляющих предметы в инвентаре.
 */
export function showInventoryModal(inventoryData) {
    // Находим контейнер для модального окна
    const modalContainer = document.getElementById('modal-container');
    if (!modalContainer) {
        console.error('Modal container not found!');
        return;
    }

    // Создаем оверлей
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    // Создаем контент модального окна
    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';

    // Создаем кнопку закрытия
    const closeButton = document.createElement('button');
    closeButton.className = 'modal-close-btn';
    closeButton.innerHTML = '&times;';
    closeButton.onclick = () => {
        modalContainer.innerHTML = ''; // Удаляем модальное окно
    };

    // Создаем заголовок и таблицу
    const title = document.createElement('h2');
    title.textContent = 'Inventory';

    const table = document.createElement('table');
    table.className = 'inventory-table';

    // Создаем заголовок таблицы
    const thead = document.createElement('thead');
    thead.innerHTML = `
        <tr>
            <th>Name</th>
            <th>Quantity</th>
            <th>Description</th>
        </tr>
    `;

    // Наполняем таблицу данными
    const tbody = document.createElement('tbody');
    if (inventoryData && inventoryData.length > 0) {
        inventoryData.forEach(item => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${item.name}</td>
                <td>${item.quantity}</td>
                <td>${item.description}</td>
            `;
            tbody.appendChild(row);
        });
    } else {
        const row = document.createElement('tr');
        row.innerHTML = '<td colspan="3" style="text-align: center;">Inventory is empty.</td>';
        tbody.appendChild(row);
    }

    table.appendChild(thead);
    table.appendChild(tbody);

    // Собираем все вместе
    modalContent.appendChild(closeButton);
    modalContent.appendChild(title);
    modalContent.appendChild(table);
    overlay.appendChild(modalContent);
    modalContainer.appendChild(overlay);

    // Закрытие по клику на оверлей
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            modalContainer.innerHTML = '';
        }
    });
}
