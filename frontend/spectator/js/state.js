import { showSpeechBubble, animateScrollTransform, stopAnimations } from './ui.js';
import { API_BASE_URL } from './api.js';

// Вся сложная логика очереди и кеширования больше не нужна благодаря единому событию `speech`.

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

    // 1. Всегда немедленно показываем текстовый "пузырь"
    const bubbleElements = showSpeechBubble(character, text, type);
    if (!bubbleElements) {
        console.error(`Could not create speech bubble for ${character}.`);
        return;
    }

    // Функция для очистки и удаления "пузыря"
    const cleanup = () => {
        stopAnimations();
        bubbleElements.wrapper.remove();
    };

    // 2. Проверяем, есть ли аудио
    if (audio_url) {
        // Сценарий С АУДИО: проигрываем звук и анимируем текст
        const audio = new Audio(`${API_BASE_URL}/${audio_url}`);
        
        audio.onloadedmetadata = () => {
            // Запускаем анимацию текста синхронно с длительностью аудио
            animateScrollTransform(bubbleElements.wrapper, bubbleElements.content, audio.duration);
            audio.play().catch(e => {
                console.error("Error playing audio:", e);
                cleanup(); // Если проигрывание не удалось, просто убираем "пузырь"
            });
        };
        
        audio.onended = cleanup; // Убираем "пузырь", когда аудио закончилось
        audio.onerror = (e) => { 
            console.error("Audio loading error:", e.message);
            cleanup(); // Если аудио не загрузилось, убираем "пузырь"
        };

    } else {
        // Сценарий БЕЗ АУДИО: просто показываем текст на несколько секунд
        console.log('No audio provided. Displaying text for a few seconds.');
        const displayDuration = Math.max(3000, text.length * 80); // Динамическая длительность
        setTimeout(cleanup, displayDuration);
    }
}
