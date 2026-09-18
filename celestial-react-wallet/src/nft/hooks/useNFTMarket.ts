import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchMarketData } from '../marketplaces/index.ts';
import type { NFTMarketData } from '../marketplaces/types.ts';
import type { NFTAsset, NFTChain } from '../types.ts';

// ---- useNFTMarket (nft.md — Phase 4.3) ----------------------------------------------
//
// Floor prices for the NFTs the user actually holds. Read-only, best-effort and always
// secondary to ownership data: market lookups never block or blank the grid.

interface UseNFTMarketOptions {
  nfts: NFTAsset[];
  evmAddress?: string | null;
  solanaAddress?: string | null;
  isTestnet: boolean;
  enabled: boolean;
}

export interface NFTMarketState {
  market: Map<string, NFTMarketData>;
  isLoading: boolean;
  /** Sum of floor prices per chain, in native currency (ETH / SOL). */
  floorTotals: Record<NFTChain, number>;
  refresh: () => void;
}

const EMPTY_TOTALS: Record<NFTChain, number> = { EVM: 0, Solana: 0 };

export function useNFTMarket({ nfts, evmAddress, solanaAddress, isTestnet, enabled }: UseNFTMarketOptions): NFTMarketState {
  const [market, setMarket] = useState<Map<string, NFTMarketData>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const requestId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  // `useNFTs` hands back a fresh array on every visibility toggle, so re-fetching on
  // array identity would hammer the provider. This key changes only when something
  // that actually affects the result does.
  const fetchKey = useMemo(
    () => [isTestnet, evmAddress, solanaAddress, ...nfts.map((n) => n.key).sort()].join('|'),
    [isTestnet, evmAddress, solanaAddress, nfts],
  );
  const lastFetchKey = useRef<string | null>(null);

  const load = useCallback(async (batch: NFTAsset[]) => {
    const id = ++requestId.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (isTestnet || batch.length === 0) {
      setMarket(new Map());
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const data = await fetchMarketData(batch, {
        evmOwner: evmAddress,
        solanaOwner: solanaAddress,
        isTestnet,
        signal: controller.signal,
      });
      if (id === requestId.current) setMarket(data);
    } catch (e) {
      if (id === requestId.current && !controller.signal.aborted) {
        console.warn('[nft] market data unavailable', e);
      }
    } finally {
      if (id === requestId.current) setIsLoading(false);
    }
  }, [evmAddress, solanaAddress, isTestnet]);

  useEffect(() => {
    if (!enabled) return;
    if (lastFetchKey.current === fetchKey) return; // same wallet, same NFTs — nothing to redo
    lastFetchKey.current = fetchKey;
    void load(nfts);
    return () => {
      requestId.current++;
      abortRef.current?.abort();
    };
  }, [enabled, load, fetchKey, nfts]);

  const refresh = useCallback(() => {
    lastFetchKey.current = null; // force the next run even if nothing changed
    void load(nfts);
  }, [load, nfts]);

  const floorTotals = useMemo(() => {
    if (market.size === 0) return EMPTY_TOTALS;
    const totals = { ...EMPTY_TOTALS };
    for (const nft of nfts) {
      const floor = market.get(nft.key)?.floorNative;
      if (!floor) continue;
      // ERC-1155 editions: the floor applies per unit held.
      const units = Number(nft.amount) || 1;
      totals[nft.chain] += floor * units;
    }
    return totals;
  }, [market, nfts]);

  return { market, isLoading, floorTotals, refresh };
}
