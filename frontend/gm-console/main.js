import { state, cacheAllCharacters, setLastObserverRequest } from './js/state.js';
import * as api from './js/api.js';
import * as panels from './js/ui/panels.js';
import { updateCharacterCard } from './js/ui/characterCard.js';
import './js/ui/inventoryModal.js';

const ROLE_COLORS = {
    Player: 'green',
    gm: 'blue',
    npc: 'yellow',
    Enemy: 'red'
};

function renderEventLog(history) {
    const eventLogPanel = document.getElementById('event-log-panel');
    if (!eventLogPanel) return;
    eventLogPanel.innerHTML = '<h2>Event Log</h2>';
    history.forEach(event => {
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry';
        logEntry.id = `step-${event.step}`;

        const characterName = document.createElement('span');
        characterName.className = 'character-name';
        characterName.textContent = `${event.name}: `;
        characterName.style.color = ROLE_COLORS[event.role] || 'white';
        logEntry.appendChild(characterName);

        if (event.thoughts) {
            const thoughts = document.createElement('p');
            thoughts.className = 'thoughts';
            thoughts.textContent = `Мысли: ${event.thoughts}`;
            logEntry.appendChild(thoughts);
        }

        if (event.action) {
            const action = document.createElement('p');
            action.className = 'action';
            action.textContent = `Действие: ${event.action}`;
            logEntry.appendChild(action);
        }

        eventLogPanel.appendChild(logEntry);
    });
    eventLogPanel.scrollTop = eventLogPanel.scrollHeight;
}

function handleCharacterUpdate(updatedCharData) {
    const charId = updatedCharData.id;
    const newData = updatedCharData.data;
    if (state.allCharactersData[charId]) {
        Object.assign(state.allCharactersData[charId], newData);
    }
    if (state.visibleCharacterIds.has(charId)) {
        const cardElement = document.querySelector(`[data-char-key='${charId}']`);
        if (cardElement) {
            console.log(`SSE: Updating card for ${charId}`);
            updateCharacterCard(cardElement, state.allCharactersData[charId]);
        }
    }
}

async function triggerObserver(action, diceRoll = null) {
    const observerTextarea = document.getElementById('observer-textarea');
    observerTextarea.value = 'Анализ...';
    setLastObserverRequest(action, diceRoll);
    try {
        const result = await api.getObserverAnalysis(action, diceRoll);
        observerTextarea.value = result.response;
    } catch (error) {
        observerTextarea.value = `Ошибка: ${error.message}`;
    }
}

function initializeObserver() {
    const confirmButton = document.getElementById('confirm-button');
    const retryButton = document.getElementById('retry-button');
    const resetButton = document.getElementById('reset-button');
    const observerTextarea = document.getElementById('observer-textarea');

    confirmButton.addEventListener('click', async () => {
        const text = observerTextarea.value;
        const patchMatch = text.match(/\[JSON PATCH\]([\s\S]*)/);
        if (patchMatch && patchMatch[1]) {
            try {
                const patch = JSON.parse(patchMatch[1].trim());
                await api.applyJsonPatch(patch);
                alert('Персонажи обновлены!');
                observerTextarea.value = '';
            } catch (error) {
                alert(`Ошибка применения патча: ${error.message}`);
            }
        } else {
            alert('[JSON PATCH] не найден в ответе.');
        }
    });

    retryButton.addEventListener('click', () => {
        if (state.lastAction) triggerObserver(state.lastAction, state.lastDiceRoll);
    });
    resetButton.addEventListener('click', () => { observerTextarea.value = ''; });
}

document.addEventListener("DOMContentLoaded", () => {
    const panelConfigs = {
        "top-panel": "panels/top-panel.html", "left-panel": "panels/left-panel.html",
        "center-panel": "panels/center-panel.html", "right-panel": "panels/right-panel.html",
        "bottom-panel": "panels/bottom-panel.html"
    };

    function loadPanel(panelId, url) {
        fetch(url)
            .then(response => response.text())
            .then(html => {
                document.getElementById(panelId).innerHTML = html;
                if (panelId === "center-panel") panels.initializeCenterPanel(triggerObserver);
                if (panelId === "top-panel") panels.initializeTopPanel();
                if (panelId === "bottom-panel") panels.initializeBottomPanel();
                if (panelId === "left-panel") panels.initializeLeftPanel();
                if (panelId === "right-panel") initializeObserver();
            });
    }

    async function main() {
        try {
            // 1. Кэшируем данные и загружаем панели
            const allChars = await api.fetchAllCharacters();
            cacheAllCharacters(allChars);
            Object.entries(panelConfigs).forEach(([id, url]) => loadPanel(id, url));

            // 2. Первоначальная загрузка лога
            const initialLogData = await api.fetchEventLog();
            renderEventLog(initialLogData.history || []);

            // 3. Подписка на ЕДИНЫЙ ПОТОК ДАННЫХ ДЛЯ ГМ
            api.subscribeToGmStream(
                // Колбэк для обновления лога
                (eventLogData) => {
                    console.log('SSE: Received event log update');
                    renderEventLog(eventLogData.history || []);

                    const lastEvent = eventLogData.history[eventLogData.history.length - 1];
                    if (lastEvent && lastEvent.name !== 'Game Master') {
                        const actionMatch = lastEvent.action.match(/\[ACTION']([\s\S]*)/);
                        if (actionMatch && actionMatch[1]) {
                            triggerObserver(actionMatch[1].trim());
                        }
                    }
                },
                // Колбэк для обновления персонажа
                (characterUpdateData) => {
                    console.log('SSE: Received character update:', characterUpdateData);
                    handleCharacterUpdate(characterUpdateData);
                }
            );

        } catch (error) {
            console.error("Initialization failed:", error);
        }
    }

    main();
});
