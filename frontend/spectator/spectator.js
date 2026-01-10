const API_BASE_URL = 'http://127.0.0.1:8000';

// --- DOM Элементы ---
const backgroundContainer = document.getElementById('background-container');
const avatarsContainer = document.getElementById('avatars-container');
const characterCardsContainer = document.getElementById('character-cards-container');
const characterModal = document.getElementById('character-modal');
const modalCharacterDetails = document.getElementById('modal-character-details');
const closeButton = document.querySelector('.close-button');
const diceRollContainer = document.getElementById('dice-roll-container');

// --- Новая система управления очередью и состоянием речи ---
let speechQueue = [];
let speechDataStore = {};
let isProcessingQueue = false;
let currentAnimationId = null;

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
        backgroundContainer.style.backgroundImage = `url('${imageUrl}')`;
    }
}

// vvvvvv ИСПРАВЛЕНИЕ КАРТОЧКИ ПЕРСОНАЖА vvvvvv
function addOrUpdateCharacterCard(charId, charData) {
    let card = document.getElementById(`card-${charId}`);
    const { identity = {}, stats = {}, meta = {} } = charData;
    if (!card) {
        card = document.createElement('div');
        card.id = `card-${charId}`;
        card.className = 'character-card';
        card.dataset.id = charId;
        // ВОЗВРАЩАЕМ DIV ДЛЯ МОДЕЛИ
        card.innerHTML = `
            <img src="" class="portrait"/>
            <div class="name">${identity.name || 'Unknown'}</div>
            <div class="model">${meta.model_id || 'N/A'}</div>
            <div class="stat-bar-container"><div class="stat-bar hp-bar"></div></div>
            <div class="stat-bar-container"><div class="stat-bar mp-bar"></div></div>
        `;
        characterCardsContainer.appendChild(card);
        card.addEventListener('click', () => openCharacterModal(charId));
    }
    card.onclick = () => openCharacterModal(charId);
    // ВОЗВРАЩАЕМ ЛОГИКУ ОБНОВЛЕНИЯ МОДЕЛИ
    card.querySelector('.model').textContent = meta.model_id || 'N/A'; 
    const portrait = card.querySelector('.portrait');
    const newPortraitSrc = `${API_BASE_URL}/assets/characters/${meta.sprite_id}`;
    if (portrait.src !== newPortraitSrc) {
        portrait.src = newPortraitSrc;
        portrait.onerror = () => { portrait.src = `${API_BASE_URL}/assets/characters/default_portrait.png`; };
    }
    const hp = stats.hp?.current || 0, maxHp = stats.hp?.max || 100;
    const mp = stats.mp?.current || 0, maxMp = stats.mp?.max || 100;
    card.querySelector('.hp-bar').style.width = `${maxHp > 0 ? (hp / maxHp) * 100 : 0}%`;
    card.querySelector('.mp-bar').style.width = `${maxMp > 0 ? (mp / maxMp) * 100 : 0}%`;
}
// ^^^^^^ КОНЕЦ ИСПРАВЛЕНИЯ ^^^^^^

