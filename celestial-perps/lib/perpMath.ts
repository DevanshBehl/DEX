// Protocol maths in bigint — the same formulas and rounding as PerpMath.sol / math.rs /
// celestial-keeper/src/math.ts (docs/perp-math.md). Every rounding goes against the trader, so
// the numbers shown in the UI are the numbers the chain will produce.
//
// Units: USD 1e6 · price 1e8 · tokens = size·1e20/price · funding index 1e18 fraction of size.

export const BPS = 10_000n;
export const TOKEN_PRECISION = 10n ** 20n;
export const FUNDING_PRECISION = 10n ** 18n;
export const PRICE_DECIMALS = 8;
export const USD_DECIMALS = 6;

export function mulDivFloor(a: bigint, b: bigint, c: bigint): bigint {
  if (c === 0n) throw new RangeError("division by zero");
  return (a * b) / c;
}

export function mulDivCeil(a: bigint, b: bigint, c: bigint): bigint {
  if (c === 0n) throw new RangeError("division by zero");
  const p = a * b;
  return p / c + (p % c === 0n ? 0n : 1n);
}

/** Oracle price adjusted by the execution spread, against the trader. */
export function executionPrice(price: bigint, isLong: boolean, isIncrease: boolean, spreadBps: bigint): bigint {
  return isLong === isIncrease ? mulDivCeil(price, BPS + spreadBps, BPS) : mulDivFloor(price, BPS - spreadBps, BPS);
}

/** Base-asset tokens for `size` at `price`: longs round down, shorts round up. */
export function tokensFor(size: bigint, price: bigint, isLong: boolean): bigint {
  return isLong ? mulDivFloor(size, TOKEN_PRECISION, price) : mulDivCeil(size, TOKEN_PRECISION, price);
}

export function entryPrice(size: bigint, tokens: bigint): bigint {
  return tokens === 0n ? 0n : mulDivFloor(size, TOKEN_PRECISION, tokens);
}

/** long: floor(tokens·P/1e20) − S; short: S − ceil(tokens·P/1e20). */
export function pnl(isLong: boolean, size: bigint, tokens: bigint, price: bigint): bigint {
  return isLong ? mulDivFloor(tokens, price, TOKEN_PRECISION) - size : size - mulDivCeil(tokens, price, TOKEN_PRECISION);
}

export function positionFee(sizeDelta: bigint, feeBps: bigint): bigint {
  return mulDivCeil(sizeDelta, feeBps, BPS);
}

export function fundingRatePerHour(longOi: bigint, shortOi: bigint, aum: bigint, factor: bigint, maxRate: bigint): bigint {
  if (aum === 0n) return 0n;
  const skew = longOi > shortOi ? longOi - shortOi : shortOi - longOi;
  const rate = mulDivFloor(factor, skew, aum);
  return rate < maxRate ? rate : maxRate;
}

export function fundingIndexDelta(ratePerHour: bigint, elapsedSecs: bigint): bigint {
  return mulDivFloor(ratePerHour, elapsedSecs, 3_600n);
}

export function fundingOwed(size: bigint, cumulative: bigint, entry: bigint): bigint {
  return cumulative <= entry ? 0n : mulDivCeil(size, cumulative - entry, FUNDING_PRECISION);
}

export function maintenanceMargin(size: bigint, mmBps: bigint): bigint {
  return mulDivCeil(size, mmBps, BPS);
}

/** R = C + PnL − F − closeFee */
export function remainingMargin(collateral: bigint, pnl_: bigint, funding: bigint, closeFee: bigint): bigint {
  return collateral + pnl_ - funding - closeFee;
}

export function isLiquidatable(collateral: bigint, pnl_: bigint, funding: bigint, closeFee: bigint, size: bigint, mmBps: bigint): boolean {
  return remainingMargin(collateral, pnl_, funding, closeFee) < maintenanceMargin(size, mmBps);
}

/** need = mm + F + closeFee − C; long ceil((S+need)·1e20/tokens), short floor((S−need)·1e20/tokens); 0 if ≤ 0. */
export function liquidationPrice(
  isLong: boolean,
  size: bigint,
  tokens: bigint,
  collateral: bigint,
  funding: bigint,
  closeFee: bigint,
  mmBps: bigint,
): bigint {
  if (size === 0n || tokens === 0n) return 0n;
  const need = maintenanceMargin(size, mmBps) + funding + closeFee - collateral;
  const threshold = isLong ? size + need : size - need;
  if (threshold <= 0n) return 0n;
  return isLong ? mulDivCeil(threshold, TOKEN_PRECISION, tokens) : mulDivFloor(threshold, TOKEN_PRECISION, tokens);
}

