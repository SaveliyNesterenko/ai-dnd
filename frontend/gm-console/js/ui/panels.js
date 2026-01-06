import * as api from '../api.js';
import { toggleCharacterCard, selectCharacter } from './characterCard.js';
import { state } from '../state.js';

const getNestedProperty = (obj, path) => {
    if (!path) return obj;
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
};

export function initializeCenterPanel(triggerObserver) {
    // === Character Action Generator Logic ===
    const generateButtonContainer = document.getElementById('generate-button-container');
    const sendBtn = document.getElementById('sendBtn');
    const charInput = document.getElementById('charKey');
    const outputArea = document.getElementById('modelOutput');
    const responseButtons = document.getElementById('response-buttons');
    const retryBtn = document.getElementById('retryBtn');
    const sendResponseBtn = document.getElementById('sendResponseBtn');
    const sendWithDiceRollBtn = document.getElementById('sendWithDiceRollBtn');

    const generateResponse = async () => {
        const charKey = charInput.value.trim();
        if (!charKey) {
            alert("Пожалуйста, введите ID персонажа!");
            return;
        }

        generateButtonContainer.style.display = 'none';
        responseButtons.style.display = 'none';
        outputArea.value = "Запрос отправлен к модели...";

        try {
            const data = await api.postAction(charKey);
            outputArea.value = data.response;
            responseButtons.style.display = 'flex';
        } catch (error) {
            console.error('Ошибка:', error);
            outputArea.value = "ПРОИЗОШЛА ОШИБКА:\n" + error.message;
            generateButtonContainer.style.display = 'block';
        }
    };

    if(sendBtn) sendBtn.addEventListener('click', generateResponse);
    if(retryBtn) retryBtn.addEventListener('click', generateResponse);

    const resetToActionGenerator = () => {
        responseButtons.style.display = 'none';
        generateButtonContainer.style.display = 'block';
        outputArea.value = '';
    };

    if(sendResponseBtn) sendResponseBtn.addEventListener('click', () => {
        const actionText = outputArea.value;
        triggerObserver(actionText, null);
        resetToActionGenerator();
    });

    if(sendWithDiceRollBtn) sendWithDiceRollBtn.addEventListener('click', () => {
        const actionText = outputArea.value;
        const diceRoll = Math.floor(Math.random() * 20) + 1;
        triggerObserver(actionText, diceRoll);
        resetToActionGenerator();
    });
}

export function initializeLeftPanel() {
    const recordButton = document.getElementById('record-button');
    const voicePreview = document.getElementById('voice-preview');
    const sendButton = document.getElementById('send-button');

    if (!recordButton || !voicePreview || !sendButton) return;

    const speechRecognition = initializeSpeechRecognition(
        (text) => { 
            voicePreview.value = text;
        },
        () => { 
            recordButton.innerHTML = "ЗАПИСЬ";
        }
    );

    if (speechRecognition) {
        recordButton.addEventListener('mousedown', () => {
            speechRecognition.start();
            recordButton.textContent = "Идёт запись...";
        });

        recordButton.addEventListener('mouseup', () => {
            speechRecognition.stop();
        });
    }

    sendButton.addEventListener('click', async () => {
        const textToSend = voicePreview.value.trim();
        if (!textToSend) return;

        sendButton.disabled = true;
        try {
            await api.postGmAction(textToSend);
            voicePreview.value = '';
        } catch (error) {
            console.error('Ошибка при отправке действия GM:', error);
        } finally {
            sendButton.disabled = false;
        }
    });
}

