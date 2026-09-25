/**
 * Request lifecycle: business failures cancel (refund + keeper still paid), owner cancel after
 * expiry, batching, keeper-only access, pause, disabled markets and the AUM account list.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";

import {
  Ctx,
  EXEC_FEE,
  USD,
  big,
  configPda,
  positionPda,
  poolPda,
  requestPda,
  scenario,
  userStatePda,
  variant,
} from "./harness.ts";

const C = 1_000n * USD;
const S = 10_000n * USD;
const TX_FEE = 5_000n;
const ETH_3000 = 300_000_000_000n;

/**
 * Request an increase, execute it and assert it was cancelled with `reason`: escrow refunded,
 * keeper paid the execution fee, request closed with all remaining lamports back to the owner.
 */
function expectIncreaseCancelled(
  ctx: Ctx,
  reason: string,
  args: { symbol?: string; isLong?: boolean; collateral: bigint; size: bigint; acceptable?: bigint; before?: () => void },
) {
  const { symbol = "ETH-USD", isLong = true } = args;
  const user = ctx.createUser();
  const usdcStart = ctx.tokenBalance(ctx.usdcAta(user.publicKey));
  const acceptable = args.acceptable ?? (isLong ? ETH_3000 * 2n : 1n);
  const nonce = ctx.nextNonce(user.publicKey);
  ctx.send([ctx.requestIncreaseIx(user, symbol, isLong, args.collateral, args.size, acceptable)], [user]);
  const lamportsAfterRequest = ctx.lamports(user.publicKey);
  const requestLamports = ctx.lamports(requestPda(user.publicKey, nonce));
  args.before?.();

  const keeperBefore = ctx.lamports(ctx.keeper.publicKey);
  const meta = ctx.send([ctx.executeIx(user.publicKey, nonce, symbol, isLong)], [ctx.keeper]);
  const ev = ctx.event(meta, "RequestCancelled");
  assert.ok(ev, "RequestCancelled emitted");
  assert.equal(variant(ev.reason), reason);
  assert.equal(ev.by.toBase58(), ctx.keeper.publicKey.toBase58());
  assert.equal(ctx.event(meta, "RequestExecuted"), undefined);

  assert.equal(ctx.tokenBalance(ctx.usdcAta(user.publicKey)), usdcStart, "escrow refunded");
  assert.equal(big(ctx.getPool().total_escrow), 0n);
  assert.equal(ctx.lamports(ctx.keeper.publicKey) - keeperBefore, EXEC_FEE - TX_FEE, "keeper still paid");
  assert.equal(ctx.exists(requestPda(user.publicKey, nonce)), false, "request closed");
  assert.equal(ctx.lamports(user.publicKey) - lamportsAfterRequest, requestLamports - EXEC_FEE, "rent refunded");
  assert.equal(ctx.exists(positionPda(user.publicKey, ctx.markets[symbol].market, isLong)), false);
  return user;
}

