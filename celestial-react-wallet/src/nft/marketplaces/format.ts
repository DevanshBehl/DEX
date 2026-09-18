import type { NFTChain } from '../types.ts';

// ---- Market value formatting (nft.md — Phase 4.3) ----------------------------------

export const nativeSymbol = (chain: NFTChain) => (chain === 'EVM' ? 'ETH' : 'SOL');

/**
 * Floor prices span several orders of magnitude (0.0008 ETH → 400 ETH), so a fixed
 * precision either loses small floors entirely or makes large ones unreadable.
 */
export function formatNative(amount: number, chain: NFTChain): string {
  const abs = Math.abs(amount);
  const decimals = abs === 0 ? 2 : abs < 0.001 ? 4 : abs < 1 ? 3 : abs < 1000 ? 2 : 0;
  return `${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: decimals })} ${nativeSymbol(chain)}`;
}

export function formatUsd(amount: number): string {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
