
document.addEventListener("DOMContentLoaded", () => {
    const panels = {
        "top-panel": "panels/top-panel.html",
        "left-panel": "panels/left-panel.html",
        "center-panel": "panels/center-panel.html",
        "right-panel": "panels/right-panel.html",
        "bottom-panel": "panels/bottom-panel.html"
    };

    function initializeCenterPanel() {
        const sendBtn = document.getElementById('sendBtn');
        const charInput = document.getElementById('charKey');
        const outputArea = document.getElementById('modelOutput');

        if (!sendBtn || !charInput || !outputArea) {
            console.error("Center panel elements not found!");
            return;
        }

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
        const populateSelect = async (url, selectId, defaultOptionText) => {
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    console.warn(`Could not load data for ${selectId} from ${url}. Status: ${response.status}`);
                    const selectElement = document.getElementById(selectId);
                    selectElement.innerHTML = `<option disabled selected>${defaultOptionText} (Error)</option>`;
                    return;
                }
                const data = await response.json();
                const selectElement = document.getElementById(selectId);
                selectElement.innerHTML = `<option disabled selected>${defaultOptionText}</option>`;
                for (const key in data) {
                    const item = data[key];
                    const option = document.createElement('option');
                    option.value = key;
                    option.textContent = item.identity.name;
                    selectElement.appendChild(option);
                }
            } catch (error) {
                console.error(`Error populating ${selectId}:`, error);
            }
        };

        // Use the new, correct API endpoints
        populateSelect('http://127.0.0.1:8000/api/characters', 'character-select', 'Characters');
        populateSelect('http://127.0.0.1:8000/api/npcs', 'npc-select', 'NPCs');
    }

    function loadPanel(panelId, url) {
        fetch(url)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.text();
            })
            .then(html => {
                const panelElement = document.getElementById(panelId);
                if (panelElement) {
                    panelElement.innerHTML = html;
                    if (panelId === "center-panel") initializeCenterPanel();
                    else if (panelId === "top-panel") initializeTopPanel();
                    // Use the dedicated function for the bottom panel
                    else if (panelId === "bottom-panel") fetchAllCharactersCards();
                }
            })
            .catch(err => console.warn(`Could not load panel ${panelId}:`, err));
    }

    // Load all panels
    Object.entries(panels).forEach(([id, url]) => loadPanel(id, url));

    // This function now specifically fetches all characters for the bottom panel
    function fetchAllCharactersCards() {
        fetch('http://127.0.0.1:8000/api/all_characters') // Use the new endpoint
            .then(response => response.json())
            .then(data => {
                const bottomPanel = document.getElementById('bottom-panel');
                if (!bottomPanel) return;
                bottomPanel.innerHTML = ''; // Clear previous content
                const container = document.createElement('div');
                container.className = 'characters-container';
                for (const key in data) {
                    const char = data[key];
                    const card = document.createElement('div');
                    card.className = 'character-card';
                    card.dataset.charKey = key;
                    const name = char.identity ? char.identity.name : 'Unknown';
                    const bio = char.identity && char.identity.bio ? char.identity.bio.substring(0, 100) + '...' : 'No bio.';
                    card.innerHTML = `<h3>${name}</h3><p>${bio}</p>`;
                    container.appendChild(card);
                }
                bottomPanel.appendChild(container);
                
                // Add a single event listener to the container
                container.addEventListener('click', (event) => {
                    const card = event.target.closest('.character-card');
                    if (card) {
                        const charKeyInput = document.getElementById('charKey');
                        if (charKeyInput) charKeyInput.value = card.dataset.charKey;
                    }
                });
            })
            .catch(error => console.error('Error fetching all characters for cards:', error));
    }
});
