import { state, cacheAllCharacters, setLastObserverRequest } from './js/state.js';
import * as api from './js/api.js';
import * as panels from './js/ui/panels.js';
import { updateCharacterCard } from './js/ui/characterCard.js';
import './js/ui/inventoryModal.js';

const ROLE_COLORS = {
    Player: 'green',
    gm: 'blue',
    npc: 'yellow',
    enemy: 'red'
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

async function triggerObserver(action, diceRoll, characterId) {
    const observerTextarea = document.getElementById('observer-textarea');
    observerTextarea.value = 'Анализ...';
    setLastObserverRequest(action, diceRoll);
    try {
        const result = await api.getObserverAnalysis(action, diceRoll, characterId);
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

    if (confirmButton) confirmButton.addEventListener('click', async () => {
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

    if (retryButton) retryButton.addEventListener('click', () => {
        if (state.lastAction) triggerObserver(state.lastAction, state.lastDiceRoll, state.lastCharacterId);
    });
    if (resetButton) resetButton.addEventListener('click', () => { observerTextarea.value = ''; });
}

document.addEventListener("DOMContentLoaded", () => {
    const panelConfigs = {
        "top-panel": "panels/top-panel.html", "left-panel": "panels/left-panel.html",
        "center-panel": "panels/center-panel.html", "right-panel": "panels/right-panel.html",
        "bottom-panel": "panels/bottom-panel.html",
        "settings-modal-container": "panels/settings-modal.html"
    };

    function loadPanel(panelId, url) {
        return fetch(url)
            .then(response => response.text())
            .then(html => {
                const element = document.getElementById(panelId);
                if (element) {
                    element.innerHTML = html;
                }
            });
    }

    async function main() {
        try {
            // 1. Кэшируем данные и загружаем HTML для панелей
            const allChars = await api.fetchAllCharacters();
            cacheAllCharacters(allChars);
            const loadPromises = Object.entries(panelConfigs).map(([id, url]) => loadPanel(id, url));
            await Promise.all(loadPromises);

            // 2. Инициализируем JS для панелей после загрузки всего HTML
            panels.initializeCenterPanel(triggerObserver);
            panels.initializeTopPanel(); // Эта функция теперь также настроит модальное окно
            panels.initializeBottomPanel();
            panels.initializeLeftPanel();
            initializeObserver();

            // 3. Первоначальная загрузка лога
            const initialLogData = await api.fetchEventLog();
            renderEventLog(initialLogData.history || []);

            // 4. Подписка на SSE
            api.subscribeToGmStream(
                (eventLogData) => {
                    console.log('SSE: Received event log update');
                    renderEventLog(eventLogData.history || []);

                    const lastEvent = eventLogData.history[eventLogData.history.length - 1];
                    if (lastEvent && lastEvent.name !== 'Game Master') {
                        const actionMatch = lastEvent.action.match(/\[ACTION\]([\s\S]*)/);
                        if (actionMatch && actionMatch[1]) {
                            triggerObserver(actionMatch[1].trim(), null, lastEvent.id);
                        }
                    }
                },
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