export async function initializeTopPanel() {
    const populateSelect = async (fetcher, selectId, defaultText, namePath = null) => {
        try {
            const data = await fetcher();
            const select = document.getElementById(selectId);
            if (!select) return;
            select.innerHTML = `<option disabled selected>${defaultText}</option>`;
            for (const key in data) {
                const item = data[key];
                const option = document.createElement('option');
                option.value = key;
                option.textContent = namePath ? getNestedProperty(item, namePath) : key;
                select.appendChild(option);
            }
        } catch (error) {
            console.error(`Error populating ${selectId}:`, error);
        }
    };

    await populateSelect(api.fetchCharacters, 'character-select', 'Characters', 'identity.name');
    await populateSelect(api.fetchNpcs, 'npc-select', 'NPCs', 'identity.name');
    await populateSelect(api.fetchLocations, 'location-select', 'Locations');

    const eventButton = document.getElementById('event-button');
    const compressButton = document.getElementById('compress-context-btn');
    const locationSelect = document.getElementById('location-select');
    
    const updateEventButtonState = () => {
        const charactersCount = state.visibleCharacterIds.size;
        const locationSelected = locationSelect.value !== 'Locations' && locationSelect.value !== '';
        eventButton.disabled = !(charactersCount > 0 && locationSelected);
    };

    const updateCompressButtonState = () => {
        const history = state.eventLog.history || [];
        compressButton.disabled = history.length <= 10;
    };

    const handleCharacterDropdownChange = (event) => {
        const selectedId = event.target.value;
        if (!selectedId) return;

        const isVisible = state.visibleCharacterIds.has(selectedId);

        // Toggle card visibility
        toggleCharacterCard(selectedId);

        // Activate or deactivate the character for the spectator view
        if (!isVisible) {
            api.activateCharacter(selectedId).catch(err => console.error(`Failed to activate ${selectedId}:`, err));
        } else {
            api.deactivateCharacter(selectedId).catch(err => console.error(`Failed to deactivate ${selectedId}:`, err));
        }
        
        // We use a timeout to ensure the state has been updated by toggleCharacterCard
        setTimeout(updateEventButtonState, 100);
    };

    const handleLocationDropdownChange = (event) => {
        const selectedLocationId = event.target.value;
        if (selectedLocationId) {
            api.setLocation(selectedLocationId).catch(error => {
                console.error("Failed to set location:", error);
                alert("Ошибка установки локации!");
            });
        }
        updateEventButtonState();
    };
    
    document.getElementById('character-select')?.addEventListener('change', handleCharacterDropdownChange);
    document.getElementById('npc-select')?.addEventListener('change', handleCharacterDropdownChange);
    document.getElementById('location-select')?.addEventListener('change', handleLocationDropdownChange);

    eventButton.addEventListener('click', async () => {
        if (eventButton.textContent === 'Запустить событие') {
            const characterIds = Array.from(state.visibleCharacterIds);
            try {
                await api.updateActiveCharacters({ characters_id: characterIds }); // This might be deprecated now
                eventButton.textContent = 'Завершить событие';
            } catch (error) {
                console.error('Failed to update active characters:', error);
            }
        } else {
            eventButton.disabled = true;
            eventButton.style.backgroundColor = '#6c757d'; // Серый цвет
            console.log("Отправка запроса на архивацию события...");

            try {
                await api.archiveEvent();
                console.log("Событие успешно заархивировано.");
                eventButton.textContent = 'Запустить событие';
            } catch (error) {
                console.error('Failed to archive event:', error);
                alert('Ошибка архивации события!');
            } finally {
                eventButton.disabled = false;
                eventButton.style.backgroundColor = ''; // Сброс цвета
            }
        }
    });

    compressButton.addEventListener('click', async () => {
        compressButton.disabled = true;
        compressButton.style.backgroundColor = '#6c757d';
        console.log("Отправка запроса на сжатие контекста...");

        try {
            const response = await api.compressContext();
            console.log("Контекст успешно сжат:", response.message);
        } catch (error) {
            console.error('Failed to compress context:', error);
            alert('Ошибка сжатия контекста!');
        } finally {
            compressButton.style.backgroundColor = ''; 
            updateCompressButtonState();
        }
    });

    // Initialization and subscription to event_log updates
    const initialLog = await api.fetchEventLog();
    state.eventLog = initialLog;
    updateCompressButtonState();

    api.subscribeToEventLog(log => {
        state.eventLog = log;
        updateCompressButtonState();
    });

    updateEventButtonState();
}

export function initializeBottomPanel() {
    const container = document.querySelector('#bottom-panel .characters-container');
    if (container) {
        container.addEventListener('click', (event) => {
            const card = event.target.closest('.character-card');
            if (card) {
                selectCharacter(card);
            }
        });

        container.addEventListener('wheel', (event) => {
            if (event.deltaY !== 0) {
                event.preventDefault();
                container.scrollLeft += event.deltaY;
            }
        }, { passive: false });
    }
}
