import type { NFTAsset, NFTChain } from '../types.ts';
import { magicEden } from './magiceden.ts';
import { opensea } from './opensea.ts';
import { tensor } from './tensor.ts';
import type { MarketplaceProvider, NFTMarketData } from './types.ts';

// ---- Provider registry (nft.md — Phase 4.1) -----------------------------------------
//
// Preference order per chain. The first *configured* provider that returns stats for a
// collection wins; the rest are not queried. Magic Eden leads on both chains because it
// is the only keyless provider (nft.md Open Question 3 — flip these lists to change the
// default once partner keys land).

const PROVIDER_ORDER: Record<NFTChain, MarketplaceProvider[]> = {
  EVM: [magicEden, opensea],
  Solana: [magicEden, tensor],
};

export const ALL_PROVIDERS: MarketplaceProvider[] = [magicEden, tensor, opensea];

/** Cap on distinct collections queried per refresh — protects the shared public rate limit. */
const MAX_COLLECTIONS = 30;

export interface FetchMarketDataOptions {
  evmOwner?: string | null;
  solanaOwner?: string | null;
  isTestnet: boolean;
  signal?: AbortSignal;
}

/**
 * Floor price + collection stats for each NFT, keyed by `nft.key`.
 *
 * Read-only and best-effort: any provider failure degrades to "no market data" for the
 * NFTs it covered rather than failing the batch. Returns an empty map on testnets,
 * where no marketplace indexes the fixtures.
 */
export async function fetchMarketData(
  nfts: NFTAsset[],
  { evmOwner, solanaOwner, isTestnet, signal }: FetchMarketDataOptions,
): Promise<Map<string, NFTMarketData>> {
  const result = new Map<string, NFTMarketData>();
  if (isTestnet) return result;

  // Only NFTs that belong to a collection can have a floor price.
  const candidates = nfts.filter((n) => n.collection && !n.providerSpam);
  if (candidates.length === 0) return result;

  for (const chain of ['EVM', 'Solana'] as const) {
    const chainNfts = candidates.filter((n) => n.chain === chain);
    const owner = chain === 'EVM' ? evmOwner : solanaOwner;
    if (chainNfts.length === 0 || !owner) continue;

    for (const provider of PROVIDER_ORDER[chain]) {
      // Stop as soon as every NFT on this chain has a floor.
      const unresolved = chainNfts.filter((n) => !result.get(n.key)?.stats);
      if (unresolved.length === 0) break;
      if (!provider.isConfigured(chain)) continue;

      try {
        const handles = await provider.resolveCollections(unresolved, owner, signal);
        if (handles.size === 0) continue;

        // Many NFTs share a collection — query each handle once.
        const distinct = [...new Set(handles.values())].slice(0, MAX_COLLECTIONS);
        const statsByHandle = new Map(
          await Promise.all(
            distinct.map(async (handle) => {
              try {
                return [handle, await provider.getCollectionStats(handle, signal)] as const;
              } catch (e) {
                console.warn(`[nft] ${provider.id} stats failed for ${handle}`, e);
                return [handle, null] as const;
              }
            }),
          ),
        );

        for (const nft of unresolved) {
          const handle = handles.get(nft.key);
          const stats = handle ? statsByHandle.get(handle) : null;
          if (stats) result.set(nft.key, { floorNative: stats.floorNative, stats });
        }
      } catch (e) {
        if (signal?.aborted) return result;
        console.warn(`[nft] ${provider.id} market lookup failed`, e);
      }
    }
  }

  return result;
}

export * from './types.ts';