describe("cancellations during execution", () => {
  it("long slippage", scenario((ctx) => void expectIncreaseCancelled(ctx, "SlippageExceeded", { collateral: C, size: S, acceptable: ETH_3000 })));
  it(
    "short slippage",
    scenario((ctx) => void expectIncreaseCancelled(ctx, "SlippageExceeded", { isLong: false, collateral: C, size: S, acceptable: ETH_3000 })),
  );
  it(
    "stale oracle",
    scenario((ctx) =>
      void expectIncreaseCancelled(ctx, "StalePrice", {
        collateral: C,
        size: S,
        before: () => {
          ctx.setTime(ctx.now + 121); // no price refresh
          ctx.svm.expireBlockhash();
        },
      }),
    ),
  );
  it("open-interest cap (30% of AUM)", scenario((ctx) => void expectIncreaseCancelled(ctx, "OpenInterestCap", { collateral: 100_000n * USD, size: 1_600_000n * USD })));
  it(
    "reserve cap",
    scenario((ctx) => {
      ctx.setParams({ oi_cap_bps: 10_000n });
      // reserve = 9 × ~599k ≈ $5.39M > $5M pool
      expectIncreaseCancelled(ctx, "ReserveCap", { collateral: 600_000n * USD, size: 1_000_000n * USD });
    }),
  );
  it("min collateral", scenario((ctx) => void expectIncreaseCancelled(ctx, "CollateralTooLow", { collateral: 5n * USD, size: 20n * USD })));
  it("leverage below 1x", scenario((ctx) => void expectIncreaseCancelled(ctx, "LeverageTooLow", { collateral: C, size: 500n * USD })));
  it("leverage above max", scenario((ctx) => void expectIncreaseCancelled(ctx, "LeverageTooHigh", { collateral: C, size: 20_001n * USD })));
  it(
    "paused after the request",
    scenario((ctx) => void expectIncreaseCancelled(ctx, "Paused", { collateral: C, size: S, before: () => ctx.setPaused(true) })),
  );
  it(
    "market disabled after the request",
    scenario((ctx) =>
      void expectIncreaseCancelled(ctx, "MarketDisabled", {
        collateral: C,
        size: S,
        before: () =>
          ctx.send(
            [ctx.ix("set_market_enabled", { admin: ctx.admin.publicKey, config: configPda(), market: ctx.markets["ETH-USD"].market }, { enabled: false })],
            [ctx.admin],
          ),
      }),
    ),
  );
});

describe("owner cancel", () => {
  it(
    "only after expiry, only by the owner; refunds escrow, fee and rent",
    scenario((ctx) => {
      const alice = ctx.createUser();
      const bob = ctx.createUser();
      const usdcStart = ctx.tokenBalance(ctx.usdcAta(alice.publicKey));
      const lamportsStart = ctx.lamports(alice.publicKey);
      const nonce = ctx.nextNonce(alice.publicKey);
      ctx.send([ctx.requestIncreaseIx(alice, "ETH-USD", true, C, S, ETH_3000 * 2n)], [alice]);

      assert.equal(ctx.expectError([ctx.cancelIx(alice, nonce)], [alice]), "RequestNotExpired");
      ctx.warp(59);
      assert.equal(ctx.expectError([ctx.cancelIx(alice, nonce)], [alice]), "RequestNotExpired");
      ctx.warp(1);
      assert.equal(ctx.expectError([ctx.cancelIx(alice, nonce, bob.publicKey)], [bob]), "RequestMismatch");

      const meta = ctx.send([ctx.cancelIx(alice, nonce)], [alice]);
      assert.equal(variant(ctx.event(meta, "RequestCancelled").reason), "UserCancelled");
      assert.equal(ctx.tokenBalance(ctx.usdcAta(alice.publicKey)), usdcStart);
      assert.equal(big(ctx.getPool().total_escrow), 0n);
      assert.equal(ctx.exists(requestPda(alice.publicKey, nonce)), false);
      const userStateRent = ctx.lamports(userStatePda(alice.publicKey));
      assert.equal(ctx.lamports(alice.publicKey), lamportsStart - userStateRent - 4n * TX_FEE, "execution fee refunded"); // 1 request + 2 failed + 1 cancel

      // An executed/cancelled request cannot be executed again.
      assert.equal(ctx.expectError([ctx.executeIx(alice.publicKey, nonce, "ETH-USD", true)], [ctx.keeper]), "AccountNotInitialized");
    }),
  );

  it(
    "decrease requests can be cancelled too (no escrow)",
    scenario((ctx) => {
      const alice = ctx.createUser();
      ctx.openPosition(alice, "ETH-USD", true, C, S);
      const nonce = ctx.nextNonce(alice.publicKey);
      ctx.send([ctx.requestDecreaseIx(alice, "ETH-USD", true, 0n, S, 1n)], [alice]);
      ctx.warp(60);
      ctx.send([ctx.cancelIx(alice, nonce)], [alice]);
      assert.equal(big(ctx.getPosition(alice.publicKey, "ETH-USD", true).size), S);
    }),
  );
});

