/* eslint-disable @typescript-eslint/no-explicit-any -- drives the untyped public/background.js through a chrome API stand-in */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// public/background.js with a stand-in chrome API: who may send which message, the origin shown
// in approval popups, chain switching, and the Solana signing queue.

const EXT_ID = 'celestialextensionid';
const storage: Record<string, any> = {};
let onMessage: (msg: any, sender: any, sendResponse: (r: any) => void) => boolean | void;
let onWindowRemoved: (id: number) => void = () => {};
const popupMessages: any[] = [];
const tabMessages: any[] = [];
const createdWindows: string[] = [];

const pick = (keys: string | string[] | undefined) => {
  if (keys === undefined) return { ...storage };
  const list = Array.isArray(keys) ? keys : [keys];
  return Object.fromEntries(list.filter((k) => k in storage).map((k) => [k, storage[k]]));
};

const chromeStub = {
  runtime: {
    id: EXT_ID,
    getURL: (path: string) => `chrome-extension://${EXT_ID}/${path}`,
    lastError: undefined as unknown,
    onMessage: { addListener: (fn: typeof onMessage) => (onMessage = fn) },
    // No popup is open: the background falls back to opening an approval window.
    sendMessage: (msg: any, cb?: (r: any) => void) => {
      popupMessages.push(msg);
      cb?.(undefined);
    },
  },
  storage: {
    local: {
      get: (keys: any, cb?: (r: any) => void) => (cb ? cb(pick(keys)) : Promise.resolve(pick(keys))),
      set: (items: Record<string, any>, cb?: () => void) => {
        Object.assign(storage, items);
        if (cb) cb();
        else return Promise.resolve();
      },
      remove: (key: string) => {
        delete storage[key];
        return Promise.resolve();
      },
    },
  },
  windows: {
    create: (opts: { url: string }, cb?: (w: { id: number }) => void) => {
      createdWindows.push(opts.url);
      cb?.({ id: createdWindows.length });
    },
    onRemoved: { addListener: (fn: typeof onWindowRemoved) => (onWindowRemoved = fn) },
  },
  tabs: {
    query: async () => [{ id: 7 }],
    sendMessage: (tabId: number, msg: any) => {
      tabMessages.push({ tabId, msg });
      return Promise.resolve();
    },
  },
};

new Function('chrome', readFileSync(new URL('../../public/background.js', import.meta.url), 'utf8'))(chromeStub);

const page = (url: string) => ({ id: EXT_ID, url, origin: new URL(url).origin, tab: { id: 7 } });
const extensionPage = { id: EXT_ID, url: `chrome-extension://${EXT_ID}/index.html` };

function send(msg: any, sender: any): Promise<any> {
  return new Promise((resolve) => {
    const async = onMessage(msg, sender, resolve);
    if (async !== true && async !== false) resolve(undefined);
  });
}

const vault = (id: string) => ({ version: 1, id, name: 'W', salt: 'c2FsdA==', mnemonic: { iv: 'aXY=', ciphertext: 'Y3Q=' }, createdAt: 1 });

test('VAULT_INIT from a random website is refused and nothing is stored', async () => {
  const res = await send({ type: 'VAULT_INIT', payload: { vault: vault('evil') } }, page('https://evil.example/claim'));
  assert.equal(res.success, false);
  assert.match(res.error, /onboarding site/);
  assert.equal(storage.celestial_dex_vault, undefined);
});

test('VAULT_INIT from the onboarding site is stored', async () => {
  const res = await send({ type: 'VAULT_INIT', payload: { vault: vault('w1') } }, page('http://localhost:5173/onboarding'));
  assert.equal(res.success, true);
  assert.deepEqual(storage.celestial_dex_vault.map((v: any) => v.id), ['w1']);
});

test('extension-only messages are refused from web pages (even via content.js)', async () => {
  for (const type of ['VAULT_STATE_GET', 'VAULT_UNLOCK', 'ACCOUNTS_UPDATE', 'CONNECTION_RESPOND', 'TX_RESOLVED', 'SOL_SIGN_RESOLVED', 'NETWORK_CHANGE']) {
    const res = await send({ type, payload: {} }, page('http://localhost:5173/'));
    assert.equal(res.success, false, type);
    assert.match(res.error, /not allowed from a web page/, type);
  }
  const other = await send({ type: 'VAULT_STATE_GET', payload: {} }, { id: 'another-extension', url: 'chrome-extension://another-extension/x' });
  assert.equal(other.success, false, 'other extensions are not trusted either');
});

test('the extension popup can use them', async () => {
  const res = await send({ type: 'VAULT_STATE_GET', payload: {} }, extensionPage);
  assert.equal(res.success, true);
  assert.equal(res.hasVault, true);
  assert.equal(res.isUnlocked, false);
  assert.equal(res.mnemonic, undefined);
});

