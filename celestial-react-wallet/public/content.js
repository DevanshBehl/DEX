/**
 * Celestial Wallet — Content Script
 * 
 * 1. Injects inpage.js to set window.celestial for extension detection
 * 2. Relays vault initialization messages from the landing page to background
 */

// ---- Inject inpage.js (existing behavior) -----------------------------------
const script = document.createElement('script');
script.src = chrome.runtime.getURL('inpage.js');
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

// ---- Relay messages from landing page → background --------------------------

window.addEventListener('message', (event) => {
  // Only accept messages from the same page
  if (event.source !== window) return;
  
  // Filter for messages targeted at our extension
  if (event.data?.target !== 'celestial-wallet') return;

  const { type, payload } = event.data;

  if (type === 'VAULT_INIT') {
    // Forward to background service worker
    chrome.runtime.sendMessage({ type: 'VAULT_INIT', payload }, (response) => {
      // Relay response back to the landing page
      window.postMessage(
        {
          target: 'celestial-page',
          type: 'VAULT_INIT_ACK',
          success: response?.success === true,
          error: response?.error || null,
        },
        '*',
      );
    });
  }
});