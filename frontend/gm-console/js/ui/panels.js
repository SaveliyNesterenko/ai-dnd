import * as api from '../api.js';
import { toggleCharacterCard, selectCharacter } from './characterCard.js';

/**
 * Safely access nested properties of an object.
 * @param {object} obj The object to access.
 * @param {string} path The path to the property (e.g., 'identity.name').
 * @returns {*} The value of the property, or undefined if not found.
 */
const getNestedProperty = (obj, path) => {
    if (!path) return obj;
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
};

/**
 * Initializes the center panel logic.
 */
export function initializeCenterPanel() {
    const generateButtonContainer = document.getElementById('generate-button-container');
    const sendBtn = document.getElementById('sendBtn');
    const charInput = document.getElementById('charKey');
    const outputArea = document.getElementById('modelOutput');
    const responseButtons = document.getElementById('response-buttons');
    const retryBtn = document.getElementById('retryBtn');
    const sendResponseBtn = document.getElementById('sendResponseBtn');
    const sendWithDiceRollBtn = document.getElementById('sendWithDiceRollBtn');

    if (!generateButtonContainer || !sendBtn || !charInput || !outputArea || !responseButtons || !retryBtn || !sendResponseBtn || !sendWithDiceRollBtn) return;

    const generateResponse = async () => {
        const charKey = charInput.value.trim();
        if (!charKey) {
            alert("Пожалуйста, введите ID персонажа!");
            return;
        }

        // Hide buttons and show thinking status
        generateButtonContainer.style.display = 'none';
        responseButtons.style.display = 'none';
        outputArea.value = "Запрос отправлен к модели...";

        try {
            const data = await api.postAction(charKey);
            outputArea.value = data.response;
            responseButtons.style.display = 'flex'; // Show response buttons
        } catch (error) {
            console.error('Ошибка:', error);
            outputArea.value = "ПРОИЗОШЛА ОШИБКА:\n" + error.message;
            generateButtonContainer.style.display = 'block'; // Show generate button again on error
        }
    };

    sendBtn.addEventListener('click', generateResponse);
    retryBtn.addEventListener('click', generateResponse);

    const resetToGenerate = () => {
        responseButtons.style.display = 'none';
        generateButtonContainer.style.display = 'block';
        outputArea.value = ''; // Clear output
    };

    sendResponseBtn.addEventListener('click', () => {
        console.log('Отправить');
        // Here you would add the logic to actually send the response
        resetToGenerate();
    });

    sendWithDiceRollBtn.addEventListener('click', () => {
        console.log('Отправить с Dice Roll');
        // Here you would add the logic to send with a dice roll
        resetToGenerate();
    });
}


/**
 * Initializes the left panel logic.
 */
export function initializeLeftPanel() {
    const recordButton = document.getElementById('record-button');
    const voicePreview = document.getElementById('voice-preview');
    const sendButton = document.getElementById('send-button');

    if (!recordButton || !voicePreview || !sendButton) return;

    // Speech Recognition Logic (assuming initializeSpeechRecognition is globally available from speech.js)
    const speechRecognition = initializeSpeechRecognition(
        (text) => { // resultCallback
            voicePreview.value = text;
        },
        () => { // endCallback
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

/**
 * Initializes the top panel logic.
 * Populates dropdowns for characters, NPCs, and locations.
 */
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

    const handleCharacterDropdownChange = (event) => {
        const selectedId = event.target.value;
        if (selectedId) toggleCharacterCard(selectedId);
    };

    const handleLocationDropdownChange = (event) => {
        const selectedLocation = event.target.value;
        console.log(`Location selected: ${selectedLocation}`);
    };

    document.getElementById('character-select')?.addEventListener('change', handleCharacterDropdownChange);
    document.getElementById('npc-select')?.addEventListener('change', handleCharacterDropdownChange);
    document.getElementById('location-select')?.addEventListener('change', handleLocationDropdownChange);
}

/**
 * Initializes the bottom panel logic.
 */
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
        });
    }
}
