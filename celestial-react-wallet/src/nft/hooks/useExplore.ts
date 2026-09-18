import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ALL_PROVIDERS } from '../marketplaces/index.ts';
import type { CollectionStats, CollectionSummary, Listing, MarketplaceProvider } from '../marketplaces/types.ts';
import type { NFTChain } from '../types.ts';

// ---- Explore data (nft.md — Phase 4.3) ---------------------------------------------
//
// Explore is marketplace-only: it shows collections the user does not own, so nothing
// here touches the wallet's keys or ownership data.

export interface ExploreEntry {
  collection: CollectionSummary;
  stats: CollectionStats | null;
}

/** The first provider that can serve Explore on this chain. */
function exploreProvider(chain: NFTChain): MarketplaceProvider | null {
  return ALL_PROVIDERS.find((p) => p.isConfigured(chain) && !!p.getExploreCollections) || null;
}

export function useExplore(enabled: boolean, isTestnet: boolean) {
  const [entries, setEntries] = useState<ExploreEntry[]>([]);
  const [ranked, setRanked] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const loaded = useRef(false);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    const isCurrent = () => id === requestId.current;

    // Marketplaces index mainnet only — say so rather than showing an empty list.
    const provider = isTestnet ? null : exploreProvider('Solana');
    if (!provider) {
      setEntries([]);
      setError(isTestnet ? 'testnet' : 'unavailable');
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const { collections, ranked: isRanked } = await provider.getExploreCollections!();
      if (!isCurrent()) return;
      setRanked(isRanked);
      // Render names/images immediately, then fill in floors as they arrive.
      setEntries(collections.map((collection) => ({ collection, stats: null })));

      const withStats = await Promise.all(
        collections.map(async (collection) => {
          try {
            return { collection, stats: await provider.getCollectionStats(collection.handle) };
          } catch {
            return { collection, stats: null };
          }
        }),
      );
      if (isCurrent()) setEntries(withStats);
    } catch (e) {
      if (isCurrent()) {
        console.warn('[nft] explore failed', e);
        setError('unavailable');
      }
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  }, [isTestnet]);

  useEffect(() => {
    if (!enabled) return;
    // Explore data is the same for everyone — load it once per session unless the
    // network changes or the user refreshes.
    if (loaded.current) return;
    loaded.current = true;
    void load();
  }, [enabled, load]);

  useEffect(() => {
    loaded.current = false; // network switch invalidates the list
  }, [isTestnet]);

  const refresh = useCallback(() => {
    loaded.current = true;
    void load();
  }, [load]);

  return { entries, ranked, isLoading, error, refresh };
}

// ---- Collection page ----------------------------------------------------------------

export function useCollectionListings(handle: string | null, chain: NFTChain, isTestnet: boolean) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [stats, setStats] = useState<CollectionStats | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  // `settled` is flipped once the first fetch finishes, so "loading" is derived rather
  // than switched on synchronously inside the effect. CollectionPage is mounted with a
  // `key` per collection, so this state resets naturally when the collection changes.
  const [settled, setSettled] = useState(false);
  const [isPaging, setIsPaging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  // Emptiness and "no provider" are derived (below), never pushed into state from an
  // effect — that would cause a cascading re-render.
  const provider = useMemo(
    () => ALL_PROVIDERS.find((p) => p.isConfigured(chain) && !!p.getListings) || null,
    [chain],
  );
  const active = !!handle && !isTestnet && !!provider;

  // State updates live inside `load` rather than the effect body, so opening a
  // collection doesn't trigger a cascading render (same shape as `useNFTs`).
  const load = useCallback(async () => {
    if (!provider || !handle) return;
    const id = ++requestId.current;
    try {
      // Awaited before any state update, so nothing is set synchronously from the effect.
      const [page, collectionStats] = await Promise.all([
        provider.getListings!(handle),
        provider.getCollectionStats(handle).catch(() => null),
      ]);
      if (id !== requestId.current) return;
      setListings(page.items);
      setCursor(page.cursor);
      setStats(collectionStats);
      setError(null);
    } catch (e) {
      if (id === requestId.current) {
        console.warn('[nft] listings failed', e);
        setError('unavailable');
      }
    } finally {
      if (id === requestId.current) setSettled(true);
    }
  }, [provider, handle]);

  useEffect(() => {
    if (!active) return;
    // Fetch-on-open: every state update inside `load` happens after an await, so this
    // is a subscription to an external system rather than a synchronous cascade. The
    // rule can't see across the await boundary here (it doesn't flag the identical
    // shape in `useNFTs`).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [active, load]);

  // Fired from a click, not an effect, so setting state directly is fine here.
  const loadMore = useCallback(async () => {
    if (!handle || !cursor || isPaging || !provider) return;
    setIsPaging(true);
    try {
      const page = await provider.getListings!(handle, cursor);
      setListings((prev) => [...prev, ...page.items]);
      setCursor(page.cursor);
    } catch (e) {
      console.warn('[nft] listings page failed', e);
    } finally {
      setIsPaging(false);
    }
  }, [handle, cursor, provider, isPaging]);

  return {
    listings: active ? listings : [],
    stats: active ? stats : null,
    isLoading: active && (!settled || isPaging),
    error: isTestnet ? 'testnet' : !provider && handle ? 'unavailable' : active ? error : null,
    hasMore: active && !!cursor,
    loadMore,
  };
}
