/**
 * Phase 3 integration check — ERC-721 / ERC-1155 transfers against a LOCAL anvil chain.
 * Uses only anvil's well-known public dev keys. Not part of `npm test`.
 *
 *   anvil --port 8546 &
 *   (cd ../celestial-contracts && PRIVATE_KEY=<anvil #0> RECIPIENT=<address of anvil #1 key> \
 *      forge script script/MintTestNFTs.s.sol:MintTestNFTs --rpc-url http://127.0.0.1:8546 --broadcast)
 *   node tests/nft/integration/evm-transfers.ts <erc721> <erc1155>
 */
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { estimateEVMNFTTransfer, sendEVMNFT } from '../../../src/nft/tx/evm.ts';
import { friendlyTransferError } from '../../../src/nft/tx/types.ts';
import type { NFTAsset } from '../../../src/nft/types.ts';

const RPC = 'http://127.0.0.1:8546';
const OWNER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'; // anvil #1
const OWNER = new ethers.Wallet(OWNER_KEY).address;
const RECIPIENT = new ethers.Wallet('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a').address; // anvil #2
const [erc721, erc1155] = process.argv.slice(2);

const nft = (over: Partial<NFTAsset>): NFTAsset => ({
  key: 'k', chain: 'EVM', standard: 'erc721', name: 'x', description: null, images: [], animation: null,
  attributes: [], collection: null, amount: '1', symbol: null, providerSpam: false, ...over,
});

const provider = new ethers.JsonRpcProvider(RPC);
const c721 = new ethers.Contract(erc721, ['function ownerOf(uint256) view returns (address)'], provider);
const c1155 = new ethers.Contract(erc1155, ['function balanceOf(address,uint256) view returns (uint256)'], provider);

// ERC-721
const orb = nft({ standard: 'erc721', contract: erc721, tokenId: '1' });
const est721 = await estimateEVMNFTTransfer({ nft: orb, from: OWNER, to: RECIPIENT, amount: 1n, rpcUrl: RPC });
console.log('ERC-721 estimate', est721);
assert.ok(est721.sufficient && est721.gasLimit > 0n);
const tx721 = await sendEVMNFT({ nft: orb, from: OWNER, to: RECIPIENT, amount: 1n, rpcUrl: RPC }, OWNER_KEY, est721.gasLimit);
await tx721.wait();
assert.equal(await c721.ownerOf(1n), RECIPIENT);
console.log('✔ ERC-721 #1 transferred', tx721.hash);

// Re-sending the same token must fail with a clear ownership error
await assert.rejects(
  estimateEVMNFTTransfer({ nft: orb, from: OWNER, to: RECIPIENT, amount: 1n, rpcUrl: RPC }),
  (e) => friendlyTransferError(e) === 'You no longer own this NFT',
);
console.log('✔ ERC-721 re-send rejected: no longer owned');

// ERC-1155 partial quantity
const pass = nft({ standard: 'erc1155', contract: erc1155, tokenId: '1', amount: '10' });
const est1155 = await estimateEVMNFTTransfer({ nft: pass, from: OWNER, to: RECIPIENT, amount: 3n, rpcUrl: RPC });
const tx1155 = await sendEVMNFT({ nft: pass, from: OWNER, to: RECIPIENT, amount: 3n, rpcUrl: RPC }, OWNER_KEY, est1155.gasLimit);
await tx1155.wait();
assert.equal(await c1155.balanceOf(OWNER, 1n), 7n);
assert.equal(await c1155.balanceOf(RECIPIENT, 1n), 3n);
console.log('✔ ERC-1155 id 1: sent 3 of 10', tx1155.hash);

await assert.rejects(
  estimateEVMNFTTransfer({ nft: pass, from: OWNER, to: RECIPIENT, amount: 8n, rpcUrl: RPC }),
  (e) => friendlyTransferError(e) === 'You only own 7 of this NFT',
);
console.log('✔ ERC-1155 over-send rejected');

// Wrong signing key is refused before anything is signed
await assert.rejects(
  sendEVMNFT({ nft: nft({ contract: erc721, tokenId: '2' }), from: OWNER, to: RECIPIENT, amount: 1n, rpcUrl: RPC },
    ethers.Wallet.createRandom().privateKey),
  /Signing key does not match/,
);
console.log('✔ mismatched signing key refused\n\nAll EVM transfer checks passed');
