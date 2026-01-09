const API_BASE_URL = 'http://127.0.0.1:8000';

// --- DOM Элементы ---
const backgroundContainer = document.getElementById('background-container');
const avatarsContainer = document.getElementById('avatars-container');
const characterCardsContainer = document.getElementById('character-cards-container');
const characterModal = document.getElementById('character-modal');
const modalCharacterDetails = document.getElementById('modal-character-details');
const closeButton = document.querySelector('.close-button');
const diceRollContainer = document.getElementById('dice-roll-container');

// --- Новые переменные для управления очередью речи ---
let speechQueue = [];
let isPlayingSpeech = false;

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

function addOrUpdateCharacterCard(charId, charData) {
    let card = document.getElementById(`card-${charId}`);
    const identity = charData.identity || {};
    const stats = charData.stats || {};
    const meta = charData.meta || {};
    if (!card) {
        card = document.createElement('div');
        card.id = `card-${charId}`;
        card.className = 'character-card';
        card.dataset.id = charId;
        card.innerHTML = `
            <img src="" class="portrait"/>
            <div class="name">${identity.name || 'Unknown'}</div>
            <div class="model">${meta.model_id || 'N/A'}</div>
            <div class="stat-bar-container"><div class="stat-bar hp-bar"></div></div>
            <div class="stat-bar-container"><div class="stat-bar mp-bar"></div></div>
        `;
        characterCardsContainer.appendChild(card);
        card.addEventListener('click', () => openCharacterModal(charId, charData));
    }
    card.onclick = () => openCharacterModal(charId, charData);
    card.querySelector('.model').textContent = meta.model_id || 'N/A';
    const portrait = card.querySelector('.portrait');
    const newPortraitSrc = `${API_BASE_URL}/assets/characters/${meta.sprite_id}`;
    if (portrait.src !== newPortraitSrc) {
        portrait.src = newPortraitSrc;
        portrait.onerror = () => { portrait.onerror = null; portrait.src = `${API_BASE_URL}/assets/characters/default_portrait.png`; };
    }
    const hp = stats.hp?.current || 0, maxHp = stats.hp?.max || 100;
    const mp = stats.mp?.current || 0, maxMp = stats.mp?.max || 100;
    card.querySelector('.hp-bar').style.width = `${maxHp > 0 ? (hp / maxHp) * 100 : 0}%`;
    card.querySelector('.mp-bar').style.width = `${maxMp > 0 ? (mp / maxMp) * 100 : 0}%`;
}

function openCharacterModal(charId, charData) {
    const { identity = {}, stats = {}, meta = {}, inventory = [] } = charData;
    const { hp = {}, mp = {}, attributes = {}, status_effects = [] } = stats;
    const hpPercentage = (hp.max || 100) > 0 ? ((hp.current || 0) / hp.max) * 100 : 0;
    const mpPercentage = (mp.max || 100) > 0 ? ((mp.current || 0) / mp.max) * 100 : 0;
    modalCharacterDetails.innerHTML = `
        <div class="modal-left-column">
            <img src="${API_BASE_URL}/assets/characters/${meta.sprite_id}" class="modal-portrait" onerror="this.onerror=null; this.src='${API_BASE_URL}/assets/characters/default_portrait.png'"/>
            <div class="modal-character-name">${identity.name || 'Unknown'}</div>
            <div class="modal-stat-bar-container">
                <div class="modal-stat-bar modal-hp-bar" style="width: ${hpPercentage}%;"></div>
                <div class="stat-text">${hp.current || 0} / ${hp.max || 100}</div>
            </div>
            <div class="modal-stat-bar-container">
                <div class="modal-stat-bar modal-mp-bar" style="width: ${mpPercentage}%;"></div>
                <div class="stat-text">${mp.current || 0} / ${mp.max || 100}</div>
            </div>
        </div>
        <div class="modal-right-column">
            <div class="modal-section-title">Biography</div><p class="modal-bio">${identity.bio || 'N/A'}</p>
            <div class="modal-section-title">Attributes</div><div class="modal-attributes-grid">${Object.entries(attributes).map(([k, v]) => `<div><strong>${k}:</strong> ${v}</div>`).join('')}</div>
            <div class="modal-section-title">Status Effects</div><ul class="modal-list">${status_effects.length ? status_effects.map(e => `<li>${e}</li>`).join('') : '<li>None</li>'}</ul>
            <div class="modal-section-title">Inventory</div><ul class="modal-list modal-inventory-list">${inventory.length ? inventory.map(i => `<li><strong>${i.name}</strong> (x${i.quantity})<br><small>${i.description || ''}</small></li>`).join('') : '<li>Empty</li>'}</ul>
        </div>`;
    characterModal.style.display = 'flex';
}

closeButton.onclick = () => { characterModal.style.display = "none"; };
window.onclick = (event) => { if (event.target == characterModal) characterModal.style.display = "none"; };

function renderAvatars(characterIds) {
    const idSet = new Set(characterIds);
    document.querySelectorAll('.character-wrapper').forEach(w => { if (!idSet.has(w.dataset.id)) { w.remove(); document.getElementById(`card-${w.dataset.id}`)?.remove(); } });
    characterIds.forEach((charId, index) => {
        if (!document.getElementById(`wrapper-${charId}`)) {
            const wrapper = document.createElement('div');
            wrapper.id = `wrapper-${charId}`;
            wrapper.dataset.id = charId;
            wrapper.className = 'character-wrapper';
            const avatar = document.createElement('img');
            avatar.id = `avatar-${charId}`;
            avatar.className = 'character-avatar';
            avatar.src = `${API_BASE_URL}/assets/characters/${charId}.png`;
            avatar.onerror = () => { avatar.onerror = null; avatar.src = `${API_BASE_URL}/assets/characters/default.png`; };
            wrapper.append(avatar);
            wrapper.style.left = `${100 + index * 150}px`;
            wrapper.style.top = `100px`;
            avatarsContainer.appendChild(wrapper);
            makeDraggable(wrapper);
        }
    });
}

