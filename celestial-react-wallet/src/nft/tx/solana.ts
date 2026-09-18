import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  ACCOUNT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { NFTTransferError, type NFTTransferEstimate, type NFTTransferParams } from './types.ts';
import type { SentTransaction } from './evm.ts';

// ---- Solana NFT transfers (nft.md — Phase 3.1) ---------------------------------------
//
//   metaplex-nft / token-2022-nft → SPL transferChecked (+ idempotent recipient ATA)
//   metaplex-pnft / -cnft / -core → Metaplex programs via lazily loaded solana-metaplex.ts

const BASE_FEE_LAMPORTS = 5_000n; // one signature
/** Token-2022 ATAs carry the ImmutableOwner extension (165 + 1 type + 4 TLV header). */
const TOKEN_2022_ATA_SIZE = ACCOUNT_SIZE + 5;

const isSplStandard = (standard: string) => standard === 'metaplex-nft' || standard === 'token-2022-nft';
const loadMetaplex = () => import('./solana-metaplex.ts');

const formatSol = (lamports: bigint) =>
  (Number(lamports) / LAMPORTS_PER_SOL).toFixed(9).replace(/\.?0+$/, '') || '0';

async function findSourceTokenAccount(connection: Connection, owner: PublicKey, mint: PublicKey) {
  const { value } = await connection.getParsedTokenAccountsByOwner(owner, { mint });
  const holding = value.find((a) => a.account.data.parsed?.info?.tokenAmount?.amount !== '0');
  if (!holding) throw new NFTTransferError('You no longer own this NFT');
  const state = holding.account.data.parsed?.info?.state;
  if (state === 'frozen') throw new NFTTransferError('This NFT is frozen (e.g. staked or listed) and cannot be sent');
  return { address: holding.pubkey, programId: holding.account.owner };
}

/** Idempotent recipient ATA + transferChecked(1, decimals 0) — pure, so unit tests can assert accounts. */
export function buildSplNFTTransferInstructions(
  owner: PublicKey,
  recipient: PublicKey,
  mint: PublicKey,
  sourceTokenAccount: PublicKey,
  programId: PublicKey,
) {
  const destination = getAssociatedTokenAddressSync(mint, recipient, true, programId);
  return [
    createAssociatedTokenAccountIdempotentInstruction(owner, destination, recipient, mint, programId),
    createTransferCheckedInstruction(sourceTokenAccount, mint, destination, owner, 1n, 0, [], programId),
  ];
}

export async function estimateSolanaNFTTransfer(params: NFTTransferParams): Promise<NFTTransferEstimate> {
  const connection = new Connection(params.rpcUrl, 'confirmed');
  const from = new PublicKey(params.from);
  const balance = BigInt(await connection.getBalance(from));

  let lamports = BASE_FEE_LAMPORTS;
  const notes: string[] = [];

  if (isSplStandard(params.nft.standard)) {
    const mint = new PublicKey(params.nft.assetId!);
    const { programId } = await findSourceTokenAccount(connection, from, mint);
    const destination = getAssociatedTokenAddressSync(mint, new PublicKey(params.to), true, programId);
    if (!(await connection.getAccountInfo(destination))) {
      const size = programId.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_ATA_SIZE : ACCOUNT_SIZE;
      lamports += BigInt(await connection.getMinimumBalanceForRentExemption(size));
      notes.push("Includes rent to create the recipient's token account");
    }
  } else {
    const extra = await (await loadMetaplex()).checkMetaplexTransfer(params);
    lamports += extra.rentLamports;
    notes.push(...extra.notes);
  }

  return {
    fee: formatSol(lamports),
    symbol: 'SOL',
    nativeBalance: formatSol(balance),
    sufficient: balance >= lamports,
    notes,
  };
}

export async function sendSolanaNFT(params: NFTTransferParams, privateKey: string): Promise<SentTransaction> {
  const signer = Keypair.fromSecretKey(bs58.decode(privateKey));
  if (signer.publicKey.toBase58() !== params.from) {
    throw new NFTTransferError('Signing key does not match the sending account');
  }

  if (!isSplStandard(params.nft.standard)) {
    const signature = await (await loadMetaplex()).sendMetaplexNFT(params, signer.secretKey);
    return { hash: signature, wait: async () => {} };
  }

  const connection = new Connection(params.rpcUrl, 'confirmed');
  const mint = new PublicKey(params.nft.assetId!);
  const recipient = new PublicKey(params.to);
  const source = await findSourceTokenAccount(connection, signer.publicKey, mint);

  const tx = new Transaction().add(...buildSplNFTTransferInstructions(signer.publicKey, recipient, mint, source.address, source.programId));
  const signature = await sendAndConfirmTransaction(connection, tx, [signer], { commitment: 'confirmed' });
  return { hash: signature, wait: async () => {} };
}
