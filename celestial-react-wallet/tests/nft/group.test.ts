import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByCollection, UNGROUPED } from '../../src/nft/group.ts';
import { normalizeAlchemyNFT, normalizeHeliusAsset } from '../../src/nft/normalize.ts';
import { computeVisibility } from '../../src/nft/spam.ts';
import type { NFTAsset, NFTWithVisibility } from '../../src/nft/types.ts';
import { loadFixture } from './helpers.ts';

const withVisibility = (list: (NFTAsset | null)[]): NFTWithVisibility[] =>
  list.filter((n): n is NFTAsset => !!n).map((n) => ({ ...n, ...computeVisibility(n, null) }));

test('groups Solana fixtures by collection, largest first, ungrouped last', () => {
  const items = loadFixture('helius-devnet-getAssetsByOwner.json').result.items;
  const groups = groupByCollection(withVisibility(items.map(normalizeHeliusAsset)));

  assert.deepEqual(
    groups.map((g) => [g.name, g.nfts.length]),
    [['Celestial Test Collection', 5], ['Celestial Core Collection', 1], ['Other NFTs', 2]],
  );
  assert.equal(groups.at(-1)!.key, UNGROUPED);
  assert.ok(groups[0].verified);
});

test('EVM collections group case-insensitively by contract and never merge across chains', () => {
  const alchemy = withVisibility(loadFixture('alchemy-sepolia-getNFTsForOwner.json').ownedNfts.map(normalizeAlchemyNFT));
  const mixedCase = alchemy.map((n, i) => (i % 2 && n.collection ? { ...n, collection: { ...n.collection, id: n.collection.id.toUpperCase() } } : n));
  const groups = groupByCollection(mixedCase);
  assert.deepEqual(groups.map((g) => g.nfts.length), [7, 2]);

  const solanaTwin = { ...alchemy[0], key: 'solana:x', chain: 'Solana' as const };
  assert.equal(groupByCollection([alchemy[0], solanaTwin]).length, 2);
});
