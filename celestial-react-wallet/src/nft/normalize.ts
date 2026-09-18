import { imageCandidates, mediaKind, resolveMediaUrl } from './media.ts';
import type { NFTAsset, NFTAttribute, NFTStandard } from './types.ts';

// ---- Indexer payload → NFTAsset (nft.md — Phase 1.3) ------------------------------
//
// Pure functions (no network, no Vite env) so they can be unit-tested against
// recorded provider responses in tests/nft/fixtures.

export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

function normalizeAttributes(raw: unknown): NFTAttribute[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is { trait_type?: unknown; value?: unknown } => !!a && typeof a === 'object')
    .filter((a) => a.value !== undefined && a.value !== null && a.value !== '')
    .map((a) => ({
      trait_type: typeof a.trait_type === 'string' && a.trait_type ? a.trait_type : 'Trait',
      value: typeof a.value === 'number' ? a.value : String(a.value),
    }));
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

// ---- Alchemy NFT API v3 (getNFTsForOwner) ------------------------------------------

export interface AlchemyOwnedNft {
  contract: {
    address: string;
    name?: string | null;
    symbol?: string | null;
    tokenType?: string | null;
    isSpam?: boolean | null;
    openSeaMetadata?: {
      collectionName?: string | null;
      imageUrl?: string | null;
      safelistRequestStatus?: string | null;
    } | null;
  };
  tokenId: string;
  tokenType?: string | null;
  name?: string | null;
  description?: string | null;
  balance?: string | null;
  image?: {
    cachedUrl?: string | null;
    pngUrl?: string | null;
    thumbnailUrl?: string | null;
    originalUrl?: string | null;
    contentType?: string | null;
  } | null;
  animation?: { cachedUrl?: string | null; contentType?: string | null } | null;
  raw?: { metadata?: Record<string, unknown> | null } | null;
  collection?: { name?: string | null } | null;
}

export function normalizeAlchemyNFT(nft: AlchemyOwnedNft): NFTAsset | null {
  const address = nft?.contract?.address;
  if (!address || nft.tokenId === undefined || nft.tokenId === null) return null;

  const type = (nft.tokenType || nft.contract.tokenType || '').toUpperCase();
  const standard: NFTStandard = type === 'ERC1155' ? 'erc1155' : 'erc721';
  const meta = (nft.raw?.metadata || {}) as Record<string, unknown>;
  const os = nft.contract.openSeaMetadata;

  const collectionName = str(nft.collection?.name) || str(os?.collectionName) || str(nft.contract.name);
  const symbol = str(nft.contract.symbol);

  const animationUrl = resolveMediaUrl(nft.animation?.cachedUrl) || resolveMediaUrl(str(meta.animation_url));

  return {
    key: `evm:${address.toLowerCase()}:${nft.tokenId}`,
    chain: 'EVM',
    standard,
    contract: address,
    tokenId: nft.tokenId,
    name: str(nft.name) || str(meta.name) || `${symbol || collectionName || 'NFT'} #${nft.tokenId}`,
    description: str(nft.description) || str(meta.description),
    images: imageCandidates(
      nft.image?.cachedUrl,
      nft.image?.pngUrl,
      nft.image?.originalUrl,
      str(meta.image),
      str(meta.image_url),
    ),
    animation: animationUrl
      ? { url: animationUrl, kind: mediaKind(animationUrl, nft.animation?.contentType) }
      : null,
    attributes: normalizeAttributes(meta.attributes),
    collection: {
      id: address,
      name: collectionName,
      image: resolveMediaUrl(os?.imageUrl),
      verified: os?.safelistRequestStatus === 'verified',
    },
    amount: str(nft.balance) || '1',
    symbol,
    providerSpam: nft.contract.isSpam === true,
  };
}

// ---- Helius DAS (getAssetsByOwner) --------------------------------------------------

export interface HeliusAsset {
  id: string;
  interface: string;
  burnt?: boolean;
  content?: {
    json_uri?: string;
    files?: { uri?: string; cdn_uri?: string; mime?: string }[];
    metadata?: { name?: string; symbol?: string; description?: string; attributes?: unknown };
    links?: { image?: string; animation_url?: string };
  };
  grouping?: {
    group_key: string;
    group_value: string;
    collection_metadata?: { name?: string; image?: string } | null;
  }[];
  royalty?: { basis_points?: number } | null;
  compression?: { compressed?: boolean } | null;
  token_info?: { token_program?: string; supply?: number; decimals?: number; balance?: number } | null;
}

const HELIUS_NFT_INTERFACES = new Set(['V1_NFT', 'V1_PRINT', 'LEGACY_NFT', 'V2_NFT', 'ProgrammableNFT', 'MplCoreAsset']);

export function normalizeHeliusAsset(asset: HeliusAsset): NFTAsset | null {
  if (!asset?.id || asset.burnt) return null;

  const tokenInfo = asset.token_info;
  const isSingleSupplyToken = tokenInfo?.decimals === 0 && tokenInfo?.supply === 1;
  if (!HELIUS_NFT_INTERFACES.has(asset.interface) && !isSingleSupplyToken) return null;

  let standard: NFTStandard;
  if (asset.compression?.compressed) standard = 'metaplex-cnft';
  else if (asset.interface === 'ProgrammableNFT') standard = 'metaplex-pnft';
  else if (asset.interface === 'MplCoreAsset') standard = 'metaplex-core';
  else if (tokenInfo?.token_program === TOKEN_2022_PROGRAM_ID) standard = 'token-2022-nft';
  else standard = 'metaplex-nft';

  const content = asset.content || {};
  const meta = content.metadata || {};
  const files = content.files || [];
  const imageLink = content.links?.image;
  const imageFile = files.find((f) => f.uri && f.uri === imageLink);
  const firstImageFile = files.find((f) => mediaKind(f.uri, f.mime) === 'image');

  const animationLink = resolveMediaUrl(content.links?.animation_url);
  const animationFile = files.find((f) => f.uri && f.uri === content.links?.animation_url);

  // Helius only returns verified collections in `grouping`
  const group = (asset.grouping || []).find((g) => g.group_key === 'collection');

  return {
    key: `solana:${asset.id}`,
    chain: 'Solana',
    standard,
    assetId: asset.id,
    name: str(meta.name) || `Unnamed ${asset.id.slice(0, 4)}…${asset.id.slice(-4)}`,
    description: str(meta.description),
    images: imageCandidates(imageFile?.cdn_uri, imageLink, firstImageFile?.cdn_uri, firstImageFile?.uri),
    animation: animationLink ? { url: animationLink, kind: mediaKind(animationLink, animationFile?.mime) } : null,
    attributes: normalizeAttributes(meta.attributes),
    collection: group
      ? {
          id: group.group_value,
          name: str(group.collection_metadata?.name),
          image: resolveMediaUrl(group.collection_metadata?.image),
          verified: true,
        }
      : null,
    amount: String(tokenInfo?.balance ?? 1),
    symbol: str(meta.symbol),
    royaltyBps: asset.royalty?.basis_points ?? undefined,
    tokenProgram: tokenInfo?.token_program,
    providerSpam: false,
  };
}
