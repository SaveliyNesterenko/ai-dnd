const API_BASE_URL = 'http://127.0.0.1:8000';

const spectatorView = document.getElementById('spectator-view');

/**
 * Запрашивает актуальное состояние игры с сервера.
 * @returns {Promise<object>} Объект состояния игры.
 */
async function fetchGameState() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/game_state`);
        if (!response.ok) {
            throw new Error(`Ошибка сети: ${response.statusText}`);
        }
        return await response.json();
    } catch (error) {
        console.error("Не удалось получить состояние игры:", error);
        return null; // Возвращаем null в случае ошибки
    }
}

/**
 * Обновляет отображение на основе полученного состояния игры.
 * @param {object} gameState - Состояние игры.
 */
function updateView(gameState) {
    if (!gameState || !gameState.current_location) {
        // Если данных нет, можно установить фон по умолчанию или оставить как есть
        spectatorView.style.backgroundImage = 'none';
        return;
    }

    const location = gameState.current_location;
    const imageUrl = `${API_BASE_URL}/${location.image_url}`;

    // Обновляем фон, только если он изменился, чтобы избежать лишних перерисовок
    if (spectatorView.style.backgroundImage !== `url("${imageUrl}")`) {
        console.log(`Меняем локацию на: ${location.name}`);
        spectatorView.style.backgroundImage = `url('${imageUrl}')`;
    }
}

/**
 * Основная функция, запускающая цикл опроса.
 */
async function main() {
    console.log("Зрительский экран запущен.");
    
    // Немедленный первый запуск
    const initialState = await fetchGameState();
    updateView(initialState);

    // Запуск опроса каждые 2 секунды
    setInterval(async () => {
        const gameState = await fetchGameState();
        updateView(gameState);
    }, 2000);
}

// Запускаем!
main();
