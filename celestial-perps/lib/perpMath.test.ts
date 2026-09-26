// docs/perp-math.md Ex 1–10 (both CLP columns), asserted exactly — same vectors as the EVM
// PerpMath.t.sol, Solana math.rs and the keeper's math tests.
//   npm run test:math
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clpToMint,
  entryPrice,
  executionPrice,
  formatUnits,
  fundingIndexDelta,
  fundingOwed,
  fundingRatePerHour,
  isLiquidatable,
  liquidationPrice,
  lpMintFee,
  maintenanceMargin,
  maxSizeFor,
  parseUnits,
  pnl,
  positionFee,
  previewOpen,
  remainingMargin,
  tokensFor,
  usdcForClp,
} from "./perpMath";

const SPREAD = 10n;
const FEE = 6n;
const MM = 250n;
const ETH_3000 = 300_000_000_000n;
const S1 = 10_000_000_000n;
const TOKENS1 = 3_330_003_330_003_330_003n;
const C1 = 994_000_000n;
const LIQ1 = 278_137_860_001n;
const S3 = 2_500_000_000n;
const TOKENS3 = 41_708_375_041_708_376n;
const PARAMS = { positionFeeBps: FEE, maintenanceMarginBps: MM, executionSpreadBps: SPREAD, maxLeverage: 20n, minCollateral: 10_000_000n };

