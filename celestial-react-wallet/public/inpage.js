/**
 * 
 * 
 * 
 * Celestial Wallet — Inpage Provider (EIP-1193)
 *
 * Injected into every webpage by content.js.
 * Implements the EIP-1193 Ethereum Provider interface so dApps
 * (Uniswap, OpenSea, etc.) can detect and in
 * 
 * 
 * 
 * teract with Celestial.
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
  const _pendingRequests = new Map(); // id → { resolve, reject, timer }
  const REQUEST_TIMEOUT_MS = 300_000; // 5 minutes: approvals wait for the user

  function _track(id, resolve, reject, onTimeout) {
    const timer = setTimeout(() => {
      if (_pendingRequests.delete(id)) onTimeout();
    }, REQUEST_TIMEOUT_MS);
    _pendingRequests.set(id, { resolve, reject, timer });
  }

  /** Remove a pending request and cancel its timeout; undefined if unknown. */
  function _takePending(id) {
    const pending = _pendingRequests.get(id);
    if (!pending) return undefined;
    _pendingRequests.delete(id);
    clearTimeout(pending.timer);
    return pending;
  }

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
          return this._sendToBackground(method, params);

        // Read-only JSON-RPC, proxied to the network RPC by the background.
        case 'eth_getBalance':
        case 'eth_call':
        case 'eth_estimateGas':
        case 'eth_blockNumber':
        case 'eth_getTransactionReceipt':
        case 'eth_getTransactionByHash':
        case 'eth_getTransactionCount':
        case 'eth_getBlockByNumber':
        case 'eth_getBlockByHash':
        case 'eth_getLogs':
        case 'eth_getStorageAt':
        case 'eth_feeHistory':
        case 'eth_maxPriorityFeePerGas':
        case 'eth_gasPrice':
        case 'eth_getCode':
        case 'eth_syncing':
        case 'web3_clientVersion':
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
        // Some methods (signing) wait for the user in the approval popup.
        _track(id, resolve, reject, () => reject(this._rpcError(-32603, 'Request timed out')));

        window.postMessage(
          {
            target: 'celestial-content',
            type: 'CELESTIAL_PROVIDER_REQUEST',
            id,
            payload: { method, params, origin: window.location.origin },
          },
          '*',
        );
      });
    }

    _rpcError(code, message) {
      const err = new Error(message);
      err.code = code;
      return err;
    }

    // ---- Handle responses from content script --------------------------------

    _handleResponse(id, error, result) {
      const pending = _takePending(id);
      if (!pending) return;

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

  // ---- Solana encoding helpers ----------------------------------------------

  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  function base58Decode(str) {
    const bytes = [0];
    for (const ch of str) {
      let carry = B58.indexOf(ch);
      if (carry < 0) throw new Error('Invalid base58 string');
      for (let i = 0; i < bytes.length; i++) {
        carry += bytes[i] * 58;
        bytes[i] = carry & 0xff;
        carry >>= 8;
      }
      while (carry > 0) {
        bytes.push(carry & 0xff);
        carry >>= 8;
      }
    }
    for (let i = 0; i < str.length && str[i] === '1'; i++) bytes.push(0);
    return new Uint8Array(bytes.reverse());
  }

  function toBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function fromBase64(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** Wire bytes of a web3.js Transaction / VersionedTransaction (or raw bytes). */
  function serializeTx(tx) {
    if (tx instanceof Uint8Array) return tx;
    // Legacy Transaction needs the flags (it is unsigned); VersionedTransaction ignores them.
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  }

  /** Rebuild the dApp's own transaction class from signed bytes. */
  function rebuildTx(original, bytes) {
    const C = original && original.constructor;
    if (C && typeof C.deserialize === 'function') return C.deserialize(bytes); // VersionedTransaction
    if (C && typeof C.from === 'function') return C.from(bytes); // legacy Transaction
    return bytes;
  }

  const SOLANA_CHAINS = ['solana:mainnet', 'solana:devnet', 'solana:testnet'];
  const SOLANA_FEATURES = ['solana:signAndSendTransaction', 'solana:signTransaction', 'solana:signMessage'];

  // ---- CelestialSolanaProvider (window.solana / window.phantom.solana) ------

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
        const address = response.publicKey;
        const bytes = base58Decode(address);
        this.publicKey = {
          toString: () => address,
          toBase58: () => address,
          toBytes: () => bytes.slice(),
          toJSON: () => address,
          equals: (other) => !!other && String(other.toBase58 ? other.toBase58() : other) === address,
        };
        this.isConnected = true;
        this.emit('connect', this.publicKey);
        this.emit('change', { accounts: solanaWalletStandard.accounts });
        return { publicKey: this.publicKey };
      }
      throw new Error('Connection failed');
    }

    async disconnect() {
      this.publicKey = null;
      this.isConnected = false;
      this.emit('disconnect');
      this.emit('change', { accounts: [] });
    }

    async signTransaction(transaction) {
      const [signed] = await this.signAllTransactions([transaction]);
      return signed;
    }

    async signAllTransactions(transactions) {
      const result = await this._request('signAllTransactions', {
        transactions: transactions.map((tx) => toBase64(serializeTx(tx))),
      });
      return result.transactions.map((b64, i) => rebuildTx(transactions[i], fromBase64(b64)));
    }

    async signAndSendTransaction(transaction, options) {
      const result = await this._request('signAndSendTransaction', {
        transactions: [toBase64(serializeTx(transaction))],
        options,
      });
      return { signature: result.signature, publicKey: this.publicKey.toBase58() };
    }

    async signMessage(message) {
      const result = await this._request('signMessage', { message: toBase64(message) });
      return { signature: fromBase64(result.signature), publicKey: this.publicKey };
    }

    /** Signing request for the connected account (or the account a Wallet Standard input names). */
    _request(method, params) {
      const account = params.account || (this.publicKey && this.publicKey.toBase58());
      if (!account) {
        const err = new Error('Connect Celestial Wallet first.');
        err.code = 4100;
        return Promise.reject(err);
      }
      return this._sendToBackground(method, { ...params, account });
    }

    _sendToBackground(method, params) {
      return new Promise((resolve, reject) => {
        const id = ++_requestId;
        _track(id, resolve, reject, () => reject(new Error('Request timed out')));

        window.postMessage(
          {
            target: 'celestial-content',
            type: 'CELESTIAL_SOLANA_REQUEST',
            id,
            payload: { method, params, origin: window.location.origin },
          },
          '*',
        );
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
      const pending = _takePending(event.data.id);
      if (!pending) return;

      if (event.data.error) {
        const err = new Error(event.data.error.message || 'Unknown error');
        if (event.data.error.code !== undefined) err.code = event.data.error.code;
        pending.reject(err);
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

  const standardAccount = (address) => ({
    address,
    publicKey: base58Decode(address),
    chains: SOLANA_CHAINS,
    features: SOLANA_FEATURES,
  });

  const solanaWalletStandard = {
    version: '1.0.0',
    name: 'Celestial Wallet',
    icon: providerInfo.icon,
    chains: SOLANA_CHAINS,
    features: {
      'standard:connect': {
        version: '1.0.0',
        connect: async () => {
          const res = await solanaProvider.connect();
          return { accounts: [standardAccount(res.publicKey.toBase58())] };
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
        on: (event, listener) => {
          solanaProvider.on(event, listener);
          return () => solanaProvider.removeListener(event, listener);
        },
      },
      'solana:signTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        // All inputs are approved together in one popup (they share the first input's account).
        signTransaction: async (...inputs) => {
          const result = await solanaProvider._request('signAllTransactions', {
            account: inputs[0] && inputs[0].account && inputs[0].account.address,
            chain: inputs[0] && inputs[0].chain,
            transactions: inputs.map((input) => toBase64(input.transaction)),
          });
          return result.transactions.map((b64) => ({ signedTransaction: fromBase64(b64) }));
        },
      },
      'solana:signAndSendTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signAndSendTransaction: async (...inputs) => {
          const outputs = [];
          for (const input of inputs) {
            const result = await solanaProvider._request('signAndSendTransaction', {
              account: input.account && input.account.address,
              chain: input.chain,
              transactions: [toBase64(input.transaction)],
              options: input.options,
            });
            outputs.push({ signature: base58Decode(result.signature) });
          }
          return outputs;
        },
      },
      'solana:signMessage': {
        version: '1.0.0',
        signMessage: async (...inputs) => {
          const outputs = [];
          for (const input of inputs) {
            const result = await solanaProvider._request('signMessage', {
              account: input.account && input.account.address,
              message: toBase64(input.message),
            });
            outputs.push({ signedMessage: input.message, signature: fromBase64(result.signature) });
          }
          return outputs;
        },
      },
    },
    get accounts() {
      return solanaProvider.publicKey ? [standardAccount(solanaProvider.publicKey.toBase58())] : [];
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