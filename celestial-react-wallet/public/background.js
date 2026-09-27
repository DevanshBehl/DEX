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

// ---- Message sources --------------------------------------------------------
// Web pages reach the worker only through content.js. Chrome fills in `sender` itself, so a page
// cannot fake where a message came from — unlike anything inside the message.

/** Origins allowed to hand the extension a new vault. Keep in sync with ONBOARDING_URL in src/config/networks.ts. */
const ONBOARDING_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

/** The only messages a web page (via content.js) may send; everything else is extension-internal. */
const PAGE_MESSAGES = new Set(['VAULT_INIT', 'WEB3_REQUEST', 'SOLANA_REQUEST']);

function isExtensionPage(sender) {
  return sender?.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
}

function senderOrigin(sender) {
  if (sender?.origin) return sender.origin;
  try {
    return new URL(sender.url).origin;
  } catch {
    return '';
  }
}

/** Why a message must be refused, or null. */
function senderError(type, sender) {
  if (isExtensionPage(sender)) return null;
  if (sender?.id !== chrome.runtime.id || !PAGE_MESSAGES.has(type)) return `Message ${type} is not allowed from a web page.`;
  if (type === 'VAULT_INIT' && !ONBOARDING_ORIGINS.includes(senderOrigin(sender))) {
    return 'Wallets can only be created from the Celestial onboarding site.';
  }
  return null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const denied = senderError(message?.type, sender);
  if (denied) {
    sendResponse({ success: false, error: denied });
    return false;
  }
  // dApp requests: the origin shown in approval popups is the real one, not what the page claims.
  if (!isExtensionPage(sender) && message.payload && typeof message.payload === 'object') {
    message = { ...message, payload: { ...message.payload, origin: senderOrigin(sender) } };
  }
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

      const result = await chrome.storage.local.get('celestial_dex_vault');
      const vaults = result['celestial_dex_vault'] || [];
      
      // Ensure no duplicate ID
      const existingIdx = vaults.findIndex((v) => v.id === vault.id);
      if (existingIdx >= 0) {
        vaults[existingIdx] = vault;
      } else {
        vaults.push(vault);
      }

      await chrome.storage.local.set({ 'celestial_dex_vault': vaults });
      return { success: true };
    }

    case 'VAULT_UNLOCK': {
      // Attempt to decrypt the vault with the provided password
      const { password, vaultId } = payload;
      const result = await chrome.storage.local.get('celestial_dex_vault');
      const vaults = result['celestial_dex_vault'] || [];
      
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
      const result = await chrome.storage.local.get('celestial_dex_vault');
      const vaults = result['celestial_dex_vault'] || [];
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
      const result = await chrome.storage.local.get('celestial_dex_vault');
      const vaults = result['celestial_dex_vault'] || [];
      const v = vaults.find(v => v.id === activeVaultId);
      if (v) {
        v.accountCount = (v.accountCount || 1) + 1;
        await chrome.storage.local.set({ 'celestial_dex_vault': vaults });
        return { success: true, accountCount: v.accountCount };
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
      const { method, origin, params } = payload || {};
      if (method === 'connect') {
        // Mirror the EVM eth_requestAccounts flow: open the approval popup (which
        // also lets the user unlock) instead of hard-failing when the wallet is
        // locked or accounts haven't been synced yet. The Solana address is read
        // at approval time, by which point the popup has pushed ACCOUNTS_UPDATE.
        return new Promise((resolve) => {
          const reqId = nextReqId++;
          pendingConnectionRequests.set(reqId.toString(), { resolve, origin, type: 'sol' });
          openApproval('connect', 'INCOMING_CONNECT', reqId, origin);
        });
      }
      if (SOLANA_SIGN_METHODS.includes(method)) {
        return openSolanaSignRequest(method, params || {}, origin);
      }
      return { error: { code: 4200, message: `Celestial does not support the Solana method: ${method}` } };
    }

    // ---- Solana signature approvals (from React Popup) ----------------------

    case 'SOL_SIGN_RESOLVED': {
      const { id, result } = payload;
      settleSolanaRequest(id, { result });
      return { success: true };
    }

    case 'SOL_SIGN_REJECTED': {
      const { id, message } = payload;
      settleSolanaRequest(id, { error: { code: 4001, message: message || 'User rejected the request.' } });
      return { success: true };
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
            if (sol) {
              req.resolve({ result: { publicKey: sol } });
            } else {
              req.resolve({ error: { code: 4100, message: 'No Solana account available. Please open the wallet.' } });
            }
          }
        } else {
          req.resolve({ error: { code: 4001, message: 'User rejected the request.' } });
        }
        pendingConnectionRequests.delete(id.toString());
      }
      return { success: true };
    }

    case 'TX_RESOLVED': {
      const { id, result } = payload;
      const req = pendingTxRequests.get(id.toString());
      if (req) {
        req.resolve({ result });
        pendingTxRequests.delete(id.toString());
        chrome.storage.local.remove(`tx_${id}`);
      }
      return { success: true };
    }

    case 'TX_REJECTED': {
      const { id } = payload;
      const req = pendingTxRequests.get(id.toString());
      if (req) {
        req.resolve({ error: { code: 4001, message: 'User rejected the transaction.' } });
        pendingTxRequests.delete(id.toString());
        chrome.storage.local.remove(`tx_${id}`);
      }
      return { success: true };
    }

    case 'NETWORK_CHANGE': {
      const { isTestnet, rpcUrl, rpcUrls } = payload;
      await setNetwork(isTestnet, rpcUrl, rpcUrls);
      return { success: true };
    }

    default:
      return { success: false, error: `Unknown message type: ${type}` };
  }
}

