document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('togglePicker');
    const resultBox = document.getElementById('selectionResult');
    const cssCode = document.getElementById('cssSelector');
    const xpathCode = document.getElementById('xpathSelector');
    const textPreview = document.getElementById('textPreview');
    const actionsDiv = document.getElementById('actions');
    const validateBtn = document.getElementById('validateBtn');
    const exportBtn = document.getElementById('exportBtn');
    const clearBtn = document.getElementById('clearBtn');
    const statusDiv = document.getElementById('status');
    const alternativesDiv = document.getElementById('alternatives');
    const debugInfoDiv = document.getElementById('debugInfo');

    let isPicking = false;
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

        // Display alternative selectors if available
        if (selection.alternatives) {
            displayAlternatives(selection.alternatives);
        }

        resultBox.style.display = "block";
        actionsDiv.style.display = "block";
    }

    function displayAlternatives(alternatives) {
        if (!alternativesDiv) return;

        alternativesDiv.innerHTML = '<div style="font-weight: bold; margin-top: 10px; font-size: 11px; color: #666;">Alternative Selectors:</div>';

        const altList = [
            { name: 'Data Attributes', value: alternatives.data_attributes },
            { name: 'Semantic', value: alternatives.semantic },
            { name: 'Text-based', value: alternatives.text_based },
            { name: 'Robust Path', value: alternatives.robust_path },
            { name: 'Simple Class', value: alternatives.simple_class }
        ];

        altList.forEach(alt => {
            if (alt.value && alt.value !== 'null') {
                const div = document.createElement('div');
                div.style.cssText = 'margin-top: 6px;';
                div.innerHTML = `
                    <span class="label">${alt.name}:</span>
                    <code class="alternative-selector" data-selector="${alt.value}" style="cursor: pointer; background: #e3f2fd;">${alt.value}</code>
                `;
                alternativesDiv.appendChild(div);
            }
        });

        // Make alternative selectors clickable to use them instead
        document.querySelectorAll('.alternative-selector').forEach(el => {
            el.addEventListener('click', () => {
                const selector = el.dataset.selector;
                cssCode.textContent = selector;
                currentSelection.selector = selector;
                updateStatus('Switched to alternative selector', 'blue');
            });
        });
    }

    function updateStatus(msg, color = 'black', persistent = false) {
        statusDiv.textContent = msg;
        statusDiv.style.color = color;

        // Only auto-clear non-persistent messages (like "Element captured!")
        if (!persistent) {
            setTimeout(() => {
                if (statusDiv.textContent === msg) statusDiv.textContent = '';
            }, 5000);
        }
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
            displaySelection(currentSelection);
            updateStatus("Element captured!", "green");

            // Store for persistence
            chrome.storage.local.set({ lastSelection: currentSelection });
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
                displayValidationResult(resData);
            } else {
                let msg = resData.detail;
                if (typeof msg === 'object') {
                    msg = JSON.stringify(msg);
                }
                updateStatus(`Server Error: ${msg}`, "red");
            }
        } catch (e) {
            updateStatus("Connection Failed - Is backend running?", "red");
            console.error(e);
        }
    });

    function displayValidationResult(result) {
        // Clear previous debug info
        if (debugInfoDiv) {
            debugInfoDiv.innerHTML = '';
        }

        const count = result.count || 0;
        const debugInfo = result.debug_info;

        if (count > 0) {
            updateStatus(`✓ Valid! Found ${count} match${count > 1 ? 'es' : ''}.`, "green", true);
            exportBtn.style.display = "block";

            // Show preview of matches
            if (result.all_matches_preview && result.all_matches_preview.length > 0) {
                const previewDiv = document.createElement('div');
                previewDiv.style.cssText = 'margin-top: 8px; font-size: 11px; color: #666;';
                previewDiv.innerHTML = '<strong>Matched content:</strong><br>' +
                    result.all_matches_preview.map(m => `<code style="display:block; margin-top:2px;">${m}</code>`).join('');
                if (debugInfoDiv) debugInfoDiv.appendChild(previewDiv);
            }
        } else {
            updateStatus(`⚠ Selector valid but found 0 matches`, "orange", true);

            // Show debug information
            if (debugInfo) {
                displayDebugInfo(debugInfo);
            }

            // Suggest trying alternatives
            if (currentSelection.alternatives) {
                updateStatus(`Try alternative selectors below (click to switch)`, "orange", true);

                // Auto-try alternatives
                setTimeout(() => {
                    suggestWorkingAlternative(url);
                }, 1000);
            }
        }
    }

    function displayDebugInfo(debugInfo) {
        if (!debugInfoDiv) return;

        const debugDiv = document.createElement('div');
        debugDiv.style.cssText = 'margin-top: 10px; padding: 8px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; font-size: 11px;';

        let html = '<strong>🔍 Debug Info:</strong><br>';
        html += `<strong>Page Title:</strong> ${debugInfo.title || 'N/A'}<br>`;
        html += `<strong>Status Code:</strong> ${debugInfo.status}<br>`;

        if (debugInfo.suggestions && debugInfo.suggestions.length > 0) {
            html += '<br><strong>Suggestions:</strong><br>';
            debugInfo.suggestions.forEach(sug => {
                html += `• <em>${sug.message}</em><br>`;
                if (sug.values) {
                    html += `  Similar: ${sug.values.join(', ')}<br>`;
                }
                if (sug.html) {
                    html += `  <code>${sug.html.substring(0, 100)}...</code><br>`;
                }
            });
        }

        // Show HTML snippet
        if (debugInfo.html_snippet) {
            html += '<br><strong>Page HTML (first 500 chars):</strong><br>';
            html += `<code style="display: block; max-height: 100px; overflow-y: auto; font-size: 9px;">${escapeHtml(debugInfo.html_snippet.substring(0, 500))}</code>`;
        }

        debugDiv.innerHTML = html;
        debugInfoDiv.appendChild(debugDiv);
    }

    async function suggestWorkingAlternative(url) {
        if (!currentSelection.alternatives) return;

        updateStatus("Testing alternative selectors...", "blue");

        const alternatives = [
            currentSelection.alternatives.data_attributes,
            currentSelection.alternatives.semantic,
            currentSelection.alternatives.robust_path,
            currentSelection.alternatives.simple_class
        ].filter(alt => alt && alt !== 'null');

        for (const altSelector of alternatives) {
            try {
                const response = await fetch("http://localhost:8000/api/config/validate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        url: url,
                        selector: altSelector
                    })
                });

                const result = await response.json();
                if (result.count > 0) {
                    updateStatus(`✓ Found working alternative: ${altSelector}`, "green");
                    cssCode.textContent = altSelector;
                    currentSelection.selector = altSelector;
                    exportBtn.style.display = "block";
                    return;
                }
            } catch (e) {
                console.error('Error testing alternative:', e);
            }
        }

        updateStatus("No working alternatives found. Page may be rendering differently.", "red");
    }

    function escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    async function getCurrentUrl() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab.url;
    }

    // Export Button
    exportBtn.onclick = async () => {
        updateStatus("Export not implemented yet", "gray");
        // TODO: Send to backend configuration
    };

    // Clear Button - Clear all results and browser highlights
    clearBtn.addEventListener('click', async () => {
        // Clear UI elements
        currentSelection = null;
        resultBox.style.display = "none";
        actionsDiv.style.display = "none";
        cssCode.textContent = '';
        xpathCode.textContent = '';
        textPreview.textContent = '';
        alternativesDiv.innerHTML = '';
        debugInfoDiv.innerHTML = '';
        statusDiv.textContent = '';
        exportBtn.style.display = "none";

        // Clear storage
        chrome.storage.local.remove(['lastSelection']);

        // Clear highlights in the browser page
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        chrome.tabs.sendMessage(tab.id, { action: "clearHighlights" }, (response) => {
            if (chrome.runtime.lastError) {
                console.log("Could not clear highlights (page may need refresh)", chrome.runtime.lastError.message);
            }
        });

        updateStatus("All results cleared", "green");
    });
});