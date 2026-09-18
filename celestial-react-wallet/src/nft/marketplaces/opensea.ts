import { cached, marketGet, providerReachable } from './client.ts';
import type { CollectionStats, MarketplaceProvider } from './types.ts';

// ---- OpenSea — Ethereum (nft.md — Phase 4.1) ----------------------------------------
//
// OpenSea API v2 requires an `X-API-KEY` header on every route, so like Tensor it is
// reachable only through the Celestial API proxy.
//
// ⚠️ Shapes follow OpenSea's v2 docs; not yet verified against a live key.

interface OSContract {
  collection?: string; // collection slug
}

interface OSStats {
  total?: {
    floor_price?: number; // in ETH
    volume?: number;
  };
  intervals?: { interval?: string; volume?: number }[];
}

export const opensea: MarketplaceProvider = {
  id: 'opensea',
  chains: ['EVM'],

  isConfigured: (chain) => chain === 'EVM' && providerReachable('opensea'),

  async resolveCollections(nfts, _owner, signal) {
    const handles = new Map<string, string>();
    const contracts = [
      ...new Set(nfts.filter((n) => n.chain === 'EVM' && n.contract).map((n) => n.contract!.toLowerCase())),
    ];

    // One lookup per contract (cached for the popup session), not per token.
    const slugs = new Map<string, string | null>();
    await Promise.all(
      contracts.map(async (contract) => {
        try {
          const row = await cached(`os:contract:${contract}`, () =>
            marketGet<OSContract>('opensea', `/api/v2/chain/ethereum/contract/${contract}`, signal),
          );
          slugs.set(contract, row?.collection || null);
        } catch {
          slugs.set(contract, null); // one bad contract must not sink the batch
        }
      }),
    );

    for (const nft of nfts) {
      if (nft.chain !== 'EVM' || !nft.contract) continue;
      const slug = slugs.get(nft.contract.toLowerCase());
      if (slug) handles.set(nft.key, slug);
    }

    return handles;
  },

  getCollectionStats(handle, signal) {
    return cached(`os:stats:${handle}`, async () => {
      const raw = await marketGet<OSStats>('opensea', `/api/v2/collections/${encodeURIComponent(handle)}/stats`, signal);
      if (!raw) return null;
      const floor = raw.total?.floor_price;
      const daily = raw.intervals?.find((i) => i.interval === 'one_day')?.volume;
      return {
        source: 'opensea',
        handle,
        floorNative: typeof floor === 'number' && floor > 0 ? floor : null,
        listedCount: null,
        volume: daily ? { window: '24h', native: daily } : null,
        avgPrice24hNative: null,
        totalSupply: null,
        url: `https://opensea.io/collection/${encodeURIComponent(handle)}`,
        fetchedAt: Date.now(),
      } satisfies CollectionStats;
    });
  },
};
