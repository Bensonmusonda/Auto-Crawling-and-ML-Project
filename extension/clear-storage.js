// Clear Extension Storage Utility
// Run this in the browser console on the extension popup or any page where the extension is active

(async function clearExtensionStorage() {
  try {
    // Clear all stored data
    await chrome.storage.local.clear();
    console.log('✓ Extension storage cleared successfully');
    
    // Verify it's cleared
    const result = await chrome.storage.local.get(null);
    console.log('Current storage contents:', result);
    
    if (Object.keys(result).length === 0) {
      console.log('✓ Storage is now empty');
    }
  } catch (error) {
    console.error('Error clearing storage:', error);
  }
})();
