import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CONFIG } from '../../config/networks';
import { fetchEVMNFTs } from '../indexers/alchemy.ts';
import { fetchSolanaNFTs } from '../indexers/helius.ts';
import { computeVisibility } from '../spam.ts';
import {
  readNFTCache,
  readVisibilityOverrides,
  writeNFTCache,
  writeVisibilityOverride,
  type NetworkMode,
  type VisibilityOverride,
} from '../storage.ts';
import type { NFTAsset, NFTChain, NFTWithVisibility } from '../types.ts';

// ---- useNFTs (nft.md — Phase 1.6) ---------------------------------------------------
//
// Stale-while-revalidate: cached NFTs render immediately, both chains refresh in
// parallel, and a failure on one chain never blanks the other.

interface UseNFTsOptions {
  evmAddress?: string | null;
  solanaAddress?: string | null;
  isTestnet: boolean;
  enabled: boolean;
}

type ChainState = { assets: NFTAsset[]; error: string | null; fetchedAt: number | null };
const EMPTY: ChainState = { assets: [], error: null, fetchedAt: null };

export function useNFTs({ evmAddress, solanaAddress, isTestnet, enabled }: UseNFTsOptions) {
  const network: NetworkMode = isTestnet ? 'testnet' : 'mainnet';
  const [chains, setChains] = useState<Record<NFTChain, ChainState>>({ EVM: EMPTY, Solana: EMPTY });
  const [overrides, setOverrides] = useState<Record<string, VisibilityOverride>>({});
  const [isLoading, setIsLoading] = useState(false); // nothing to show yet
  const [isRefreshing, setIsRefreshing] = useState(false); // showing cache, fetching fresh
  const requestId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const isCurrent = () => id === requestId.current;

    const targets: { chain: NFTChain; owner: string; fetcher: typeof fetchEVMNFTs; rpcUrl: string }[] = [];
    if (evmAddress) {
      targets.push({ chain: 'EVM', owner: evmAddress, fetcher: fetchEVMNFTs, rpcUrl: isTestnet ? CONFIG.ALCHEMY_SEPOLIA_URL : CONFIG.ALCHEMY_ETH_URL });
    }
    if (solanaAddress) {
      targets.push({ chain: 'Solana', owner: solanaAddress, fetcher: fetchSolanaNFTs, rpcUrl: isTestnet ? CONFIG.HELIUS_DEVNET_URL : CONFIG.HELIUS_SOL_URL });
    }

    // 1. Cache + overrides for instant render
    const [cached, savedOverrides] = await Promise.all([
      Promise.all(targets.map((t) => readNFTCache(network, t.chain, t.owner))),
      readVisibilityOverrides(network),
    ]);
    if (!isCurrent()) return;

    const next: Record<NFTChain, ChainState> = { EVM: EMPTY, Solana: EMPTY };
    targets.forEach((t, i) => {
      if (cached[i]) next[t.chain] = { assets: cached[i]!.assets, error: null, fetchedAt: cached[i]!.fetchedAt };
    });
    setChains(next);
    setOverrides(savedOverrides);
    const hasCache = cached.some(Boolean);
    setIsLoading(!hasCache);
    setIsRefreshing(hasCache);

    // 2. Fresh data, per chain
    await Promise.all(
      targets.map(async (t) => {
        try {
          if (!t.rpcUrl) throw new Error(`No RPC configured for ${t.chain}`);
          const assets = await t.fetcher(t.owner, t.rpcUrl, controller.signal);
          if (!isCurrent()) return;
          setChains((prev) => ({ ...prev, [t.chain]: { assets, error: null, fetchedAt: Date.now() } }));
          void writeNFTCache(network, t.chain, t.owner, assets);
        } catch (e) {
          if (!isCurrent() || controller.signal.aborted) return;
          console.error(`[nft] ${t.chain} fetch failed`, e);
          setChains((prev) => ({ ...prev, [t.chain]: { ...prev[t.chain], error: (e as Error).message } }));
        }
      }),
    );

    if (isCurrent()) {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [evmAddress, solanaAddress, isTestnet, network]);

  useEffect(() => {
    if (!enabled) return;
    void load();
    return () => {
      requestId.current++; // invalidate in-flight results
      abortRef.current?.abort();
    };
  }, [enabled, load]);

  const setVisibility = useCallback(
    async (nftKey: string, value: VisibilityOverride | null) => {
      setOverrides((prev) => {
        const next = { ...prev };
        if (value) next[nftKey] = value;
        else delete next[nftKey];
        return next;
      });
      await writeVisibilityOverride(network, nftKey, value);
    },
    [network],
  );

  /**
   * Optimistic update after a confirmed send: removes the NFT (or decrements an
   * ERC-1155 balance) immediately, then re-syncs with the indexer once it catches up.
   */
  const applyLocalTransfer = useCallback(
    (nft: NFTAsset, amount: bigint) => {
      const owner = nft.chain === 'EVM' ? evmAddress : solanaAddress;
      setChains((prev) => {
        const assets = prev[nft.chain].assets.flatMap((a) => {
          if (a.key !== nft.key) return [a];
          const remaining = BigInt(a.amount) - amount;
          return a.standard === 'erc1155' && remaining > 0n ? [{ ...a, amount: remaining.toString() }] : [];
        });
        if (owner) void writeNFTCache(network, nft.chain, owner, assets);
        return { ...prev, [nft.chain]: { ...prev[nft.chain], assets } };
      });
      // Indexers typically lag a few seconds behind confirmation
      setTimeout(() => void load(), 8000);
    },
    [evmAddress, solanaAddress, network, load],
  );

  const nfts: NFTWithVisibility[] = useMemo(
    () =>
      [...chains.EVM.assets, ...chains.Solana.assets].map((nft) => ({
        ...nft,
        ...computeVisibility(nft, overrides[nft.key] ?? null),
      })),
    [chains, overrides],
  );

  return {
    nfts,
    visibleNfts: useMemo(() => nfts.filter((n) => !n.hidden), [nfts]),
    hiddenNfts: useMemo(() => nfts.filter((n) => n.hidden), [nfts]),
    errors: { EVM: chains.EVM.error, Solana: chains.Solana.error },
    isLoading,
    isRefreshing,
    refresh: load,
    setVisibility,
    applyLocalTransfer,
  };
}
