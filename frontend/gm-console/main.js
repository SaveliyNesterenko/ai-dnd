import { cacheAllCharacters } from './js/state.js';
import * as api from './js/api.js';
import * as panels from './js/ui/panels.js';
import './js/ui/inventoryModal.js'; // Просто импортируем, чтобы код был доступен

const ROLE_COLORS = {
    player: 'green',
    gm: 'blue',
    npc: 'yellow',
    enemy: 'red'
};

async function updateEventLog() {
    const eventLogPanel = document.getElementById('event-log-panel');
    if (!eventLogPanel) return;

    try {
        const eventLogData = await api.fetchEventLog();
        const history = eventLogData.history || [];

        // Очищаем старые логи
        eventLogPanel.innerHTML = '<h2>Event Log</h2>';

        // Отображаем новые логи
        history.forEach(event => {
            const logEntry = document.createElement('div');
            logEntry.className = 'log-entry';

            const characterName = document.createElement('span');
            characterName.className = 'character-name';
            characterName.textContent = `${event.name}: `;
            characterName.style.color = ROLE_COLORS[event.role] || 'white';

            const thoughts = document.createElement('p');
            thoughts.className = 'thoughts';
            thoughts.textContent = event.thoughts ? `Мысли: ${event.thoughts}` : '';

            const action = document.createElement('p');
            action.className = 'action';
            action.textContent = `Действие: ${event.action}`;

            logEntry.appendChild(characterName);
            logEntry.appendChild(thoughts);
            logEntry.appendChild(action);

            eventLogPanel.appendChild(logEntry);
        });
    } catch (error) {
        console.error('Failed to update event log:', error);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const panelConfigs = {
        "top-panel": "panels/top-panel.html",
        "left-panel": "panels/left-panel.html",
        "center-panel": "panels/center-panel.html",
        "right-panel": "panels/right-panel.html",
        "bottom-panel": "panels/bottom-panel.html"
    };

    /**
     * Загружает HTML-содержимое для указанной панели и вставляет его в DOM.
     * После загрузки вызывает соответствующую функцию инициализации для этой панели.
     * @param {string} panelId - ID HTML-элемента панели.
     * @param {string} url - URL HTML-файла панели.
     */
    function loadPanel(panelId, url) {
        fetch(url)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                return response.text();
            })
            .then(html => {
                const panelElement = document.getElementById(panelId);
                if (!panelElement) return;
                panelElement.innerHTML = html;

                // Вызов инициализаторов в зависимости от панели
                if (panelId === "center-panel") panels.initializeCenterPanel();
                if (panelId === "top-panel") panels.initializeTopPanel();
                if (panelId === "bottom-panel") panels.initializeBottomPanel();
                if (panelId === "left-panel") panels.initializeLeftPanel();
            })
            .catch(err => console.warn(`Could not load panel ${panelId}:`, err));
    }

    /**
     * Главная функция приложения.
     * Кэширует все данные персонажей, а затем загружает все UI-панели.
     */
    async function main() {
        try {
            // Сначала кэшируем все данные, необходимые для создания карточек
            const allChars = await api.fetchAllCharacters();
            cacheAllCharacters(allChars);
            console.log("Character data cached.");
            
            // Затем загружаем все панели пользовательского интерфейса
            Object.entries(panelConfigs).forEach(([id, url]) => loadPanel(id, url));

            // Обновляем лог в первый раз
            updateEventLog();

            // Устанавливаем интервал для автоматического обновления лога
            setInterval(updateEventLog, 3000);

        } catch (error) {
            console.error("Failed to initialize the application:", error);
        }
    }

    main();
});
