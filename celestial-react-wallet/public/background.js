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
let activeVaultId = null;
let activeMnemonic = null;

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
      if (!vault || !vault.salt || !vault.mnemonic || !vault.id) {
        return { success: false, error: 'Invalid vault payload' };
      }
      
      // Initialize accountCount to 1 for the new vault
      vault.accountCount = 1;

      const result = await chrome.storage.local.get('celestial/vaults');
      const vaults = result['celestial/vaults'] || [];
      
      // Ensure no duplicate ID
      const existingIdx = vaults.findIndex((v) => v.id === vault.id);
      if (existingIdx >= 0) {
        vaults[existingIdx] = vault;
      } else {
        vaults.push(vault);
      }

      await chrome.storage.local.set({ 'celestial/vaults': vaults });
      return { success: true };
    }

    case 'VAULT_UNLOCK': {
      // Attempt to decrypt the vault with the provided password
      const { password, vaultId } = payload;
      const result = await chrome.storage.local.get('celestial/vaults');
      const vaults = result['celestial/vaults'] || [];
      
      const vault = vaults.find((v) => v.id === vaultId);
      
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
        activeVaultId = vault.id;
        activeMnemonic = mnemonic;

        return { success: true, mnemonic, accountCount: vault.accountCount || 1 };
      } catch {
        return { success: false, error: 'Wrong password' };
      }
    }

    case 'VAULT_LOCK': {
      sessionKey = null;
      isUnlocked = false;
      activeVaultId = null;
      activeMnemonic = null;
      return { success: true };
    }

    case 'VAULT_STATE_GET': {
      const result = await chrome.storage.local.get('celestial/vaults');
      const vaults = result['celestial/vaults'] || [];
      const hasVault = vaults.length > 0;
      
      const activeVault = vaults.find(v => v.id === activeVaultId);
      
      return { 
        success: true, 
        hasVault, 
        isUnlocked,
        activeVaultId,
        mnemonic: isUnlocked ? activeMnemonic : undefined,
        accountCount: isUnlocked ? (activeVault?.accountCount || 1) : undefined,
        vaults: vaults.map(v => ({ id: v.id, name: v.name }))
      };
    }

    case 'VAULT_ADD_ACCOUNT': {
      if (!isUnlocked || !activeVaultId) return { success: false, error: 'Vault locked' };
      const result = await chrome.storage.local.get('celestial/vaults');
      const vaults = result['celestial/vaults'] || [];
      const vIdx = vaults.findIndex(v => v.id === activeVaultId);
      if (vIdx >= 0) {
        vaults[vIdx].accountCount = (vaults[vIdx].accountCount || 1) + 1;
        await chrome.storage.local.set({ 'celestial/vaults': vaults });
        return { success: true, accountCount: vaults[vIdx].accountCount };
      }
      return { success: false, error: 'Active vault not found' };
    }

    // ---- EIP-1193 Web3 Requests (from content script) -----------------------

    case 'WEB3_REQUEST': {
      const { method, params, origin } = payload || {};
      return handleWeb3Request(method, params, origin);
    }

    // ---- Solana Requests (from content script) ------------------------------
    
    case 'SOLANA_REQUEST': {
      const { method, origin } = payload || {};
      if (method === 'connect') {
        if (!isUnlocked) {
          return { error: 'Wallet is locked. Please unlock Celestial Wallet first.' };
        }
        if (connectedAccounts.length === 0) {
          return { error: 'No accounts available. Please open the wallet.' };
        }
        return new Promise((resolve, reject) => {
          const requestId = Date.now().toString();
          pendingConnectionRequests.set(requestId, { resolve, reject, origin, type: 'sol' });
          chrome.windows.create({
            url: chrome.runtime.getURL(`index.html?request=connect&origin=${encodeURIComponent(origin || 'Unknown')}&id=${requestId}`),
            type: 'popup',
            width: 380,
            height: 600,
            focused: true
          });
        });
      }
      return { success: false, error: 'Unknown method' };
    }

    // ---- Account addresses pushed from popup after unlock -------------------

    case 'ACCOUNTS_UPDATE': {
      if (!isUnlocked) return { success: false, error: 'Vault locked' };
      connectedAccounts = payload?.accounts || [];
      return { success: true };
    }

    // ---- Connection Approvals (from React Popup) ----------------------------

    case 'CONNECTION_RESPOND': {
      const { id, success } = payload;
      const req = pendingConnectionRequests.get(id.toString());
      if (req) {
        if (success) {
          if (req.type === 'eth') {
            const evm = connectedAccounts.map(a => a.chains.find(c => c.chain === 'EVM')?.address).filter(Boolean);
            req.resolve({ result: evm });
          } else if (req.type === 'sol') {
            const sol = connectedAccounts[0]?.chains.find(c => c.chain === 'Solana')?.address;
            req.resolve({ result: { publicKey: sol } });
          }
        } else {
          req.resolve({ error: { code: 4001, message: 'User rejected the request.' } });
        }
        pendingConnectionRequests.delete(id.toString());
      }
      return { success: true };
    }

    default:
      return { success: false, error: `Unknown message type: ${type}` };
  }
}

// ---- EIP-1193 Web3 Request Handler ------------------------------------------

// Mock address for Phase 1 testing — will be replaced with real derivation
const MOCK_ETH_ADDRESS = '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18';

// In-memory connected accounts (set by popup via ACCOUNTS_UPDATE, or mock)
let connectedAccounts = [];

// Pending connection requests waiting for user approval
const pendingConnectionRequests = new Map();
let nextReqId = 1;

async function handleWeb3Request(method, params, origin) {
  switch (method) {
    case 'eth_requestAccounts': {
      // Phase 2: Open popup for user approval
      if (!isUnlocked) {
        return {
          error: {
            code: 4100,
            message: 'Wallet is locked. Please unlock Celestial Wallet first.',
          },
        };
      }

      // If no accounts are derived yet (shouldn't happen if unlocked)
      if (connectedAccounts.length === 0) {
        return {
          error: {
            code: 4100,
            message: 'No accounts available. Please open the wallet.',
          },
        };
      }

      return new Promise((resolve) => {
        const reqId = nextReqId++;
        pendingConnectionRequests.set(reqId.toString(), {
          resolve,
          origin,
          type: 'eth'
        });

        chrome.windows.create({
          url: `index.html?request=connect&id=${reqId}&origin=${encodeURIComponent(origin || '')}`,
          type: 'popup',
          width: 360,
          height: 600,
          focused: true
        });
      });
    }

    case 'eth_accounts': {
      // Return connected accounts without prompting
      if (!isUnlocked) {
        return { result: [] };
      }

      const accounts = connectedAccounts.length > 0
        ? connectedAccounts
        : [MOCK_ETH_ADDRESS];

      return { result: accounts };
    }

    case 'eth_chainId': {
      return { result: '0x1' }; // Ethereum Mainnet
    }

    case 'net_version': {
      return { result: '1' }; // Ethereum Mainnet
    }

    default: {
      return {
        error: {
          code: 4200,
          message: `Celestial does not yet support the method: ${method}`,
        },
      };
    }
  }
}
