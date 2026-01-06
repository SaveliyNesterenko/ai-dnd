const API_BASE_URL = 'http://127.0.0.1:8000';

// --- DOM Элементы ---
const backgroundContainer = document.getElementById('background-container');
const avatarsContainer = document.getElementById('avatars-container');

// --- Состояние для Drag-and-Drop ---
let activeDrag = null;

// --- Логика обновления фона локации ---

function updateBackground(gameState) {
    if (!gameState || !gameState.current_location) {
        backgroundContainer.style.backgroundImage = 'none';
        return;
    }
    const location = gameState.current_location;
    const imageUrl = `${API_BASE_URL}/${location.image_url}`;

    if (backgroundContainer.style.backgroundImage !== `url("${imageUrl}")`) {
        console.log(`Changing location to: ${location.name}`);
        backgroundContainer.style.backgroundImage = `url('${imageUrl}')`;
    }
}

function subscribeToGameStateUpdates() {
    const eventSource = new EventSource(`${API_BASE_URL}/api/game_state_stream`);
    eventSource.onmessage = function(event) {
        const gameState = JSON.parse(event.data);
        updateBackground(gameState);
    };
    eventSource.onerror = (err) => console.error("GameState EventSource failed:", err);
}

// --- Логика аватаров ---

function makeDraggable(element) {
    element.addEventListener('mousedown', (e) => {
        e.preventDefault();
        activeDrag = {
            element,
            offsetX: e.clientX - element.getBoundingClientRect().left,
            offsetY: e.clientY - element.getBoundingClientRect().top
        };
        element.classList.add('dragging'); 
    });
}

document.addEventListener('mousemove', (e) => {
    if (!activeDrag) return;
    e.preventDefault();
    const newX = e.clientX - activeDrag.offsetX;
    const newY = e.clientY - activeDrag.offsetY;

    activeDrag.element.style.left = `${newX}px`;
    activeDrag.element.style.top = `${newY}px`;
});

document.addEventListener('mouseup', (e) => {
    if (activeDrag) {
        activeDrag.element.classList.remove('dragging');
        activeDrag = null;
    }
});

function renderAvatars(characterIds) {
    const idSet = new Set(characterIds);

    // Удаляем аватары, которых больше нет в списке
    const existingAvatars = avatarsContainer.querySelectorAll('.character-avatar');
    existingAvatars.forEach(avatar => {
        if (!idSet.has(avatar.dataset.id)) {
            avatar.remove();
        }
    });

    // Добавляем или обновляем аватары
    characterIds.forEach((charId, index) => {
        let avatarElement = document.getElementById(`avatar-${charId}`);
        if (!avatarElement) {
            avatarElement = document.createElement('img');
            avatarElement.id = `avatar-${charId}`;
            avatarElement.dataset.id = charId;
            avatarElement.className = 'character-avatar';
            // Клиент сам конструирует путь к аватару
            avatarElement.src = `${API_BASE_URL}/assets/characters/${charId}.png`;
            
            // Обработчик ошибок загрузки изображения
            avatarElement.onerror = () => {
                // Удаляем обработчик, чтобы избежать бесконечного цикла, если и default.png отсутствует
                avatarElement.onerror = null; 
                console.warn(`Could not load avatar for ${charId}. Using default.`);
                avatarElement.src = `${API_BASE_URL}/assets/characters/default.png`; // Путь к аватару по умолчанию
            };

            // Начальное позиционирование
            avatarElement.style.left = `${100 + index * 120}px`;
            avatarElement.style.top = `100px`;

            avatarsContainer.appendChild(avatarElement);
            makeDraggable(avatarElement);
        }
    });
}

function subscribeToActiveCharacterUpdates() {
    const eventSource = new EventSource(`${API_BASE_URL}/api/active_characters_stream`);
    
    eventSource.addEventListener('active_characters_updated', function(event) {
        console.log("Received active characters update via SSE.");
        const characterIds = JSON.parse(event.data);
        renderAvatars(characterIds);
    });

    eventSource.onerror = function(err) {
        console.error("ActiveCharacters EventSource failed:", err);
    };
}

// --- Инициализация ---

async function main() {
    console.log("Spectator screen initializing...");

    // 1. Загрузка и настройка фона
    try {
        const response = await fetch(`${API_BASE_URL}/api/game_state`);
        const initialState = await response.json();
        updateBackground(initialState);
    } catch (error) {
        console.error("Failed to get initial game state:", error);
    }
    subscribeToGameStateUpdates();

    // 2. Загрузка и настройка аватаров
    try {
        const response = await fetch(`${API_BASE_URL}/api/active_characters`);
        const initialCharacterIds = await response.json(); // Получаем массив ID
        if(initialCharacterIds) renderAvatars(initialCharacterIds);
    } catch (error) {
       console.warn("Could not fetch initial active characters. This is expected if the list is empty.");
    }
    subscribeToActiveCharacterUpdates();
    
    console.log("Spectator screen initialized.");
}

main();
