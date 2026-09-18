import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { alchemyNftApiBase, fetchEVMNFTs } from '../../src/nft/indexers/alchemy.ts';
import { fetchSolanaNFTs } from '../../src/nft/indexers/helius.ts';
import { loadFixture } from './helpers.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test('alchemyNftApiBase derives the NFT API URL from an RPC URL', () => {
  assert.equal(alchemyNftApiBase('https://eth-sepolia.g.alchemy.com/v2/KEY123'), 'https://eth-sepolia.g.alchemy.com/nft/v3/KEY123');
  assert.throws(() => alchemyNftApiBase('https://rpc.example.com/v2/abc'));
});

test('fetchEVMNFTs follows pageKey across pages', async () => {
  const fixture = loadFixture('alchemy-sepolia-getNFTsForOwner.json');
  const named = fixture.ownedNfts.map((n: any) => ({ ...n, contract: { ...n.contract, name: 'Named' } }));
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const page = new URL(url).searchParams.get('pageKey');
    const body = page ? { ownedNfts: named.slice(5), pageKey: null } : { ownedNfts: named.slice(0, 5), pageKey: 'p2' };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;

  const nfts = await fetchEVMNFTs('0xowner', 'https://eth-sepolia.g.alchemy.com/v2/KEY');
  assert.equal(urls.length, 2);
  assert.equal(new URL(urls[1]).searchParams.get('pageKey'), 'p2');
  assert.equal(nfts.length, 9);
});

test('fetchSolanaNFTs pages until a short page is returned', async () => {
  const items = loadFixture('helius-devnet-getAssetsByOwner.json').result.items;
  const pages: number[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const { params } = JSON.parse(String(init!.body));
    pages.push(params.page);
    // page 1: exactly 1000 items (forces another request), page 2: the real fixtures
    const pageItems = params.page === 1
      ? Array.from({ length: 1000 }, (_, i) => ({ id: `fungible-${i}`, interface: 'FungibleToken' }))
      : items;
    return new Response(JSON.stringify({ result: { items: pageItems } }), { status: 200 });
  }) as typeof fetch;

  const nfts = await fetchSolanaNFTs('owner', 'https://devnet.helius-rpc.com/?api-key=x');
  assert.deepEqual(pages, [1, 2]);
  assert.equal(nfts.length, 8);
});

test('fetchSolanaNFTs surfaces DAS errors', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: 'bad owner' } }), { status: 200 })) as typeof fetch;
  await assert.rejects(fetchSolanaNFTs('owner', 'https://devnet.helius-rpc.com/'), /bad owner/);
});
