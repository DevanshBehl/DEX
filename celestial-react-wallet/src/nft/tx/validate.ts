import { ethers } from 'ethers';
import { PublicKey } from '@solana/web3.js';
import type { NFTAsset } from '../types.ts';

// ---- Send-flow validation (nft.md — Phase 3.2) -------------------------------------
// Pure checks — no network — so they run on every keystroke and in unit tests.

export interface RecipientCheck {
  ok: boolean;
  /** Canonical address to use for the transfer (checksummed EVM / base58 Solana). */
  address?: string;
  error?: string;
  warnings: string[];
}

export function validateRecipient(
  nft: Pick<NFTAsset, 'chain' | 'contract' | 'assetId' | 'collection'>,
  ownerAddress: string,
  input: string,
): RecipientCheck {
  const value = input.trim();
  if (!value) return { ok: false, warnings: [] };

  if (nft.chain === 'EVM') {
    if (!ethers.isAddress(value)) return { ok: false, error: 'Enter a valid Ethereum address (0x…)', warnings: [] };
    const address = ethers.getAddress(value.toLowerCase());
    if (address === ethers.ZeroAddress) {
      return { ok: false, error: 'Sending to the zero address burns the NFT', warnings: [] };
    }
    if (address.toLowerCase() === ownerAddress.toLowerCase()) {
      return { ok: false, error: 'This is your own address', warnings: [] };
    }
    if (nft.contract && address.toLowerCase() === nft.contract.toLowerCase()) {
      return { ok: false, error: "That's the NFT's own contract — NFTs sent there are usually lost", warnings: [] };
    }
    return { ok: true, address, warnings: [] };
  }

  let key: PublicKey;
  try {
    key = new PublicKey(value);
  } catch {
    return { ok: false, error: 'Enter a valid Solana address', warnings: [] };
  }
  const address = key.toBase58();
  if (address !== value) return { ok: false, error: 'Enter a valid Solana address', warnings: [] };
  if (address === ownerAddress) return { ok: false, error: 'This is your own address', warnings: [] };
  if (address === nft.assetId || (nft.collection && address === nft.collection.id)) {
    return { ok: false, error: "That's the NFT's own mint / collection address — NFTs sent there are lost", warnings: [] };
  }

  const warnings: string[] = [];
  if (!PublicKey.isOnCurve(key.toBytes())) {
    warnings.push('This is a program-owned address (PDA), not a normal wallet. Only continue if you know the program can hold NFTs.');
  }
  return { ok: true, address, warnings };
}

/** True when the wallet hasn't sent an NFT to `address` recently on this chain. */
export function isNewRecipient(chain: NFTAsset['chain'], recent: string[], address: string): boolean {
  return chain === 'EVM'
    ? !recent.some((a) => a.toLowerCase() === address.toLowerCase())
    : !recent.includes(address);
}

export interface AmountCheck {
  ok: boolean;
  amount?: bigint;
  error?: string;
}

/** ERC-1155 allows partial quantities; every other standard transfers exactly one. */
export function validateAmount(nft: Pick<NFTAsset, 'standard' | 'amount'>, input: string): AmountCheck {
  const owned = BigInt(nft.amount || '1');
  if (nft.standard !== 'erc1155') return { ok: true, amount: 1n };

  const value = input.trim();
  if (!/^\d+$/.test(value)) return { ok: false, error: 'Enter a whole number' };
  const amount = BigInt(value);
  if (amount < 1n) return { ok: false, error: 'Amount must be at least 1' };
  if (amount > owned) return { ok: false, error: `You only own ${owned}` };
  return { ok: true, amount };
}
