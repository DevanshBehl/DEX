import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { __clearMarketCache, providerReachable } from '../../src/nft/marketplaces/client.ts';
import { formatNative, formatUsd } from '../../src/nft/marketplaces/format.ts';
import { magicEden } from '../../src/nft/marketplaces/magiceden.ts';
import { fetchMarketData } from '../../src/nft/marketplaces/index.ts';
import type { NFTAsset } from '../../src/nft/types.ts';

// ---- Test doubles ------------------------------------------------------------------

const realFetch = globalThis.fetch;
let calls: string[] = [];

/** Routes stubbed responses by URL substring; an unmatched URL fails the test loudly. */
function stubFetch(routes: Record<string, unknown | (() => unknown)>) {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const match = Object.keys(routes).find((k) => url.includes(k));
    if (!match) throw new Error(`unstubbed request: ${url}`);
    const body = routes[match];
    const value = typeof body === 'function' ? (body as () => unknown)() : body;
    if (value instanceof Error) throw value;
    return { ok: true, status: 200, json: async () => value } as Response;
  }) as typeof fetch;
}

beforeEach(() => __clearMarketCache());
afterEach(() => {
  globalThis.fetch = realFetch;
});

const solanaNFT = (assetId: string, collection = 'CollMint1'): NFTAsset => ({
  key: `solana:${assetId}`,
  chain: 'Solana',
  standard: 'metaplex-nft',
  assetId,
  name: `Solana NFT ${assetId}`,
  description: null,
  images: [],
  animation: null,
  attributes: [],
  collection: { id: collection, name: 'Test Collection', image: null, verified: true },
  amount: '1',
  symbol: null,
  providerSpam: false,
});

const evmNFT = (contract: string, tokenId: string, amount = '1'): NFTAsset => ({
  key: `evm:${contract.toLowerCase()}:${tokenId}`,
  chain: 'EVM',
  standard: amount === '1' ? 'erc721' : 'erc1155',
  contract,
  tokenId,
  name: `EVM NFT #${tokenId}`,
  description: null,
  images: [],
  animation: null,
  attributes: [],
  collection: { id: contract, name: 'Test EVM Collection', image: null, verified: true },
  amount,
  symbol: null,
  providerSpam: false,
});

// ---- Formatting --------------------------------------------------------------------

test('formatNative scales precision to the magnitude of the floor', () => {
  assert.equal(formatNative(0.0008123, 'EVM'), '0.0008 ETH');
  assert.equal(formatNative(0.4567, 'Solana'), '0.457 SOL');
  assert.equal(formatNative(12.3456, 'EVM'), '12.35 ETH');
  assert.equal(formatNative(4200.9, 'Solana'), '4,201 SOL');
  assert.equal(formatUsd(1234.5), '$1,234.50');
});

// ---- Provider reachability ---------------------------------------------------------

test('key-gated providers are unreachable without the proxy; Magic Eden is keyless', () => {
  assert.equal(providerReachable('magiceden'), true);
  assert.equal(providerReachable('tensor'), false);
  assert.equal(providerReachable('opensea'), false);
});

test('reachability is per-chain: Magic Eden serves Solana keylessly but needs the proxy for EVM', () => {
  // Verified live: the Solana v2 routes answer unauthenticated, the EVM/RTP routes
  // reject with 400 "Not Found.".
  assert.equal(magicEden.isConfigured('Solana'), true);
  assert.equal(magicEden.isConfigured('EVM'), false);
});

// ---- Magic Eden mapping ------------------------------------------------------------

test('Magic Eden Solana stats convert lamports to SOL and keep the 7d volume window', async () => {
  // Field set recorded from a live keyless call: there is no 24h volume, only volume7d.
  stubFetch({
    '/v2/collections/okay_bears/stats': {
      symbol: 'okay_bears',
      floorPrice: 1_490_200_000,
      listedCount: 644,
      avgPrice24hr: 1_570_892_976,
      volume7d: 164_733_976_669,
    },
  });

  const stats = await magicEden.getCollectionStats('okay_bears');
  assert.equal(stats?.floorNative, 1.4902);
  assert.equal(stats?.listedCount, 644);
  assert.equal(stats?.volume?.window, '7d');
  assert.ok(Math.abs(stats!.volume!.native - 164.733976669) < 1e-6);
  assert.ok(Math.abs(stats!.avgPrice24hNative! - 1.570892976) < 1e-9);
  assert.equal(stats?.url, 'https://magiceden.io/marketplace/okay_bears');
});

