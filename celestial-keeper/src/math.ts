/**
 * bigint port of `celestial-contracts/src/libraries/PerpMath.sol` (= Solana `math.rs`).
 * Formulas and rounding rules: docs/perp-math.md. Every rounding goes against the trader, so an
 * off-chain "liquidatable" verdict matches the on-chain one exactly (asserted in test/math.test.ts).
 *
 * Units: USD 1e6 · price 1e8 · tokens = size·1e20/price · funding index 1e18 fraction of size.
 */

export const BPS = 10_000n;
export const TOKEN_PRECISION = 10n ** 20n;
export const FUNDING_PRECISION = 10n ** 18n;

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

export function isLiquidatable(
  collateral: bigint,
  pnl_: bigint,
  funding: bigint,
  closeFee: bigint,
  size: bigint,
  mmBps: bigint,
): boolean {
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

/** Position fields the liquidation check needs (same on both chains). */
export type PositionState = {
  isLong: boolean;
  size: bigint;
  collateral: bigint;
  tokens: bigint;
  entryFundingIndex: bigint;
};

export type RiskParams = { positionFeeBps: bigint; maintenanceMarginBps: bigint };

/**
 * The on-chain `liquidate` check at `price` with the market's stored funding index for the
 * position's side. On-chain, `liquidate` first accrues funding up to now, which can only raise
 * the owed amount — so an off-chain `true` stays `true` on-chain (it is re-confirmed anyway).
 */
export function checkLiquidatable(p: PositionState, price: bigint, cumFunding: bigint, params: RiskParams): boolean {
  if (p.size === 0n) return false;
  return isLiquidatable(
    p.collateral,
    pnl(p.isLong, p.size, p.tokens, price),
    fundingOwed(p.size, cumFunding, p.entryFundingIndex),
    positionFee(p.size, params.positionFeeBps),
    p.size,
    params.maintenanceMarginBps,
  );
}
