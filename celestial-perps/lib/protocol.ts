// UI defaults. Protocol parameters (max leverage, fees, margins, execution fee…) are read from
// the chain at runtime (lib/chains) — docs/protocol-spec.md is the source of truth.

export const MAX_LEVERAGE = 20; // fallback before params load
export const DEFAULT_LEVERAGE = 5;
export const LEV_PRESETS = [2, 5, 10, 15, 20];
export const OPEN_FEE_BPS = 6; // fallback before params load

/** Worst-price tolerance on market orders (acceptablePrice = execution price ± slippage). */
export const SLIPPAGE_PRESETS_BPS = [30, 50, 100];
export const DEFAULT_SLIPPAGE_BPS = 50;
