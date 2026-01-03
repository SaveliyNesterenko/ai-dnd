
document.addEventListener("DOMContentLoaded", () => {
    const panels = {
        "top-panel": "panels/top-panel.html",
        "left-panel": "panels/left-panel.html",
        "center-panel": "panels/center-panel.html",
        "right-panel": "panels/right-panel.html",
        "bottom-panel": "panels/bottom-panel.html"
    };

    // Function to initialize the center panel logic
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
                    headers: {
                        'Content-Type': 'application/json'
                    },
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

    // Function to initialize the top panel logic
    async function initializeTopPanel() {
        try {
            const charactersResponse = await fetch('http://127.0.0.1:8000/api/characters');
            const charactersData = await charactersResponse.json();
            const characterSelect = document.getElementById('character-select');
            characterSelect.innerHTML = '<option disabled selected>Characters</option>';
            for (const key in charactersData) {
                const character = charactersData[key];
                const option = document.createElement('option');
                option.value = key;
                option.textContent = character.identity.name;
                characterSelect.appendChild(option);
            }

            const npcResponse = await fetch('http://127.0.0.1:8000/api/npcs');
            const npcData = await npcResponse.json();
            const npcSelect = document.getElementById('npc-select');
            npcSelect.innerHTML = '<option disabled selected>NPC</option>';
            for (const key in npcData) {
                const npc = npcData[key];
                const option = document.createElement('option');
                option.value = key;
                option.textContent = npc.identity.name;
                npcSelect.appendChild(option);
            }
        } catch (error) {
            console.error('Error populating dropdowns:', error);
        }
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

                    if (panelId === "center-panel") {
                        initializeCenterPanel();
                    } else if (panelId === "top-panel") {
                        initializeTopPanel();
                    } else if (panelId === "bottom-panel") {
                        setTimeout(fetchCharacters, 100); 
                    }
                }
            })
            .catch(err => console.warn(`Could not load panel ${panelId}:`, err));
    }

    for (const panelId in panels) {
        loadPanel(panelId, panels[panelId]);
    }

    function fetchCharacters() {
        fetch('http://127.0.0.1:8000/api/characters')
            .then(response => response.json())
            .then(data => {
                const bottomPanel = document.getElementById('bottom-panel');
                if (!bottomPanel) {
                    console.error("Could not find the 'bottom-panel' element.");
                    return;
                }
                
                bottomPanel.innerHTML = ''; 

                const container = document.createElement('div');
                container.className = 'characters-container';

                for (const key in data) {
                    if (data.hasOwnProperty(key)) {
                        const char = data[key];
                        const card = document.createElement('div');
                        card.className = 'character-card';
                        card.dataset.charKey = key;

                        const name = char.identity ? char.identity.name : 'Unknown Name';
                        const bio = char.identity && char.identity.bio ? char.identity.bio.substring(0, 100) + '...' : 'No bio available.';

                        card.innerHTML = `
                            <h3>${name}</h3>
                            <p>${bio}</p>
                        `;
                        container.appendChild(card);
                    }
                }
                
                bottomPanel.appendChild(container);
                
                container.addEventListener('click', (event) => {
                    const clickedCard = event.target.closest('.character-card');
                    if (clickedCard) {
                        const charKey = clickedCard.dataset.charKey;
                        const charKeyInput = document.getElementById('charKey');
                        if (charKeyInput) {
                            charKeyInput.value = charKey;
                        }
                    }
                });

            })
            .catch(error => {
                console.error('Error fetching or processing characters:', error);
            });
    }
});
