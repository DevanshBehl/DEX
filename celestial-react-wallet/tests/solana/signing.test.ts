import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  SolanaSignError,
  assertSigner,
  base64ToBytes,
  bytesToBase64,
  clusterFor,
  decodeTransaction,
  displayMessage,
  signMessage,
  signTransaction,
  summarize,
} from '../../src/solana/signing.ts';

// Solana dApp signing — what the popup does with a request (no network)

const BLOCKHASH = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';

function legacyTransfer(from: PublicKey, to: PublicKey): Transaction {
  const tx = new Transaction({ feePayer: from, recentBlockhash: BLOCKHASH });
  tx.add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: 1_000 }));
  return tx;
}

/** Bytes exactly as a dApp sends them: unsigned, serialized without signature checks. */
const dappBytes = (tx: Transaction) => tx.serialize({ requireAllSignatures: false, verifySignatures: false });

test('base64 round-trip', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 255]);
  assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
});

test('cluster: the dApp chain wins, else the wallet network', () => {
  assert.equal(clusterFor('solana:devnet', false), 'devnet');
  assert.equal(clusterFor('solana:mainnet', true), 'mainnet');
  assert.equal(clusterFor('solana:testnet', false), 'testnet');
  assert.equal(clusterFor(undefined, true), 'devnet');
  assert.equal(clusterFor(undefined, false), 'mainnet');
});

test('legacy transaction: decode, summarise, sign — the dApp can rebuild it and the signature verifies', () => {
  const me = Keypair.generate();
  const to = Keypair.generate().publicKey;
  const tx = decodeTransaction(bytesToBase64(dappBytes(legacyTransfer(me.publicKey, to))));
  const s = summarize(tx);
  assert.equal(s.version, 'legacy');
  assert.equal(s.feePayer, me.publicKey.toBase58());
  assert.deepEqual(s.signers, [me.publicKey.toBase58()]);
  assert.deepEqual(s.programs, [{ id: SystemProgram.programId.toBase58(), name: 'System Program' }]);
  assert.equal(s.recentBlockhash, BLOCKHASH);

  const signed = Transaction.from(signTransaction(tx, me.secretKey)); // what the perps app does
  assert.ok(signed.verifySignatures(), 'signature valid for the legacy message');
  assert.equal(signed.feePayer?.toBase58(), me.publicKey.toBase58());
});

test('v0 transaction: signed in place, deserialises as versioned', () => {
  const me = Keypair.generate();
  const msg = new TransactionMessage({
    payerKey: me.publicKey,
    recentBlockhash: BLOCKHASH,
    instructions: [SystemProgram.transfer({ fromPubkey: me.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 5 })],
  }).compileToV0Message();
  const tx = decodeTransaction(bytesToBase64(new VersionedTransaction(msg).serialize()));
  assert.equal(summarize(tx).version, 0);
  const signed = VersionedTransaction.deserialize(signTransaction(tx, me.secretKey));
  assert.equal(signed.version, 0);
  assert.notDeepEqual(signed.signatures[0], new Uint8Array(64), 'signature slot filled');
});

test('keeps a co-signer signature that was already present', () => {
  const me = Keypair.generate();
  const other = Keypair.generate();
  const tx = legacyTransfer(me.publicKey, Keypair.generate().publicKey);
  tx.add(SystemProgram.transfer({ fromPubkey: other.publicKey, toPubkey: me.publicKey, lamports: 1 }));
  tx.partialSign(other);
  const signed = Transaction.from(signTransaction(decodeTransaction(bytesToBase64(dappBytes(tx))), me.secretKey));
  assert.ok(signed.verifySignatures(), 'both signatures valid');
});

test('refuses to sign a transaction that does not need our account', () => {
  const me = Keypair.generate();
  const stranger = Keypair.generate();
  const tx = decodeTransaction(bytesToBase64(dappBytes(legacyTransfer(stranger.publicKey, me.publicKey))));
  assert.throws(() => assertSigner(tx, me.publicKey.toBase58()), SolanaSignError);
  assert.throws(() => signTransaction(tx, me.secretKey), SolanaSignError);
});

test('garbage bytes → readable decode error', () => {
  assert.throws(() => decodeTransaction(bytesToBase64(new Uint8Array([1, 2, 3]))), /could not be decoded/);
});

test('signMessage: WebCrypto Ed25519 signature verifies against the account public key', async () => {
  const me = Keypair.generate();
  const message = new TextEncoder().encode('Sign in to Celestial Perps\nNonce: 42');
  const sig = await signMessage(message, me.secretKey);
  assert.equal(sig.length, 64);
  const pub = await crypto.subtle.importKey('raw', new Uint8Array(me.publicKey.toBytes()), { name: 'Ed25519' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'Ed25519' }, pub, new Uint8Array(sig), message));
  assert.deepEqual(await signMessage(message, me.secretKey), sig, 'deterministic');
});

test('message display: text when printable UTF-8, hex otherwise', () => {
  assert.deepEqual(displayMessage(new TextEncoder().encode('hello\nworld')), { text: 'hello\nworld', isUtf8: true });
  assert.deepEqual(displayMessage(new Uint8Array([0, 255, 16])), { text: '00ff10', isUtf8: false });
});
