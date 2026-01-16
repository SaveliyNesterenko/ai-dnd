import { fetchCharacterData } from './api.js';
import { API_BASE_URL } from './api.js';

const backgroundContainer = document.getElementById('background-container');
const avatarsContainer = document.getElementById('avatars-container');
const characterCardsContainer = document.getElementById('character-cards-container');
const characterModal = document.getElementById('character-modal');
const modalCharacterDetails = document.getElementById('modal-character-details');
const closeButton = document.querySelector('.close-button');
const diceRollContainer = document.getElementById('dice-roll-container');

let currentAnimationId = null;
let currentAvatarSize = null; // Variable to store the current avatar size

// Helper function to apply avatar size to all character avatars
function applyAvatarSize(size) {
    const avatars = document.querySelectorAll('.character-avatar');
    avatars.forEach(avatar => {
        avatar.style.width = `${size}px`;
        avatar.style.height = `${size}px`;
    });
    currentAvatarSize = size;
}

export function updateBackground(gameState) {
    if (!gameState) return;

    // Update background image
    if (gameState.current_location) {
        const location = gameState.current_location;
        const imageUrl = `${API_BASE_URL}/${location.image_url}`;
        if (backgroundContainer.style.backgroundImage !== `url("${imageUrl}")`) {
            backgroundContainer.style.backgroundImage = `url('${imageUrl}')`;
        }
    } else {
        backgroundContainer.style.backgroundImage = 'none';
    }

    // Update avatar size if it has changed
    const newSize = gameState.avatar_size;
    if (newSize && newSize !== currentAvatarSize) {
        applyAvatarSize(newSize);
    }
}

export function addOrUpdateCharacterCard(charId, charData) {
    let card = document.getElementById(`card-${charId}`);
    const { identity = {}, stats = {}, meta = {} } = charData;
    
    const modelId = meta.model_id || 'N/A';
    const displayModelName = modelId.includes('/') ? modelId.split('/').pop() : modelId;

    if (!card) {
        card = document.createElement('div');
        card.id = `card-${charId}`;
        card.className = 'character-card';
        card.dataset.id = charId;
        card.innerHTML = `
            <img src="" class="portrait"/>
            <div class="name">${identity.name || 'Unknown'}</div>
            <div class="model">${displayModelName}</div>
            <div class="stat-bar-container"><div class="stat-bar hp-bar"></div></div>
            <div class="stat-bar-container"><div class="stat-bar mp-bar"></div></div>
        `;
        characterCardsContainer.appendChild(card);
        card.addEventListener('click', () => openCharacterModal(charId));
    }
    card.onclick = () => openCharacterModal(charId);
    
    card.querySelector('.model').textContent = displayModelName;
    card.querySelector('.name').textContent = identity.name || 'Unknown';

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

async function openCharacterModal(charId) {
    const charData = await fetchCharacterData(charId);
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

export function renderAvatars(characterIds, makeDraggable) {
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

            // Apply the current avatar size when creating a new avatar
            if (currentAvatarSize) {
                avatar.style.width = `${currentAvatarSize}px`;
                avatar.style.height = `${currentAvatarSize}px`;
            }

            wrapper.append(avatar);
            wrapper.style.left = `${100 + index * 150}px`;
            wrapper.style.top = `100px`;
            avatarsContainer.appendChild(wrapper);
            makeDraggable(wrapper);
        }
    });
}

export function showSpeechBubble(characterId, text, type) {
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

export function animateScrollTransform(wrapper, content, duration) {
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

export function showDiceRoll(rollValue) {
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

export function stopAnimations() {
    if (currentAnimationId) {
        cancelAnimationFrame(currentAnimationId);
        currentAnimationId = null;
    }
}