test('a Magic Eden floorPrice of 0 means "nothing listed", not a free NFT', async () => {
  stubFetch({ '/stats': { symbol: 'empty_collection', floorPrice: 0, listedCount: 0 } });
  const stats = await magicEden.getCollectionStats('empty_collection');
  assert.equal(stats?.floorNative, null);
  assert.equal(stats?.listedCount, 0);
});

test('Magic Eden EVM stats read the Reservoir-shaped collection payload', async () => {
  stubFetch({
    '/v3/rtp/ethereum/collections/v7': {
      collections: [{
        id: '0xaee65b84d152ee214a2e7607fcbfe302bd3effde',
        tokenCount: '10000',
        onSaleCount: '412',
        floorAsk: { price: { amount: { native: 1.234 } } },
        volume: { '1day': 88.5 },
      }],
    },
  });

  const stats = await magicEden.getCollectionStats('0xaee65b84d152ee214a2e7607fcbfe302bd3effde');
  assert.equal(stats?.floorNative, 1.234);
  assert.equal(stats?.totalSupply, 10000);
  assert.equal(stats?.listedCount, 412);
  assert.deepEqual(stats?.volume, { window: '24h', native: 88.5 });
});

test('an unknown collection returns null rather than throwing', async () => {
  globalThis.fetch = (async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response) as typeof fetch;
  assert.equal(await magicEden.getCollectionStats('does_not_exist'), null);
});

test('resolveCollections: EVM uses the contract, Solana needs one wallet lookup for symbols', async () => {
  stubFetch({
    '/v2/wallets/': [
      { mintAddress: 'MintA', collection: 'celestial_test' },
      { mintAddress: 'MintB', collection: 'celestial_test' },
      { mintAddress: 'MintUnindexed' }, // no collection → omitted
    ],
  });

  const nfts = [solanaNFT('MintA'), solanaNFT('MintB'), solanaNFT('MintUnindexed'), evmNFT('0xAeE65b84D152Ee214A2e7607FcBFe302BD3EffDe', '1')];
  const handles = await magicEden.resolveCollections(nfts, 'OwnerWallet');

  assert.equal(handles.get('solana:MintA'), 'celestial_test');
  assert.equal(handles.get('solana:MintB'), 'celestial_test');
  assert.equal(handles.has('solana:MintUnindexed'), false);
  // EVM handles are lowercased contracts and cost no request
  assert.equal(handles.get('evm:0xaee65b84d152ee214a2e7607fcbfe302bd3effde:1'), '0xaee65b84d152ee214a2e7607fcbfe302bd3effde');
  assert.equal(calls.filter((c) => c.includes('/v2/wallets/')).length, 1);
});

// ---- Aggregation -------------------------------------------------------------------

test('testnets skip market lookups entirely', async () => {
  stubFetch({});
  const data = await fetchMarketData([solanaNFT('MintA'), evmNFT('0xabc', '1')], {
    evmOwner: '0xowner',
    solanaOwner: 'OwnerWallet',
    isTestnet: true,
  });
  assert.equal(data.size, 0);
  assert.equal(calls.length, 0);
});

test('collections shared by several NFTs are priced with a single stats request', async () => {
  stubFetch({
    '/v2/wallets/': [
      { mintAddress: 'MintA', collection: 'celestial_test' },
      { mintAddress: 'MintB', collection: 'celestial_test' },
    ],
    '/v2/collections/celestial_test/stats': { floorPrice: 2_000_000_000, listedCount: 4 },
  });

  const nfts = [solanaNFT('MintA'), solanaNFT('MintB')];
  const data = await fetchMarketData(nfts, { solanaOwner: 'OwnerWallet', isTestnet: false });

  assert.equal(data.get('solana:MintA')?.floorNative, 2);
  assert.equal(data.get('solana:MintB')?.floorNative, 2);
  assert.equal(calls.filter((c) => c.includes('/v2/collections/')).length, 1, 'stats fetched once per collection');
});

test('EVM NFTs get no market data until the proxy is configured, and cost no requests', async () => {
  // Both EVM providers are key-gated, so the chain is skipped entirely rather than
  // firing requests that would 400.
  stubFetch({});
  const data = await fetchMarketData([evmNFT('0xAbc0000000000000000000000000000000000001', '1')], {
    evmOwner: '0xowner',
    isTestnet: false,
  });
  assert.equal(data.size, 0);
  assert.equal(calls.length, 0);
});