// ── CLP (LP token) ── `scale` is 10^(clpDecimals − 6): 1e12 on EVM (18-dec CLP), 1 on Solana.

export function clpToMint(amountAfterFee: bigint, aum: bigint, supply: bigint, scale: bigint): bigint {
  return supply === 0n ? amountAfterFee * scale : mulDivFloor(amountAfterFee, supply, aum);
}

export function usdcForClp(clp: bigint, aum: bigint, supply: bigint): bigint {
  return supply === 0n ? 0n : mulDivFloor(clp, aum, supply);
}

export function lpMintFee(amount: bigint, lpMintFeeBps: bigint): bigint {
  return mulDivCeil(amount, lpMintFeeBps, BPS);
}

// ── Order preview (what the trade form shows before sending) ──

export type RiskParams = {
  positionFeeBps: bigint;
  maintenanceMarginBps: bigint;
  executionSpreadBps: bigint;
  maxLeverage: bigint;
  minCollateral: bigint;
};

export type OpenPreview = {
  size: bigint;
  fee: bigint;
  collateralAfterFee: bigint;
  executionPrice: bigint;
  tokens: bigint;
  entryPrice: bigint;
  liquidationPrice: bigint;
  /** reason the engine would cancel this order, if any (mirrors _validatePosition) */
  problem?: "CollateralTooLow" | "LeverageTooLow" | "LeverageTooHigh" | "PositionLiquidatable";
};

/** Preview a brand-new position (no existing one on this side) opened at `oraclePrice`. */
export function previewOpen(isLong: boolean, collateral: bigint, size: bigint, oraclePrice: bigint, p: RiskParams): OpenPreview {
  const fee = positionFee(size, p.positionFeeBps);
  const collateralAfterFee = collateral > fee ? collateral - fee : 0n;
  const exec = executionPrice(oraclePrice, isLong, true, p.executionSpreadBps);
  const tokens = exec > 0n ? tokensFor(size, exec, isLong) : 0n;
  const closeFee = fee;
  const out: OpenPreview = {
    size,
    fee,
    collateralAfterFee,
    executionPrice: exec,
    tokens,
    entryPrice: entryPrice(size, tokens),
    liquidationPrice: liquidationPrice(isLong, size, tokens, collateralAfterFee, 0n, closeFee, p.maintenanceMarginBps),
  };
  if (collateralAfterFee < p.minCollateral) out.problem = "CollateralTooLow";
  else if (size < collateralAfterFee) out.problem = "LeverageTooLow";
  else if (size > collateralAfterFee * p.maxLeverage) out.problem = "LeverageTooHigh";
  else if (isLiquidatable(collateralAfterFee, pnl(isLong, size, tokens, oraclePrice), 0n, closeFee, size, p.maintenanceMarginBps)) {
    out.problem = "PositionLiquidatable";
  }
  return out;
}

/** Largest size with size ≤ maxLeverage × (collateral − fee(size)) — Ex 8's "max leverage" size. */
export function maxSizeFor(collateral: bigint, p: RiskParams): bigint {
  // size ≤ L·(C − ceil(size·f/BPS)); start from the closed-form bound and step down.
  let size = mulDivFloor(collateral * p.maxLeverage, BPS, BPS + p.maxLeverage * p.positionFeeBps);
  while (size > 0n && size > (collateral - positionFee(size, p.positionFeeBps)) * p.maxLeverage) size--;
  return size;
}

// ── display helpers (bigint → number only at the edge) ──

export const toUsd = (v: bigint) => Number(v) / 1e6;
export const toPrice = (v: bigint) => Number(v) / 1e8;

/** Parse a decimal string ("12.5") into base units with `decimals` places (no float rounding). */
export function parseUnits(value: string, decimals: number): bigint | null {
  const s = value.trim();
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return null;
  const [int, frac = ""] = s.split(".");
  if (frac.length > decimals) return null;
  return BigInt(int || "0") * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
}

export function formatUnits(value: bigint, decimals: number, maxFrac = decimals): string {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const int = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  return `${neg ? "-" : ""}${int.toString()}${frac ? "." + frac : ""}`;
}