describe("request validation", () => {
  it(
    "rejects a low execution fee, an empty request and a wrong nonce",
    scenario((ctx) => {
      const alice = ctx.createUser();
      assert.equal(
        ctx.expectError([ctx.requestIncreaseIx(alice, "ETH-USD", true, C, S, ETH_3000 * 2n, EXEC_FEE - 1n)], [alice]),
        "InsufficientExecutionFee",
      );
      assert.equal(ctx.expectError([ctx.requestIncreaseIx(alice, "ETH-USD", true, 0n, 0n, ETH_3000 * 2n)], [alice]), "EmptyRequest");
      assert.equal(ctx.expectError([ctx.requestDecreaseIx(alice, "ETH-USD", true, 0n, 0n, 1n)], [alice]), "EmptyRequest");
      assert.equal(
        ctx.expectError([ctx.requestIncreaseIx(alice, "ETH-USD", true, C, S, ETH_3000 * 2n, EXEC_FEE, 5n)], [alice]),
        "InvalidNonce",
      );
    }),
  );

  it(
    "execute rejects a position account that does not match the request",
    scenario((ctx) => {
      const alice = ctx.createUser();
      const nonce = ctx.nextNonce(alice.publicKey);
      ctx.send([ctx.requestIncreaseIx(alice, "ETH-USD", true, C, S, ETH_3000 * 2n)], [alice]);
      const ix = ctx.executeIx(alice.publicKey, nonce, "ETH-USD", true);
      const wrong = positionPda(alice.publicKey, ctx.markets["ETH-USD"].market, false);
      ix.keys = ix.keys.map((k) => (k.pubkey.equals(positionPda(alice.publicKey, ctx.markets["ETH-USD"].market, true)) ? { ...k, pubkey: wrong } : k));
      assert.equal(ctx.expectError([ix], [ctx.keeper]), "RequestMismatch");
    }),
  );
});

describe("batching", () => {
  it(
    "several execute_request in one transaction: one cancels, the others succeed",
    scenario((ctx) => {
      const alice = ctx.createUser();
      const bob = ctx.createUser();
      const carol = ctx.createUser();
      const n = [alice, bob, carol].map((u) => ctx.nextNonce(u.publicKey));
      ctx.send([ctx.requestIncreaseIx(alice, "ETH-USD", true, C, S, ETH_3000 * 2n)], [alice]);
      ctx.send([ctx.requestIncreaseIx(bob, "BTC-USD", false, 500n * USD, 2_500n * USD, 7_000_000_000_000n)], [bob]); // short needs ≥ $70k → slippage
      ctx.send([ctx.requestIncreaseIx(carol, "SOL-USD", false, 100n * USD, 500n * USD, 1n)], [carol]);

      const keeperBefore = ctx.lamports(ctx.keeper.publicKey);
      const meta = ctx.send(
        [
          ctx.executeIx(alice.publicKey, n[0], "ETH-USD", true),
          ctx.executeIx(bob.publicKey, n[1], "BTC-USD", false),
          ctx.executeIx(carol.publicKey, n[2], "SOL-USD", false),
        ],
        [ctx.keeper],
      );
      const names = ctx.events(meta).map((e) => e.name);
      assert.equal(names.filter((x) => x === "RequestExecuted").length, 2);
      assert.equal(names.filter((x) => x === "RequestCancelled").length, 1);
      assert.equal(ctx.lamports(ctx.keeper.publicKey) - keeperBefore, 3n * EXEC_FEE - TX_FEE);
      assert.equal(big(ctx.getPosition(alice.publicKey, "ETH-USD", true).size), S);
      assert.equal(big(ctx.getPosition(carol.publicKey, "SOL-USD", false).size), 500n * USD);
      assert.equal(ctx.exists(positionPda(bob.publicKey, ctx.markets["BTC-USD"].market, false)), false);
    }),
  );
});

