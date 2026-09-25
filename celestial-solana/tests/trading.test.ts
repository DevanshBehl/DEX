/**
 * Open / increase / decrease / close, liquidation and funding. Mirrors the EVM
 * `test/PerpEngine.t.sol` scenarios and asserts the docs/perp-math.md vectors on-chain.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EXEC_FEE, USD, big, positionPda, requestPda, scenario, userStatePda, variant } from "./harness.ts";

const C = 1_000n * USD; // Ex 1 collateral
const S = 10_000n * USD; // Ex 1 size
const TOKENS_EX1 = 3_330_003_330_003_330_003n;
const TX_FEE = 5_000n; // LiteSVM lamports per signature
const E20 = 10n ** 20n;

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

describe("open", () => {
  it(
    "opens a long with the Ex 1 numbers",
    scenario((ctx) => {
      const alice = ctx.createUser();
      const keeperBefore = ctx.lamports(ctx.keeper.publicKey);
      const nonce = ctx.nextNonce(alice.publicKey);
      ctx.send([ctx.requestIncreaseIx(alice, "ETH-USD", true, C, S, 3_100n * 100_000_000n)], [alice]);
      assert.equal(big(ctx.getPool().total_escrow), C);
      const req = ctx.getRequest(alice.publicKey, nonce);
      assert.equal(variant(req.kind), "Increase");

      const meta = ctx.send([ctx.executeIx(alice.publicKey, nonce, "ETH-USD", true)], [ctx.keeper]);
      const p = ctx.getPosition(alice.publicKey, "ETH-USD", true);
      assert.equal(big(p.size), S);
      assert.equal(big(p.collateral), 994_000_000n);
      assert.equal(big(p.tokens), TOKENS_EX1);
      assert.equal(big(p.reserved), 9n * 994_000_000n);

      const ev = ctx.event(meta, "PositionIncreased");
      assert.equal(big(ev.execution_price), 300_300_000_000n);
      assert.equal(big(ev.entry_price), 300_300_000_000n);
      assert.equal(big(ev.fee), 6_000_000n);
      const fees = ctx.event(meta, "FeesAdded");
      assert.equal(big(fees.to_protocol), 600_000n);
      assert.equal(big(fees.to_pool), 5_400_000n);

      const pool = ctx.getPool();
      assert.equal(big(pool.total_escrow), 0n);
      assert.equal(big(pool.total_collateral), 994_000_000n);
      assert.equal(big(pool.reserved_amount), 9n * 994_000_000n);
      assert.equal(ctx.lamports(ctx.keeper.publicKey) - keeperBefore, EXEC_FEE - TX_FEE);
      assert.equal(ctx.exists(requestPda(alice.publicKey, nonce)), false, "request account closed");
      assert.equal(ctx.liquidationPrice(alice.publicKey, "ETH-USD", true), 278_137_860_001n); // Ex 6
    }),
  );

  it(
    "opens a short with the Ex 3 tokens",
    scenario((ctx) => {
      const bob = ctx.createUser();
      ctx.openPosition(bob, "BTC-USD", false, 500n * USD, 2_500n * USD);
      const p = ctx.getPosition(bob.publicKey, "BTC-USD", false);
      assert.equal(big(p.tokens), 41_708_375_041_708_376n);
      assert.equal(big(p.collateral), 500n * USD - 1_500_000n);
      const info = ctx.marketInfo("BTC-USD");
      assert.equal(big(info.short_size), 2_500n * USD);
      assert.equal(big(info.long_size), 0n);
    }),
  );

  it(
    "increase averages the entry price",
    scenario((ctx) => {
      const alice = ctx.createUser();
      ctx.openPosition(alice, "ETH-USD", true, C, S);
      ctx.setPrice("ETH-USD", 330_000_000_000n);
      ctx.openPosition(alice, "ETH-USD", true, C, S);
      const p = ctx.getPosition(alice.publicKey, "ETH-USD", true);
      const exec2 = ceilDiv(330_000_000_000n * 10_010n, 10_000n);
      const t2 = (S * E20) / exec2;
      assert.equal(big(p.size), 2n * S);
      assert.equal(big(p.tokens), TOKENS_EX1 + t2);
      const entry = (big(p.size) * E20) / big(p.tokens);
      assert.ok(entry > 300_300_000_000n && entry < 330_330_000_000n);
    }),
  );

  it(
    "max-leverage open (Ex 8) is not liquidatable; one unit more is cancelled",
    scenario((ctx) => {
      const alice = ctx.createUser();
      ctx.openPosition(alice, "ETH-USD", true, C, 19_762_845_840n);
      const p = ctx.getPosition(alice.publicKey, "ETH-USD", true);
      assert.equal(big(p.size), 19_762_845_840n);
      assert.equal(big(p.collateral), 988_142_292n);
      assert.equal(ctx.expectError([ctx.liquidateIx(alice.publicKey, "ETH-USD", true)], [ctx.keeper]), "NotLiquidatable");

      const bob = ctx.createUser();
      const meta = ctx.openPosition(bob, "ETH-USD", true, C, 19_762_845_841n);
      assert.equal(variant(ctx.event(meta, "RequestCancelled").reason), "LeverageTooHigh");
    }),
  );
});

describe("decrease / close", () => {
  it(
    "full close in profit pays the Ex 2 amount and refunds all rent",
    scenario((ctx) => {
      const alice = ctx.createUser();
      const start = ctx.tokenBalance(ctx.usdcAta(alice.publicKey));
      const lamportsStart = ctx.lamports(alice.publicKey);
      ctx.openPosition(alice, "ETH-USD", true, C, S);
      const position = positionPda(alice.publicKey, ctx.markets["ETH-USD"].market, true);
      assert.ok(ctx.exists(position));

      ctx.setPrice("ETH-USD", 330_000_000_000n);
      const meta = ctx.closePosition(alice, "ETH-USD", true, 0n, S);
      assert.equal(ctx.tokenBalance(ctx.usdcAta(alice.publicKey)), start - C + 1_966_021_978n);
      assert.equal(big(ctx.event(meta, "PositionDecreased").realised_pnl), 978_021_978n);
      assert.ok(ctx.event(meta, "PositionClosed"));
      assert.equal(ctx.exists(position), false, "position account closed");

      // Only the two execution fees, two tx fees and the (kept) UserState rent are spent.
      const userStateRent = ctx.lamports(userStatePda(alice.publicKey));
      assert.equal(ctx.lamports(alice.publicKey), lamportsStart - userStateRent - 2n * EXEC_FEE - 2n * TX_FEE);

      const pool = ctx.getPool();
      assert.equal(big(pool.reserved_amount), 0n);
      assert.equal(big(pool.total_collateral), 0n);
    }),
  );

  it(
    "full close of a short in loss pays the Ex 3 amount",
    scenario((ctx) => {
      const bob = ctx.createUser();
      const start = ctx.tokenBalance(ctx.usdcAta(bob.publicKey));
      ctx.openPosition(bob, "BTC-USD", false, 500n * USD, 2_500n * USD);
      ctx.setPrice("BTC-USD", 6_300_000_000_000n);
      const meta = ctx.closePosition(bob, "BTC-USD", false, 0n, 2_500n * USD);
      assert.equal(ctx.tokenBalance(ctx.usdcAta(bob.publicKey)), start - 500n * USD + 366_744_744n);
      assert.equal(big(ctx.event(meta, "PositionDecreased").realised_pnl), -130_255_256n);
    }),
  );

  it(
    "full close of a short in profit pays the Ex 4 amount",
    scenario((ctx) => {
      const bob = ctx.createUser();
      const start = ctx.tokenBalance(ctx.usdcAta(bob.publicKey));
      ctx.openPosition(bob, "BTC-USD", false, 500n * USD, 2_500n * USD);
      ctx.setPrice("BTC-USD", 5_700_000_000_000n);
      ctx.closePosition(bob, "BTC-USD", false, 0n, 2_500n * USD);
      assert.equal(ctx.tokenBalance(ctx.usdcAta(bob.publicKey)), start - 500n * USD + 617_245_245n);
    }),
  );

  it(
    "profit is capped at the reserve (Ex 9)",
    scenario((ctx) => {
      const alice = ctx.createUser();
      const start = ctx.tokenBalance(ctx.usdcAta(alice.publicKey));
      ctx.openPosition(alice, "ETH-USD", true, C, S);
      ctx.setPrice("ETH-USD", 600_000_000_000n);
      const meta = ctx.closePosition(alice, "ETH-USD", true, 0n, S);
      assert.equal(big(ctx.event(meta, "PositionDecreased").execution_price), 599_400_000_000n);
      assert.equal(big(ctx.event(meta, "PositionDecreased").realised_pnl), 8_946_000_000n);
      assert.equal(ctx.tokenBalance(ctx.usdcAta(alice.publicKey)), start - C + 994_000_000n - 6_000_000n + 8_946_000_000n);
    }),
  );

  it(
    "partial decrease realises proportional PnL and withdraws collateral",
    scenario((ctx) => {
      const alice = ctx.createUser();
      const start = ctx.tokenBalance(ctx.usdcAta(alice.publicKey));
      ctx.openPosition(alice, "ETH-USD", true, C, S);
      ctx.closePosition(alice, "ETH-USD", true, 100n * USD, S / 2n);

      const p = ctx.getPosition(alice.publicKey, "ETH-USD", true);
      assert.equal(big(p.size), S / 2n);
      const exec = (300_000_000_000n * 9_990n) / 10_000n;
      const pnlHalf = ((TOKENS_EX1 / 2n) * exec) / E20 - S / 2n;
      assert.ok(pnlHalf < 0n);
      assert.equal(big(p.collateral), 994_000_000n + pnlHalf - 3_000_000n - 100n * USD);
      assert.equal(big(p.tokens), TOKENS_EX1 - TOKENS_EX1 / 2n);
      assert.equal(ctx.tokenBalance(ctx.usdcAta(alice.publicKey)), start - C + 100n * USD);
      assert.ok(big(p.reserved) <= 9n * big(p.collateral));
      assert.equal(big(ctx.getPool().reserved_amount), big(p.reserved));
    }),
  );

  it(
    "partial decrease that breaches max leverage is cancelled",
    scenario((ctx) => {
      const alice = ctx.createUser();
      ctx.openPosition(alice, "ETH-USD", true, C, S);
      const meta = ctx.closePosition(alice, "ETH-USD", true, 900n * USD, S / 2n);
      assert.equal(variant(ctx.event(meta, "RequestCancelled").reason), "LeverageTooHigh");
      assert.equal(big(ctx.getPosition(alice.publicKey, "ETH-USD", true).size), S);
    }),
  );

  it(
    "decrease of a missing position, an oversized decrease and an underwater close are cancelled",
    scenario((ctx) => {
      const alice = ctx.createUser();
      let meta = ctx.closePosition(alice, "ETH-USD", true, 0n, S);
      assert.equal(variant(ctx.event(meta, "RequestCancelled").reason), "PositionNotFound");

      ctx.openPosition(alice, "ETH-USD", true, C, S);
      meta = ctx.closePosition(alice, "ETH-USD", true, 0n, S + 1n);
      assert.equal(variant(ctx.event(meta, "RequestCancelled").reason), "SizeTooLarge");

      ctx.setPrice("ETH-USD", 250_000_000_000n); // loss ≈ $1,675 > collateral
      meta = ctx.closePosition(alice, "ETH-USD", true, 0n, S, 1n);
      assert.equal(variant(ctx.event(meta, "RequestCancelled").reason), "PositionLiquidatable");
      assert.equal(big(ctx.getPosition(alice.publicKey, "ETH-USD", true).size), S);
    }),
  );
});

describe("liquidation", () => {
  it(
    "liquidates exactly below the Ex 7 boundary; keeper fee 0.5%, rest to the pool, rent to the trader",
    scenario((ctx) => {
      const alice = ctx.createUser();
      ctx.openPosition(alice, "ETH-USD", true, C, S);
      const position = positionPda(alice.publicKey, ctx.markets["ETH-USD"].market, true);

      ctx.setPrice("ETH-USD", 278_137_860_001n);
      assert.equal(ctx.expectError([ctx.liquidateIx(alice.publicKey, "ETH-USD", true)], [ctx.keeper]), "NotLiquidatable");

      ctx.setPrice("ETH-USD", 278_137_860_000n);
      const keeperUsdc = ctx.tokenBalance(ctx.usdcAta(ctx.keeper.publicKey));
      const poolBefore = big(ctx.getPool().pool_amount);
      const rent = ctx.lamports(position);
      const ownerLamports = ctx.lamports(alice.publicKey);
      const meta = ctx.liquidate(alice.publicKey, "ETH-USD", true);

      const keeperFee = (S * 50n) / 10_000n;
      assert.equal(ctx.tokenBalance(ctx.usdcAta(ctx.keeper.publicKey)) - keeperUsdc, keeperFee);
      assert.equal(big(ctx.getPool().pool_amount) - poolBefore, 994_000_000n - keeperFee);
      assert.equal(big(ctx.event(meta, "PositionLiquidated").keeper_fee), keeperFee);
      assert.equal(ctx.exists(position), false);
      assert.equal(ctx.lamports(alice.publicKey) - ownerLamports, rent);
      const pool = ctx.getPool();
      assert.equal(big(pool.reserved_amount), 0n);
      assert.equal(big(pool.total_collateral), 0n);
      const m = ctx.getMarket("ETH-USD");
      assert.equal(big(m.long_size), 0n);
      assert.equal(big(m.long_tokens), 0n);
    }),
  );

  it(
    "keeper fee is capped at the collateral",
    scenario((ctx) => {
      // The cap only binds when 2% of size exceeds collateral, i.e. above 50x.
      ctx.setParams({ max_leverage: 60n, maintenance_margin_bps: 150n, liquidation_fee_bps: 200n });
      const alice = ctx.createUser();
      ctx.openPosition(alice, "ETH-USD", true, 100n * USD, 5_700n * USD);
      const coll = big(ctx.getPosition(alice.publicKey, "ETH-USD", true).collateral);
      assert.equal(coll, 96_580_000n);
      ctx.setPrice("ETH-USD", 100_000_000n);
      const before = ctx.tokenBalance(ctx.usdcAta(ctx.keeper.publicKey));
      ctx.liquidate(alice.publicKey, "ETH-USD", true);
      assert.equal(ctx.tokenBalance(ctx.usdcAta(ctx.keeper.publicKey)) - before, coll);
    }),
  );

  it(
    "liquidating a missing position fails",
    scenario((ctx) => {
      const alice = ctx.createUser();
      const code = ctx.expectError([ctx.liquidateIx(alice.publicKey, "ETH-USD", true)], [ctx.keeper]);
      assert.equal(code, "AccountNotInitialized");
    }),
  );
});

describe("funding", () => {
  it(
    "accrues on the heavier side only and settles into the pool on the next update",
    scenario((ctx) => {
      const alice = ctx.createUser();
      const bob = ctx.createUser();
      ctx.openPosition(alice, "ETH-USD", true, 20_000n * USD, 200_000n * USD);
      ctx.openPosition(bob, "ETH-USD", false, 10_000n * USD, 50_000n * USD);

      ctx.warp(8 * 3_600);
      const aum = ctx.aum();
      const meta = ctx.updateFunding("ETH-USD");
      const ev = ctx.event(meta, "FundingUpdated");
      const expectedRate = [100_000_000_000_000n, (300_000_000_000_000n * 150_000n * USD) / aum].reduce((a, b) => (a < b ? a : b));
      assert.equal(big(ev.rate_long_per_hour), expectedRate);
      assert.equal(big(ev.rate_short_per_hour), 0n);

      const info = ctx.marketInfo("ETH-USD");
      const cumLong = big(info.cum_funding_long);
      assert.equal(cumLong, (expectedRate * 28_800n) / 3_600n);
      assert.equal(big(info.cum_funding_short), 0n);
      assert.ok(big(info.funding_rate_long_per_hour) > 0n);
      assert.equal(big(info.funding_rate_short_per_hour), 0n);

      const owed = ceilDiv(200_000n * USD * cumLong, 10n ** 18n);
      assert.ok(owed > 0n);

      // Settled into the pool on the next update (collateral top-up, no size change → no fee).
      const poolBefore = big(ctx.getPool().pool_amount);
      const inc = ctx.openPosition(alice, "ETH-USD", true, 100n * USD, 0n);
      assert.equal(big(ctx.event(inc, "PositionIncreased").funding_paid), owed);
      assert.equal(big(ctx.getPool().pool_amount) - poolBefore, owed);
      const p = ctx.getPosition(alice.publicKey, "ETH-USD", true);
      assert.equal(big(p.entry_funding_index), cumLong);
      assert.equal(big(p.collateral), 20_000n * USD - 120_000_000n + 100n * USD - owed);
      // The short side owes nothing.
      const bobClose = ctx.closePosition(bob, "ETH-USD", false, 0n, 50_000n * USD);
      assert.equal(big(ctx.event(bobClose, "PositionDecreased").funding_paid), 0n);
    }),
  );

  it(
    "does not accrue when the market is balanced",
    scenario((ctx) => {
      const alice = ctx.createUser();
      const bob = ctx.createUser();
      ctx.openPosition(alice, "ETH-USD", true, C, S);
      ctx.openPosition(bob, "ETH-USD", false, C, S);
      ctx.warp(86_400);
      ctx.updateFunding("ETH-USD");
      const m = ctx.getMarket("ETH-USD");
      assert.equal(big(m.cum_funding_long), 0n);
      assert.equal(big(m.cum_funding_short), 0n);
    }),
  );

  it(
    "update_funding needs the market listed and writable",
    scenario((ctx) => {
      const code = ctx.expectError(
        [
          ctx.ix(
            "update_funding",
            { config: ctx.common().config, pool: ctx.common().pool },
            { market: ctx.keeper.publicKey },
            ctx.marketAccounts(),
          ),
        ],
        [ctx.keeper],
      );
      assert.equal(code, "InvalidMarketAccounts");
      const ro = ctx.expectError(
        [
          ctx.ix(
            "update_funding",
            { config: ctx.common().config, pool: ctx.common().pool },
            { market: ctx.markets["ETH-USD"].market },
            ctx.marketAccounts({ writable: [] }),
          ),
        ],
        [ctx.keeper],
      );
      assert.equal(ro, "MarketNotWritable");
    }),
  );
});