async function openCharacterModal(charId) {
    const response = await fetch(`${API_BASE_URL}/api/all_characters`);
    const allChars = await response.json();
    const charData = allChars[charId];
    if (!charData) return;

    const { identity = {}, stats = {}, meta = {}, inventory = [] } = charData;
    const { hp = {}, mp = {}, attributes = {}, status_effects = [] } = stats;
    const hpPercentage = (hp.max || 100) > 0 ? ((hp.current || 0) / hp.max) * 100 : 0;
    const mpPercentage = (mp.max || 100) > 0 ? ((mp.current || 0) / mp.max) * 100 : 0;
    modalCharacterDetails.innerHTML = `
        <div class="modal-left-column">
            <img src="${API_BASE_URL}/assets/characters/${meta.sprite_id}" class="modal-portrait" onerror="this.onerror=null; this.src='${API_BASE_URL}/assets/characters/default_portrait.png'"/>
            <div class="modal-character-name">${identity.name || 'Unknown'}</div>
            <div class="modal-stat-bar-container"><div class="modal-stat-bar modal-hp-bar" style="width: ${hpPercentage}%;"></div><div class="stat-text">${hp.current || 0}/${hp.max || 100}</div></div>
            <div class="modal-stat-bar-container"><div class="modal-stat-bar modal-mp-bar" style="width: ${mpPercentage}%;"></div><div class="stat-text">${mp.current || 0}/${mp.max || 100}</div></div>
        </div>
        <div class="modal-right-column">
            <div class="modal-section-title">Biography</div><p class="modal-bio">${identity.bio || 'N/A'}</p>
            <div class="modal-section-title">Attributes</div><div class="modal-attributes-grid">${Object.entries(attributes).map(([k, v]) => `<div><strong>${k}:</strong> ${v}</div>`).join('')}</div>
            <div class="modal-section-title">Status Effects</div><ul class="modal-list">${status_effects.length ? status_effects.map(e => `<li>${e}</li>`).join('') : '<li>None</li>'}</ul>
            <div class="modal-section-title">Inventory</div><ul class="modal-list modal-inventory-list">${inventory.length ? inventory.map(i => `<li><strong>${i.name}</strong>(x${i.quantity})<br><small>${i.description || ''}</small></li>`).join('') : '<li>Empty</li>'}</ul>
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
            avatar.onerror = () => { avatar.src = `${API_BASE_URL}/assets/characters/default.png`; };
            wrapper.append(avatar);
            wrapper.style.left = `${100 + index * 150}px`;
            wrapper.style.top = `100px`;
            avatarsContainer.appendChild(wrapper);
            makeDraggable(wrapper);
        }
    });
}

// --- Новая логика озвучки ---

function showSpeechBubble(characterId, text, type) {
    const charWrapper = document.getElementById(`wrapper-${characterId}`);
    if (!charWrapper) return null;
    const bubbleWrapper = document.createElement('div');
    bubbleWrapper.className = `speech-bubble ${type}`;
    bubbleWrapper.style.bottom = '280px';
    const bubbleContent = document.createElement('div');
    bubbleContent.className = 'speech-bubble-content';
    bubbleContent.textContent = text;
    bubbleWrapper.appendChild(bubbleContent);
    charWrapper.appendChild(bubbleWrapper);
    return { wrapper: bubbleWrapper, content: bubbleContent };
}

function animateScrollTransform(wrapper, content, duration) {
    requestAnimationFrame(() => {
        const distance = content.offsetHeight - wrapper.offsetHeight;
        if (distance <= 0) return;
        let startTime = null;
        function step(timestamp) {
            if (!startTime) startTime = timestamp;
            const elapsed = timestamp - startTime;
            const progress = Math.min(elapsed / (duration * 1000), 1);
            content.style.transform = `translate3d(0, ${-distance * progress}px, 0)`;
            if (progress < 1) {
                currentAnimationId = requestAnimationFrame(step);
            }
        }
        currentAnimationId = requestAnimationFrame(step);
    });
}

function playPart(step, type) {
    return new Promise(async (resolve) => {
        let partData;
        while (!(partData = speechDataStore[step]?.[type]) || !partData.text || !partData.audio_url) {
            await new Promise(r => setTimeout(r, 100));
        }

        const characterId = speechDataStore[step].character;
        const bubbleElements = showSpeechBubble(characterId, partData.text, type);
        if (!bubbleElements) {
            console.error(`Could not create speech bubble for ${characterId}.`);
            resolve();
            return;
        }

        const audio = new Audio(`${API_BASE_URL}/${partData.audio_url}`);
        
        const cleanupAndResolve = () => {
            if (currentAnimationId) cancelAnimationFrame(currentAnimationId);
            currentAnimationId = null;
            bubbleElements.wrapper.remove();
            if (type === 'thought') {
                setTimeout(resolve, 1000);
            } else {
                resolve();
            }
        };

        audio.onloadedmetadata = () => {
            animateScrollTransform(bubbleElements.wrapper, bubbleElements.content, audio.duration);
            audio.play().catch(e => {
                console.error("Error playing audio:", e);
                cleanupAndResolve();
            });
        };
        
        audio.onended = cleanupAndResolve;
        audio.onerror = (e) => { 
            console.error("Audio error:", e.message);
            cleanupAndResolve();
        };
    });
}

async function processSpeechQueue() {
    if (isProcessingQueue || speechQueue.length === 0) return;
    isProcessingQueue = true;

    const step = speechQueue.shift();
    console.log(`Processing step ${step}`);

    if (speechDataStore[step]?.thought) {
        await playPart(step, 'thought');
    }
    if (speechDataStore[step]?.action) {
        await playPart(step, 'action');
    }

    console.log(`Finished processing step ${step}`);
    isProcessingQueue = false;
    processSpeechQueue();
}


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

    eventSource.addEventListener('game_state_update', (e) => updateBackground(JSON.parse(e.data)));
    eventSource.addEventListener('active_characters_update', (e) => renderAvatars(JSON.parse(e.data)));
    eventSource.addEventListener('character_full_update', (e) => { const u = JSON.parse(e.data); addOrUpdateCharacterCard(u.id, u.data); });
    eventSource.addEventListener('dice_roll', (e) => showDiceRoll(JSON.parse(e.data).roll));

    eventSource.addEventListener('text_update', (e) => {
        const data = JSON.parse(e.data);
        const { step, character, type, text } = data;

        if (!speechDataStore[step]) {
            speechDataStore[step] = { character: character };
            speechQueue.push(step);
        }
        if (!speechDataStore[step][type]) {
            speechDataStore[step][type] = {};
        }
        speechDataStore[step][type].text = text;
        console.log(`Cached text for step ${step}, type ${type}`);
        processSpeechQueue();
    });

    eventSource.addEventListener('audio_update', (e) => {
        const data = JSON.parse(e.data);
        const { step, type, audio_url } = data;
        if (speechDataStore[step] && speechDataStore[step][type]) {
            speechDataStore[step][type].audio_url = audio_url;
            console.log(`Cached audio_url for step ${step}, type ${type}`);
        } else {
            if (!speechDataStore[step]) speechDataStore[step] = {};
            if (!speechDataStore[step][type]) speechDataStore[step][type] = {};
            speechDataStore[step][type].audio_url = audio_url;
        }
    });

    eventSource.onerror = (err) => { console.error("SSE failed:", err); eventSource.close(); };
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
