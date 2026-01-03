
document.addEventListener("DOMContentLoaded", () => {
    const panels = {
        "top-panel": "panels/top-panel.html",
        "left-panel": "panels/left-panel.html",
        "center-panel": "panels/center-panel.html",
        "right-panel": "panels/right-panel.html",
        "bottom-panel": "panels/bottom-panel.html"
    };

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
                    if (panelId === "bottom-panel") {
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
                        card.dataset.charKey = key; // Store character key in a data attribute

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
                
                // Add click listener to the container
                container.addEventListener('click', (event) => {
                    const clickedCard = event.target.closest('.character-card');
                    if (clickedCard) {
                        const charKey = clickedCard.dataset.charKey;
                        const charKeyInput = document.getElementById('charKey');
                        if (charKeyInput) {
                            charKeyInput.value = charKey;
                            console.log(`Set charKey input to: ${charKey}`);
                        }
                    }
                });

            })
            .catch(error => {
                console.error('Error fetching or processing characters:', error);
            });
    }
});
