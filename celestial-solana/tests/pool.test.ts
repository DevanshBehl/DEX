/**
 * Liquidity pool (CLP maths, cooldown, reserve), fees, faucet, admin parameters and market
 * listing. Mirrors the EVM `test/LiquidityPool.t.sol` plus the Solana-only faucet.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Keypair, SystemProgram } from "@solana/web3.js";

import {
  Ctx,
  USD,
  big,
  configPda,
  marketPda,
  mockOraclePda,
  scenario,
  setup,
  userStatePda,
} from "./harness.ts";

const C = 1_000n * USD;
const S = 10_000n * USD;
const SEED = 5_000_000n * USD;
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

describe("liquidity", () => {
  it(
    "seed deposit mints 1:1 minus the 0.1% fee (Ex 10, 6-decimal CLP)",
    scenario((ctx, lp) => {
      assert.equal(ctx.tokenBalance(ctx.clpAta(lp.publicKey)), 4_995_000_000_000n);
      assert.equal(ctx.clpSupply(), 4_995_000_000_000n);
      assert.equal(big(ctx.getPool().pool_amount), SEED);
      assert.equal(ctx.aum(), SEED);
      // $1 of AUM per CLP, grossed up by the mint fee kept in the pool.
      assert.equal(ctx.clpPrice(), (SEED * 100_000_000n) / 4_995_000_000_000n);
    }),
  );

  it(
    "later deposits mint pro rata; min_clp and zero amounts are enforced",
    scenario((ctx) => {
      const lp2 = ctx.createUser();
      const aum = ctx.aum();
      const supply = ctx.clpSupply();
      const amount = 1_000n * USD;
      const afterFee = amount - ceilDiv(amount * 10n, 10_000n);
      const expected = (afterFee * supply) / aum;

      const add = (min: bigint) =>
        ctx.ix("add_liquidity", lpAccounts(ctx, lp2), { amount, min_clp: min }, ctx.marketAccounts());
      assert.equal(ctx.expectError([add(expected + 1n)], [lp2]), "Slippage");
      const meta = ctx.send([add(expected)], [lp2]);
      assert.equal(ctx.tokenBalance(ctx.clpAta(lp2.publicKey)), expected);
      const ev = ctx.event(meta, "LiquidityAdded");
      assert.equal(big(ev.clp_minted), expected);
      assert.equal(big(ev.fee), 1_000_000n);
      assert.equal(ctx.expectError([zeroAdd(ctx, lp2)], [lp2]), "ZeroAmount");
    }),
  );

  it(
    "remove respects the 15 min cooldown and pays out at AUM",
    scenario((ctx, lp) => {
      const clp = 1_000_000n * USD;
      assert.equal(ctx.expectError([removeIx(ctx, lp, clp)], [lp]), "CooldownActive");
      ctx.warp(899);
      assert.equal(ctx.expectError([removeIx(ctx, lp, clp)], [lp]), "CooldownActive");
      ctx.warp(1);

      const aum = ctx.aum();
      const supply = ctx.clpSupply();
      const expected = (clp * aum) / supply;
      const before = ctx.tokenBalance(ctx.usdcAta(lp.publicKey));
      assert.equal(ctx.expectError([removeIx(ctx, lp, clp, expected + 1n)], [lp]), "Slippage");
      ctx.send([removeIx(ctx, lp, clp, expected)], [lp]);
      assert.equal(ctx.tokenBalance(ctx.usdcAta(lp.publicKey)) - before, expected);
      assert.equal(ctx.clpSupply(), supply - clp);
      assert.equal(big(ctx.getPool().pool_amount), SEED - expected);
    }),
  );

  it(
    "reserved liquidity blocks removal",
    scenario((ctx, lp) => {
      const alice = ctx.createUser();
      ctx.openPosition(alice, "ETH-USD", true, 100_000n * USD, 1_000_000n * USD); // reserves ≈ $899k
      ctx.warp(900);
      const all = ctx.tokenBalance(ctx.clpAta(lp.publicKey));
      assert.equal(ctx.expectError([removeIx(ctx, lp, all)], [lp]), "InsufficientUnreservedLiquidity");
      // What is not reserved can still leave.
      const pool = ctx.getPool();
      const available = big(pool.pool_amount) - big(pool.reserved_amount);
      const clpForAvailable = (available * ctx.clpSupply()) / ctx.aum() - 1_000_000n;
      ctx.send([removeIx(ctx, lp, clpForAvailable)], [lp]);
    }),
  );

  it(
    "AUM reflects trader PnL, and trader losses are capped at their collateral",
    scenario((ctx) => {
      const alice = ctx.createUser();
      ctx.openPosition(alice, "ETH-USD", true, C, S);
      const poolAmount = big(ctx.getPool().pool_amount);
      const tokens = big(ctx.getPosition(alice.publicKey, "ETH-USD", true).tokens);

      ctx.setPrice("ETH-USD", 330_000_000_000n);
      const pnl = (tokens * 330_000_000_000n) / 10n ** 20n - S;
      assert.equal(ctx.aum(), poolAmount - pnl);

      ctx.setPrice("ETH-USD", 100_000_000_000n); // loss ≈ $6.7k > $994 collateral
      assert.equal(ctx.aum(), poolAmount + 994_000_000n);
    }),
  );

  it(
    "fees split 10% protocol / 90% pool; withdraw_fees is admin-only",
    scenario((ctx) => {
      const alice = ctx.createUser();
      const poolBefore = big(ctx.getPool().pool_amount);
      ctx.openPosition(alice, "ETH-USD", true, C, S);
      const pool = ctx.getPool();
      assert.equal(big(pool.fee_reserves), 600_000n);
      assert.equal(big(pool.pool_amount) - poolBefore, 5_400_000n);

      const treasury = ctx.createUser(0n);
      const mallory = ctx.createUser(0n);
      assert.equal(ctx.expectError([ctx.withdrawFeesIx(ctx.usdcAta(treasury.publicKey), mallory.publicKey)], [mallory]), "NotAdmin");
      const meta = ctx.send([ctx.withdrawFeesIx(ctx.usdcAta(treasury.publicKey))], [ctx.admin]);
      assert.equal(big(ctx.event(meta, "FeesWithdrawn").amount), 600_000n);
      assert.equal(ctx.tokenBalance(ctx.usdcAta(treasury.publicKey)), 600_000n);
      assert.equal(big(ctx.getPool().fee_reserves), 0n);
      assert.equal(ctx.expectError([ctx.withdrawFeesIx(ctx.usdcAta(treasury.publicKey))], [ctx.admin]), "NoFees");
    }),
  );
});

describe("faucet", () => {
  it(
    "mints 10,000 USDC through the program PDA, once per 24 h, creating the token account",
    scenario((ctx) => {
      const user = Keypair.generate();
      ctx.svm.airdrop(user.publicKey, 10n ** 10n);

      // Before the mint authority moves, the PDA cannot mint.
      assert.notEqual(ctx.expectError([ctx.faucetIx(user.publicKey)], [user]), "");
      ctx.moveMintAuthorityToProgram();

      const meta = ctx.send([ctx.faucetIx(user.publicKey)], [user]);
      assert.equal(ctx.tokenBalance(ctx.usdcAta(user.publicKey)), 10_000n * USD);
      assert.equal(big(ctx.event(meta, "FaucetClaimed").amount), 10_000n * USD);

      assert.equal(ctx.expectError([ctx.faucetIx(user.publicKey)], [user]), "FaucetCooldown");
      ctx.warp(86_399);
      assert.equal(ctx.expectError([ctx.faucetIx(user.publicKey)], [user]), "FaucetCooldown");
      ctx.warp(1);
      ctx.send([ctx.faucetIx(user.publicKey)], [user]);
      assert.equal(ctx.tokenBalance(ctx.usdcAta(user.publicKey)), 20_000n * USD);

      // Cooldowns are per user.
      const other = Keypair.generate();
      ctx.svm.airdrop(other.publicKey, 10n ** 10n);
      ctx.send([ctx.faucetIx(other.publicKey)], [other]);
      assert.equal(ctx.tokenBalance(ctx.usdcAta(other.publicKey)), 10_000n * USD);
    }),
  );
});

describe("admin", () => {
  it(
    "set_params enforces the EVM bounds",
    scenario((ctx) => {
      const bad = (fields: Parameters<Ctx["setParamsIx"]>[0]) => ctx.expectError([ctx.setParamsIx(fields)], [ctx.admin]);
      assert.equal(bad({ max_leverage: 40n }), "InvalidParam"); // 40 × 250 = 10,000
      assert.equal(bad({ maintenance_margin_bps: 0n }), "InvalidParam");
      assert.equal(bad({ max_leverage: 0n }), "InvalidParam");
      assert.equal(bad({ position_fee_bps: 101n }), "InvalidParam");
      assert.equal(bad({ liquidation_fee_bps: 201n }), "InvalidParam");
      assert.equal(bad({ execution_spread_bps: 101n }), "InvalidParam");
      assert.equal(bad({ max_profit_multiplier: 0n }), "InvalidParam");
      assert.equal(bad({ max_profit_multiplier: 21n }), "InvalidParam");
      assert.equal(bad({ oi_cap_bps: 10_001n }), "InvalidParam");
      assert.equal(bad({ request_expiry: 9n }), "InvalidParam");
      assert.equal(bad({ request_expiry: 3_601n }), "InvalidParam");
      assert.equal(bad({ min_execution_fee_lamports: 10_000_001n }), "InvalidParam");
      assert.equal(bad({ min_collateral: 999_999n }), "InvalidParam");
      assert.equal(bad({ lp_mint_fee_bps: 101n }), "InvalidParam");
      assert.equal(bad({ protocol_fee_share_bps: 5_001n }), "InvalidParam");
      assert.equal(bad({ lp_cooldown: 86_401n }), "InvalidParam");
      // Funding params need every market so accrued funding settles at the old rate first.
      assert.equal(bad({ funding_factor_per_hour: 1n }), "InvalidMarketAccounts");

      const meta = ctx.setParams({ max_leverage: 30n, maintenance_margin_bps: 300n, oi_cap_bps: 5_000n, lp_cooldown: 0n });
      assert.ok(ctx.events(meta).some((e) => e.name === "ParamUpdated" && e.data.key === "maxLeverage"));
      const config = ctx.getConfig();
      assert.equal(big(config.max_leverage), 30n);
      assert.equal(big(config.maintenance_margin_bps), 300n);
      assert.equal(big(config.oi_cap_bps), 5_000n);
      assert.equal(big(ctx.getPool().lp_cooldown), 0n);

      const mallory = ctx.createUser(0n);
      assert.equal(ctx.expectError([ctx.setParamsIx({ oi_cap_bps: 1n }, [], mallory.publicKey)], [mallory]), "NotAdmin");
    }),
  );

  it(
    "changing funding params settles accrued funding at the old rate",
    scenario((ctx) => {
      const alice = ctx.createUser();
      ctx.openPosition(alice, "ETH-USD", true, 20_000n * USD, 200_000n * USD);
      ctx.warp(3_600);
      const meta = ctx.setParams({ funding_factor_per_hour: 0n }, ctx.marketAccounts());
      assert.ok(ctx.event(meta, "FundingUpdated"));
      const accrued = big(ctx.getMarket("ETH-USD").cum_funding_long);
      assert.ok(accrued > 0n);
      ctx.warp(3_600);
      ctx.updateFunding("ETH-USD");
      assert.equal(big(ctx.getMarket("ETH-USD").cum_funding_long), accrued, "no accrual at factor 0");
    }),
  );

  it(
    "add_market rejects stale or foreign oracles, duplicates and bad symbols",
    scenario((ctx) => {
      const listing = (symbol: string, oracle = mockOraclePda(symbol), kind: object = { Mock: {} }) =>
        ctx.ix(
          "add_market",
          { admin: ctx.admin.publicKey, config: configPda(), market: marketPda(symbol), oracle, system_program: SystemProgram.programId },
          { symbol, oracle_kind: kind, max_age: 120 },
        );
      const initOracle = (symbol: string) =>
        ctx.ix(
          "init_mock_oracle",
          { admin: ctx.admin.publicKey, config: configPda(), mock_oracle: mockOraclePda(symbol), system_program: SystemProgram.programId },
          { symbol, answer: 100_000_000n, decimals: 8 },
        );

      ctx.send([initOracle("DOGE-USD")], [ctx.admin]);
      ctx.send(
        [ctx.ix("set_mock_price", { admin: ctx.admin.publicKey, config: configPda(), mock_oracle: mockOraclePda("DOGE-USD") }, { answer: 100_000_000n, timestamp: BigInt(ctx.now - 121) })],
        [ctx.admin],
      );
      assert.equal(ctx.expectError([listing("DOGE-USD")], [ctx.admin]), "StalePrice");
      // A program-owned account presented as Chainlink fails the owner check.
      ctx.setPrice("ETH-USD", 300_000_000_000n);
      assert.equal(ctx.expectError([listing("DOGE-USD", mockOraclePda("ETH-USD"), { Chainlink: {} })], [ctx.admin]), "InvalidOracleOwner");
      // Non-positive answers.
      ctx.send(
        [ctx.ix("set_mock_price", { admin: ctx.admin.publicKey, config: configPda(), mock_oracle: mockOraclePda("DOGE-USD") }, { answer: 0n, timestamp: 0n })],
        [ctx.admin],
      );
      assert.equal(ctx.expectError([listing("DOGE-USD")], [ctx.admin]), "InvalidOracleAnswer");
      // Symbols are 1–16 bytes; the PDA makes duplicates impossible.
      assert.equal(ctx.expectError([listing("")], [ctx.admin]), "InvalidSymbol");
      assert.notEqual(ctx.expectError([listing("ETH-USD")], [ctx.admin]), "");

      ctx.send(
        [ctx.ix("set_mock_price", { admin: ctx.admin.publicKey, config: configPda(), mock_oracle: mockOraclePda("DOGE-USD") }, { answer: 20_000_000n, timestamp: 0n })],
        [ctx.admin],
      );
      ctx.send([listing("DOGE-USD")], [ctx.admin]);
      ctx.markets["DOGE-USD"] = { symbol: "DOGE-USD", market: marketPda("DOGE-USD"), oracle: mockOraclePda("DOGE-USD") };
      assert.equal(ctx.getConfig().markets.length, 4);
      assert.ok(ctx.aum() > 0n, "AUM now needs the fourth market too");
      assert.equal(
        ctx.expectError([ctx.ix("get_aum", { config: configPda(), pool: ctx.common().pool }, {}, ctx.marketAccounts({ skip: "DOGE-USD" }))], [ctx.keeper]),
        "InvalidMarketAccounts",
      );
    }),
  );

  it("initialize cannot run twice", () => {
    const { ctx } = setup({ liquidity: 0n });
    assert.notEqual(ctx.expectError([ctx.ix("initialize", ctx.common({ admin: ctx.admin.publicKey }))], [ctx.admin]), "");
  });
});

// ── helpers ──

function lpAccounts(ctx: Ctx, user: Keypair) {
  return ctx.common({
    user: user.publicKey,
    user_usdc: ctx.usdcAta(user.publicKey),
    user_clp: ctx.clpAta(user.publicKey),
    user_state: userStatePda(user.publicKey),
  });
}

function zeroAdd(ctx: Ctx, user: Keypair) {
  return ctx.ix("add_liquidity", lpAccounts(ctx, user), { amount: 0n, min_clp: 0n }, ctx.marketAccounts());
}

function removeIx(ctx: Ctx, user: Keypair, clpAmount: bigint, minUsdc = 0n) {
  return ctx.ix("remove_liquidity", lpAccounts(ctx, user), { clp_amount: clpAmount, min_usdc: minUsdc }, ctx.marketAccounts());
}
