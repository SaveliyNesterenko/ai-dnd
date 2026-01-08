const API_BASE_URL = 'http://127.0.0.1:8000';

// --- DOM Элементы ---
const backgroundContainer = document.getElementById('background-container');
const avatarsContainer = document.getElementById('avatars-container');
const characterCardsContainer = document.getElementById('character-cards-container');
const characterModal = document.getElementById('character-modal');
const modalCharacterDetails = document.getElementById('modal-character-details');
const closeButton = document.querySelector('.close-button');


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

function addOrUpdateCharacterCard(characterData) {
    let card = document.getElementById(`card-${characterData.id}`);

    if (!card) {
        card = document.createElement('div');
        card.id = `card-${characterData.id}`;
        card.className = 'character-card';
        card.dataset.id = characterData.id;

        card.innerHTML = `
            <img src="${API_BASE_URL}/assets/characters/${characterData.sprite_id}_portrait.png" class="portrait"/>
            <div class="name">${characterData.name}</div>
            <div class="model">${characterData.model_id}</div>
            <div class="stat-bar-container">
                <div class="stat-bar hp-bar"></div>
            </div>
            <div class="stat-bar-container">
                <div class="stat-bar mp-bar"></div>
            </div>
        `;

        card.addEventListener('click', () => openCharacterModal(characterData));
        characterCardsContainer.appendChild(card);
    }

    const hpPercentage = (characterData.hp / characterData.max_hp) * 100;
    const mpPercentage = (characterData.mp / characterData.max_mp) * 100;

    card.querySelector('.hp-bar').style.width = `${hpPercentage}%`;
    card.querySelector('.mp-bar').style.width = `${mpPercentage}%`;
}

function openCharacterModal(characterData) {
    modalCharacterDetails.innerHTML = `
        <h2>${characterData.name}</h2>
        <p><strong>Model:</strong> ${characterData.model_id}</p>
        <p><strong>HP:</strong> ${characterData.hp} / ${characterData.max_hp}</p>
        <p><strong>MP:</strong> ${characterData.mp} / ${characterData.max_mp}</p>
        <p><strong>Attributes:</strong></p>
        <ul>
            ${Object.entries(characterData.attributes).map(([key, value]) => `<li><strong>${key}:</strong> ${value}</li>`).join('')}
        </ul>
        <p><strong>Status Effects:</strong></p>
        <ul>
            ${characterData.status_effects.map(effect => `<li>${effect}</li>`).join('')}
        </ul>
        <p><strong>Inventory:</strong></p>
        <ul>
            ${characterData.inventory.map(item => `<li>${item}</li>`).join('')}
        </ul>
    `;
    characterModal.style.display = 'block';
}

closeButton.onclick = function() {
    characterModal.style.display = "none";
}

window.onclick = function(event) {
    if (event.target == characterModal) {
        characterModal.style.display = "none";
    }
}

function renderAvatars(characterIds) {
    const idSet = new Set(characterIds);
    const existingWrappers = avatarsContainer.querySelectorAll('.character-wrapper');
    existingWrappers.forEach(wrapper => {
        if (!idSet.has(wrapper.dataset.id)) { 
            wrapper.remove(); 
            const card = document.getElementById(`card-${wrapper.dataset.id}`);
            if (card) {
                card.remove();
            }
        }
    });

    characterIds.forEach((charId, index) => {
        let wrapperElement = document.getElementById(`wrapper-${charId}`);
        if (!wrapperElement) {
            wrapperElement = document.createElement('div');
            wrapperElement.id = `wrapper-${charId}`;
            wrapperElement.dataset.id = charId;
            wrapperElement.className = 'character-wrapper';

            const avatarElement = document.createElement('img');
            avatarElement.id = `avatar-${charId}`;
            avatarElement.className = 'character-avatar';
            avatarElement.src = `${API_BASE_URL}/assets/characters/${charId}.png`;
            avatarElement.onerror = () => {
                avatarElement.onerror = null;
                avatarElement.src = `${API_BASE_URL}/assets/characters/default.png`;
            };

            wrapperElement.appendChild(avatarElement);

            wrapperElement.style.left = `${100 + index * 150}px`;
            wrapperElement.style.top = `100px`;
            avatarsContainer.appendChild(wrapperElement);

            makeDraggable(wrapperElement);
        }
    });
}

function showSpeechBubble(characterId, text, type) {
    const wrapper = document.getElementById(`wrapper-${characterId}`);
    if (!wrapper) {
        console.error(`Speech bubble error: Wrapper for character ID '${characterId}' not found.`);
        return;
    }

    const bubble = document.createElement('div');
    bubble.className = `speech-bubble ${type}`;
    bubble.textContent = text;
    
    wrapper.appendChild(bubble);

    if (type === 'thought') {
        bubble.style.bottom = '280px';
    } else {
        bubble.style.bottom = '250px';
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
    
    eventSource.addEventListener('character_full_update', function(event) {
        const characterData = JSON.parse(event.data);
        console.log('SSE: Received character full update', characterData);
        addOrUpdateCharacterCard(characterData);
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
    if (activeDrag) {
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
