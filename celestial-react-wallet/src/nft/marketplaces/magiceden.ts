import { cached, marketGet, providerReachable, proxyBase } from './client.ts';
import type { CollectionStats, CollectionSummary, MarketplaceProvider } from './types.ts';

// ---- Magic Eden (nft.md — Phase 4.1) ------------------------------------------------
//
// The default provider on both chains: its v2 read API is keyless, so floor prices
// work out of the box while Tensor/OpenSea wait on partner keys.
//
// Solana collections are keyed by *symbol* ("okay_bears"), which is Magic Eden's own
// identifier and is not derivable from the on-chain collection mint. The wallet
// endpoint gives us mint → symbol for everything the user owns in one request.

const LAMPORTS_PER_SOL = 1e9;

interface MEWalletToken {
  mintAddress?: string;
  collection?: string; // Magic Eden symbol
}

// Verified live against api-mainnet.magiceden.dev (2026-09): the keyless stats route
// returns exactly these fields. Note there is NO 24h volume — only `volume7d`.
interface MESolanaStats {
  symbol?: string;
  floorPrice?: number; // lamports
  listedCount?: number;
  avgPrice24hr?: number; // lamports
  volume7d?: number; // lamports
}

interface MEEvmCollection {
  id?: string;
  slug?: string;
  tokenCount?: string | number;
  onSaleCount?: string | number;
  floorAsk?: { price?: { amount?: { native?: number } } };
  volume?: { '1day'?: number };
}

/** Solana: mint → Magic Eden collection symbol, for every NFT in the wallet. */
async function resolveSolanaSymbols(owner: string, signal?: AbortSignal): Promise<Map<string, string>> {
  const byMint = new Map<string, string>();
  const tokens = await marketGet<MEWalletToken[]>(
    'magiceden',
    `/v2/wallets/${owner}/tokens?limit=500`,
    signal,
  );
  for (const token of tokens || []) {
    if (token.mintAddress && token.collection) byMint.set(token.mintAddress, token.collection);
  }
  return byMint;
}

async function solanaStats(symbol: string, signal?: AbortSignal): Promise<CollectionStats | null> {
  const raw = await marketGet<MESolanaStats>('magiceden', `/v2/collections/${encodeURIComponent(symbol)}/stats`, signal);
  if (!raw) return null;
  return {
    source: 'magiceden',
    handle: symbol,
    // A collection with nothing listed reports floorPrice 0 — that's "no floor", not free.
    floorNative: raw.floorPrice ? raw.floorPrice / LAMPORTS_PER_SOL : null,
    listedCount: raw.listedCount ?? null,
    volume: raw.volume7d ? { window: '7d', native: raw.volume7d / LAMPORTS_PER_SOL } : null,
    avgPrice24hNative: raw.avgPrice24hr ? raw.avgPrice24hr / LAMPORTS_PER_SOL : null,
    totalSupply: null,
    url: `https://magiceden.io/marketplace/${encodeURIComponent(symbol)}`,
    fetchedAt: Date.now(),
  };
}

/**
 * Magic Eden's EVM surface is the Reservoir-compatible RTP API, keyed by contract.
 *
 * ⚠️ Unlike the Solana routes, this one is NOT keyless: called without an API key it
 * answers `400 "Not Found."`. It is therefore gated behind the proxy in
 * `isConfigured('EVM')`, and this response shape is still **unverified** — re-check it
 * when a partner key lands.
 */
async function evmStats(contract: string, signal?: AbortSignal): Promise<CollectionStats | null> {
  const raw = await marketGet<{ collections?: MEEvmCollection[] }>(
    'magiceden',
    `/v3/rtp/ethereum/collections/v7?id=${contract}&limit=1`,
    signal,
  );
  const collection = raw?.collections?.[0];
  if (!collection) return null;

  const floor = collection.floorAsk?.price?.amount?.native;
  const toNumber = (v: string | number | undefined) => (v === undefined ? null : Number(v) || null);
  return {
    source: 'magiceden',
    handle: contract,
    floorNative: typeof floor === 'number' && floor > 0 ? floor : null,
    listedCount: toNumber(collection.onSaleCount),
    volume: collection.volume?.['1day'] ? { window: '24h', native: collection.volume['1day'] } : null,
    avgPrice24hNative: null,
    totalSupply: toNumber(collection.tokenCount),
    url: `https://magiceden.io/collections/ethereum/${contract}`,
    fetchedAt: Date.now(),
  };
}

// ---- Explore (nft.md — Phase 4.3) --------------------------------------------------
//
// Magic Eden has no keyless "trending collections" route: `popular_collections` returns
// an empty array, and `/v2/collections` pages through arbitrary unranked collections
// with no stats attached. So without the proxy, Explore shows this curated set with
// *live* stats fetched per collection, and reports `ranked: false` so the UI can label
// it "Featured" rather than pretending it is a volume ranking.
//
// Names are hardcoded because the per-collection metadata route (`/v2/collections/
// {symbol}`) answers 429 to unauthenticated callers even when `/stats` and `/listings`
// return 200 at the same moment — verified 2026-09. Thumbnails come from a listing
// instead, which is on a route that does work.
const CURATED_SOLANA: { symbol: string; name: string }[] = [
  { symbol: 'mad_lads', name: 'Mad Lads' },
  { symbol: 'claynosaurz', name: 'Claynosaurz' },
  { symbol: 'solana_monkey_business', name: 'Solana Monkey Business' },
  { symbol: 'degods', name: 'DeGods' },
  { symbol: 'okay_bears', name: 'Okay Bears' },
  { symbol: 'famous_fox_federation', name: 'Famous Fox Federation' },
  { symbol: 'lifinity_flares', name: 'Lifinity Flares' },
  { symbol: 'cets_on_creck', name: 'Cets on Creck' },
];

