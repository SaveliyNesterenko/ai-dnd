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

    if (!recordButton || !voicePreview) return;

    const speechRecognition = initializeSpeechRecognition(
        (text) => { // resultCallback
            voicePreview.value = text;
        },
        () => { // endCallback
            recordButton.textContent = "<span>&#127908;</span> УДЕРЖИВАТЬ ДЛЯ ЗАПИСИ";
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
}

/**
 * Инициализирует логику верхней панели.
 * Заполняет выпадающие списки персонажей и NPC.
 */
export async function initializeTopPanel() {
    const populateSelect = async (fetcher, selectId, defaultText) => {
        try {
            const data = await fetcher();
            const select = document.getElementById(selectId);
            if (!select) return;
            select.innerHTML = `<option disabled selected>${defaultText}</option>`;
            for (const key in data) {
                const item = data[key];
                const option = document.createElement('option');
                option.value = key;
                option.textContent = item.identity.name;
                select.appendChild(option);
            }
        } catch (error) {
            console.error(`Error populating ${selectId}:`, error);
        }
    };

    await populateSelect(api.fetchCharacters, 'character-select', 'Characters');
    await populateSelect(api.fetchNpcs, 'npc-select', 'NPCs');

    const handleDropdownChange = (event) => {
        const selectedId = event.target.value;
        toggleCharacterCard(selectedId);
    };

    document.getElementById('character-select')?.addEventListener('change', handleDropdownChange);
    document.getElementById('npc-select')?.addEventListener('change', handleDropdownChange);
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
