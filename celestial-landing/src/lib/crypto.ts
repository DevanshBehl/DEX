/**
 * Browser-safe cryptographic utilities for Celestial wallet.
 * Uses native Web Crypto API — no external dependencies for crypto primitives.
 * 
 * Security:
 * - PBKDF2-SHA256 with 600,000 iterations
 * - AES-256-GCM with 12-byte random IV
 * - 16-byte random salt
 * - CryptoKey is non-extractable
 */

// ---- Encoding helpers -------------------------------------------------------

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export function fromBase64(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ---- Vault types -----------------------------------------------------------

export interface EncryptedPayload {
  iv: string;         // base64-encoded 12-byte IV
  ciphertext: string; // base64-encoded AES-GCM ciphertext (includes GCM tag)
}

export interface VaultBlob {
  version: 1;
  salt: string;                // base64-encoded 16-byte PBKDF2 salt
  mnemonic: EncryptedPayload;  // encrypted BIP-39 phrase
  createdAt: number;           // timestamp
}

// ---- PBKDF2 key derivation -------------------------------------------------

const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

export async function deriveKey(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
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
      salt: salt as any,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable — key bytes can never leave the JS VM
    ['encrypt', 'decrypt'],
  );
}

// ---- AES-256-GCM encrypt/decrypt -------------------------------------------

export async function encrypt(
  key: CryptoKey,
  plaintext: string,
): Promise<EncryptedPayload> {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext),
  );

  return {
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertextBuffer)),
  };
}

export async function decrypt(
  key: CryptoKey,
  payload: EncryptedPayload,
): Promise<string> {
  const iv = fromBase64(payload.iv);
  const ciphertext = fromBase64(payload.ciphertext);

  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as any },
    key,
    ciphertext as any,
  );

  return new TextDecoder().decode(plaintextBuffer);
}

// ---- High-level vault operations -------------------------------------------

/**
 * Creates an encrypted vault blob from a mnemonic and password.
 * The mnemonic is encrypted with AES-256-GCM using a PBKDF2-derived key.
 */
export async function createVaultBlob(
  mnemonic: string,
  password: string,
): Promise<VaultBlob> {
  const salt = generateSalt();
  const key = await deriveKey(password, salt);
  const encryptedMnemonic = await encrypt(key, mnemonic);

  return {
    version: 1,
    salt: toBase64(salt),
    mnemonic: encryptedMnemonic,
    createdAt: Date.now(),
  };
}

/**
 * Decrypts the mnemonic from a vault blob using the password.
 * Throws on wrong password (AES-GCM authentication fails).
 */
export async function decryptVaultMnemonic(
  vault: VaultBlob,
  password: string,
): Promise<string> {
  const salt = fromBase64(vault.salt);
  const key = await deriveKey(password, salt);
  return decrypt(key, vault.mnemonic);
}
