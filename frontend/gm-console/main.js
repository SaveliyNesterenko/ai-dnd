
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
                        // Wait a moment for the panel to be in the DOM, then fetch characters.
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
        console.log("[1/6] Attempting to fetch characters...");
        fetch('http://127.0.0.1:8000/api/characters')
            .then(response => {
                console.log("[2/6] Received response from server:", response);
                if (!response.ok) {
                    console.error("Server response not OK:", response.status, response.statusText);
                    throw new Error(`Network response was not ok: ${response.statusText}`);
                }
                return response.json();
            })
            .then(data => {
                console.log("[3/6] Successfully parsed JSON data:", data);
                const bottomPanel = document.getElementById('bottom-panel');
                if (!bottomPanel) {
                    console.error("Could not find the 'bottom-panel' element.");
                    return;
                }
                
                // Clear previous content if any
                bottomPanel.innerHTML = ''; 

                const container = document.createElement('div');
                container.className = 'characters-container';
                console.log("[4/6] Created characters container.");

                let characterCount = 0;
                for (const key in data) {
                    if (data.hasOwnProperty(key)) {
                        characterCount++;
                        const char = data[key];
                        const card = document.createElement('div');
                        card.className = 'character-card';
                        
                        // Defensive checks for properties
                        const name = char.identity ? char.identity.name : 'Unknown Name';
                        const bio = char.identity && char.identity.bio ? char.identity.bio.substring(0, 100) + '...' : 'No bio available.';

                        card.innerHTML = `
                            <h3>${name}</h3>
                            <p>${bio}</p>
                        `;
                        container.appendChild(card);
                    }
                }

                if (characterCount > 0) {
                    console.log(`[5/6] Created and prepared ${characterCount} character cards.`);
                } else {
                    console.warn("Data received, but it contains no characters to display.");
                }
                
                bottomPanel.appendChild(container);
                console.log("[6/6] Appended container to bottom panel.");

            })
            .catch(error => {
                console.error('CRITICAL ERROR: Error fetching or processing characters:', error);
            });
    }
});
