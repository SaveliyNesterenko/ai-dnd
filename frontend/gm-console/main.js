import { state, cacheAllCharacters, setLastObserverRequest } from './js/state.js';
import * as api from './js/api.js';
import * as panels from './js/ui/panels.js';
import { updateCharacterCard } from './js/ui/characterCard.js';
import './js/ui/inventoryModal.js';

const ROLE_COLORS = {
    player: 'green',
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
            console.log(`Updating card for ${charId}`);
            updateCharacterCard(cardElement, state.allCharactersData[charId]);
        }
    }
}

// --- OBSERVER LOGIC ---

async function triggerObserver(action, diceRoll = null) {
    const observerTextarea = document.getElementById('observer-textarea');
    observerTextarea.value = 'Анализ...';
    setLastObserverRequest(action, diceRoll);

    try {
        const result = await api.getObserverAnalysis(action, diceRoll);
        observerTextarea.value = result.response;
    } catch (error) {
        observerTextarea.value = `Ошибка: ${error.message}`;
        console.error("Observer analysis failed:", error);
    }
}

function initializeObserver() {
    const confirmButton = document.getElementById('confirm-button');
    const retryButton = document.getElementById('retry-button');
    const observerTextarea = document.getElementById('observer-textarea');

    confirmButton.addEventListener('click', async () => {
        const text = observerTextarea.value;
        const patchMatch = text.match(/\[JSON PATCH\]([\s\S]*)/);
        if (patchMatch && patchMatch[1]) {
            try {
                const patch = JSON.parse(patchMatch[1].trim());
                await api.applyJsonPatch(patch);
                alert('Персонажи обновлены!');
                observerTextarea.value = ''; // Clear on success
            } catch (error) {
                alert(`Ошибка применения патча: ${error.message}`);
                console.error("Failed to parse or apply JSON patch:", error);
            }
        } else {
            alert('[JSON PATCH] не найден в ответе.');
        }
    });

    retryButton.addEventListener('click', () => {
        if (state.lastAction) {
            triggerObserver(state.lastAction, state.lastDiceRoll);
        }
    });
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
                if (panelId === "bottom-panel") panels.initializeBottomPanel(triggerObserver); // Pass trigger function
                if (panelId === "left-panel") panels.initializeLeftPanel();
                if (panelId === "right-panel") initializeObserver(); // Initialize observer buttons
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

                const lastEvent = eventLogData.history[eventLogData.history.length - 1];
                // Automatically trigger observer for non-GM actions
                if(lastEvent && lastEvent.name !== 'Game Master') {
                    // Extract the ACTION part from the response for the observer
                    const actionMatch = lastEvent.action.match(/\[ACTION\]([\s\S]*)/);
                    if(actionMatch && actionMatch[1]) {
                        triggerObserver(actionMatch[1].trim());
                    }
                }
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
