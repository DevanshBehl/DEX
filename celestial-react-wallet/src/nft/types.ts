// ---- NFT domain model (nft.md — Phase 1.2) -------------------------------------
//
// Every indexer payload (Alchemy for EVM, Helius DAS for Solana) is normalized
// into `NFTAsset` so the UI, send flow and marketplace layers never deal with
// provider-specific shapes.

export type NFTChain = 'EVM' | 'Solana';

export type NFTStandard =
  | 'erc721'
  | 'erc1155'
  | 'metaplex-nft' // Token Metadata, non-programmable
  | 'metaplex-pnft' // Programmable NFT
  | 'metaplex-cnft' // Bubblegum compressed
  | 'metaplex-core' // mpl-core asset
  | 'token-2022-nft'; // Token-2022 mint with supply 1

export type NFTMediaKind = 'image' | 'video' | 'audio' | 'model' | 'html' | 'unknown';

export interface NFTCollection {
  id: string; // EVM contract address or Solana collection address
  name: string | null;
  image: string | null;
  verified: boolean;
}

export interface NFTAttribute {
  trait_type: string;
  value: string | number;
}

export interface NFTAsset {
  key: string; // `evm:<contract>:<tokenId>` or `solana:<assetId>`
  chain: NFTChain;
  standard: NFTStandard;
  contract?: string; // EVM contract (checksummed as returned by the indexer)
  tokenId?: string; // EVM token id (decimal string)
  assetId?: string; // Solana mint / asset id
  name: string;
  description: string | null;
  /** Ordered image URLs to try; the UI falls back to the next on load error, then to a local placeholder. */
  images: string[];
  animation: { url: string; kind: NFTMediaKind } | null;
  attributes: NFTAttribute[];
  collection: NFTCollection | null;
  amount: string; // "1" for ERC-721 / Solana, quantity for ERC-1155
  symbol: string | null;
  royaltyBps?: number;
  tokenProgram?: string; // Solana token program (transfers)
  /** Provider-reported spam flag (Alchemy mainnet). Combined with local heuristics in spam.ts. */
  providerSpam: boolean;
}

/** Result of applying spam heuristics + the user's own hide/show choices. */
export interface NFTVisibility {
  isSpam: boolean;
  spamReasons: string[];
  hidden: boolean; // what the UI should do by default
  userOverride: 'hidden' | 'visible' | null;
}

export type NFTWithVisibility = NFTAsset & NFTVisibility;
