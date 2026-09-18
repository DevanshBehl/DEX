import { cached, marketGet, providerReachable } from './client.ts';
import type { CollectionStats, MarketplaceProvider } from './types.ts';

// ---- Tensor — Solana (nft.md — Phase 4.1) -------------------------------------------
//
// Tensor's API requires an `x-tensor-api-key` header, so it is reachable only through
// the Celestial API proxy. Until that is deployed `isConfigured()` is false and the
// registry silently falls back to Magic Eden.
//
// ⚠️ Response shapes below follow Tensor's published REST v1 docs but have NOT been
// verified against a live key yet (see nft.md Open Question 1). Re-check when the
// partner key lands — the mappers are deliberately defensive about missing fields.

const LAMPORTS_PER_SOL = 1e9;

interface TensorMint {
  mint?: string;
  collId?: string;
  slug?: string;
}

interface TensorCollection {
  collId?: string;
  slug?: string;
  name?: string;
  statsV2?: {
    buyNowPrice?: string; // lamports
    numListed?: number;
    numMints?: number;
    volume24h?: string; // lamports
  };
}

const toSol = (lamports: string | undefined) => {
  const n = Number(lamports);
  return Number.isFinite(n) && n > 0 ? n / LAMPORTS_PER_SOL : null;
};

export const tensor: MarketplaceProvider = {
  id: 'tensor',
  chains: ['Solana'],

  isConfigured: (chain) => chain === 'Solana' && providerReachable('tensor'),

  async resolveCollections(nfts, _owner, signal) {
    const handles = new Map<string, string>();
    const solana = nfts.filter((n) => n.chain === 'Solana' && n.assetId);
    if (solana.length === 0) return handles;

    // Tensor resolves mints → collection ids in batches of 100.
    for (let i = 0; i < solana.length; i += 100) {
      const batch = solana.slice(i, i + 100);
      const mints = batch.map((n) => n.assetId!).join(',');
      const rows = await cached(`tensor:mints:${mints}`, () =>
        marketGet<TensorMint[]>('tensor', `/api/v1/mint?mints=${mints}`, signal),
      );
      const byMint = new Map((rows || []).filter((r) => r.mint).map((r) => [r.mint!, r]));
      for (const nft of batch) {
        const collId = byMint.get(nft.assetId!)?.collId;
        if (collId) handles.set(nft.key, collId);
      }
    }

    return handles;
  },

  getCollectionStats(handle, signal) {
    return cached(`tensor:stats:${handle}`, async () => {
      const rows = await marketGet<TensorCollection[]>('tensor', `/api/v1/collections?collId=${handle}`, signal);
      const collection = rows?.[0];
      if (!collection) return null;
      const stats = collection.statsV2;
      return {
        source: 'tensor',
        handle,
        floorNative: toSol(stats?.buyNowPrice),
        listedCount: stats?.numListed ?? null,
        volume: (() => {
          const native = toSol(stats?.volume24h);
          return native ? { window: '24h' as const, native } : null;
        })(),
        avgPrice24hNative: null,
        totalSupply: stats?.numMints ?? null,
        url: collection.slug ? `https://www.tensor.trade/trade/${collection.slug}` : null,
        fetchedAt: Date.now(),
      } satisfies CollectionStats;
    });
  },
};
