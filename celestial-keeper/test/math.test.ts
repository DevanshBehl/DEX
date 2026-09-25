/**
 * docs/perp-math.md Ex 1–9, asserted exactly — the same vectors as the EVM `test/PerpMath.t.sol`
 * and the Solana `math.rs` tests — plus liquidation-boundary properties.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkLiquidatable,
  entryPrice,
  executionPrice,
  fundingIndexDelta,
  fundingOwed,
  fundingRatePerHour,
  isLiquidatable,
  liquidationPrice,
  maintenanceMargin,
  pnl,
  positionFee,
  remainingMargin,
  tokensFor,
} from "../src/math.ts";

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

describe("perp-math.md vectors", () => {
  it("Ex 1: open an ETH long", () => {
    const exec = executionPrice(ETH_3000, true, true, SPREAD);
    assert.equal(exec, 300_300_000_000n);
    assert.equal(tokensFor(S1, exec, true), TOKENS1);
    assert.equal(positionFee(S1, FEE), 6_000_000n);
    assert.equal(S1 / 10n - positionFee(S1, FEE), C1);
    assert.equal(entryPrice(S1, TOKENS1), 300_300_000_000n);
  });

  it("Ex 2: close Ex 1 at +10%", () => {
    const exec = executionPrice(330_000_000_000n, true, false, SPREAD);
    assert.equal(exec, 329_670_000_000n);
    const p = pnl(true, S1, TOKENS1, exec);
    assert.equal(p, 978_021_978n);
    assert.equal(C1 + p - 6_000_000n, 1_966_021_978n);
  });

  it("Ex 3: BTC short closed at a loss", () => {
    const open = executionPrice(6_000_000_000_000n, false, true, SPREAD);
    assert.equal(open, 5_994_000_000_000n);
    assert.equal(tokensFor(S3, open, false), TOKENS3);
    assert.equal(positionFee(S3, FEE), 1_500_000n);
    const close = executionPrice(6_300_000_000_000n, false, false, SPREAD);
    assert.equal(close, 6_306_300_000_000n);
    const p = pnl(false, S3, TOKENS3, close);
    assert.equal(p, -130_255_256n);
    assert.equal(500_000_000n - 1_500_000n + p - 1_500_000n, 366_744_744n);
  });

  it("Ex 4: BTC short closed at a profit", () => {
    const close = executionPrice(5_700_000_000_000n, false, false, SPREAD);
    assert.equal(close, 5_705_700_000_000n);
    const p = pnl(false, S3, TOKENS3, close);
    assert.equal(p, 120_245_245n);
    assert.equal(500_000_000n - 1_500_000n + p - 1_500_000n, 617_245_245n);
  });

  it("Ex 5 / 5b: funding accrual and cap", () => {
    const rate = fundingRatePerHour(2_000_000_000_000n, 1_000_000_000_000n, 5_000_000_000_000n, 300_000_000_000_000n, 100_000_000_000_000n);
    assert.equal(rate, 60_000_000_000_000n);
    const delta = fundingIndexDelta(rate, 28_800n);
    assert.equal(delta, 480_000_000_000_000n);
    assert.equal(fundingOwed(S1, delta, 0n), 4_800_000n);
    assert.equal(
      fundingRatePerHour(3_000_000_000_000n, 0n, 5_000_000_000_000n, 300_000_000_000_000n, 100_000_000_000_000n),
      100_000_000_000_000n,
    );
    assert.equal(fundingRatePerHour(1n, 0n, 0n, 1n, 1n), 0n);
    assert.equal(fundingOwed(10n, 5n, 5n), 0n);
  });

  it("Ex 6: liquidation price of Ex 1", () => {
    assert.equal(maintenanceMargin(S1, MM), 250_000_000n);
    assert.equal(liquidationPrice(true, S1, TOKENS1, C1, 0n, positionFee(S1, FEE), MM), LIQ1);
  });

  it("Ex 7: the liquidation boundary", () => {
    const fee = positionFee(S1, FEE);
    const below = pnl(true, S1, TOKENS1, LIQ1 - 1n);
    assert.equal(below, -738_000_001n);
    assert.equal(remainingMargin(C1, below, 0n, fee), 249_999_999n);
    assert.equal(isLiquidatable(C1, below, 0n, fee, S1, MM), true);
    const at = pnl(true, S1, TOKENS1, LIQ1);
    assert.equal(at, -738_000_000n);
    assert.equal(remainingMargin(C1, at, 0n, fee), 250_000_000n);
    assert.equal(isLiquidatable(C1, at, 0n, fee, S1, MM), false);
    assert.equal(isLiquidatable(C1, pnl(true, S1, TOKENS1, LIQ1 + 1n), 0n, fee, S1, MM), false);

    const pos = { isLong: true, size: S1, collateral: C1, tokens: TOKENS1, entryFundingIndex: 0n };
    const params = { positionFeeBps: FEE, maintenanceMarginBps: MM };
    assert.equal(checkLiquidatable(pos, LIQ1, 0n, params), false);
    assert.equal(checkLiquidatable(pos, LIQ1 - 1n, 0n, params), true);
  });

  it("Ex 8: a max-leverage open is not liquidatable", () => {
    const size = 19_762_845_840n;
    const coll = 1_000_000_000n - positionFee(size, FEE);
    assert.equal(coll, 988_142_292n);
    const tokens = tokensFor(size, executionPrice(ETH_3000, true, true, SPREAD), true);
    const p = pnl(true, size, tokens, ETH_3000);
    assert.equal(p, -19_743_103n);
    assert.equal(remainingMargin(coll, p, 0n, positionFee(size, FEE)), 956_541_481n);
    assert.equal(maintenanceMargin(size, MM), 494_071_146n);
    assert.equal(isLiquidatable(coll, p, 0n, positionFee(size, FEE), size, MM), false);
  });

  it("Ex 9: profit cap", () => {
    const exec = executionPrice(600_000_000_000n, true, false, SPREAD);
    assert.equal(exec, 599_400_000_000n);
    const p = pnl(true, S1, TOKENS1, exec);
    assert.equal(p, 9_960_039_960n);
    const reserved = 9n * C1;
    assert.equal(p < reserved ? p : reserved, 8_946_000_000n);
  });
});

describe("liquidation boundary properties", () => {
  // Deterministic LCG sweep (no extra dependency).
  let seed = 42n;
  const rand = (mod: bigint) => {
    seed = (seed * 6364136223846793005n + 1442695040888963407n) % 2n ** 64n;
    return (seed >> 11n) % mod;
  };

  it("at the liquidation price a position is safe; 1 unit beyond it is liquidatable (long and short, with funding)", () => {
    const params = { positionFeeBps: FEE, maintenanceMarginBps: MM };
    for (let i = 0; i < 3_000; i++) {
      const collateral = rand(1_000_000_000_000n) + 10_000_000n;
      const lev = rand(19n) + 2n;
      const price = rand(10_000_000_000_000n) + 100_000_000n;
      const isLong = rand(2n) === 0n;
      const size = collateral * lev;
      const tokens = tokensFor(size, price, isLong);
      const entryIdx = rand(1_000_000_000_000_000n);
      const cum = entryIdx + rand(1_000_000_000_000n);
      const funding = fundingOwed(size, cum, entryIdx);
      const liq = liquidationPrice(isLong, size, tokens, collateral, funding, positionFee(size, FEE), MM);
      if (liq === 0n) continue;
      const pos = { isLong, size, collateral, tokens, entryFundingIndex: entryIdx };
      assert.equal(checkLiquidatable(pos, liq, cum, params), false, `safe at liq (${isLong ? "long" : "short"})`);
      assert.equal(checkLiquidatable(pos, isLong ? liq - 1n : liq + 1n, cum, params), true, "liquidatable 1 unit beyond");
    }
  });

  it("the spread always goes against the trader", () => {
    for (let i = 0; i < 2_000; i++) {
      const price = rand(100_000_000_000_000n) + 1n;
      const s = rand(101n);
      assert.ok(executionPrice(price, true, true, s) >= price);
      assert.ok(executionPrice(price, true, false, s) <= price);
      assert.ok(executionPrice(price, false, true, s) <= price);
      assert.ok(executionPrice(price, false, false, s) >= price);
    }
  });
});
