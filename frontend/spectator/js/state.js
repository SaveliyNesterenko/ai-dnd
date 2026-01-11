import { showSpeechBubble, animateScrollTransform, stopAnimations } from './ui.js';
import { API_BASE_URL } from './api.js';

// --- СИСТЕМА ОЧЕРЕДИ ДЛЯ ПОСЛЕДОВАТЕЛЬНОГО ВОСПРОИЗВЕДЕНИЯ --- 

let speechQueue = [];
let isProcessing = false;

/**
 * Главная функция, вызываемая извне. Добавляет событие в очередь и запускает обработчик.
 * @param {object} data - Данные события от сервера.
 * @param {string} data.character - ID персонажа.
 * @param {string} data.text - Текст реплики.
 * @param {string} data.type - Тип реплики ('thought' или 'action').
 * @param {string|null} data.audio_url - URL аудиофайла или null.
 */
export function handleSpeechEvent(data) {
    speechQueue.push(data);
    processQueue();
}

/**
 * Обработчик очереди. Гарантирует, что только одно событие обрабатывается в данный момент.
 */
async function processQueue() {
    if (isProcessing || speechQueue.length === 0) {
        return; // Выход, если уже идет обработка или очередь пуста
    }
    isProcessing = true;

    const eventData = speechQueue.shift(); // Берем первое событие из очереди

    // Ждем, пока событие полностью не отработает (проиграется аудио или пройдет таймер)
    await executeSpeechEvent(eventData);

    isProcessing = false;
    // Рекурсивно вызываем для обработки следующих событий в очереди
    processQueue();
}

/**
 * Выполняет логику отображения одного события и возвращает Promise, который разрешается по завершении.
 * @param {object} data - Объект события speech.
 * @returns {Promise<void>}
 */
function executeSpeechEvent(data) {
    return new Promise(resolve => {
        const { character, text, type, audio_url } = data;

        console.log(`Executing speech event for ${character}: ${type}`);

        const bubbleElements = showSpeechBubble(character, text, type);
        if (!bubbleElements) {
            console.error(`Could not create speech bubble for ${character}.`);
            resolve(); // Разрешаем Promise, чтобы очередь не зависла
            return;
        }

        // Функция, которая убирает "пузырь" и сигнализирует о завершении
        const cleanupAndResolve = () => {
            stopAnimations();
            bubbleElements.wrapper.remove();
            resolve(); // <-- Ключевой момент: Promise завершен, можно начинать следующее событие
        };

        if (audio_url) {
            // Сценарий С АУДИО
            const audio = new Audio(`${API_BASE_URL}/${audio_url}`);
            
            audio.onloadedmetadata = () => {
                animateScrollTransform(bubbleElements.wrapper, bubbleElements.content, audio.duration);
                audio.play().catch(e => {
                    console.error("Error playing audio:", e);
                    cleanupAndResolve();
                });
            };
            
            audio.onended = cleanupAndResolve;
            audio.onerror = (e) => { 
                console.error("Audio loading error:", e.message);
                cleanupAndResolve();
            };

        } else {
            // Сценарий БЕЗ АУДИО
            const fixedDurationInSeconds = 15;
            animateScrollTransform(bubbleElements.wrapper, bubbleElements.content, fixedDurationInSeconds);
            setTimeout(cleanupAndResolve, fixedDurationInSeconds * 1000);
        }
    });
}