describe("perp-math.md vectors", () => {
  it("Ex 1: open an ETH long (and the UI preview matches it)", () => {
    const exec = executionPrice(ETH_3000, true, true, SPREAD);
    assert.equal(exec, 300_300_000_000n);
    assert.equal(tokensFor(S1, exec, true), TOKENS1);
    assert.equal(positionFee(S1, FEE), 6_000_000n);
    assert.equal(entryPrice(S1, TOKENS1), 300_300_000_000n);
    const pv = previewOpen(true, 1_000_000_000n, S1, ETH_3000, PARAMS);
    assert.equal(pv.collateralAfterFee, C1);
    assert.equal(pv.tokens, TOKENS1);
    assert.equal(pv.entryPrice, 300_300_000_000n);
    assert.equal(pv.liquidationPrice, LIQ1); // Ex 6
    assert.equal(pv.problem, undefined);
  });

  it("Ex 2: close Ex 1 at +10%", () => {
    const exec = executionPrice(330_000_000_000n, true, false, SPREAD);
    assert.equal(exec, 329_670_000_000n);
    const p = pnl(true, S1, TOKENS1, exec);
    assert.equal(p, 978_021_978n);
    assert.equal(C1 + p - 6_000_000n, 1_966_021_978n);
  });

  it("Ex 3 / Ex 4: BTC short closed at a loss and at a profit", () => {
    const open = executionPrice(6_000_000_000_000n, false, true, SPREAD);
    assert.equal(open, 5_994_000_000_000n);
    assert.equal(tokensFor(S3, open, false), TOKENS3);
    const loss = pnl(false, S3, TOKENS3, executionPrice(6_300_000_000_000n, false, false, SPREAD));
    assert.equal(loss, -130_255_256n);
    assert.equal(500_000_000n - 1_500_000n + loss - 1_500_000n, 366_744_744n);
    const profit = pnl(false, S3, TOKENS3, executionPrice(5_700_000_000_000n, false, false, SPREAD));
    assert.equal(profit, 120_245_245n);
    assert.equal(500_000_000n - 1_500_000n + profit - 1_500_000n, 617_245_245n);
  });

  it("Ex 5 / 5b: funding", () => {
    const rate = fundingRatePerHour(2_000_000_000_000n, 1_000_000_000_000n, 5_000_000_000_000n, 300_000_000_000_000n, 100_000_000_000_000n);
    assert.equal(rate, 60_000_000_000_000n);
    const delta = fundingIndexDelta(rate, 28_800n);
    assert.equal(delta, 480_000_000_000_000n);
    assert.equal(fundingOwed(S1, delta, 0n), 4_800_000n);
    assert.equal(fundingRatePerHour(3_000_000_000_000n, 0n, 5_000_000_000_000n, 300_000_000_000_000n, 100_000_000_000_000n), 100_000_000_000_000n);
  });

  it("Ex 6 / Ex 7: liquidation price and its exact boundary", () => {
    const fee = positionFee(S1, FEE);
    assert.equal(maintenanceMargin(S1, MM), 250_000_000n);
    assert.equal(liquidationPrice(true, S1, TOKENS1, C1, 0n, fee, MM), LIQ1);
    const below = pnl(true, S1, TOKENS1, LIQ1 - 1n);
    assert.equal(below, -738_000_001n);
    assert.equal(remainingMargin(C1, below, 0n, fee), 249_999_999n);
    assert.equal(isLiquidatable(C1, below, 0n, fee, S1, MM), true);
    assert.equal(isLiquidatable(C1, pnl(true, S1, TOKENS1, LIQ1), 0n, fee, S1, MM), false);
    assert.equal(isLiquidatable(C1, pnl(true, S1, TOKENS1, LIQ1 + 1n), 0n, fee, S1, MM), false);
  });

  it("Ex 8: max-leverage open is not liquidatable, and maxSizeFor finds that size", () => {
    const size = 19_762_845_840n;
    assert.equal(maxSizeFor(1_000_000_000n, PARAMS), size);
    const pv = previewOpen(true, 1_000_000_000n, size, ETH_3000, PARAMS);
    assert.equal(pv.collateralAfterFee, 988_142_292n);
    assert.equal(pnl(true, size, pv.tokens, ETH_3000), -19_743_103n);
    assert.equal(remainingMargin(pv.collateralAfterFee, -19_743_103n, 0n, positionFee(size, FEE)), 956_541_481n);
    assert.equal(maintenanceMargin(size, MM), 494_071_146n);
    assert.equal(pv.problem, undefined);
    assert.equal(previewOpen(true, 1_000_000_000n, size + 1n, ETH_3000, PARAMS).problem, "LeverageTooHigh");
  });

  it("Ex 9: profit cap", () => {
    const exec = executionPrice(600_000_000_000n, true, false, SPREAD);
    assert.equal(exec, 599_400_000_000n);
    const p = pnl(true, S1, TOKENS1, exec);
    assert.equal(p, 9_960_039_960n);
    const reserved = 9n * C1;
    assert.equal(p < reserved ? p : reserved, 8_946_000_000n);
  });

  it("Ex 10: CLP — EVM (18 decimals) and Solana (6 decimals) columns", () => {
    const seed = 5_000_000_000_000n;
    const seedFee = lpMintFee(seed, 10n);
    assert.equal(seedFee, 5_000_000_000n);
    const dep = 1_000_000_000n;
    assert.equal(lpMintFee(dep, 10n), 1_000_000n);
    const aum = 5_100_000_000_000n;

    const evmSeed = clpToMint(seed - seedFee, 0n, 0n, 10n ** 12n);
    assert.equal(evmSeed, 4_995_000_000_000_000_000_000_000n);
    const evmMinted = clpToMint(dep - 1_000_000n, aum, evmSeed, 10n ** 12n);
    assert.equal(evmMinted, 978_432_352_941_176_470_588n);
    assert.equal(usdcForClp(evmMinted, aum + dep, evmSeed + evmMinted), 999_000_195n);

    const solSeed = clpToMint(seed - seedFee, 0n, 0n, 1n);
    assert.equal(solSeed, 4_995_000_000_000n);
    const solMinted = clpToMint(dep - 1_000_000n, aum, solSeed, 1n);
    assert.equal(solMinted, 978_432_352n);
    assert.equal(usdcForClp(solMinted, aum + dep, solSeed + solMinted), 999_000_194n);
  });
});

describe("unit parsing", () => {
  it("parses and formats without float rounding", () => {
    assert.equal(parseUnits("100", 6), 100_000_000n);
    assert.equal(parseUnits("0.000001", 6), 1n);
    assert.equal(parseUnits("12.5", 6), 12_500_000n);
    assert.equal(parseUnits("1.0000001", 6), null);
    assert.equal(parseUnits("abc", 6), null);
    assert.equal(parseUnits("", 6), null);
    assert.equal(formatUnits(1_966_021_978n, 6), "1966.021978");
    assert.equal(formatUnits(-130_255_256n, 6, 2), "-130.25");
    assert.equal(formatUnits(4_995_000_000_000_000_000_000_000n, 18), "4995000");
  });
});
