/**
 * Phase 3 integration check — Solana NFT transfers on DEVNET, one per standard.
 * Signs with the fixture payer keypair (scripts/.keys, devnet only). Not part of `npm test`.
 *
 *   npm run fixtures:solana -- --owner <payer address> --output /tmp/fixtures.payer.json
 *   node tests/nft/integration/solana-transfers.ts /tmp/fixtures.payer.json
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { fetchSolanaNFTs } from '../../../src/nft/indexers/helius.ts';
import { estimateSolanaNFTTransfer, sendSolanaNFT } from '../../../src/nft/tx/solana.ts';
import { friendlyTransferError } from '../../../src/nft/tx/types.ts';
import { validateRecipient } from '../../../src/nft/tx/validate.ts';

process.loadEnvFile('.env');
const RPC = process.env.VITE_HELIUS_DEVNET_URL!;
const fixtures = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync('scripts/.keys/devnet-fixture-payer.json', 'utf8'))));
const FROM = payer.publicKey.toBase58();
const KEY = bs58.encode(payer.secretKey);
const recipient = Keypair.generate().publicKey.toBase58();
assert.equal(fixtures.owner, FROM, 'fixtures must be owned by the payer');

async function ownerOf(id: string): Promise<string | undefined> {
  const res = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAsset', params: { id } }) });
  return (await res.json()).result?.ownership?.owner;
}
async function waitForOwner(id: string, expected: string, timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((await ownerOf(id)) === expected) return;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`owner of ${id} did not become ${expected}`);
}

// Wait until DAS has indexed the freshly minted fixtures
const all = { nft: fixtures.standardNfts[0], pnft: fixtures.programmableNft, cnft: fixtures.compressedNfts[0], core: fixtures.coreAsset };
// Optional 2nd arg: comma list of standards to run (e.g. "cnft,core") when re-running after a partial run
const only = process.argv[3]?.split(',');
const wanted: string[] = Object.entries(all).filter(([k]) => !only || only.includes(k)).map(([, id]) => id);
let nfts = await fetchSolanaNFTs(FROM, RPC);
for (let i = 0; i < 30 && !wanted.every((id: string) => nfts.some((n) => n.assetId === id)); i++) {
  await new Promise((r) => setTimeout(r, 3000));
  nfts = await fetchSolanaNFTs(FROM, RPC);
}
console.log(`payer ${FROM}\nrecipient ${recipient}\n`);

for (const id of wanted) {
  const nft = nfts.find((n) => n.assetId === id);
  assert.ok(nft, `indexer did not return ${id}`);

  const check = validateRecipient(nft, FROM, recipient);
  assert.ok(check.ok && check.address === recipient);

  const params = { nft, from: FROM, to: recipient, amount: 1n, rpcUrl: RPC };
  const estimate = await estimateSolanaNFTTransfer(params);
  assert.ok(estimate.sufficient);

  const sent = await sendSolanaNFT(params, KEY);
  await waitForOwner(id, recipient);
  console.log(`✔ ${nft.standard.padEnd(14)} ${nft.name.padEnd(24)} fee≈${estimate.fee} SOL  ${estimate.notes.join('; ') || ''}\n    ${sent.hash}`);

  await assert.rejects(estimateSolanaNFTTransfer(params), (e) => friendlyTransferError(e) === 'You no longer own this NFT');
}
console.log('\n✔ re-sending each transferred NFT is rejected (no longer owned)');

await assert.rejects(
  sendSolanaNFT({ nft: nfts.find((n) => n.assetId === fixtures.standardNfts[1])!, from: FROM, to: recipient, amount: 1n, rpcUrl: RPC },
    bs58.encode(Keypair.generate().secretKey)),
  /Signing key does not match/,
);
console.log('✔ mismatched signing key refused\n\nAll Solana transfer checks passed');
