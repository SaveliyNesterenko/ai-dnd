import * as api from '../api.js';
import { toggleCharacterCard, selectCharacter } from './characterCard.js';

/**
 * Инициализирует логику центральной панели.
 * Навешивает обработчик на кнопку отправки действия.
 */
export function initializeCenterPanel() {
    const sendBtn = document.getElementById('sendBtn');
    const charInput = document.getElementById('charKey');
    const outputArea = document.getElementById('modelOutput');
    if (!sendBtn || !charInput || !outputArea) return;

    sendBtn.addEventListener('click', async () => {
        const charKey = charInput.value.trim();
        if (!charKey) {
            alert("Пожалуйста, введите ID персонажа!");
            return;
        }
        sendBtn.disabled = true;
        sendBtn.textContent = "Думаю...";
        outputArea.value = "Запрос отправлен к модели...";
        try {
            const data = await api.postAction(charKey);
            outputArea.value = data.response;
        } catch (error) {
            console.error('Ошибка:', error);
            outputArea.value = "ПРОИЗОШЛА ОШИБКА:\n" + error.message;
        } finally {
            sendBtn.disabled = false;
            sendBtn.textContent = "Сгенерировать ответ";
        }
    });
}

/**
 * Инициализирует логику левой панели.
 */
export function initializeLeftPanel() {
    const recordButton = document.getElementById('record-button');
    const voicePreview = document.getElementById('voice-preview');
    const sendButton = document.getElementById('send-button'); // Make sure this ID exists in your left-panel.html

    if (!recordButton || !voicePreview || !sendButton) return;

    // Speech Recognition Logic
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

    // Send Button Logic
    sendButton.addEventListener('click', async () => {
        const textToSend = voicePreview.value.trim();
        if (!textToSend) {
            // Maybe show a small, temporary message instead of an alert
            return;
        }

        sendButton.disabled = true;

        try {
            await api.postGmAction(textToSend);
            voicePreview.value = ''; // Clear the textarea on success
        } catch (error) {
            console.error('Ошибка при отправке действия GM:', error);
            // Optionally, display an error message to the user in the UI
        } finally {
            sendButton.disabled = false;
            // sendButton.textContent = "ОТПРАВИТЬ";
        }
    });
}

/**
 * Инициализирует логику верхней панели.
 * Заполняет выпадающие списки персонажей, NPC и локаций.
 */
export async function initializeTopPanel() {
    const populateSelect = async (fetcher, selectId, defaultText, nameField = null) => {
        try {
            const data = await fetcher();
            const select = document.getElementById(selectId);
            if (!select) return;
            select.innerHTML = `<option disabled selected>${defaultText}</option>`;
            for (const key in data) {
                const item = data[key];
                const option = document.createElement('option');
                option.value = key;
                // Если `nameField` задано, используем его для получения имени, иначе используем ключ
                option.textContent = nameField ? item[nameField] : key;
                select.appendChild(option);
            }
        } catch (error) {
            console.error(`Error populating ${selectId}:`, error);
        }
    };

    await populateSelect(api.fetchCharacters, 'character-select', 'Characters', 'identity.name');
    await populateSelect(api.fetchNpcs, 'npc-select', 'NPCs', 'identity.name');
    await populateSelect(api.fetchLocations, 'location-select', 'Locations');

    const handleDropdownChange = (event) => {
        const selectedId = event.target.value;
        toggleCharacterCard(selectedId);
    };

    document.getElementById('character-select')?.addEventListener('change', handleDropdownChange);
    document.getElementById('npc-select')?.addEventListener('change', handleDropdownChange);
    document.getElementById('location-select')?.addEventListener('change', (event) => {
        const selectedLocation = event.target.value;
        // Здесь вы можете добавить логику для обработки выбора локации
        console.log(`Location selected: ${selectedLocation}`);
    });
}

/**
 * Инициализирует логику нижней панели.
 * Навешивает обработчики кликов для выбора карточки и скролла.
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