test('approval popups show the real origin, not the one a page claims', async () => {
  const pending = send(
    { type: 'WEB3_REQUEST', payload: { method: 'eth_requestAccounts', params: [], origin: 'https://perps.celestial.example' } },
    page('https://phish.example/app'),
  );
  await new Promise((r) => setTimeout(r, 0));
  const incoming = popupMessages.findLast((m) => m.type === 'INCOMING_CONNECT');
  assert.equal(incoming.origin, 'https://phish.example');
  assert.match(createdWindows.at(-1)!, /origin=https%3A%2F%2Fphish\.example/);
  await send({ type: 'CONNECTION_RESPOND', payload: { id: incoming.id, success: false } }, extensionPage);
  assert.equal((await pending).error.code, 4001);
});

test('wallet_switchEthereumChain: Sepolia ⇄ mainnet switch and notify tabs; other chains → 4902', async () => {
  await send({ type: 'NETWORK_CHANGE', payload: { isTestnet: false, rpcUrl: 'https://main', rpcUrls: { mainnet: 'https://main', sepolia: 'https://sep' } } }, extensionPage);
  const ok = await send({ type: 'WEB3_REQUEST', payload: { method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] } }, page('http://localhost:3000/trade'));
  assert.equal(ok.result, null);
  assert.equal(storage.isTestnet, true);
  assert.equal(storage.rpcUrl, 'https://sep');
  assert.deepEqual(tabMessages.at(-1)!.msg, { type: 'CELESTIAL_NETWORK_CHANGED', chainId: '0xaa36a7' });
  const chainId = await send({ type: 'WEB3_REQUEST', payload: { method: 'eth_chainId' } }, page('http://localhost:3000/trade'));
  assert.equal(chainId.result, '0xaa36a7');

  const bad = await send({ type: 'WEB3_REQUEST', payload: { method: 'wallet_switchEthereumChain', params: [{ chainId: '0x89' }] } }, page('http://localhost:3000/trade'));
  assert.equal(bad.error.code, 4902);
  const add = await send({ type: 'WEB3_REQUEST', payload: { method: 'wallet_addEthereumChain', params: [{ chainId: '0x89' }] } }, page('http://localhost:3000/trade'));
  assert.equal(add.error.code, 4200);
});

test('Solana signing: request queued for the popup, answered by SOL_SIGN_RESOLVED', async () => {
  const pending = send(
    { type: 'SOLANA_REQUEST', payload: { method: 'signAllTransactions', params: { account: 'Acc1', chain: 'solana:devnet', transactions: ['AQID'] } } },
    page('http://localhost:3000/trade'),
  );
  await new Promise((r) => setTimeout(r, 0));
  const incoming = popupMessages.findLast((m) => m.type === 'INCOMING_SIGN_SOL');
  const stored = storage[`solreq_${incoming.id}`];
  assert.deepEqual({ method: stored.method, account: stored.account, chain: stored.chain, origin: stored.origin }, {
    method: 'signAllTransactions',
    account: 'Acc1',
    chain: 'solana:devnet',
    origin: 'http://localhost:3000',
  });
  await send({ type: 'SOL_SIGN_RESOLVED', payload: { id: incoming.id, result: { transactions: ['BAUG'] } } }, extensionPage);
  assert.deepEqual((await pending).result, { transactions: ['BAUG'] });
  assert.equal(storage[`solreq_${incoming.id}`], undefined, 'payload cleaned up');
});

test('Solana signing: closing the approval window rejects with 4001', async () => {
  const pending = send(
    { type: 'SOLANA_REQUEST', payload: { method: 'signMessage', params: { account: 'Acc1', message: 'aGk=' } } },
    page('http://localhost:3000/trade'),
  );
  await new Promise((r) => setTimeout(r, 0));
  onWindowRemoved(createdWindows.length);
  assert.equal((await pending).error.code, 4001);
});

test('Solana signing: malformed requests are refused without opening a window', async () => {
  const before = createdWindows.length;
  const noAccount = await send({ type: 'SOLANA_REQUEST', payload: { method: 'signTransaction', params: { transactions: ['AQID'] } } }, page('http://localhost:3000/'));
  assert.equal(noAccount.error.code, 4100);
  const empty = await send({ type: 'SOLANA_REQUEST', payload: { method: 'signAllTransactions', params: { account: 'Acc1', transactions: [] } } }, page('http://localhost:3000/'));
  assert.equal(empty.error.code, -32602);
  const unknown = await send({ type: 'SOLANA_REQUEST', payload: { method: 'drainWallet', params: {} } }, page('http://localhost:3000/'));
  assert.equal(unknown.error.code, 4200);
  assert.equal(createdWindows.length, before);
});
