// Background Service Worker

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "elementSelected" || 
        request.action === "containerSelected" ||
        request.action === "fieldSelected" ||
        request.action === "paginationSelected" ||
        request.action === "linkSelected") {
        
        // Save the selection to storage so the popup can read it when opened later
        chrome.storage.local.set({
            lastSelection: request.data,
            selectionTime: Date.now(),
            selectionType: request.action
        }, () => {
            console.log("Selection saved to storage:", request.action);
        });

        // Acknowledge receipt
        sendResponse({ status: "received" });
    }
    
    return true; // Keep channel open for async response
});
