import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { Keypair, PublicKey } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { encodeEVMNFTTransfer } from '../../src/nft/tx/evm.ts';
import { buildSplNFTTransferInstructions } from '../../src/nft/tx/solana.ts';
import { NFTTransferError, friendlyTransferError } from '../../src/nft/tx/types.ts';
import { isNewRecipient, validateAmount, validateRecipient } from '../../src/nft/tx/validate.ts';
import type { NFTAsset } from '../../src/nft/types.ts';

// Phase 3 — pure send-flow validation and transaction builders (no network)

const CONTRACT = '0xaeE65b84d152Ee214A2e7607fcBFe302BD3EffDe';
const OWNER = '0x11F27CD68B72a81A192E4ec2672870084607c3B1';
const RECIPIENT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const SOL_OWNER = '5ehVoahvrtU7MxUpGnj4JTk8rXka4dmDECU8fRusLKsZ';
const SOL_MINT = 'G3r8kpB6Bjf6KE5kn4PTGemuwktiks51yvPh4jwkUFUq';
const SOL_COLLECTION = 'GX8LDM4wi3ukxJrGoS8McCagraUy9u5WrYBk2KQNpuLa';

const nft = (over: Partial<NFTAsset>): NFTAsset => ({
  key: 'k', chain: 'EVM', standard: 'erc721', contract: CONTRACT, tokenId: '1', name: 'x', description: null, images: [],
  animation: null, attributes: [], collection: null, amount: '1', symbol: null, providerSpam: false, ...over,
});
const solNft = nft({ chain: 'Solana', standard: 'metaplex-nft', contract: undefined, tokenId: undefined, assetId: SOL_MINT,
  collection: { id: SOL_COLLECTION, name: 'C', image: null, verified: true } });

test('validateRecipient (EVM): accepts any case, returns checksum, rejects self / contract / zero', () => {
  const ok = validateRecipient(nft({}), OWNER, `  ${RECIPIENT.toLowerCase()} `);
  assert.deepEqual(ok, { ok: true, address: RECIPIENT, warnings: [] });

  assert.equal(validateRecipient(nft({}), OWNER, '').error, undefined);
  assert.match(validateRecipient(nft({}), OWNER, '0x1234').error!, /valid Ethereum address/);
  assert.match(validateRecipient(nft({}), OWNER, SOL_OWNER).error!, /valid Ethereum address/);
  assert.match(validateRecipient(nft({}), OWNER, OWNER.toUpperCase().replace('0X', '0x')).error!, /own address/);
  assert.match(validateRecipient(nft({}), OWNER, CONTRACT.toLowerCase()).error!, /own contract/);
  assert.match(validateRecipient(nft({}), OWNER, ethers.ZeroAddress).error!, /burns/);
});

test('validateRecipient (Solana): rejects invalid, self, mint and collection; warns on PDA', () => {
  const to = Keypair.generate().publicKey.toBase58();
  assert.deepEqual(validateRecipient(solNft, SOL_OWNER, to), { ok: true, address: to, warnings: [] });

  assert.match(validateRecipient(solNft, SOL_OWNER, RECIPIENT).error!, /valid Solana address/);
  assert.match(validateRecipient(solNft, SOL_OWNER, 'not-base58-0OIl').error!, /valid Solana address/);
  assert.match(validateRecipient(solNft, SOL_OWNER, SOL_OWNER).error!, /own address/);
  assert.match(validateRecipient(solNft, SOL_OWNER, SOL_MINT).error!, /mint/);
  assert.match(validateRecipient(solNft, SOL_OWNER, SOL_COLLECTION).error!, /collection/);

  const [pda] = PublicKey.findProgramAddressSync([Buffer.from('vault')], TOKEN_PROGRAM_ID);
  const pdaCheck = validateRecipient(solNft, SOL_OWNER, pda.toBase58());
  assert.ok(pdaCheck.ok);
  assert.match(pdaCheck.warnings[0], /program-owned/);
});

test('validateAmount: ERC-1155 bounded by balance; other standards always 1', () => {
  const edition = nft({ standard: 'erc1155', amount: '10' });
  assert.deepEqual(validateAmount(edition, '3'), { ok: true, amount: 3n });
  assert.deepEqual(validateAmount(edition, '10'), { ok: true, amount: 10n });
  assert.match(validateAmount(edition, '11').error!, /only own 10/);
  assert.match(validateAmount(edition, '0').error!, /at least 1/);
  assert.match(validateAmount(edition, '1.5').error!, /whole number/);
  assert.deepEqual(validateAmount(nft({}), '99'), { ok: true, amount: 1n });
  assert.deepEqual(validateAmount(solNft, ''), { ok: true, amount: 1n });
});

