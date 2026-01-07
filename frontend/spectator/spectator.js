const API_BASE_URL = 'http://127.0.0.1:8000';

// --- DOM Элементы ---
const backgroundContainer = document.getElementById('background-container');
const avatarsContainer = document.getElementById('avatars-container');

// --- Состояние для Drag-and-Drop ---
let activeDrag = null;

// --- Функции-обработчики данных ---

function updateBackground(gameState) {
    if (!gameState || !gameState.current_location) {
        backgroundContainer.style.backgroundImage = 'none';
        return;
    }
    const location = gameState.current_location;
    const imageUrl = `${API_BASE_URL}/${location.image_url}`;
    if (backgroundContainer.style.backgroundImage !== `url("${imageUrl}")`) {
        console.log(`SSE: Updating background to ${location.name}`);
        backgroundContainer.style.backgroundImage = `url('${imageUrl}')`;
    }
}

function renderAvatars(characterIds) {
    const idSet = new Set(characterIds);
    const existingAvatars = avatarsContainer.querySelectorAll('.character-avatar');
    existingAvatars.forEach(avatar => {
        if (!idSet.has(avatar.dataset.id)) { avatar.remove(); }
    });
    characterIds.forEach((charId, index) => {
        let avatarElement = document.getElementById(`avatar-${charId}`);
        if (!avatarElement) {
            avatarElement = document.createElement('img');
            avatarElement.id = `avatar-${charId}`;
            avatarElement.dataset.id = charId;
            avatarElement.className = 'character-avatar';
            avatarElement.src = `${API_BASE_URL}/assets/characters/${charId}.png`;
            avatarElement.onerror = () => {
                avatarElement.onerror = null;
                avatarElement.src = `${API_BASE_URL}/assets/characters/default.png`;
            };
            avatarElement.style.left = `${100 + index * 120}px`;
            avatarElement.style.top = `100px`;
            avatarsContainer.appendChild(avatarElement);
            makeDraggable(avatarElement);
        }
    });
}

function showSpeechBubble(characterId, text, type) {
    const avatar = document.getElementById(`avatar-${characterId}`);
    if (!avatar) {
        console.error(`Speech bubble error: Avatar for character ID '${characterId}' not found.`);
        return;
    }

    // --- ИСПРАВЛЕНИЕ СОГЛАСНО ВАШЕМУ ПРЕДЛОЖЕНИЮ ---
    // Логика поиска и удаления существующего пузыря полностью удалена.
    // Мы полагаемся только на setTimeout для очистки.

    const bubble = document.createElement('div');
    bubble.className = `speech-bubble ${type}`;
    bubble.dataset.character = characterId;
    bubble.textContent = text;
    document.body.appendChild(bubble);

    const avatarRect = avatar.getBoundingClientRect();

    // Позиционируем пузыри с небольшим смещением, чтобы они не перекрывали друг друга
    let topOffset = -10;
    if (type === 'thought') {
        topOffset = -90; // Размещаем пузырь с мыслями выше
    }

    bubble.style.left = `${avatarRect.left + avatarRect.width / 2 - bubble.offsetWidth / 2}px`;
    bubble.style.top = `${avatarRect.top - bubble.offsetHeight + topOffset}px`;

    // Устанавливаем таймер на удаление этого конкретного пузыря
    setTimeout(() => { bubble.remove(); }, 8000); // Время жизни пузыря 8 секунд
}

// --- НОВАЯ ЕДИНАЯ ПОДПИСКА НА СОБЫТИЯ --- 

function subscribeToSpectatorStream() {
    console.log("Connecting to the unified spectator stream...");
    const eventSource = new EventSource(`${API_BASE_URL}/api/spectator_stream`);

    eventSource.addEventListener('game_state_update', function(event) {
        const gameState = JSON.parse(event.data);
        updateBackground(gameState);
    });

    eventSource.addEventListener('active_characters_update', function(event) {
        const characterIds = JSON.parse(event.data);
        console.log('SSE: Received active characters update', characterIds);
        renderAvatars(characterIds);
    });

    eventSource.addEventListener('character_speech', function(event) {
        const speechData = JSON.parse(event.data);
        console.log('SSE: Received speech data', speechData);
        showSpeechBubble(speechData.character, speechData.text, speechData.type);
    });

    eventSource.onerror = function(err) {
        console.error("Spectator EventSource failed:", err);
        eventSource.close();
    };
}


// --- Drag and Drop для аватаров ---
function makeDraggable(element) {
    element.addEventListener('mousedown', (e) => {
        e.preventDefault();
        activeDrag = { element, offsetX: e.clientX - element.getBoundingClientRect().left, offsetY: e.clientY - element.getBoundingClientRect().top };
        element.classList.add('dragging');
    });
}
document.addEventListener('mousemove', (e) => {
    if (!activeDrag) return;
    e.preventDefault();
    activeDrag.element.style.left = `${e.clientX - activeDrag.offsetX}px`;
    activeDrag.element.style.top = `${e.clientY - activeDrag.offsetY}px`;
});
document.addEventListener('mouseup', () => {
    if (activeDrag) { activeDrag.element.classList.remove('dragging'); activeDrag = null; }
});


// --- Инициализация ---

async function main() {
    console.log("Spectator screen initializing...");

    try {
        const [gameStateRes, activeCharsRes] = await Promise.all([
            fetch(`${API_BASE_URL}/api/game_state`),
            fetch(`${API_BASE_URL}/api/active_characters`)
        ]);
        const initialState = await gameStateRes.json();
        const initialCharacterIds = await activeCharsRes.json();
        
        updateBackground(initialState);
        if(initialCharacterIds) renderAvatars(initialCharacterIds);

    } catch (error) {
        console.error("Failed to fetch initial data:", error);
    }

    subscribeToSpectatorStream();
    
    console.log("Spectator screen initialized and connected to stream.");
}

main();
