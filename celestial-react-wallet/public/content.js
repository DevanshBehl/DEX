/**
 * Celestial Wallet — Content Script
 *
 * Bridge between the webpage (inpage.js) and the extension background.
 *
 * Responsibilities:
 * 1. Injects inpage.js into the page DOM to set window.ethereum
 * 2. Relays vault initialization messages from the landing page to background
 * 3. Relays EIP-1193 provider requests from inpage.js to background
 */

// ---- Inject inpage.js -------------------------------------------------------

const script = document.createElement('script');
script.src = chrome.runtime.getURL('inpage.js');
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

// ---- Message relay (webpage ↔ background) -----------------------------------

window.addEventListener('message', (event) => {
  // Only accept messages from the same page
  if (event.source !== window) return;

  // Filter for messages targeted at our extension
  const { target, type } = event.data || {};

  // ---- Vault Init Relay (landing page → background) -------------------------
  if (target === 'celestial-wallet' && type === 'VAULT_INIT') {
    const { payload } = event.data;
    chrome.runtime.sendMessage({ type: 'VAULT_INIT', payload }, (response) => {
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

  // ---- EIP-1193 Provider Relay (inpage.js → background) ---------------------
  if (target === 'celestial-content' && type === 'CELESTIAL_PROVIDER_REQUEST') {
    const { id, payload } = event.data;
    
    chrome.runtime.sendMessage(
      { type: 'WEB3_REQUEST', payload },
      (response) => {
        // Handle extension context invalidated (e.g., extension reloaded)
        if (chrome.runtime.lastError) {
          window.postMessage(
            {
              target: 'celestial-inpage',
              type: 'CELESTIAL_PROVIDER_RESPONSE',
              id,
              error: {
                code: -32603,
                message: 'Extension context invalidated. Please reload the page.',
              },
            },
            '*',
          );
          return;
        }

        if (response?.error) {
          window.postMessage(
            {
              target: 'celestial-inpage',
              type: 'CELESTIAL_PROVIDER_RESPONSE',
              id,
              error: response.error,
            },
            '*',
          );
        } else {
          window.postMessage(
            {
              target: 'celestial-inpage',
              type: 'CELESTIAL_PROVIDER_RESPONSE',
              id,
              result: response?.result,
            },
            '*',
          );
        }
      },
    );
  }

  // ---- Solana Provider Relay (inpage.js → background) -----------------------
  if (target === 'celestial-content' && type === 'CELESTIAL_SOLANA_REQUEST') {
    const { id, payload } = event.data;
    
    chrome.runtime.sendMessage(
      { type: 'SOLANA_REQUEST', payload },
      (response) => {
        if (chrome.runtime.lastError) {
          window.postMessage(
            {
              target: 'celestial-inpage',
              type: 'CELESTIAL_SOLANA_RESPONSE',
              id,
              error: { message: 'Extension context invalidated.' },
            },
            '*',
          );
          return;
        }

        window.postMessage(
          {
            target: 'celestial-inpage',
            type: 'CELESTIAL_SOLANA_RESPONSE',
            id,
            error: response?.error,
            result: response?.result,
          },
          '*',
        );
      },
    );
  }
});