import { showSpeechBubble, animateScrollTransform, stopAnimations } from './ui.js';
import { API_BASE_URL } from './api.js';

/**
 * Обрабатывает единое событие реплики от сервера.
 * Отображает текстовый "пузырь" и проигрывает аудио, если оно доступно.
 * @param {object} data - Данные события от сервера.
 * @param {string} data.character - ID персонажа.
 * @param {string} data.text - Текст реплики.
 * @param {string} data.type - Тип реплики ('thought' или 'action').
 * @param {string|null} data.audio_url - URL аудиофайла или null.
 */
export function handleSpeechEvent(data) {
    const { character, text, type, audio_url } = data;

    console.log(`Received speech event for ${character}: ${type}`);

    const bubbleElements = showSpeechBubble(character, text, type);
    if (!bubbleElements) {
        console.error(`Could not create speech bubble for ${character}.`);
        return;
    }

    const cleanup = () => {
        stopAnimations();
        bubbleElements.wrapper.remove();
    };

    if (audio_url) {
        // Сценарий С АУДИО: проигрываем звук и анимируем текст
        const audio = new Audio(`${API_BASE_URL}/${audio_url}`);
        
        audio.onloadedmetadata = () => {
            animateScrollTransform(bubbleElements.wrapper, bubbleElements.content, audio.duration);
            audio.play().catch(e => {
                console.error("Error playing audio:", e);
                cleanup();
            });
        };
        
        audio.onended = cleanup;
        audio.onerror = (e) => { 
            console.error("Audio loading error:", e.message);
            cleanup();
        };

    } else {
        // Сценарий БЕЗ АУДИО: показываем текст 15 секунд с авто-прокруткой
        console.log('No audio provided. Displaying text for 15s with auto-scroll.');
        const fixedDurationInSeconds = 15;

        // 1. Запускаем анимацию прокрутки текста на фиксированную длительность
        animateScrollTransform(bubbleElements.wrapper, bubbleElements.content, fixedDurationInSeconds);
        
        // 2. Убираем "пузырь" ровно через 15 секунд
        setTimeout(cleanup, fixedDurationInSeconds * 1000);
    }
}
