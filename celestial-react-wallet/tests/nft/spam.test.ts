import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeVisibility, scoreSpam, SPAM_THRESHOLD } from '../../src/nft/spam.ts';
import type { NFTAsset } from '../../src/nft/types.ts';

const base = (over: Partial<NFTAsset>): NFTAsset => ({
  key: 'evm:0xabc:1', chain: 'EVM', standard: 'erc721', name: 'Test', description: null, images: [],
  animation: null, attributes: [], collection: { id: '0xabc', name: 'Collection', image: null, verified: false },
  amount: '1', symbol: null, providerSpam: false, ...over,
});

test('legitimate NFTs are not flagged', () => {
  for (const name of ['Mad Lads #1234', 'Bored Ape Yacht Club #1', 'DeGod #420 — Airdrop Season', 'Pudgy Penguin #88']) {
    assert.ok(scoreSpam(base({ name })).score < SPAM_THRESHOLD, name);
  }
  // Unverified / missing collection alone is not spam
  assert.equal(computeVisibility(base({ name: 'Artist 1/1', collection: null }), null).isSpam, false);
});

test('scam-style NFTs are flagged', () => {
  const cases: Partial<NFTAsset>[] = [
    { name: 'Claim 5 ETH Reward #6', description: 'Congratulations! Visit celestial-airdrop-claim.xyz to claim your reward now.' },
    { name: 'Visit usdc-bonus.io to claim', collection: null },
    { name: '$5000 USDC Voucher', description: 'Redeem at www.get-voucher.site', collection: null },
    { name: 'Totally Normal', providerSpam: true },
  ];
  for (const c of cases) assert.equal(computeVisibility(base(c), null).isSpam, true, c.name);
});

test('user overrides win over heuristics', () => {
  const scam = base({ name: 'Claim 500 SOL Reward', description: 'Visit claim-sol.xyz', collection: null });
  assert.equal(computeVisibility(scam, null).hidden, true);
  assert.equal(computeVisibility(scam, 'visible').hidden, false);
  assert.equal(computeVisibility(base({ name: 'Mad Lads #1' }), 'hidden').hidden, true);
});