test('isNewRecipient: case-insensitive on EVM, exact on Solana', () => {
  assert.equal(isNewRecipient('EVM', [RECIPIENT.toLowerCase()], RECIPIENT), false);
  assert.equal(isNewRecipient('EVM', [OWNER], RECIPIENT), true);
  assert.equal(isNewRecipient('Solana', [SOL_OWNER], SOL_OWNER), false);
  assert.equal(isNewRecipient('Solana', [SOL_OWNER.toLowerCase()], SOL_OWNER), true);
});

test('EVM calldata: ERC-721 safeTransferFrom(from,to,id) and ERC-1155 safeTransferFrom(from,to,id,amount,"0x")', () => {
  const erc721 = encodeEVMNFTTransfer({ nft: nft({ tokenId: '42' }), from: OWNER.toLowerCase(), to: RECIPIENT, amount: 1n });
  assert.equal(erc721.to, CONTRACT);
  const i721 = new ethers.Interface(['function safeTransferFrom(address,address,uint256)']);
  assert.ok(erc721.data.startsWith(i721.getFunction('safeTransferFrom')!.selector)); // 0x42842e0e
  assert.equal(i721.getFunction('safeTransferFrom')!.selector, '0x42842e0e');
  assert.deepEqual([...i721.decodeFunctionData('safeTransferFrom', erc721.data)], [OWNER, RECIPIENT, 42n]);

  const erc1155 = encodeEVMNFTTransfer({ nft: nft({ standard: 'erc1155', tokenId: '2', amount: '10' }), from: OWNER, to: RECIPIENT, amount: 7n });
  const i1155 = new ethers.Interface(['function safeTransferFrom(address,address,uint256,uint256,bytes)']);
  assert.equal(i1155.getFunction('safeTransferFrom')!.selector, '0xf242432a');
  assert.deepEqual([...i1155.decodeFunctionData('safeTransferFrom', erc1155.data)], [OWNER, RECIPIENT, 2n, 7n, '0x']);

  assert.throws(() => encodeEVMNFTTransfer({ nft: nft({ standard: 'metaplex-nft' }), from: OWNER, to: RECIPIENT, amount: 1n }), NFTTransferError);
  assert.throws(() => encodeEVMNFTTransfer({ nft: nft({ tokenId: undefined }), from: OWNER, to: RECIPIENT, amount: 1n }), /Missing contract/);
});

for (const [label, programId] of [['SPL Token', TOKEN_PROGRAM_ID], ['Token-2022', TOKEN_2022_PROGRAM_ID]] as const) {
  test(`Solana ${label} NFT: idempotent recipient ATA + transferChecked(1, decimals 0)`, () => {
    const owner = Keypair.generate().publicKey;
    const recipient = Keypair.generate().publicKey;
    const mint = new PublicKey(SOL_MINT);
    const source = getAssociatedTokenAddressSync(mint, owner, false, programId);
    const destination = getAssociatedTokenAddressSync(mint, recipient, true, programId);

    const [createAta, transfer] = buildSplNFTTransferInstructions(owner, recipient, mint, source, programId);

    assert.ok(createAta.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));
    assert.deepEqual([...createAta.data], [1]); // CreateIdempotent
    assert.deepEqual(createAta.keys.slice(0, 4).map((k) => k.pubkey.toBase58()), [owner, destination, recipient, mint].map((k) => k.toBase58()));
    assert.ok(createAta.keys[0].isSigner);

    assert.ok(transfer.programId.equals(programId));
    assert.equal(transfer.data[0], 12); // TransferChecked
    assert.equal(transfer.data.readBigUInt64LE(1), 1n);
    assert.equal(transfer.data[9], 0); // decimals
    assert.deepEqual(transfer.keys.map((k) => k.pubkey.toBase58()), [source, mint, destination, owner].map((k) => k.toBase58()));
    assert.ok(transfer.keys[3].isSigner);
  });
}

test('friendlyTransferError maps common RPC failures', () => {
  assert.equal(friendlyTransferError(new NFTTransferError('You no longer own this NFT')), 'You no longer own this NFT');
  assert.equal(friendlyTransferError(new Error('insufficient funds for gas * price + value')), 'Not enough balance to pay the network fee.');
  assert.equal(friendlyTransferError(new Error('Attempt to debit an account but found no record of a prior credit. insufficient lamports')), 'Not enough balance to pay the network fee.');
  assert.match(friendlyTransferError({ shortMessage: 'execution reverted' }), /contract rejected/);
  assert.match(friendlyTransferError(new Error('Blockhash not found')), /too long/);
  assert.ok(friendlyTransferError(new Error('x'.repeat(500))).length <= 181);
});
