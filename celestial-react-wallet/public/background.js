/**
 * Celestial Wallet — Background Service Worker
 * 
 * Handles:
 * - VAULT_INIT: Stores encrypted vault blob from landing page
 * - VAULT_UNLOCK: Validates password by attempting AES-GCM decryption
 * - VAULT_LOCK: Clears in-memory session
 * - VAULT_STATE_GET: Returns vault status
 */

// ---- In-memory session (wiped when SW terminates) ---------------------------

let sessionKey = null;   // CryptoKey — non-extractable, memory-only
let isUnlocked = false;

// ---- Crypto helpers (matching landing page implementation) ------------------

function fromBase64(str) {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveKey(password, saltBase64) {
  const salt = fromBase64(saltBase64);
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 600000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function decryptPayload(key, payload) {
  const iv = fromBase64(payload.iv);
  const ciphertext = fromBase64(payload.ciphertext);

  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  );

  return new TextDecoder().decode(plainBuffer);
}

// ---- Message handler --------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ success: false, error: err.message }));
  return true; // async response
});

async function handleMessage(message) {
  const { type, payload } = message;

  switch (type) {
    case 'VAULT_INIT': {
      // Store encrypted vault from landing page
      const { vault } = payload;
      if (!vault || !vault.salt || !vault.mnemonic) {
        return { success: false, error: 'Invalid vault payload' };
      }
      await chrome.storage.local.set({ 'celestial/vault': vault });
      return { success: true };
    }

    case 'VAULT_UNLOCK': {
      // Attempt to decrypt the vault with the provided password
      const { password } = payload;
      const result = await chrome.storage.local.get('celestial/vault');
      const vault = result['celestial/vault'];
      
      if (!vault) {
        return { success: false, error: 'No vault found' };
      }

      try {
        const key = await deriveKey(password, vault.salt);
        // Attempt decryption — will throw on wrong password
        const mnemonic = await decryptPayload(key, vault.mnemonic);
        
        // Cache key in memory
        sessionKey = key;
        isUnlocked = true;

        return { success: true, mnemonic };
      } catch {
        return { success: false, error: 'Wrong password' };
      }
    }

    case 'VAULT_LOCK': {
      sessionKey = null;
      isUnlocked = false;
      return { success: true };
    }

    case 'VAULT_STATE_GET': {
      const result = await chrome.storage.local.get('celestial/vault');
      const hasVault = !!result['celestial/vault'];
      return { success: true, hasVault, isUnlocked };
    }

    default:
      return { success: false, error: `Unknown message type: ${type}` };
  }
}
