import { CONFIG } from '../../config/networks.ts';
import type { MarketplaceId } from './types.ts';

// ---- Shared marketplace HTTP client (nft.md — Phase 4.2) ---------------------------
//
// Every partner request goes through here so key handling lives in exactly one place.
//
//   CELESTIAL_API_URL set  → requests go to the proxy, which injects partner keys
//                            server-side. Nothing secret ships in the extension.
//   CELESTIAL_API_URL unset → direct calls to whatever is keyless (Magic Eden's public
//                            v2 read API). Key-gated providers report
//                            `isConfigured() === false` and are simply skipped.
//
// A partner key is never read from `import.meta.env` here: anything in `VITE_*` is
// baked into the bundle in plaintext, which would break the Phase 4 acceptance
// criterion "no partner API key present in the built extension bundle".

const DIRECT_BASES: Record<MarketplaceId, string | null> = {
  magiceden: 'https://api-mainnet.magiceden.dev',
  tensor: null, // requires `x-tensor-api-key` → proxy only
  opensea: null, // requires `X-API-KEY` → proxy only
};

const TIMEOUT_MS = 8000;

export function proxyBase(): string {
  return (CONFIG.CELESTIAL_API_URL || '').replace(/\/+$/, '');
}

/** True when this provider can be reached at all (directly or through the proxy). */
export function providerReachable(id: MarketplaceId): boolean {
  return !!proxyBase() || !!DIRECT_BASES[id];
}

function endpoint(id: MarketplaceId, path: string): string {
  const base = proxyBase();
  if (base) return `${base}/market/${id}${path}`;
  const direct = DIRECT_BASES[id];
  if (!direct) throw new MarketUnavailableError(`${id} requires the Celestial API proxy`);
  return `${direct}${path}`;
}

export class MarketUnavailableError extends Error {}

/**
 * GET JSON from a marketplace.
 *
 * @returns parsed body, or `null` for 404 / 204 — "this collection isn't on this
 * marketplace" is a normal answer, not an error.
 * @throws on network failure, rate limiting (429) or a 5xx, so the caller can decide
 * whether to fall back to another provider.
 */
export async function marketGet<T>(id: MarketplaceId, path: string, signal?: AbortSignal): Promise<T | null> {
  const url = endpoint(id, path);
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const res = await fetch(url, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: { accept: 'application/json' },
  });

  if (res.status === 404 || res.status === 204) return null;
  if (res.status === 429) throw new Error(`${id}: rate limited`);
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

// ---- TTL cache ---------------------------------------------------------------------
//
// Floor prices move slowly relative to a popup session; re-fetching on every render
// would burn the shared public rate limit within seconds.

const STATS_TTL_MS = 10 * 60 * 1000;

interface CacheEntry<T> {
  value: T;
  at: number;
}

const memory = new Map<string, CacheEntry<unknown>>();

/**
 * `{ hit: false }` vs `{ hit: true, value: null }` are different answers: "no stats
 * for this collection" is worth caching, otherwise every unlisted NFT re-queries the
 * provider on each render.
 */
export function readCache<T>(key: string, ttl = STATS_TTL_MS): { hit: true; value: T } | { hit: false } {
  const entry = memory.get(key);
  if (!entry || Date.now() - entry.at > ttl) return { hit: false };
  return { hit: true, value: entry.value as T };
}

export function writeCache<T>(key: string, value: T): T {
  memory.set(key, { value, at: Date.now() });
  return value;
}

/** Runs `fn` at most once per `key` per TTL, sharing in-flight requests. */
const inflight = new Map<string, Promise<unknown>>();

export async function cached<T>(key: string, fn: () => Promise<T>, ttl = STATS_TTL_MS): Promise<T> {
  const hit = readCache<T>(key, ttl);
  if (hit.hit) return hit.value;

  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = fn()
    .then((value) => writeCache(key, value))
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/** Test seam — clears memoized stats between cases. */
export function __clearMarketCache(): void {
  memory.clear();
  inflight.clear();
}
