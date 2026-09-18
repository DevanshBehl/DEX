import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAlchemyNFT, normalizeHeliusAsset, type AlchemyOwnedNft, type HeliusAsset } from '../../src/nft/normalize.ts';
import { computeVisibility } from '../../src/nft/spam.ts';
import type { NFTAsset } from '../../src/nft/types.ts';
import { loadFixture } from './helpers.ts';

// Recorded from the Phase 0 fixture wallets (nft.md)
const helius = loadFixture<{ result: { items: HeliusAsset[] } }>('helius-devnet-getAssetsByOwner.json').result.items;
const alchemy = loadFixture<{ ownedNfts: AlchemyOwnedNft[] }>('alchemy-sepolia-getNFTsForOwner.json').ownedNfts;

const byName = (list: NFTAsset[], name: string) => {
  const found = list.find((n) => n.name === name);
  assert.ok(found, `missing ${name}`);
  return found!;
};

test('Helius devnet fixtures map to the correct standards', () => {
  const nfts = helius.map(normalizeHeliusAsset).filter((n): n is NFTAsset => !!n);
  assert.equal(nfts.length, 8);

  const counts = nfts.reduce<Record<string, number>>((acc, n) => ({ ...acc, [n.standard]: (acc[n.standard] || 0) + 1 }), {});
  assert.deepEqual(counts, { 'metaplex-nft': 4, 'metaplex-pnft': 1, 'metaplex-cnft': 2, 'metaplex-core': 1 });

  assert.equal(byName(nfts, 'Celestial Relic (pNFT)').standard, 'metaplex-pnft');
  assert.equal(byName(nfts, 'Celestial Dust #1').standard, 'metaplex-cnft');
  assert.equal(byName(nfts, 'Celestial Core Orb').standard, 'metaplex-core');
});

test('Helius fixtures carry collection, royalty, program and ordered images', () => {
  const nfts = helius.map(normalizeHeliusAsset).filter((n): n is NFTAsset => !!n);
  const orb = byName(nfts, 'Celestial Orb #1');

  assert.equal(orb.key, `solana:${orb.assetId}`);
  assert.deepEqual(
    { name: orb.collection?.name, verified: orb.collection?.verified },
    { name: 'Celestial Test Collection', verified: true },
  );
  assert.equal(orb.royaltyBps, 500);
  assert.equal(orb.tokenProgram, 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  assert.ok(orb.images[0].startsWith('https://cdn.helius-rpc.com/'), 'Helius CDN first');
  assert.ok(orb.images.some((u) => u.startsWith('https://gateway.irys.xyz/')), 'original URL as fallback');
  assert.deepEqual(orb.attributes.map((a) => a.trait_type), ['Standard', 'Color']);

  assert.equal(byName(nfts, 'Celestial Core Orb').collection?.name, 'Celestial Core Collection');
  assert.equal(byName(nfts, 'Claim 500 SOL Reward').collection, null);
});

test('Helius spam fixture is hidden by default, everything else visible', () => {
  const nfts = helius.map(normalizeHeliusAsset).filter((n): n is NFTAsset => !!n);
  const hidden = nfts.filter((n) => computeVisibility(n, null).hidden).map((n) => n.name);
  assert.deepEqual(hidden, ['Claim 500 SOL Reward']);
});

test('Helius broken-image fixture keeps its (unresolvable) URL for UI fallback', () => {
  const nfts = helius.map(normalizeHeliusAsset).filter((n): n is NFTAsset => !!n);
  const broken = byName(nfts, 'Celestial Broken Image');
  assert.ok(broken.images.length >= 1);
  assert.ok(broken.images.some((u) => u.includes('invalid.celestial.test')));
});

test('Helius fungible tokens and burnt assets are excluded', () => {
  assert.equal(normalizeHeliusAsset({ id: 'USDC', interface: 'FungibleToken', token_info: { decimals: 6, supply: 1e9 } }), null);
  assert.equal(normalizeHeliusAsset({ ...helius[0], burnt: true }), null);
  // Token-2022 single-supply mint with a non-NFT interface is still an NFT
  const t22 = normalizeHeliusAsset({
    id: 'T22Mint', interface: 'FungibleAsset',
    token_info: { decimals: 0, supply: 1, balance: 1, token_program: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' },
  });
  assert.equal(t22?.standard, 'token-2022-nft');
});

test('Alchemy Sepolia fixtures: 7× ERC-721 and 2 ERC-1155 editions with quantities', () => {
  const nfts = alchemy.map(normalizeAlchemyNFT).filter((n): n is NFTAsset => !!n);
  assert.equal(nfts.length, 9);
  assert.equal(nfts.filter((n) => n.standard === 'erc721').length, 7);

  assert.equal(byName(nfts, 'Celestial Pass').amount, '10');
  assert.equal(byName(nfts, 'Celestial Relic').amount, '1');
  assert.equal(byName(nfts, 'Celestial Pass').standard, 'erc1155');

  const orb = byName(nfts, 'Celestial Orb #1');
  assert.equal(orb.key, `evm:${orb.contract!.toLowerCase()}:1`);
  assert.ok(orb.images[0].startsWith('data:image/svg+xml;base64,'), 'on-chain SVG preserved');
  assert.deepEqual(orb.attributes.map((a) => a.trait_type), ['Kind', 'Orbit', 'Color']);
});

test('Alchemy: missing contract metadata leaves collection name empty (filled on-chain by the indexer)', () => {
  const nfts = alchemy.map(normalizeAlchemyNFT).filter((n): n is NFTAsset => !!n);
  assert.ok(nfts.every((n) => n.collection?.name === null));
});

test('Alchemy spam fixture is hidden (with or without collection name)', () => {
  const nfts = alchemy.map(normalizeAlchemyNFT).filter((n): n is NFTAsset => !!n);
  const hiddenBefore = nfts.filter((n) => computeVisibility(n, null).hidden).map((n) => n.name);
  assert.deepEqual(hiddenBefore, ['Claim 5 ETH Reward #6']);

  for (const n of nfts) if (n.collection) n.collection.name = 'Celestial Test Collection';
  const hiddenAfter = nfts.filter((n) => computeVisibility(n, null).hidden).map((n) => n.name);
  assert.deepEqual(hiddenAfter, ['Claim 5 ETH Reward #6']);
});

test('Alchemy broken-image fixture keeps the unresolvable URL (UI must fall back)', () => {
  const nfts = alchemy.map(normalizeAlchemyNFT).filter((n): n is NFTAsset => !!n);
  assert.deepEqual(byName(nfts, 'Celestial Broken #7').images, ['https://invalid.celestial.test/missing-image.png']);
});
