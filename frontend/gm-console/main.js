import { state, cacheAllCharacters } from './js/state.js';
import * as api from './js/api.js';
import * as panels from './js/ui/panels.js';
import { updateCharacterCard } from './js/ui/characterCard.js';
import './js/ui/inventoryModal.js'; // Просто импортируем, чтобы код был доступен

const ROLE_COLORS = {
    player: 'green',
    gm: 'blue',
    npc: 'yellow',
    enemy: 'red'
};

/**
 * Отрисовывает историю событий в панели "Event Log".
 * @param {Array} history - Массив событий для отображения.
 */
function renderEventLog(history) {
    const eventLogPanel = document.getElementById('event-log-panel');
    if (!eventLogPanel) return;

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
        if (event.thoughts) logEntry.appendChild(thoughts);
        logEntry.appendChild(action);

        eventLogPanel.appendChild(logEntry);
    });

    // Автоматически прокручиваем до последнего события
    eventLogPanel.scrollTop = eventLogPanel.scrollHeight;
}

/**
 * Обрабатывает входящие обновления данных персонажа.
 * @param {object} updatedCharData - Обновленные данные персонажа.
 */
function handleCharacterUpdate(updatedCharData) {
    const charId = updatedCharData.id;
    const newData = updatedCharData.data;

    // 1. Обновить кэш
    if (state.allCharactersData[charId]) {
        Object.assign(state.allCharactersData[charId], newData);
    }

    // 2. Обновить видимую карточку, если она есть
    if (state.visibleCharacterIds.has(charId)) {
        const cardElement = document.querySelector(`[data-char-key='${charId}']`);
        if (cardElement) {
            console.log(`Updating card for ${charId}`);
            updateCharacterCard(cardElement, state.allCharactersData[charId]);
        }
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

    function loadPanel(panelId, url) {
        fetch(url)
            .then(response => response.text())
            .then(html => {
                const panelElement = document.getElementById(panelId);
                if (!panelElement) return;
                panelElement.innerHTML = html;

                if (panelId === "center-panel") panels.initializeCenterPanel();
                if (panelId === "top-panel") panels.initializeTopPanel();
                if (panelId === "bottom-panel") panels.initializeBottomPanel();
                if (panelId === "left-panel") panels.initializeLeftPanel();
            })
            .catch(err => console.warn(`Could not load panel ${panelId}:`, err));
    }

    async function main() {
        try {
            const allChars = await api.fetchAllCharacters();
            cacheAllCharacters(allChars);
            console.log("Character data cached.");
            
            Object.entries(panelConfigs).forEach(([id, url]) => loadPanel(id, url));

            const initialLogData = await api.fetchEventLog();
            renderEventLog(initialLogData.history || []);

            api.subscribeToEventLog(eventLogData => {
                console.log('Received event log update via SSE');
                renderEventLog(eventLogData.history || []);
            });

            api.subscribeToCharacterUpdates(characterUpdateData => {
                console.log('Received character update via SSE:', characterUpdateData);
                handleCharacterUpdate(characterUpdateData);
            });

        } catch (error) {
            console.error("Failed to initialize the application:", error);
        }
    }

    main();
});
