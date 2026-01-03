
document.addEventListener("DOMContentLoaded", () => {
    const panels = {
        "top-panel": "panels/top-panel.html",
        "left-panel": "panels/left-panel.html",
        "center-panel": "panels/center-panel.html",
        "right-panel": "panels/right-panel.html",
        "bottom-panel": "panels/bottom-panel.html"
    };

    // --- Global State ---
    let allCharactersData = {}; // Cache for all character data (PCs and NPCs)
    const visibleCharacterIds = new Set(); // IDs of characters currently visible

    // --- Core Logic ---

    function toggleCharacterCard(characterId) {
        const container = document.querySelector('#bottom-panel .characters-container');
        if (!container || !characterId) return;

        // Deselect the option in the dropdown after selection
        const selectElements = [document.getElementById('character-select'), document.getElementById('npc-select')];
        selectElements.forEach(select => {
            if (select) select.selectedIndex = 0;
        });

        if (visibleCharacterIds.has(characterId)) {
            // If card is visible, remove it
            const cardToRemove = container.querySelector(`[data-char-key="${characterId}"]`);
            if (cardToRemove) container.removeChild(cardToRemove);
            visibleCharacterIds.delete(characterId);
        } else {
            // If card is not visible, add it
            const charData = allCharactersData[characterId];
            if (!charData) return;

            const card = document.createElement('div');
            card.className = 'character-card';
            card.dataset.charKey = characterId;

            // Set background image
            if (charData.meta && charData.meta.sprite_id) {
                card.style.backgroundImage = `url(../../assets/characters/${charData.meta.sprite_id}.png)`;
            }

            const name = charData.identity ? charData.identity.name : 'Unknown';
            const role = charData.meta ? charData.meta.role : 'No Role';
            
            let statsHtml = '';
            if (charData.stats) {
                const hp = charData.stats.hp ? `${charData.stats.hp.current} / ${charData.stats.hp.max}` : 'N/A';
                const mp = charData.stats.mp ? `${charData.stats.mp.current} / ${charData.stats.mp.max}` : 'N/A';
                statsHtml = `
                    <div class="stat-item"><span>HP</span><span>${hp}</span></div>
                    <div class="stat-item"><span>MP</span><span>${mp}</span></div>
                `;
            }

            card.innerHTML = `
                <div class="card-content">
                    <h3>${name}</h3>
                    <p class="role">${role}</p>
                    <div class="stats-grid">
                        ${statsHtml}
                    </div>
                    <div class="card-buttons">
                        <button class="card-btn" title="Attributes">&#9733;</button>
                        <button class="card-btn" title="Status Effects">&#9881;</button>
                        <button class="card-btn" title="Inventory">&#127890;</button>
                    </div>
                </div>
            `;
            
            container.appendChild(card);
            visibleCharacterIds.add(characterId);
        }
    }

    function handleDropdownChange(event) {
        const selectedId = event.target.value;
        toggleCharacterCard(selectedId);
    }

    // --- Panel Initializers ---

    function initializeCenterPanel() {
        const sendBtn = document.getElementById('sendBtn');
        const charInput = document.getElementById('charKey');
        const outputArea = document.getElementById('modelOutput');
        if (!sendBtn || !charInput || !outputArea) return;

        sendBtn.addEventListener('click', async () => {
            const charKey = charInput.value.trim();
            if (!charKey) {
                alert("Пожалуйста, введите ID персонажа!");
                return;
            }
            sendBtn.disabled = true;
            sendBtn.textContent = "Думаю...";
            outputArea.value = "Запрос отправлен к модели...";
            try {
                const response = await fetch('http://127.0.0.1:8000/act', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ character_key: charKey })
                });
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.detail || `Ошибка сервера: ${response.status}`);
                }
                const data = await response.json();
                outputArea.value = data.response;
            } catch (error) {
                console.error('Ошибка:', error);
                outputArea.value = "ПРОИЗОШЛА ОШИБКА:\n" + error.message;
            } finally {
                sendBtn.disabled = false;
                sendBtn.textContent = "Сгенерировать ответ";
            }
        });
    }

    async function initializeTopPanel() {
        const populateSelect = async (url, selectId, defaultText) => {
            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Failed to load from ${url}`);
                const data = await response.json();
                const select = document.getElementById(selectId);
                if (!select) return;
                select.innerHTML = `<option disabled selected>${defaultText}</option>`;
                for (const key in data) {
                    const item = data[key];
                    const option = document.createElement('option');
                    option.value = key;
                    option.textContent = item.identity.name;
                    select.appendChild(option);
                }
            } catch (error) {
                console.error(`Error populating ${selectId}:`, error);
            }
        };

        await populateSelect('http://127.0.0.1:8000/api/characters', 'character-select', 'Characters');
        await populateSelect('http://127.0.0.1:8000/api/npcs', 'npc-select', 'NPCs');

        document.getElementById('character-select')?.addEventListener('change', handleDropdownChange);
        document.getElementById('npc-select')?.addEventListener('change', handleDropdownChange);
    }

    function initializeBottomPanel() {
        const container = document.querySelector('#bottom-panel .characters-container');
        if (container) {
            container.addEventListener('click', (event) => {
                const card = event.target.closest('.character-card');
                if (card) {
                    const charKeyInput = document.getElementById('charKey');
                    if (charKeyInput) charKeyInput.value = card.dataset.charKey;
                }
            });

            container.addEventListener('wheel', (event) => {
                if (event.deltaY !== 0) {
                    event.preventDefault();
                    container.scrollLeft += event.deltaY;
                }
            });
        }
    }

    // --- Main Execution Flow ---

    function loadPanel(panelId, url) {
        fetch(url)
            .then(response => response.ok ? response.text() : Promise.reject(`HTTP error! Status: ${response.status}`))
            .then(html => {
                const panelElement = document.getElementById(panelId);
                if (!panelElement) return;
                panelElement.innerHTML = html;

                // Initialize panel-specific logic after its HTML is loaded
                if (panelId === "center-panel") initializeCenterPanel();
                if (panelId === "top-panel") initializeTopPanel();
                if (panelId === "bottom-panel") initializeBottomPanel();
            })
            .catch(err => console.warn(`Could not load panel ${panelId}:`, err));
    }

    async function main() {
        // First, cache all character data needed for creating cards
        try {
            const response = await fetch('http://127.0.0.1:8000/api/all_characters');
            if (!response.ok) throw new Error('Failed to cache character data');
            allCharactersData = await response.json();
            console.log("Character data cached.");
            
            // Then, load all UI panels
            Object.values(panels).forEach(url => loadPanel(url.split('/').pop().split('.')[0], url));
            Object.entries(panels).forEach(([id, url]) => loadPanel(id, url));

        } catch (error) {
            console.error("Failed to initialize the application:", error);
        }
    }

    main();
});
