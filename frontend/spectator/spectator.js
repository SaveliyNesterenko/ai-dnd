const API_BASE_URL = 'http://127.0.0.1:8000';

const spectatorView = document.getElementById('spectator-view');

/**
 * Обновляет отображение на основе полученного состояния игры.
 * @param {object} gameState - Состояние игры.
 */
function updateView(gameState) {
    if (!gameState || !gameState.current_location) {
        spectatorView.style.backgroundImage = 'none';
        return;
    }

    const location = gameState.current_location;
    // Сервер уже отдает готовый путь, поэтому просто используем его
    const imageUrl = `${API_BASE_URL}/${location.image_url}`;

    if (spectatorView.style.backgroundImage !== `url("${imageUrl}")`) {
        console.log(`Меняем локацию на: ${location.name}`);
        spectatorView.style.backgroundImage = `url('${imageUrl}')`;
    }
}

/**
 * Подписывается на серверные события для получения обновлений состояния игры.
 */
function subscribeToGameStateUpdates() {
    const eventSource = new EventSource(`${API_BASE_URL}/api/game_state_stream`);

    eventSource.onmessage = function(event) {
        console.log("Получено обновление состояния игры через SSE.");
        const gameState = JSON.parse(event.data);
        updateView(gameState);
    };

    eventSource.onerror = function(err) {
        console.error("Ошибка EventSource:", err);
        // EventSource автоматически попытается переподключиться
    };
}

/**
 * Основная функция инициализации.
 */
async function main() {
    console.log("Зрительский экран запущен в режиме SSE.");

    // Запрашиваем начальное состояние один раз при загрузке
    try {
        const response = await fetch(`${API_BASE_URL}/api/game_state`);
        if (!response.ok) throw new Error(`Network response was not ok: ${response.statusText}`);
        const initialState = await response.json();
        updateView(initialState);
    } catch (error) {
        console.error("Не удалось получить начальное состояние игры:", error);
    }

    // Подписываемся на будущие обновления
    subscribeToGameStateUpdates();
}

// Запускаем!
main();
