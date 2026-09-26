// ---- Solana dApp signing (docs/wallet.md — Solana provider) ---------------------------
// Pure helpers behind the Solana signature popup: decode what a dApp asked us to sign, check the
// wallet's account really is a required signer, summarise it for the user, and sign locally.
// Keys never leave this module's callers; nothing here talks to the network.

import { Keypair, VersionedTransaction } from '@solana/web3.js';

export type SolanaSignMethod = 'signTransaction' | 'signAllTransactions' | 'signAndSendTransaction' | 'signMessage';

export const SOLANA_SIGN_METHODS: readonly SolanaSignMethod[] = [
  'signTransaction',
  'signAllTransactions',
  'signAndSendTransaction',
  'signMessage',
];

/** What the background stores for the popup under `solreq_<id>` (transactions / message base64). */
export interface SolanaSignRequest {
  method: SolanaSignMethod;
  account: string;
  chain?: string;
  transactions?: string[];
  message?: string;
  options?: { skipPreflight?: boolean; preflightCommitment?: string; maxRetries?: number };
  origin?: string;
}

export type SolanaCluster = 'mainnet' | 'devnet' | 'testnet';

export class SolanaSignError extends Error {}

const KNOWN_PROGRAMS: Record<string, string> = {
  '11111111111111111111111111111111': 'System Program',
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: 'Token Program',
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: 'Token-2022 Program',
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: 'Associated Token Program',
  ComputeBudget111111111111111111111111111111: 'Compute Budget',
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: 'Memo Program',
  metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s: 'Token Metadata',
  CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d: 'Metaplex Core',
  BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY: 'Bubblegum',
};

// ---- encoding ----

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// ---- request handling ----

/** Cluster the dApp asked for (Wallet Standard `solana:<cluster>`), else the wallet's network. */
export function clusterFor(chain: string | undefined, isTestnet: boolean): SolanaCluster {
  if (chain === 'solana:mainnet') return 'mainnet';
  if (chain === 'solana:devnet') return 'devnet';
  if (chain === 'solana:testnet') return 'testnet';
  return isTestnet ? 'devnet' : 'mainnet';
}

export function decodeTransaction(b64: string): VersionedTransaction {
  try {
    return VersionedTransaction.deserialize(base64ToBytes(b64));
  } catch {
    throw new SolanaSignError('The site sent a transaction that could not be decoded.');
  }
}

export interface TransactionSummary {
  version: 'legacy' | number;
  feePayer: string;
  /** accounts that must sign (fee payer first) */
  signers: string[];
  programs: { id: string; name: string }[];
  instructionCount: number;
  recentBlockhash: string;
}

export function summarize(tx: VersionedTransaction): TransactionSummary {
  const msg = tx.message;
  const keys = msg.staticAccountKeys.map((k) => k.toBase58());
  const signers = keys.slice(0, msg.header.numRequiredSignatures);
  const programIds = [...new Set(msg.compiledInstructions.map((ix) => keys[ix.programIdIndex]))];
  return {
    version: tx.version,
    feePayer: keys[0],
    signers,
    programs: programIds.map((id) => ({ id, name: KNOWN_PROGRAMS[id] ?? 'Unknown program' })),
    instructionCount: msg.compiledInstructions.length,
    recentBlockhash: msg.recentBlockhash,
  };
}

/** Refuse to sign unless `account` is one of the transaction's required signers. */
export function assertSigner(tx: VersionedTransaction, account: string): void {
  if (!summarize(tx).signers.includes(account)) {
    throw new SolanaSignError('This transaction does not need a signature from your account — refusing to sign it.');
  }
}

/** Signs in place (other signers' signatures are kept) and returns the wire bytes. */
export function signTransaction(tx: VersionedTransaction, secretKey: Uint8Array): Uint8Array {
  const kp = Keypair.fromSecretKey(secretKey);
  assertSigner(tx, kp.publicKey.toBase58());
  tx.sign([kp]);
  return tx.serialize();
}

// ---- messages ----

// PKCS#8 wrapper for a raw 32-byte Ed25519 seed (RFC 8410).
const ED25519_PKCS8_PREFIX = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);

/** Ed25519 signature over `message` with WebCrypto (deterministic, same as nacl.sign.detached). */
export async function signMessage(message: Uint8Array, secretKey: Uint8Array): Promise<Uint8Array> {
  const pkcs8 = new Uint8Array(48);
  pkcs8.set(ED25519_PKCS8_PREFIX);
  pkcs8.set(secretKey.slice(0, 32), 16);
  const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, new Uint8Array(message)));
}

/** Show a message as text when it is printable UTF-8, otherwise as hex. */
export function displayMessage(message: Uint8Array): { text: string; isUtf8: boolean } {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(message);
    // eslint-disable-next-line no-control-regex
    if (!/[\u0000-\u0008\u000e-\u001f\u007f]/.test(text)) return { text, isUtf8: true };
  } catch {
    /* not UTF-8 */
  }
  return { text: Array.from(message, (b) => b.toString(16).padStart(2, '0')).join(''), isUtf8: false };
}
