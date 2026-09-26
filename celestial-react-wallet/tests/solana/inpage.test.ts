/* eslint-disable @typescript-eslint/no-explicit-any -- drives the untyped public/inpage.js and its page-world objects */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import {
  Keypair,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { base64ToBytes, bytesToBase64, decodeTransaction, signMessage, signTransaction } from '../../src/solana/signing.ts';

// public/inpage.js end to end: the real page provider, with the content script + background +
// approval popup replaced by a stand-in that signs with src/solana/signing.ts.

const me = Keypair.generate();
const BLOCKHASH = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const seen: { method: string; params: Record<string, unknown> }[] = [];
let rejectNext = false;

type Win = EventTarget & Record<string, any>;
const win = new EventTarget() as Win;
win.location = { origin: 'https://perps.test' };

const deliver = (data: unknown) => {
  const ev = new Event('message') as Event & { data?: unknown; source?: unknown };
  Object.assign(ev, { data, source: win });
  win.dispatchEvent(ev);
};

async function extension(payload: { method: string; params: Record<string, any> }) {
  const { method, params } = payload;
  seen.push({ method, params });
  if (rejectNext) {
    rejectNext = false;
    return { error: { code: 4001, message: 'User rejected the request.' } };
  }
  if (method === 'connect') return { result: { publicKey: me.publicKey.toBase58() } };
  if (method === 'signAllTransactions') {
    return { result: { transactions: params.transactions.map((b64: string) => bytesToBase64(signTransaction(decodeTransaction(b64), me.secretKey))) } };
  }
  if (method === 'signAndSendTransaction') {
    const signed = VersionedTransaction.deserialize(signTransaction(decodeTransaction(params.transactions[0]), me.secretKey));
    return { result: { signature: bs58.encode(signed.signatures[0]) } };
  }
  if (method === 'signMessage') return { result: { signature: bytesToBase64(await signMessage(base64ToBytes(params.message), me.secretKey)) } };
  return { error: { code: 4200, message: 'unsupported' } };
}

win.postMessage = (data: any) => {
  queueMicrotask(async () => {
    if (data?.target === 'celestial-content' && data.type === 'CELESTIAL_SOLANA_REQUEST') {
      const res = await extension(data.payload);
      deliver({ target: 'celestial-inpage', type: 'CELESTIAL_SOLANA_RESPONSE', id: data.id, ...res });
    } else {
      deliver(data);
    }
  });
};

// Capture the Wallet Standard registration, then load the real script.
let wallet: any;
win.addEventListener('wallet-standard:register-wallet', (e: Event) => (e as CustomEvent).detail({ register: (w: unknown) => (wallet = w) }));
const originalLog = console.log;
console.log = () => {};
new Function('window', readFileSync(new URL('../../public/inpage.js', import.meta.url), 'utf8'))(win);
console.log = originalLog;
const provider = win.solana;

const legacyTx = () =>
  new Transaction({ feePayer: me.publicKey, recentBlockhash: BLOCKHASH }).add(
    SystemProgram.transfer({ fromPubkey: me.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }),
  );

test('registers with the Wallet Standard and exposes window.solana / window.phantom.solana', () => {
  assert.equal(wallet?.name, 'Celestial Wallet');
  assert.ok(wallet.features['solana:signTransaction'] && wallet.features['solana:signMessage']);
  assert.equal(win.phantom.solana, provider);
});

test('standard:connect → account with the real public key bytes', async () => {
  const events: unknown[] = [];
  const off = wallet.features['standard:events'].on('change', (e: unknown) => events.push(e));
  const { accounts } = await wallet.features['standard:connect'].connect();
  off();
  assert.equal(accounts[0].address, me.publicKey.toBase58());
  assert.deepEqual(Array.from(accounts[0].publicKey), Array.from(me.publicKey.toBytes()));
  assert.deepEqual(Array.from(provider.publicKey.toBytes()), Array.from(me.publicKey.toBytes()));
  assert.equal(wallet.accounts.length, 1);
  assert.equal(events.length, 1, 'change event on connect');
});

test('solana:signTransaction (what the perps app calls) → signed bytes the dApp can rebuild', async () => {
  const [out] = await wallet.features['solana:signTransaction'].signTransaction({
    account: wallet.accounts[0],
    transaction: legacyTx().serialize({ requireAllSignatures: false, verifySignatures: false }),
    chain: 'solana:devnet',
  });
  const signed = Transaction.from(out.signedTransaction);
  assert.ok(signed.verifySignatures());
  const req = seen.at(-1)!;
  assert.equal(req.method, 'signAllTransactions');
  assert.equal(req.params.account, me.publicKey.toBase58());
  assert.equal(req.params.chain, 'solana:devnet');
});

test('window.solana.signTransaction / signAllTransactions return the dApp’s own classes', async () => {
  const signed = await provider.signTransaction(legacyTx());
  assert.ok(signed instanceof Transaction && signed.verifySignatures());

  const v0 = new VersionedTransaction(
    new TransactionMessage({ payerKey: me.publicKey, recentBlockhash: BLOCKHASH, instructions: legacyTx().instructions }).compileToV0Message(),
  );
  const [a, b] = await provider.signAllTransactions([legacyTx(), v0]);
  assert.ok(a instanceof Transaction && a.verifySignatures());
  assert.ok(b instanceof VersionedTransaction && b.version === 0);
});

test('signAndSendTransaction → base58 signature (legacy) / signature bytes (standard)', async () => {
  const legacy = await provider.signAndSendTransaction(legacyTx());
  assert.equal(bs58.decode(legacy.signature).length, 64);
  assert.equal(legacy.publicKey, me.publicKey.toBase58());
  const [std] = await wallet.features['solana:signAndSendTransaction'].signAndSendTransaction({
    account: wallet.accounts[0],
    transaction: legacyTx().serialize({ requireAllSignatures: false, verifySignatures: false }),
    chain: 'solana:devnet',
  });
  assert.equal(std.signature.length, 64);
});

test('solana:signMessage → Ed25519 signature that verifies', async () => {
  const message = new TextEncoder().encode('Sign in to Celestial');
  const [out] = await wallet.features['solana:signMessage'].signMessage({ account: wallet.accounts[0], message });
  const pub = await crypto.subtle.importKey('raw', new Uint8Array(me.publicKey.toBytes()), { name: 'Ed25519' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'Ed25519' }, pub, new Uint8Array(out.signature), message));
  assert.deepEqual(out.signedMessage, message);
});

test('user rejection keeps EIP-1193 code 4001 (dApps show “rejected”, not an error)', async () => {
  rejectNext = true;
  await assert.rejects(provider.signTransaction(legacyTx()), (e: Error & { code?: number }) => e.code === 4001);
});

test('signing before connect → 4100', async () => {
  await provider.disconnect();
  await assert.rejects(provider.signMessage(new Uint8Array([1])), (e: Error & { code?: number }) => e.code === 4100);
  assert.equal(wallet.accounts.length, 0);
});
