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

// --- РЕФАКТОРИНГ: Шаг 1 --- 
function renderAvatars(characterIds) {
    const idSet = new Set(characterIds);
    // Ищем обертки, а не аватары
    const existingWrappers = avatarsContainer.querySelectorAll('.character-wrapper');
    existingWrappers.forEach(wrapper => {
        if (!idSet.has(wrapper.dataset.id)) { wrapper.remove(); }
    });

    characterIds.forEach((charId, index) => {
        // Ищем обертку, а не сам аватар
        let wrapperElement = document.getElementById(`wrapper-${charId}`);
        if (!wrapperElement) {
            // 1. Создаем DIV-обертку
            wrapperElement = document.createElement('div');
            wrapperElement.id = `wrapper-${charId}`;
            wrapperElement.dataset.id = charId;
            wrapperElement.className = 'character-wrapper';

            // 2. Создаем IMG аватара
            const avatarElement = document.createElement('img');
            avatarElement.id = `avatar-${charId}`; // ID для картинки сохраняется
            avatarElement.className = 'character-avatar'; // Класс для стилей картинки
            avatarElement.src = `${API_BASE_URL}/assets/characters/${charId}.png`;
            avatarElement.onerror = () => {
                avatarElement.onerror = null;
                avatarElement.src = `${API_BASE_URL}/assets/characters/default.png`;
            };

            // 3. Собираем вместе: IMG кладется внутрь DIV
            wrapperElement.appendChild(avatarElement);

            // 4. Позиционируем и добавляем на сцену ОБЕРТКУ
            wrapperElement.style.left = `${100 + index * 150}px`; // Немного увеличим отступ
            wrapperElement.style.top = `100px`;
            avatarsContainer.appendChild(wrapperElement);

            // 5. Делаем перетаскиваемой ОБЕРТКУ
            makeDraggable(wrapperElement);
        }
    });
}

// --- РЕФАКТОРИНГ: Шаг 2 ---
function showSpeechBubble(characterId, text, type) {
    // 1. Находим главную ОБЕРТКУ персонажа
    const wrapper = document.getElementById(`wrapper-${characterId}`);
    if (!wrapper) {
        console.error(`Speech bubble error: Wrapper for character ID '${characterId}' not found.`);
        return;
    }

    const bubble = document.createElement('div');
    bubble.className = `speech-bubble ${type}`;
    bubble.textContent = text;
    
    // 2. Добавляем пузырь ВНУТРЬ обертки, а не в body
    wrapper.appendChild(bubble);

    // 3. Логика позиционирования теперь намного проще!
    // Она рассчитывается относительно аватара внутри обертки.
    // Мы просто сдвигаем пузырь вверх.
    if (type === 'thought') {
        bubble.style.bottom = '280px'; // Мысли выше
    } else {
        bubble.style.bottom = '250px'; // Действия ниже
    }

    setTimeout(() => { bubble.remove(); }, 8000);
}


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

// --- РЕФАКТОРИНГ: Шаг 3 (изменения минимальны, но важны) ---
function makeDraggable(element) { // Теперь element - это wrapper
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
    if (activeDrag) {
        // Убираем класс .dragging с обертки
        activeDrag.element.classList.remove('dragging'); 
        activeDrag = null; 
    }
});


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
