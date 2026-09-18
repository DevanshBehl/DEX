import type { NFTAsset, NFTChain } from './types.ts';

// ---- Persistence (nft.md — Phase 1.5 / 1.6) ----------------------------------------
//
// chrome.storage.local in the extension; localStorage when running `vite dev`.

export type NetworkMode = 'mainnet' | 'testnet';
export type VisibilityOverride = 'hidden' | 'visible';

const CACHE_VERSION = 'v1';

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local;
}

async function readKey<T>(key: string): Promise<T | null> {
  try {
    if (hasChromeStorage()) {
      const result = await chrome.storage.local.get(key);
      return (result[key] as T) ?? null;
    }
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function writeKey(key: string, value: unknown): Promise<void> {
  try {
    if (hasChromeStorage()) {
      await chrome.storage.local.set({ [key]: value });
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch (e) {
    console.warn('[nft] failed to persist', key, e);
  }
}

// ---- Ownership cache ---------------------------------------------------------------

export interface NFTCacheEntry {
  fetchedAt: number;
  assets: NFTAsset[];
}

const cacheKey = (network: NetworkMode, chain: NFTChain, owner: string) =>
  `celestial_nfts_${CACHE_VERSION}:${network}:${chain}:${chain === 'EVM' ? owner.toLowerCase() : owner}`;

export const readNFTCache = (network: NetworkMode, chain: NFTChain, owner: string) =>
  readKey<NFTCacheEntry>(cacheKey(network, chain, owner));

export const writeNFTCache = (network: NetworkMode, chain: NFTChain, owner: string, assets: NFTAsset[]) =>
  writeKey(cacheKey(network, chain, owner), { fetchedAt: Date.now(), assets } satisfies NFTCacheEntry);

// ---- User hide / show overrides ----------------------------------------------------
// Keyed by NFT key (globally unique: contract+tokenId or asset id) per network.

const visibilityKey = (network: NetworkMode) => `celestial_nft_visibility_${CACHE_VERSION}:${network}`;

export async function readVisibilityOverrides(network: NetworkMode): Promise<Record<string, VisibilityOverride>> {
  return (await readKey<Record<string, VisibilityOverride>>(visibilityKey(network))) || {};
}

export async function writeVisibilityOverride(
  network: NetworkMode,
  nftKey: string,
  value: VisibilityOverride | null,
): Promise<Record<string, VisibilityOverride>> {
  const current = await readVisibilityOverrides(network);
  if (value) current[nftKey] = value;
  else delete current[nftKey];
  await writeKey(visibilityKey(network), current);
  return current;
}

// ---- Recent NFT recipients ---------------------------------------------------------

const RECENT_LIMIT = 5;
const recentKey = (network: NetworkMode, chain: NFTChain) => `celestial_nft_recent_recipients_${CACHE_VERSION}:${network}:${chain}`;

export async function readRecentRecipients(network: NetworkMode, chain: NFTChain): Promise<string[]> {
  return (await readKey<string[]>(recentKey(network, chain))) || [];
}

export async function addRecentRecipient(network: NetworkMode, chain: NFTChain, address: string): Promise<void> {
  const same = (a: string) => (chain === 'EVM' ? a.toLowerCase() === address.toLowerCase() : a === address);
  const current = (await readRecentRecipients(network, chain)).filter((a) => !same(a));
  await writeKey(recentKey(network, chain), [address, ...current].slice(0, RECENT_LIMIT));
}