interface MECollectionMeta {
  symbol?: string;
  name?: string;
  description?: string;
  image?: string;
  isBadged?: boolean;
}

interface MEListing {
  tokenMint?: string;
  price?: number; // already SOL, not lamports
  seller?: string;
  expiry?: number; // -1 when the listing has no expiry
  extra?: { img?: string };
  token?: { name?: string };
}

function toCollectionSummary(raw: MECollectionMeta, fallbackHandle: string): CollectionSummary {
  return {
    chain: 'Solana',
    handle: raw.symbol || fallbackHandle,
    name: raw.name || fallbackHandle,
    image: raw.image || null,
    description: raw.description || null,
    verified: !!raw.isBadged,
  };
}

export const magicEden: MarketplaceProvider = {
  id: 'magiceden',
  chains: ['EVM', 'Solana'],

  // Solana v2 is keyless; the EVM/RTP routes reject unauthenticated callers, so EVM
  // market data only appears once the proxy is configured.
  isConfigured: (chain) => (chain === 'Solana' ? providerReachable('magiceden') : !!proxyBase()),

  async resolveCollections(nfts, owner, signal) {
    const handles = new Map<string, string>();

    // EVM: the contract address *is* the handle — no lookup needed.
    for (const nft of nfts) {
      if (nft.chain === 'EVM' && nft.contract) handles.set(nft.key, nft.contract.toLowerCase());
    }

    const solana = nfts.filter((n) => n.chain === 'Solana' && n.assetId);
    if (solana.length > 0) {
      const symbols = await cached(`me:wallet:${owner}`, () => resolveSolanaSymbols(owner, signal));
      for (const nft of solana) {
        const symbol = symbols.get(nft.assetId!);
        if (symbol) handles.set(nft.key, symbol);
      }
    }

    return handles;
  },

  getCollectionStats(handle, signal) {
    // EVM handles are 0x-prefixed contracts; Solana handles are Magic Eden symbols.
    const isEvm = /^0x[0-9a-f]{40}$/i.test(handle);
    return cached(`me:stats:${handle}`, () =>
      isEvm ? evmStats(handle, signal) : solanaStats(handle, signal),
    );
  },

  /**
   * ⚠️ Keyless callers get 429 from this route in practice (verified 2026-09), so
   * Explore does not depend on it. Kept for when the proxy supplies a key.
   */
  getCollection(handle, signal) {
    return cached(`me:collection:${handle}`, async () => {
      const raw = await marketGet<MECollectionMeta>('magiceden', `/v2/collections/${encodeURIComponent(handle)}`, signal);
      return raw ? toCollectionSummary(raw, handle) : null;
    });
  },

  async getListings(handle, cursor, signal) {
    // Magic Eden pages listings by numeric offset, in multiples of the limit.
    const offset = Number(cursor) || 0;
    const limit = 20;
    const raw = await cached(`me:listings:${handle}:${offset}`, () =>
      marketGet<MEListing[]>(
        'magiceden',
        `/v2/collections/${encodeURIComponent(handle)}/listings?offset=${offset}&limit=${limit}`,
        signal,
      ),
    );

    const items = (raw || [])
      .filter((l) => typeof l.price === 'number' && l.price > 0)
      .map((l) => ({
        source: 'magiceden' as const,
        priceNative: l.price!,
        seller: l.seller || null,
        ref: l.tokenMint || '',
        // -1 means "no expiry"; the API reports seconds, we keep ms internally.
        expiresAt: l.expiry && l.expiry > 0 ? l.expiry * 1000 : null,
        name: l.token?.name || null,
        image: l.extra?.img || null,
        assetRef: l.tokenMint || null,
      }));

    return { items, cursor: items.length === limit ? String(offset + limit) : null };
  },

  async getExploreCollections(signal) {
    const collections = await Promise.all(
      CURATED_SOLANA.map(async ({ symbol, name }): Promise<CollectionSummary> => {
        // Best-effort thumbnail from a single listing; the row renders fine without it.
        const image = await cached(`me:thumb:${symbol}`, () =>
          marketGet<MEListing[]>('magiceden', `/v2/collections/${encodeURIComponent(symbol)}/listings?offset=0&limit=1`, signal),
        )
          .then((listing) => listing?.[0]?.extra?.img || null)
          .catch(() => null);
        return { chain: 'Solana', handle: symbol, name, image, description: null, verified: true };
      }),
    );
    return { collections, ranked: false };
  },
};

/** Test seam. */
export const __magicEdenInternals = { solanaStats, evmStats, resolveSolanaSymbols };
