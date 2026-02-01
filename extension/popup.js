document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('togglePicker');
    const resultBox = document.getElementById('selectionResult');
    const cssCode = document.getElementById('cssSelector');
    const xpathCode = document.getElementById('xpathSelector');
    const textPreview = document.getElementById('textPreview');
    const actionsDiv = document.getElementById('actions');
    const validateBtn = document.getElementById('validateBtn');
    const exportBtn = document.getElementById('exportBtn');
    const statusDiv = document.getElementById('status');

    let isPicking = false; // We might want to sync this too, but for now reset.
    let currentSelection = null;

    // Load last selection from storage
    chrome.storage.local.get(['lastSelection'], (result) => {
        if (result.lastSelection) {
            currentSelection = result.lastSelection;
            displaySelection(currentSelection);
        }
    });

    function displaySelection(selection) {
        cssCode.textContent = selection.selector;
        xpathCode.textContent = selection.xpath;
        textPreview.textContent = selection.text;

        resultBox.style.display = "block";
        actionsDiv.style.display = "block";

        // Clear status if it was old
        // updateStatus("Restored previous selection", "gray");
    }

    function updateStatus(msg, color = 'black') {
        statusDiv.textContent = msg;
        statusDiv.style.color = color;
        setTimeout(() => { if (statusDiv.textContent === msg) statusDiv.textContent = ''; }, 3000);
    }

    // Toggle Picking Mode
    toggleBtn.addEventListener('click', async () => {
        isPicking = !isPicking;
        toggleBtn.textContent = isPicking ? "Stop Picking" : "Start Picking";
        toggleBtn.classList.toggle('btn-danger', isPicking);

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        chrome.tabs.sendMessage(tab.id, { action: "togglePicker", state: isPicking }, (response) => {
            if (chrome.runtime.lastError) {
                updateStatus("Error: Refresh page first!", "red");
                isPicking = false;
                toggleBtn.textContent = "Start Picking";
                toggleBtn.classList.remove('btn-danger');
            }
        });
    });

    // Listen for selection from content script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "elementSelected") {
            currentSelection = request.data;

            currentSelection = request.data;
            displaySelection(currentSelection);

            updateStatus("Element captured!", "green");
        }
    });

    // Validate Button
    validateBtn.addEventListener('click', async () => {
        if (!currentSelection) return;
        updateStatus("Validating...", "blue");

        const url = await getCurrentUrl();

        try {
            const response = await fetch("http://localhost:8000/api/config/validate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    url: url,
                    selector: currentSelection.selector
                })
            });

            const resData = await response.json();
            console.log("Validation Result:", resData);

            if (response.ok) {
                // Backend returns result from Celery task: {'count': N, 'first_match': '...', 'valid': True}
                // Adapt to whatever the backend actually returns
                if (resData.count > 0 || resData.valid) {
                    let msg = `Valid! Found ${resData.count} matches.`;
                    if (resData.count === 0 && resData.debug_title) {
                        msg += ` (Title: ${resData.debug_title})`;
                    }
                    updateStatus(msg, resData.count > 0 ? "green" : "orange");
                    exportBtn.style.display = "block";
                } else {
                    updateStatus("Valid selector, but 0 matches on server.", "orange");
                }
            } else {
                // Handle Pydantic validation errors which are arrays
                let msg = resData.detail;
                if (typeof msg === 'object') {
                    msg = JSON.stringify(msg);
                }
                updateStatus(`Server Error: ${msg}`, "red");
            }
        } catch (e) {
            updateStatus("Connection Failed", "red");
            console.error(e);
        }
    });

    // Helper to get current tab URL
    async function getCurrentUrl() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab.url;
    }

    // Export Button
    exportBtn.onclick = async () => {
        // Implement export logic (e.g., save to a 'drafts' list on backend)
        updateStatus("Export not implemented yet", "gray");
    };

});