describe("access control", () => {
  it(
    "execute and liquidate are keeper-only; set_keeper is admin-only",
    scenario((ctx) => {
      const alice = ctx.createUser();
      const mallory = Keypair.generate();
      ctx.svm.airdrop(mallory.publicKey, 10n ** 10n);
      const nonce = ctx.nextNonce(alice.publicKey);
      ctx.send([ctx.requestIncreaseIx(alice, "ETH-USD", true, C, S, ETH_3000 * 2n)], [alice]);

      const exec = ctx.executeIx(alice.publicKey, nonce, "ETH-USD", true);
      exec.keys[0] = { ...exec.keys[0], pubkey: mallory.publicKey };
      assert.equal(ctx.expectError([exec], [mallory]), "NotKeeper");

      const setKeeper = ctx.ix("set_keeper", { admin: mallory.publicKey, config: configPda() }, { keeper: mallory.publicKey, active: true });
      assert.equal(ctx.expectError([setKeeper], [mallory]), "NotAdmin");

      ctx.send([ctx.executeIx(alice.publicKey, nonce, "ETH-USD", true)], [ctx.keeper]);
      ctx.setPrice("ETH-USD", 200_000_000_000n);
      // Give mallory a USDC account so the only failing check is the keeper list.
      ctx.send([createUsdcAtaIx(ctx, mallory)], [mallory]);
      assert.equal(ctx.expectError([ctx.liquidateIx(alice.publicKey, "ETH-USD", true, mallory.publicKey)], [mallory]), "NotKeeper");

      // Removing the keeper revokes access.
      ctx.setKeeper(ctx.keeper.publicKey, false);
      assert.equal(ctx.expectError([ctx.liquidateIx(alice.publicKey, "ETH-USD", true)], [ctx.keeper]), "NotKeeper");
      ctx.setKeeper(ctx.keeper.publicKey, true);
      ctx.liquidate(alice.publicKey, "ETH-USD", true);
    }),
  );

  it(
    "two-step admin transfer",
    scenario((ctx) => {
      const next = Keypair.generate();
      ctx.svm.airdrop(next.publicKey, 10n ** 10n);
      ctx.send([ctx.ix("transfer_admin", { admin: ctx.admin.publicKey, config: configPda() }, { new_admin: next.publicKey })], [ctx.admin]);
      assert.equal(ctx.getConfig().admin.toBase58(), ctx.admin.publicKey.toBase58());
      const stranger = Keypair.generate();
      ctx.svm.airdrop(stranger.publicKey, 10n ** 10n);
      assert.equal(ctx.expectError([ctx.ix("accept_admin", { pending_admin: stranger.publicKey, config: configPda() })], [stranger]), "NotPendingAdmin");
      ctx.send([ctx.ix("accept_admin", { pending_admin: next.publicKey, config: configPda() })], [next]);
      assert.equal(ctx.getConfig().admin.toBase58(), next.publicKey.toBase58());
      assert.equal(ctx.expectError([ctx.ix("set_paused", { admin: ctx.admin.publicKey, config: configPda() }, { paused: true })], [ctx.admin]), "NotAdmin");
    }),
  );
});

