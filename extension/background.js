// Background Service Worker

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "elementSelected") {
        // Save the selection to storage so the popup can read it when opened later
        chrome.storage.local.set({
            lastSelection: request.data,
            selectionTime: Date.now()
        }, () => {
            console.log("Selection saved to storage");
        });

        // Acknowledge receipt to avoid "Receiving end does not exist" error
        // (Though purely asynchronous, return true if you plan to sendResponse asynchronously)
        sendResponse({ status: "received" });
    }
});
