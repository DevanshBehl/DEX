import type { NFTAsset, NFTChain } from '../types.ts';

// ---- Marketplace provider abstraction (nft.md — Phase 4.1) --------------------------
//
// Providers are READ-ONLY in Phase 4: they fetch floor prices and collection stats.
// Phase 5 extends this interface with `build*Tx` methods that return *unsigned*
// transactions — a provider never sees a key, a seed phrase or a signed transaction.

export type MarketplaceId = 'magiceden' | 'tensor' | 'opensea';

export const MARKETPLACE_LABELS: Record<MarketplaceId, string> = {
  magiceden: 'Magic Eden',
  tensor: 'Tensor',
  opensea: 'OpenSea',
};

/**
 * A provider's own handle for a collection: an EVM contract address for OpenSea /
 * Magic Eden EVM, a collection symbol (Magic Eden) or slug (Tensor) on Solana.
 * `resolveCollections` maps our chain-level collection ids onto these.
 */
export interface CollectionHandle {
  chain: NFTChain;
  /** Provider-specific id: contract address, Magic Eden symbol, or Tensor slug. */
  handle: string;
}

/**
 * Providers report volume over different windows — Magic Eden's keyless Solana stats
 * expose `volume7d`, OpenSea a one-day interval — so the window travels with the number
 * rather than being assumed to be 24h.
 */
export interface CollectionVolume {
  window: '24h' | '7d';
  native: number;
}

export interface CollectionStats {
  source: MarketplaceId;
  handle: string;
  /** Floor price in the chain's native currency (ETH / SOL), or null when nothing is listed. */
  floorNative: number | null;
  listedCount: number | null;
  volume: CollectionVolume | null;
  /** Average sale price over the last 24h, where the provider reports one. */
  avgPrice24hNative: number | null;
  totalSupply: number | null;
  /** Human-facing marketplace page for the collection. */
  url: string | null;
  fetchedAt: number;
}

export interface Listing {
  source: MarketplaceId;
  priceNative: number;
  seller: string | null;
  /** Provider-specific id needed to build a buy transaction in Phase 5. */
  ref: string;
  expiresAt: number | null;
  // Display fields, so a listings grid needs no second round of metadata lookups.
  name: string | null;
  image: string | null;
  /** Solana mint / EVM token id of the listed item. */
  assetRef: string | null;
}

export interface Page<T> {
  items: T[];
  /** Opaque cursor for the next page; null when the list is exhausted. */
  cursor: string | null;
}

/** Collection identity for the Explore screen, independent of ownership. */
export interface CollectionSummary {
  chain: NFTChain;
  handle: string;
  name: string;
  image: string | null;
  description: string | null;
  verified: boolean;
}

export interface Offer {
  source: MarketplaceId;
  priceNative: number;
  bidder: string | null;
  /** Collection-wide bid vs. an offer on this exact NFT. */
  scope: 'collection' | 'token';
  ref: string;
  expiresAt: number | null;
}

export interface MarketplaceProvider {
  id: MarketplaceId;
  chains: NFTChain[];
  /**
   * False when this provider can't serve this chain with the current configuration.
   * It is per-chain because reachability is: Magic Eden's Solana v2 API is keyless,
   * but its EVM surface needs the proxy, so one provider can be live on one chain and
   * unavailable on the other.
   */
  isConfigured(chain: NFTChain): boolean;
  /**
   * Map the owner's NFTs onto this provider's collection handles. Solana providers
   * key collections by symbol/slug, which can only be discovered by asking the
   * provider about the wallet — so this takes the whole set at once rather than
   * one NFT at a time.
   *
   * @returns `nft.key` → handle, omitting NFTs the provider doesn't index.
   */
  resolveCollections(nfts: NFTAsset[], owner: string, signal?: AbortSignal): Promise<Map<string, string>>;
  getCollectionStats(handle: string, signal?: AbortSignal): Promise<CollectionStats | null>;
  /** Collection identity for the Explore screen (name, image, description). */
  getCollection?(handle: string, signal?: AbortSignal): Promise<CollectionSummary | null>;
  /** Cheapest-first listings for a collection — the Explore collection page grid. */
  getListings?(handle: string, cursor?: string, signal?: AbortSignal): Promise<Page<Listing>>;
  /**
   * Collections to surface on Explore. No keyless endpoint ranks collections by
   * volume, so a provider may return a curated set instead of true trending — the
   * `ranked` flag says which, so the UI can label it honestly.
   */
  getExploreCollections?(signal?: AbortSignal): Promise<{ collections: CollectionSummary[]; ranked: boolean }>;
  /** Phase 5. Declared here so the trading UI can feature-detect. */
  getNFTListing?(nft: NFTAsset, handle: string, signal?: AbortSignal): Promise<Listing | null>;
  getBestOffer?(nft: NFTAsset, handle: string, signal?: AbortSignal): Promise<Offer | null>;
}

/** What the UI renders for a single NFT. */
export interface NFTMarketData {
  /** Floor price of this NFT's collection, in native currency. */
  floorNative: number | null;
  stats: CollectionStats | null;
}
