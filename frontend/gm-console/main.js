
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
});