// ---- Approval popups & network state ---------------------------------------

const EVM_CHAINS = { '0x1': 'mainnet', '0xaa36a7': 'sepolia' };

/** Show a request in the open popup, or open the approval window. */
function openApproval(kind, incomingType, reqId, origin, onWindow) {
  chrome.runtime.sendMessage({ type: incomingType, id: reqId, origin }, (response) => {
    if (chrome.runtime.lastError || !response || !response.received) {
      chrome.windows.create({
        url: `index.html?request=${kind}&id=${reqId}&origin=${encodeURIComponent(origin || '')}`,
        type: 'popup',
        width: 360,
        height: 600,
        focused: true
      }, (win) => onWindow?.(win?.id));
    }
  });
}

/** Persist the EVM network and tell every tab (chainChanged). */
async function setNetwork(isTestnet, rpcUrl, rpcUrls) {
  const update = { isTestnet: !!isTestnet };
  if (rpcUrl) update.rpcUrl = rpcUrl;
  if (rpcUrls) update.rpcUrls = rpcUrls;
  await chrome.storage.local.set(update);
  const chainId = isTestnet ? '0xaa36a7' : '0x1';
  const tabs = await chrome.tabs.query({});
  tabs.forEach((tab) => {
    chrome.tabs.sendMessage(tab.id, { type: 'CELESTIAL_NETWORK_CHANGED', chainId }).catch(() => {});
  });
}

// ---- Solana signing requests --------------------------------------------------
// The popup decodes, simulates and signs (keys live there after unlock); the worker only queues
// the request, stores its payload under `solreq_<id>` and relays the answer to the page.

const SOLANA_SIGN_METHODS = ['signTransaction', 'signAllTransactions', 'signAndSendTransaction', 'signMessage'];
const pendingSolanaRequests = new Map(); // id → { resolve, windowId }

function openSolanaSignRequest(method, params, origin) {
  const { account, chain, transactions, message, options } = params;
  if (typeof account !== 'string' || !account) {
    return { error: { code: 4100, message: 'Connect Celestial Wallet before requesting a signature.' } };
  }
  if (method === 'signMessage' ? typeof message !== 'string' : !Array.isArray(transactions) || transactions.length === 0) {
    return { error: { code: -32602, message: 'Nothing to sign in this request.' } };
  }
  return new Promise((resolve) => {
    const reqId = String(nextReqId++);
    pendingSolanaRequests.set(reqId, { resolve, windowId: null });
    chrome.storage.local.set({ [`solreq_${reqId}`]: { method, account, chain, transactions, message, options, origin } }, () => {
      openApproval('sign-sol', 'INCOMING_SIGN_SOL', reqId, origin, (windowId) => {
        const req = pendingSolanaRequests.get(reqId);
        if (req) req.windowId = windowId ?? null;
      });
    });
  });
}

