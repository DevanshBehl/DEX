import type { NFTAsset } from '../types.ts';

// ---- NFT transfer contracts shared by EVM + Solana builders (nft.md — Phase 3.1) ----

export interface NFTTransferParams {
  nft: NFTAsset;
  /** The wallet's own address (current owner). */
  from: string;
  /** Validated recipient address. */
  to: string;
  /** Quantity — always 1n except ERC-1155. */
  amount: bigint;
  rpcUrl: string;
}

export interface NFTTransferEstimate {
  /** Estimated total cost in native units (network fee + any rent for new accounts). */
  fee: string;
  symbol: 'ETH' | 'SOL';
  nativeBalance: string;
  sufficient: boolean;
  notes: string[];
}

/** Expected, user-facing failure (shown verbatim in the send flow). */
export class NFTTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NFTTransferError';
  }
}

export function friendlyTransferError(e: unknown): string {
  const raw = (e as { shortMessage?: string; message?: string })?.shortMessage || (e as Error)?.message || String(e);
  const msg = raw.toLowerCase();
  if (e instanceof NFTTransferError) return raw;
  if (msg.includes('insufficient funds') || msg.includes('insufficient lamports') || msg.includes('0x1 ') || msg.includes('custom program error: 0x1'))
    return 'Not enough balance to pay the network fee.';
  if (msg.includes('blockhash not found') || msg.includes('block height exceeded'))
    return 'The network took too long to confirm. Check the explorer before trying again.';
  if (msg.includes('user rejected')) return 'Transaction cancelled.';
  if (msg.includes('execution reverted') || msg.includes('call_exception'))
    return 'The NFT contract rejected this transfer (you may no longer own it, or it is non-transferable).';
  return raw.length > 180 ? `${raw.slice(0, 180)}…` : raw;
}
