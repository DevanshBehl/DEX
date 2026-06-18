/**
 * Crypto utilities for the extension popup.
 * Mirrors the landing page's crypto.ts for type compatibility.
 */

export interface EncryptedPayload {
  iv: string;
  ciphertext: string;
}

export interface VaultBlob {
  version: 1;
  salt: string;
  mnemonic: EncryptedPayload;
  createdAt: number;
}

export function fromBase64(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function deriveKey(
  password: string,
  saltBase64: string,
): Promise<CryptoKey> {
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
      salt: salt as any,
      iterations: 600_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function decryptPayload(
  key: CryptoKey,
  payload: EncryptedPayload,
): Promise<string> {
  const iv = fromBase64(payload.iv);
  const ciphertext = fromBase64(payload.ciphertext);

  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as any },
    key,
    ciphertext as any,
  );

  return new TextDecoder().decode(plainBuffer);
}