test('NFTs with no collection, and provider-flagged spam, are never looked up', async () => {
  stubFetch({ '/v2/wallets/': [] });
  const orphan: NFTAsset = { ...solanaNFT('MintOrphan'), collection: null };
  const spam: NFTAsset = { ...solanaNFT('MintSpam'), providerSpam: true };

  const data = await fetchMarketData([orphan, spam], { solanaOwner: 'OwnerWallet', isTestnet: false });
  assert.equal(data.size, 0);
  assert.equal(calls.length, 0, 'no candidates left → no requests at all');
});

test('a provider outage degrades to "no market data" instead of throwing', async () => {
  stubFetch({ '/v2/wallets/': () => new Error('network down') });
  const data = await fetchMarketData([solanaNFT('MintA')], { solanaOwner: 'OwnerWallet', isTestnet: false });
  assert.equal(data.size, 0);
});

// ---- Explore (Phase 4.3) -----------------------------------------------------------

test('Magic Eden listings keep prices in SOL and normalise the -1 "no expiry" sentinel', async () => {
  // Shape recorded from a live keyless call: `price` is already SOL (not lamports),
  // and expiry is -1 when the listing never expires.
  stubFetch({
    '/listings?offset=0': [
      { tokenMint: 'MintA', price: 6.906, seller: 'SellerA', expiry: -1, extra: { img: 'https://img/a.png' }, token: { name: 'Mad Lads #3490' } },
      { tokenMint: 'MintB', price: 6.907, seller: 'SellerB', expiry: 1789673535, token: { name: 'Mad Lads #7165' } },
      { tokenMint: 'MintC', price: 0 }, // a zero price is not a real listing
    ],
  });

  const page = await magicEden.getListings!('mad_lads');
  assert.equal(page.items.length, 2, 'zero-priced entries are dropped');
  assert.equal(page.items[0].priceNative, 6.906);
  assert.equal(page.items[0].name, 'Mad Lads #3490');
  assert.equal(page.items[0].image, 'https://img/a.png');
  assert.equal(page.items[0].expiresAt, null, '-1 becomes null, not a 1970 timestamp');
  assert.equal(page.items[1].expiresAt, 1789673535 * 1000, 'seconds are converted to ms');
  assert.equal(page.cursor, null, 'a short page ends pagination');
});

test('a full page of listings yields a cursor for the next offset', async () => {
  const full = Array.from({ length: 20 }, (_, i) => ({ tokenMint: `Mint${i}`, price: 1 + i }));
  stubFetch({ '/listings?offset=0': full });
  const page = await magicEden.getListings!('mad_lads');
  assert.equal(page.items.length, 20);
  assert.equal(page.cursor, '20');
});

test('Explore reports curated collections as unranked so the UI can label them honestly', async () => {
  // No keyless endpoint ranks Solana collections by volume, so `ranked` must be false.
  stubFetch({ '/listings?offset=0&limit=1': [{ tokenMint: 'M', price: 1, extra: { img: 'https://img/thumb.png' } }] });
  const { collections, ranked } = await magicEden.getExploreCollections!();

  assert.equal(ranked, false);
  assert.ok(collections.length > 0);
  assert.equal(collections[0].chain, 'Solana');
  assert.ok(collections[0].name, 'names come from the curated list, not the 429-prone metadata route');
  assert.equal(collections[0].image, 'https://img/thumb.png');
  assert.equal(
    calls.some((c) => /\/v2\/collections\/[^/]+$/.test(new URL(c).pathname)),
    false,
    'the rate-limited metadata route is never called',
  );
});

test('Explore still lists a collection whose thumbnail lookup fails', async () => {
  // A 429 on the thumbnail route must cost the row its image, not its place on screen.
  stubFetch({ '/listings?offset=0&limit=1': () => new Error('429') });
  const { collections } = await magicEden.getExploreCollections!();
  assert.ok(collections.length > 0, 'rows survive without thumbnails');
  assert.equal(collections[0].image, null);
  assert.ok(collections[0].name);
});

test('a failing stats call for one collection does not sink the others', async () => {
  stubFetch({
    '/v2/wallets/': [
      { mintAddress: 'MintA', collection: 'good_collection' },
      { mintAddress: 'MintB', collection: 'broken_collection' },
    ],
    '/v2/collections/good_collection/stats': { floorPrice: 1_000_000_000 },
    '/v2/collections/broken_collection/stats': () => new Error('500'),
  });

  const data = await fetchMarketData([solanaNFT('MintA'), solanaNFT('MintB')], { solanaOwner: 'OwnerWallet', isTestnet: false });
  assert.equal(data.get('solana:MintA')?.floorNative, 1);
  assert.equal(data.has('solana:MintB'), false);
});
