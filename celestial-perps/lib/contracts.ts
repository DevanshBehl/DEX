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

// Celestial Perps Solana deployment (devnet) — mirrors deployments/solana-devnet.json.
// IDL + generated types: src/idl/celestial_perps.{json,ts}. USDC and CLP are Token-2022 mints.
// Instructions that need AUM take every market + its oracle as remaining accounts, in
// SOLANA_MARKET_ORDER order: [market_0, oracle_0, market_1, oracle_1, …].
export const SOLANA_DEVNET_PERPS = {
  programId: "EK1KpDGfUiZ4XkWixAaRFonDexZYSKnJm8oJz5s7HLTL",
  config: "CCof8LtZZpL6U2wXDS7sp3yV2r6v5QuTbvE6ms8m2wgX",
  pool: "2jZjsSQMRrRWhRupktSbHeo1SDLgAs4fePT5ndhtTNmF",
  vault: "5spmkMFD9EiX9LFd7dAXzXDAjm6UDVea6wUEsNthJv5o",
  clpMint: "JCboCWJVi1qq3P1vhSwqc1TEhq1udxf3AnxT2UJ27iTz",
  mintAuthority: "xAsm3yj7Y1XbBi4DKXPA2UHuLX3GyEgWpVBdR7HkPUB",
  usdcMint: "2LW8DzDa2KVxDxqUqZLALc6htcVSDwGK1JGz4VaaTn1Y",
  tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  chainlinkStore: "HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny",
} as const;

export const SOLANA_MARKET_ORDER: readonly MarketId[] = ["SOL-USD", "BTC-USD", "ETH-USD"];

export const SOLANA_MARKETS: Record<MarketId, { market: string; oracle: string }> = {
  "SOL-USD": { market: "2TJGAiKhFDB8L59PYjy5vQ11Gh4T2CozTGNcU8RBK3dJ", oracle: "99B2bTijsU6f1GCT73HmdR7HCFFjGMBcPZY6jZ96ynrR" },
  "BTC-USD": { market: "H2T9yj2qZjcgEutpjZRjmCtzSBPJ32oNo2JiWBSMrmfs", oracle: "6PxBx93S8x3tno1TsFZwT5VqP8drrRCbCXygEXYNkFJe" },
  "ETH-USD": { market: "CXrmiKWoB6WpbHtUAedUdi17drAJax7sxSDavwkBzZW3", oracle: "669U43LNHx7LsVj95uYksnhXUfWKDsdzVqev3V4Jpw3P" },
};

// Minimum lamport execution fee paid to the keeper per request (Config.min_execution_fee_lamports).
export const MIN_EXECUTION_FEE_LAMPORTS = 50_000n;
