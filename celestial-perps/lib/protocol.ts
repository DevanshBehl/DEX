// Protocol constants — mirrors docs/protocol-spec.md. Change the spec first.

import type { MarketId } from "@/lib/marketData";

export const MAX_LEVERAGE = 20;
export const DEFAULT_LEVERAGE = 10;
export const LEV_PRESETS = [2, 5, 10, 15, 20];
export const OPEN_FEE_BPS = 6; // 0.06% of size (new engine)

// ── Legacy CelestialVault (Sepolia) — what "Execute" still calls until Phase 6 ──
export const LEGACY_VAULT_ADDRESS = "0x786f4037924772c79F39D49C302dC3D3eDd14b04";
export const LEGACY_VAULT_FEE_BPS = 10; // 0.1% of collateral, taken on open
export const LEGACY_VAULT_MARKETS: MarketId[] = ["ETH-USD", "BTC-USD"];
