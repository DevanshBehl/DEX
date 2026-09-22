// Celestial Perps EVM deployment (Sepolia) — mirrors deployments/sepolia.json.
// Traders and LPs approve USDC to the LiquidityPool (it holds all USDC), then call the engine/pool.

import type { MarketId } from "@/lib/marketData";

export const SEPOLIA_CONTRACTS = {
  chainId: 11155111,
  perpEngine: "0x49765B9bEFed004A6462ad2025C240191e762b60",
  liquidityPool: "0xB2DF5d7C1BCa2d82ECA1D591F0E58B335387b24b",
  clp: "0x303C049BF526bD40d82E2Bd405af34bB095A55DA",
  chainlinkOracle: "0xFF6a6Da437b16e5dd29D2eF8Aa38517911320cC0",
  mockUsdc: "0x88a77050162285276d6346a4Bc07C406572d6cD2",
} as const;

// keccak256 of the market symbol — the `bytes32 market` argument everywhere on EVM.
// SOL-USD is Solana-only (no Chainlink SOL/USD feed on Sepolia).
export const EVM_MARKET_IDS: Partial<Record<MarketId, `0x${string}`>> = {
  "ETH-USD": "0x2430f68ea2e8d4151992bb7fc3a4c472087a6149bf7e0232704396162ab7c1f7",
  "BTC-USD": "0xb39c402b9bd8428ba7a4cc2d1aca1432756cddeb60941a9175541a819095269e",
};

// Minimum ETH execution fee paid to the keeper per request (PerpEngine.minExecutionFee).
export const MIN_EXECUTION_FEE_WEI = 200_000_000_000_000n; // 0.0002 ETH