// vvvvvv НАЧАЛО ИЗМЕНЕНИЙ vvvvvv

function showSpeechBubble(characterId, text, type) {
    const wrapper = document.getElementById(`wrapper-${characterId}`);
    if (!wrapper) {
        console.error(`Speech bubble error: Wrapper for character ID '${characterId}' not found.`);
        return null;
    }
    const bubble = document.createElement('div');
    bubble.className = `speech-bubble ${type}`;
    bubble.textContent = text;
    wrapper.appendChild(bubble);
    if (type === 'thought') {
        bubble.style.bottom = '280px';
    } else {
        bubble.style.bottom = '280px';
    }
    return bubble; // Возвращаем элемент, чтобы им можно было управлять
}

function processSpeechQueue() {
    if (isPlayingSpeech || speechQueue.length === 0) return;

    isPlayingSpeech = true;
    const speechData = speechQueue.shift();

    const bubbleElement = showSpeechBubble(speechData.character, speechData.text, speechData.type);
    if (!bubbleElement) {
        isPlayingSpeech = false;
        return; // Прерываем, если не удалось создать "пузырь"
    }

    if (speechData.audio_url) {
        const audio = new Audio(`${API_BASE_URL}/${speechData.audio_url}`);
        
        audio.onended = () => {
            bubbleElement.remove();
            if (speechData.type === 'thought') {
                setTimeout(() => {
                    isPlayingSpeech = false;
                    processSpeechQueue();
                }, 1000); // Пауза 1 секунда после мысли
            } else {
                isPlayingSpeech = false;
                processSpeechQueue(); // Сразу обработать следующее
            }
        };

        audio.onerror = () => {
            console.error("Audio file not found or failed to load:", audio.src);
            bubbleElement.remove();
            isPlayingSpeech = false;
            processSpeechQueue();
        };

        audio.play().catch(error => {
            console.error("Error playing audio:", error);
            bubbleElement.remove();
            isPlayingSpeech = false;
            processSpeechQueue();
        });

    } else {
        // Если аудио нет, просто показываем на 8 секунд
        setTimeout(() => {
            bubbleElement.remove();
            isPlayingSpeech = false;
            processSpeechQueue();
        }, 8000);
    }
}

// ^^^^^^ КОНЕЦ ИЗМЕНЕНИЙ ^^^^^^

function showDiceRoll(rollValue) {
    if (!diceRollContainer) return;
    const rollElement = document.createElement('div');
    rollElement.className = 'dice-roll';
    rollElement.textContent = rollValue;
    diceRollContainer.appendChild(rollElement);
    setTimeout(() => { rollElement.classList.add('visible'); }, 10);
    setTimeout(() => {
        rollElement.classList.remove('visible');
        setTimeout(() => { rollElement.remove(); }, 500);
    }, 4000);
}

function subscribeToSpectatorStream() {
    console.log("Connecting to the unified spectator stream...");
    const eventSource = new EventSource(`${API_BASE_URL}/api/spectator_stream`);

    eventSource.addEventListener('game_state_update', (event) => updateBackground(JSON.parse(event.data)));
    eventSource.addEventListener('active_characters_update', (event) => renderAvatars(JSON.parse(event.data)));
    eventSource.addEventListener('character_full_update', (event) => { const u = JSON.parse(event.data); addOrUpdateCharacterCard(u.id, u.data); });
    eventSource.addEventListener('dice_roll', (event) => showDiceRoll(JSON.parse(event.data).roll));

    // vvvvvv НАЧАЛО ИЗМЕНЕНИЙ vvvvvv
    eventSource.addEventListener('character_speech', function(event) {
        const speechData = JSON.parse(event.data);
        console.log('SSE: Queuing speech data', speechData);
        speechQueue.push(speechData);
        processSpeechQueue();
    });
    // ^^^^^^ КОНЕЦ ИЗМЕНЕНИЙ ^^^^^^

    eventSource.onerror = (err) => { console.error("Spectator EventSource failed:", err); eventSource.close(); };
}

function makeDraggable(element) {
    element.addEventListener('mousedown', (e) => { e.preventDefault(); activeDrag = { element, offsetX: e.clientX - element.getBoundingClientRect().left, offsetY: e.clientY - element.getBoundingClientRect().top }; element.classList.add('dragging'); });
}
document.addEventListener('mousemove', (e) => { if (!activeDrag) return; e.preventDefault(); activeDrag.element.style.left = `${e.clientX - activeDrag.offsetX}px`; activeDrag.element.style.top = `${e.clientY - activeDrag.offsetY}px`; });
document.addEventListener('mouseup', () => { if (activeDrag) { activeDrag.element.classList.remove('dragging'); activeDrag = null; } });

async function main() {
    console.log("Spectator screen initializing...");
    try {
        const [gameStateRes, activeCharsRes] = await Promise.all([ fetch(`${API_BASE_URL}/api/game_state`), fetch(`${API_BASE_URL}/api/active_characters`) ]);
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
