
document.addEventListener("DOMContentLoaded", () => {
    const panels = {
        "top-panel": "panels/top-panel.html",
        "left-panel": "panels/left-panel.html",
        "center-panel": "panels/center-panel.html",
        "right-panel": "panels/right-panel.html",
        "bottom-panel": "panels/bottom-panel.html"
    };

    /**
     * Loads content into a panel.
     * @param {string} panelId The ID of the panel element.
     * @param {string} url The URL to fetch the content from.
     */
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
                    // If the loaded content is the bottom panel, fetch and display characters
                    if (panelId === "bottom-panel") {
                        fetchCharacters();
                    }
                    // Execute scripts in the loaded HTML
                    const scripts = panelElement.getElementsByTagName('script');
                    for (let i = 0; i < scripts.length; i++) {
                        const script = document.createElement('script');
                        if (scripts[i].src) {
                            // If the script has a src, we need to handle its loading
                            script.src = scripts[i].src;
                            script.onload = () => {
                                // Optional: callback after script is loaded
                            };
                            document.body.appendChild(script);
                        } else {
                            // If it's an inline script
                            script.innerHTML = scripts[i].innerHTML;
                            document.body.appendChild(script);
                        }
                        // To prevent re-execution, we could remove the original script tag
                        scripts[i].parentNode.removeChild(scripts[i]);
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
                const container = document.createElement('div');
                container.className = 'characters-container';

                for (const key in data) {
                    const char = data[key];
                    const card = document.createElement('div');
                    card.className = 'character-card';
                    card.innerHTML = `
                        <h3>${char.identity.name}</h3>
                        <p>${char.identity.bio.substring(0, 100)}...</p>
                    `;
                    container.appendChild(card);
                }
                bottomPanel.appendChild(container);
            })
            .catch(error => console.error('Error fetching characters:', error));
    }
});