describe("pause and disabled markets", () => {
  it(
    "pause blocks increases; decreases and liquidations still work",
    scenario((ctx) => {
      const alice = ctx.createUser();
      const bob = ctx.createUser();
      ctx.openPosition(alice, "ETH-USD", true, C, S);
      ctx.openPosition(bob, "ETH-USD", true, C, S);
      ctx.setPaused(true);

      assert.equal(ctx.expectError([ctx.requestIncreaseIx(alice, "ETH-USD", true, C, S, ETH_3000 * 2n)], [alice]), "Paused");
      const close = ctx.closePosition(alice, "ETH-USD", true, 0n, S);
      assert.ok(ctx.event(close, "PositionClosed"));

      ctx.setPrice("ETH-USD", 270_000_000_000n);
      ctx.liquidate(bob.publicKey, "ETH-USD", true);

      ctx.setPaused(false);
      ctx.setPrice("ETH-USD", ETH_3000);
      ctx.openPosition(alice, "ETH-USD", true, C, S);
    }),
  );

  it(
    "a disabled market rejects new increase requests but allows closing",
    scenario((ctx) => {
      const alice = ctx.createUser();
      ctx.openPosition(alice, "ETH-USD", true, C, S);
      const disable = (enabled: boolean) =>
        ctx.send(
          [ctx.ix("set_market_enabled", { admin: ctx.admin.publicKey, config: configPda(), market: ctx.markets["ETH-USD"].market }, { enabled })],
          [ctx.admin],
        );
      disable(false);
      assert.equal(ctx.marketInfo("ETH-USD").enabled, false);
      assert.equal(ctx.expectError([ctx.requestIncreaseIx(alice, "ETH-USD", true, C, S, ETH_3000 * 2n)], [alice]), "MarketDisabled");
      const close = ctx.closePosition(alice, "ETH-USD", true, 0n, S);
      assert.ok(ctx.event(close, "PositionClosed"));
      disable(true);
      ctx.openPosition(alice, "ETH-USD", true, C, S);
    }),
  );
});

describe("AUM market accounts", () => {
  it(
    "missing, reordered, wrong-oracle or extra market accounts are rejected everywhere",
    scenario((ctx, lp) => {
      const alice = ctx.createUser();
      ctx.openPosition(alice, "ETH-USD", true, C, S);
      const view = (remaining: any[]) =>
        ctx.expectError([ctx.ix("get_aum", { config: configPda(), pool: poolPda() }, {}, remaining)], [ctx.keeper]);

      assert.equal(view(ctx.marketAccounts({ skip: "BTC-USD" })), "InvalidMarketAccounts");
      assert.equal(view(ctx.marketAccounts({ swap: true })), "InvalidMarketAccounts");
      assert.equal(view([...ctx.marketAccounts(), ...ctx.marketAccounts().slice(0, 2)]), "InvalidMarketAccounts");
      const wrongOracle = ctx.marketAccounts();
      wrongOracle[1] = { ...wrongOracle[1], pubkey: ctx.markets["BTC-USD"].oracle };
      assert.equal(view(wrongOracle), "OracleMismatch");

      // The same list guards LP flows and execution.
      const add = ctx.ix(
        "add_liquidity",
        ctx.common({
          user: lp.publicKey,
          user_usdc: ctx.usdcAta(lp.publicKey),
          user_clp: ctx.clpAta(lp.publicKey),
          user_state: userStatePda(lp.publicKey),
        }),
        { amount: 1_000n * USD, min_clp: 0n },
        ctx.marketAccounts({ skip: "ETH-USD" }),
      );
      assert.equal(ctx.expectError([add], [lp]), "InvalidMarketAccounts");

      const nonce = ctx.nextNonce(alice.publicKey);
      ctx.send([ctx.requestDecreaseIx(alice, "ETH-USD", true, 0n, S, 1n)], [alice]);
      const exec = ctx.executeIx(alice.publicKey, nonce, "ETH-USD", true);
      const reordered = ctx.marketAccounts({ swap: true });
      exec.keys = [...exec.keys.slice(0, exec.keys.length - reordered.length), ...reordered];
      assert.equal(ctx.expectError([exec], [ctx.keeper]), "InvalidMarketAccounts");

      // Correct order works.
      assert.ok(ctx.aum() > 0n);
    }),
  );
});

/** Create a USDC token account for `user`. */
function createUsdcAtaIx(ctx: Ctx, user: Keypair) {
  return createAssociatedTokenAccountInstruction(
    user.publicKey,
    ctx.usdcAta(user.publicKey),
    user.publicKey,
    ctx.usdcMint.publicKey,
    TOKEN_2022_PROGRAM_ID,
  );
}