function settleSolanaRequest(id, response) {
  const req = pendingSolanaRequests.get(String(id));
  if (!req) return;
  pendingSolanaRequests.delete(String(id));
  chrome.storage.local.remove(`solreq_${id}`);
  req.resolve(response);
}

// Closing the approval window without answering is a rejection, not a 5-minute hang.
chrome.windows.onRemoved.addListener((windowId) => {
  for (const [id, req] of pendingSolanaRequests) {
    if (req.windowId === windowId) settleSolanaRequest(id, { error: { code: 4001, message: 'User rejected the request.' } });
  }
});

// ---- EIP-1193 Web3 Request Handler ------------------------------------------

// Mock address for Phase 1 testing — will be replaced with real derivation
const MOCK_ETH_ADDRESS = '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18';

// In-memory connected accounts (set by popup via ACCOUNTS_UPDATE, or mock)
let connectedAccounts = [];

// Pending connection requests waiting for user approval
const pendingConnectionRequests = new Map();
const pendingTxRequests = new Map();
let nextReqId = 1;

async function handleWeb3Request(method, params, origin) {
  switch (method) {
    case 'eth_requestAccounts': {
      // If no accounts are derived yet (shouldn't happen if unlocked)
      if (connectedAccounts.length === 0 && isUnlocked) {
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

        openApproval('connect', 'INCOMING_CONNECT', reqId, origin);
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
      const result = await chrome.storage.local.get('isTestnet');
      return { result: result.isTestnet ? '0xaa36a7' : '0x1' };
    }

    case 'eth_sendTransaction': {
      return new Promise((resolve) => {
        const reqId = nextReqId++;
        pendingTxRequests.set(reqId.toString(), {
          resolve,
          origin
        });

        const txPayload = params[0];
        
        // Store payload for the popup to read
        chrome.storage.local.set({ [`tx_${reqId}`]: txPayload }, () => {
          openApproval('sign-tx', 'INCOMING_SIGN_TX', reqId, origin);
        });
      });
    }

    case 'net_version': {
      const result = await chrome.storage.local.get('isTestnet');
      return { result: result.isTestnet ? '11155111' : '1' };
    }

    case 'wallet_switchEthereumChain': {
      // EIP-3326: switch between the two networks Celestial supports; 4902 for anything else.
      const chainId = String(params?.[0]?.chainId || '').toLowerCase();
      if (!(chainId in EVM_CHAINS)) {
        return { error: { code: 4902, message: `Celestial does not support chain ${chainId || '(none)'}. Use Ethereum mainnet or Sepolia.` } };
      }
      const { rpcUrls } = await chrome.storage.local.get('rpcUrls');
      const isTestnet = EVM_CHAINS[chainId] === 'sepolia';
      await setNetwork(isTestnet, rpcUrls?.[EVM_CHAINS[chainId]]);
      return { result: null };
    }

    case 'wallet_addEthereumChain': {
      // EIP-3085: the two built-in chains are already "added"; custom chains are not supported.
      const chainId = String(params?.[0]?.chainId || '').toLowerCase();
      if (chainId in EVM_CHAINS) return { result: null };
      return { error: { code: 4200, message: 'Celestial does not support adding custom networks.' } };
    }

    default: {
      return new Promise(async (resolve) => {
        try {
          const storage = await chrome.storage.local.get('rpcUrl');
          const rpcUrl = storage.rpcUrl || 'https://eth-mainnet.g.alchemy.com/v2/demo';
          
          const res = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method,
              params
            })
          });
          
          const data = await res.json();
          if (data.error) {
            resolve({ error: data.error });
          } else {
            resolve({ result: data.result });
          }
        } catch (err) {
          resolve({
            error: {
              code: 4200,
              message: `Celestial fallback RPC failed for method ${method}: ${err.message}`
            }
          });
        }
      });
    }
  }
}
