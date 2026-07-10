/**
 * 
 * 
 * Celestial Wallet — Inpage Provider (EIP-1193)
 *
 * Injected into every webpage by content.js.
 * Implements the EIP-1193 Ethereum Provider interface so dApps
 * (Uniswap, OpenSea, etc.) can detect and interact with Celestial.
 *
 * Message flow:
 *   dApp calls window.ethereum.request(...)
 *   → inpage.js posts CELESTIAL_PROVIDER_REQUEST to content.js
 *   → content.js forwards via chrome.runtime.sendMessage to background.js
 *   → background.js processes and returns result
 *   → content.js posts CELESTIAL_PROVIDER_RESPONSE back
 *   → inpage.js resolves the original Promise
 */

(function () {
  'use strict';

  // Prevent double-injection
  if (window.__celestialInjected) return;
  window.__celestialInjected = true;

  // ---- Request ID tracking --------------------------------------------------

  let _requestId = 0;
  const _pendingRequests = new Map(); // id → { resolve, reject }

  // ---- Event Emitter --------------------------------------------------------

  class EventEmitter {
    constructor() {
      this._listeners = {};
    }

    on(event, fn) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn);
      return this;
    }

    removeListener(event, fn) {
      if (!this._listeners[event]) return this;
      this._listeners[event] = this._listeners[event].filter((f) => f !== fn);
      return this;
    }

    emit(event, ...args) {
      if (!this._listeners[event]) return;
      for (const fn of this._listeners[event]) {
        try {
          fn(...args);
        } catch (e) {
          console.error(`[Celestial] Event listener error (${event}):`, e);
        }
      }
    }

    // Alias used by some dApps
    addListener(event, fn) {
      return this.on(event, fn);
    }

    removeAllListeners(event) {
      if (event) {
        delete this._listeners[event];
      } else {
        this._listeners = {};
      }
      return this;
    }
  }

  // ---- CelestialProvider (EIP-1193) -----------------------------------------

  class CelestialProvider extends EventEmitter {
    constructor() {
      super();

      // EIP-1193 / EIP-6963 identification
      this.isCelestial = true;
      this.isMetaMask = true; // Required for dApp compat (many check this)
      this.isCelestialWallet = true;

      // State
      this._chainId = '0x1';          // Ethereum Mainnet
      this._networkVersion = '1';
      this._selectedAddress = null;
      this._isConnected = false;
      this._accounts = [];
    }

    // ---- Core EIP-1193 method -----------------------------------------------

    async request({ method, params }) {
      if (!method || typeof method !== 'string') {
        throw this._rpcError(
          -32600,
          'Invalid request: method must be a non-empty string',
        );
      }

      // Handle locally-resolvable methods first (no round-trip needed)
      switch (method) {
        case 'eth_chainId':
        case 'net_version':
          return this._sendToBackground(method, params);

        case 'eth_accounts':
          return [...this._accounts];

        case 'eth_requestAccounts':
          // If already connected, return cached accounts
          if (this._accounts.length > 0) {
            return [...this._accounts];
          }
          // Otherwise, request connection via background
          return this._sendToBackground(method, params);

        // Methods that need the background / external RPC
        case 'eth_sendTransaction':
        case 'personal_sign':
        case 'eth_signTypedData_v4':
        case 'eth_signTypedData':
        case 'wallet_switchEthereumChain':
        case 'wallet_addEthereumChain':
        case 'eth_getBalance':
        case 'eth_call':
        case 'eth_estimateGas':
        case 'eth_blockNumber':
        case 'eth_getTransactionReceipt':
        case 'eth_getTransactionByHash':
        case 'eth_gasPrice':
        case 'eth_getCode':
          return this._sendToBackground(method, params);

        default:
          // Unsupported — throw EIP-1193 error code 4200
          throw this._rpcError(
            4200,
            `Celestial does not support the method: ${method}`,
          );
      }
    }

    // ---- Legacy methods (some dApps still use these) -------------------------

    enable() {
      return this.request({ method: 'eth_requestAccounts' });
    }

    send(methodOrPayload, callbackOrParams) {
      // Handle the two overloaded signatures:
      // 1. send(method, params) → Promise
      // 2. send({ method, params }, callback) → void
      if (typeof methodOrPayload === 'string') {
        return this.request({
          method: methodOrPayload,
          params: callbackOrParams,
        });
      }

      if (typeof callbackOrParams === 'function') {
        this.request(methodOrPayload)
          .then((result) => callbackOrParams(null, { result }))
          .catch((err) => callbackOrParams(err));
        return;
      }

      return this.request(methodOrPayload);
    }

    sendAsync(payload, callback) {
      this.request(payload)
        .then((result) => callback(null, { id: payload.id, jsonrpc: '2.0', result }))
        .catch((err) => callback(err));
    }

    // ---- Internal: message to content script → background -------------------

    _sendToBackground(method, params) {
      return new Promise((resolve, reject) => {
        const id = ++_requestId;
        _pendingRequests.set(id, { resolve, reject });

        window.postMessage(
          {
            target: 'celestial-content',
            type: 'CELESTIAL_PROVIDER_REQUEST',
            id,
            payload: { method, params, origin: window.location.origin },
          },
          '*',
        );

        // Timeout after 5 minutes (some methods like tx signing take time)
        setTimeout(() => {
          if (_pendingRequests.has(id)) {
            _pendingRequests.delete(id);
            reject(this._rpcError(-32603, 'Request timed out'));
          }
        }, 300_000);
      });
    }

    _rpcError(code, message) {
      const err = new Error(message);
      err.code = code;
      return err;
    }

    // ---- Handle responses from content script --------------------------------

    _handleResponse(id, error, result) {
      const pending = _pendingRequests.get(id);
      if (!pending) return;
      _pendingRequests.delete(id);

      if (error) {
        const err = new Error(error.message || 'Unknown error');
        err.code = error.code || -32603;
        pending.reject(err);
      } else {
        // Update internal state for account-related methods
        if (Array.isArray(result) && result.length > 0 && typeof result[0] === 'string' && result[0].startsWith('0x')) {
          this._accounts = result;
          this._selectedAddress = result[0];
          this._isConnected = true;
          this.emit('accountsChanged', result);
          this.emit('connect', { chainId: this._chainId });
        }
        pending.resolve(result);
      }
    }
  }

  // ---- CelestialSolanaProvider (Solana Wallet Adapter) ----------------------

  class CelestialSolanaProvider extends EventEmitter {
    constructor() {
      super();
      this.isCelestial = true;
      this.isPhantom = true; // Many dApps check for this specifically
      this.publicKey = null;
      this.isConnected = false;
    }

    async connect() {
      const response = await this._sendToBackground('connect', {});
      if (response && response.publicKey) {
        this.publicKey = {
          toString: () => response.publicKey,
          toBase58: () => response.publicKey,
          toBytes: () => new Uint8Array(), // stub
        };
        this.isConnected = true;
        this.emit('connect', this.publicKey);
        return { publicKey: this.publicKey };
      }
      throw new Error('Connection failed');
    }

    async disconnect() {
      this.publicKey = null;
      this.isConnected = false;
      this.emit('disconnect');
    }

    _sendToBackground(method, params) {
      return new Promise((resolve, reject) => {
        const id = ++_requestId;
        _pendingRequests.set(id, { resolve, reject });

        window.postMessage(
          {
            target: 'celestial-content',
            type: 'CELESTIAL_SOLANA_REQUEST',
            id,
            payload: { method, params, origin: window.location.origin },
          },
          '*',
        );

        setTimeout(() => {
          if (_pendingRequests.has(id)) {
            _pendingRequests.delete(id);
            reject(new Error('Request timed out'));
          }
        }, 300_000);
      });
    }
  }

  // ---- Instantiate and mount ------------------------------------------------

  const provider = new CelestialProvider();
  const solanaProvider = new CelestialSolanaProvider();

  // Listen for responses from the content script
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    if (event.data?.target === 'celestial-inpage' && event.data?.type === 'CELESTIAL_PROVIDER_RESPONSE') {
      const { id, error, result } = event.data;
      if (window.ethereum && window.ethereum._handleResponse) {
        window.ethereum._handleResponse(id, error, result);
      }
    }

    if (event.data?.target === 'celestial-inpage' && event.data?.type === 'CELESTIAL_NETWORK_CHANGED') {
      const { chainId } = event.data;
      if (window.ethereum) {
        window.ethereum._chainId = chainId;
        window.ethereum._networkVersion = chainId === '0x1' ? '1' : '11155111';
        window.ethereum.emit('chainChanged', chainId);
      }
    }

    if (event.data?.target === 'celestial-inpage' && event.data?.type === 'CELESTIAL_SOLANA_RESPONSE') {
      const pending = _pendingRequests.get(event.data.id);
      if (!pending) return;
      _pendingRequests.delete(event.data.id);
      
      if (event.data.error) {
        pending.reject(new Error(event.data.error.message || 'Unknown error'));
      } else {
        pending.resolve(event.data.result);
      }
    }
  });

  // Mount as window.ethereum (primary) and window.celestial (differentiator)
  try {
    Object.defineProperty(window, 'ethereum', {
      value: provider,
      writable: false,
      configurable: true, // Allow other extensions to override if needed
    });
  } catch (e) {
    console.warn('[Celestial Wallet] Could not define window.ethereum', e);
  }

  try {
    Object.defineProperty(window, 'celestial', {
      value: provider,
      writable: false,
      configurable: true,
    });
  } catch (e) {
    console.warn('[Celestial Wallet] Could not define window.celestial', e);
  }

  try {
    Object.defineProperty(window, 'solana', {
      value: solanaProvider,
      writable: false,
      configurable: true,
    });
  } catch (e) {
    console.warn('[Celestial Wallet] Could not define window.solana', e);
  }

  // Many Solana dApps (using @solana/wallet-adapter-phantom) explicitly look here
  try {
    if (!window.phantom) {
      window.phantom = {};
    }
    Object.defineProperty(window.phantom, 'solana', {
      value: solanaProvider,
      writable: false,
      configurable: true,
    });
  } catch (e) {
    console.warn('[Celestial Wallet] Could not define window.phantom.solana', e);
  }

  // ---- EIP-6963: Multi Injected Provider Discovery --------------------------

  const providerInfo = {
    uuid: 'a6813b1f-e3c3-4f9e-8c6c-84d7285a86ef',
    name: 'Celestial Wallet',
    // Simple star icon as base64 SVG
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwb2x5Z29uIHBvaW50cz0iMTIgMiAxNS4wOSA4LjI2IDIyIDkuMjcgMTcgMTQuMTQgMTguMTggMjEgMTIgMTcuNzcgNS44MiAyMSA3IDE0LjE0IDIgOS4yNyA4LjkxIDguMjYgMTIgMiIvPjwvc3ZnPg==',
    rdns: 'app.celestial.wallet', 
  };

  const announceProvider = () => {
    const event = new CustomEvent('eip6963:announceProvider', {
      detail: Object.freeze({
        info: providerInfo,
        provider: provider,
      }),
    });
    window.dispatchEvent(event);
  };

  // Announce when requested by a dApp
  window.addEventListener('eip6963:requestProvider', () => {
    announceProvider();
  });

  // Announce immediately (in case the request happened before we injected)
  announceProvider();

  // ---- Wallet Standard: Solana Provider Discovery ---------------------------

  const solanaWalletStandard = {
    version: '1.0.0',
    name: 'Celestial Wallet',
    icon: providerInfo.icon,
    chains: ['solana:mainnet', 'solana:devnet', 'solana:testnet'],
    features: {
      'standard:connect': {
        version: '1.0.0',
        connect: async () => {
          const res = await solanaProvider.connect();
          return {
            accounts: [
              {
                address: res.publicKey.toString(),
                publicKey: new Uint8Array(32), // standard expects 32 bytes
                chains: ['solana:mainnet', 'solana:devnet', 'solana:testnet'],
                features: ['solana:signAndSendTransaction', 'solana:signTransaction', 'solana:signMessage'],
              },
            ],
          };
        },
      },
      'standard:disconnect': {
        version: '1.0.0',
        disconnect: async () => {
          await solanaProvider.disconnect();
        },
      },
      'standard:events': {
        version: '1.0.0',
        on: (event, listener) => solanaProvider.on(event, listener),
      },
      'solana:signAndSendTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signAndSendTransaction: async () => {}, // Phase 3 stub
      },
      'solana:signTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signTransaction: async () => {}, // Phase 3 stub
      },
      'solana:signMessage': {
        version: '1.0.0',
        signMessage: async () => {}, // Phase 3 stub
      },
    },
    get accounts() {
      if (solanaProvider.publicKey) {
        return [{
          address: solanaProvider.publicKey.toString(),
          publicKey: new Uint8Array(32),
          chains: ['solana:mainnet', 'solana:devnet', 'solana:testnet'],
          features: ['solana:signAndSendTransaction', 'solana:signTransaction', 'solana:signMessage'],
        }];
      }
      return [];
    },
  };

  let registeredSolana = false;
  const registerCallback = ({ register }) => {
    if (registeredSolana) return;
    try {
      register(solanaWalletStandard);
      registeredSolana = true;
    } catch (e) {
      console.error('[Celestial Wallet] Wallet Standard registration failed', e);
    }
  };

  try {
    window.dispatchEvent(
      new CustomEvent('wallet-standard:register-wallet', {
        detail: registerCallback,
      })
    );
  } catch (e) {
    console.warn('[Celestial Wallet] Failed to dispatch register-wallet', e);
  }

  try {
    window.addEventListener('wallet-standard:app-ready', ({ detail: api }) => {
      registerCallback(api);
    });
  } catch (e) {
    console.warn('[Celestial Wallet] Failed to add app-ready listener', e);
  }

  console.log('[Celestial Wallet] Provider injected ✨');
})();