import type { NFTWithVisibility } from './types.ts';

// ---- Collection grouping for the NFT grid (nft.md — Phase 2.2) -------------------

export interface CollectionGroup {
  key: string;
  name: string;
  image: string | null;
  verified: boolean;
  chain: NFTWithVisibility['chain'];
  nfts: NFTWithVisibility[];
}

export const UNGROUPED = '__ungrouped__';

/** Groups by collection (per chain), largest collections first, ungrouped NFTs last. */
export function groupByCollection(nfts: NFTWithVisibility[]): CollectionGroup[] {
  const groups = new Map<string, CollectionGroup>();
  for (const nft of nfts) {
    // EVM addresses are case-insensitive; Solana base58 addresses are not
    const collectionId = nft.chain === 'EVM' ? nft.collection?.id.toLowerCase() : nft.collection?.id;
    const key = nft.collection ? `${nft.chain}:${collectionId}` : UNGROUPED;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        name: key === UNGROUPED ? 'Other NFTs' : nft.collection?.name || 'Unknown Collection',
        image: nft.collection?.image || null,
        verified: !!nft.collection?.verified,
        chain: nft.chain,
        nfts: [],
      };
      groups.set(key, group);
    }
    group.nfts.push(nft);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === UNGROUPED) return 1;
    if (b.key === UNGROUPED) return -1;
    return b.nfts.length - a.nfts.length || a.name.localeCompare(b.name);
  });
}
