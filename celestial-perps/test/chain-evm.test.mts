// Chain layer (lib/chains/evm.ts) end-to-end on Anvil with the Phase 3 contracts, the keeper
// running in-process to fill orders. A throwaway Anvil key stands in for the browser wallet.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { NonceManager, Wallet, parseEther } from "ethers";

import { EvmChain, type EvmChainConfig } from "../lib/chains/evm";
import type { OrderUpdate } from "../lib/chains/types";
import { clpToMint, lpMintFee } from "../lib/perpMath";
import { startKeeper, type RunningKeeper } from "../../celestial-keeper/src/index.ts";
import { captureLogger } from "../../celestial-keeper/test/support/common.ts";
import { ANVIL_KEYS, BTC, ETH, startLocalEvm, type LocalEvm } from "./support/evm-local.mts";

const USD = 1_000_000n;
const C = 1_000n * USD;
const S = 10_000n * USD;
const MAXP = 2n ** 255n;

describe("EVM chain layer (Anvil + keeper)", { timeout: 300_000 }, () => {
  let env: LocalEvm;
  let keeper: RunningKeeper;
  let trader: EvmChain;
  let lp: EvmChain;
  let reader: EvmChain;
  let traderAddr: string;
  let lpAddr: string;
  let cfg: EvmChainConfig;

  /** Place an order and wait for the keeper through trackRequest. */
  async function order(kind: "requestIncrease" | "requestDecrease", p: Parameters<EvmChain["requestIncrease"]>[0]) {
    const res = await trader[kind](p);
    assert.ok(res.requestId, "request id from the receipt");
    const updates: OrderUpdate[] = [];
    const final = await trader.trackRequest(res.requestId!, res.tx, (u) => updates.push(u), AbortSignal.timeout(30_000));
    assert.equal(updates[0].status, "pending");
    return final;
  }

  before(async () => {
    env = await startLocalEvm(18645);
    cfg = {
      rpcUrl: env.url,
      chainId: 31337,
      ...env.addresses,
      markets: { "ETH-USD": ETH, "BTC-USD": BTC },
      deployBlock: 0,
      explorer: "http://localhost",
      pollMs: 300,
    };
    const traderWallet = new NonceManager(new Wallet(ANVIL_KEYS[2], env.provider));
    const lpWallet = new NonceManager(new Wallet(ANVIL_KEYS[3], env.provider));
    traderAddr = await traderWallet.getAddress();
    lpAddr = await lpWallet.getAddress();
    trader = new EvmChain(cfg, traderWallet);
    lp = new EvmChain(cfg, lpWallet);
    reader = new EvmChain(cfg);

    const { log } = captureLogger();
    keeper = startKeeper(
      {
        evm: {
          rpcUrl: env.url,
          privateKey: ANVIL_KEYS[1],
          engine: env.addresses.engine,
          oracle: env.addresses.oracle,
          markets: { "ETH-USD": ETH, "BTC-USD": BTC },
          startBlock: 0,
          logRange: 500,
          maxBatch: 10,
          confirmTimeoutMs: 20_000,
          minBalanceWei: parseEther("0.02"),
          pollingMs: 100,
        },
        intervals: { executorMs: 400, liquidatorMs: 1_000, fundingMs: 60_000, healthMs: 60_000 },
        logLevel: "warn",
      },
      log,
    );
  });

  after(async () => {
    await keeper?.stop();
    trader?.provider.destroy();
    lp?.provider.destroy();
    reader?.provider.destroy();
    env?.stop();
  });

  it("reads params, markets, oracle and pool", async () => {
    const params = await reader.getParams();
    assert.equal(params.maxLeverage, 20n);
    assert.equal(params.positionFeeBps, 6n);
    assert.equal(params.minExecutionFee, parseEther("0.0002"));
    assert.deepEqual((await reader.getMarkets()).sort(), ["BTC-USD", "ETH-USD"]);
    assert.equal(reader.supports("SOL-USD"), false);
    const eth = await reader.getMarketState("ETH-USD");
    assert.equal(eth.price, 300_000_000_000n);
    assert.ok(eth.priceUpdatedAt && eth.priceUpdatedAt > 0);
    assert.equal(eth.longCapacity, 1_500_000n * USD); // 30% of $5M
    const pool = await reader.getPool();
    assert.equal(pool.aum, 5_000_000n * USD);
    assert.equal(pool.clpDecimals, 18);
  });

  it("faucet: 10,000 USDC, then a readable cooldown error", async () => {
    assert.equal((await trader.faucetStatus(traderAddr)).canClaim, true);
    await trader.faucet();
    assert.equal(await trader.getUsdcBalance(traderAddr), 10_000n * USD);
    const st = await trader.faucetStatus(traderAddr);
    assert.equal(st.canClaim, false);
    assert.ok(st.nextClaimAt! > Date.now() / 1000);
    await assert.rejects(trader.faucet(), (e: Error & { code?: string }) => e.code === "FaucetCooldown" && /24 h/.test(e.message));
  });

  it("approve: allowance to the pool", async () => {
    assert.equal(await trader.getAllowance(traderAddr), 0n);
    await trader.approve(5_000n * USD);
    assert.equal(await trader.getAllowance(traderAddr), 5_000n * USD);
  });

  it("open → filled; getPositions shows the Ex 1 numbers", async () => {
    const final = await order("requestIncrease", { market: "ETH-USD", isLong: true, collateralDelta: C, sizeDelta: S, acceptablePrice: 303_300_000_000n });
    assert.equal(final.status, "filled");
    assert.equal(final.status === "filled" && final.executionPrice, 300_300_000_000n);
    assert.equal(final.status === "filled" && final.fee, 6_000_000n);
    const [p] = await reader.getPositions(traderAddr);
    assert.equal(p.market, "ETH-USD");
    assert.equal(p.size, S);
    assert.equal(p.collateral, 994_000_000n);
    assert.equal(p.entryPrice, 300_300_000_000n);
    assert.equal(p.liquidationPrice, 278_137_860_001n);
    assert.equal(p.markPrice, 300_000_000_000n);
    assert.equal(p.pnl, -9_990_010n); // spread cost at the raw oracle price
    assert.equal(p.netPnl, -9_990_010n - 6_000_000n);
  });

  it("add collateral, remove collateral, partial close", async () => {
    // Funding accrues on the (only) long side between blocks, so compare against the funding the
    // fill actually charged (from its event) rather than a fixed number.
    const lastFunding = async () => (await reader.getHistory(traderAddr)).find((x) => x.event === "PositionIncreased" || x.event === "PositionDecreased")!.fundingPaid!;
    let coll = (await reader.getPositions(traderAddr))[0].collateral;
    assert.equal((await order("requestIncrease", { market: "ETH-USD", isLong: true, collateralDelta: 100n * USD, sizeDelta: 0n, acceptablePrice: MAXP })).status, "filled");
    let next = (await reader.getPositions(traderAddr))[0].collateral;
    assert.equal(next, coll + 100n * USD - (await lastFunding()));
    coll = next;

    assert.equal((await order("requestDecrease", { market: "ETH-USD", isLong: true, collateralDelta: 50n * USD, sizeDelta: 0n, acceptablePrice: 0n })).status, "filled");
    next = (await reader.getPositions(traderAddr))[0].collateral;
    assert.equal(next, coll - 50n * USD - (await lastFunding()));

    assert.equal((await order("requestDecrease", { market: "ETH-USD", isLong: true, collateralDelta: 0n, sizeDelta: S / 2n, acceptablePrice: 0n })).status, "filled");
    assert.equal((await reader.getPositions(traderAddr))[0].size, S / 2n);
  });

  it("slippage → cancelled with the decoded reason; escrow refunded", async () => {
    const before = await reader.getUsdcBalance(traderAddr);
    const final = await order("requestIncrease", { market: "BTC-USD", isLong: true, collateralDelta: 100n * USD, sizeDelta: 500n * USD, acceptablePrice: 60_000n * 10n ** 8n });
    assert.equal(final.status, "cancelled");
    assert.equal(final.status === "cancelled" && final.reason, "SlippageExceeded");
    assert.equal(await reader.getUsdcBalance(traderAddr), before);
  });

  it("full close → no positions", async () => {
    const [p] = await reader.getPositions(traderAddr);
    assert.equal((await order("requestDecrease", { market: "ETH-USD", isLong: true, collateralDelta: 0n, sizeDelta: p.size, acceptablePrice: 0n })).status, "filled");
    assert.deepEqual(await reader.getPositions(traderAddr), []);
  });

  it("history lists every step with its details", async () => {
    const h = await reader.getHistory(traderAddr);
    const count = (e: string) => h.filter((x) => x.event === e).length;
    assert.equal(count("FaucetClaimed"), 1);
    assert.equal(count("RequestCreated"), 6);
    assert.equal(count("RequestExecuted"), 5);
    assert.equal(count("RequestCancelled"), 1);
    assert.equal(h.find((x) => x.event === "RequestCancelled")?.reason, "SlippageExceeded");
    assert.equal(count("PositionIncreased"), 2);
    assert.equal(count("PositionDecreased"), 3);
    assert.equal(count("PositionClosed"), 1);
    const fees = await reader.getFeesToPool(0);
    assert.equal(fees.complete, true);
    assert.ok(fees.amount > 0n, "LP share of trading fees is visible for the APR estimate");
    const open = h.find((x) => x.event === "PositionIncreased" && x.sizeDelta === S);
    assert.equal(open?.executionPrice, 300_300_000_000n);
    assert.ok(h.every((x) => x.time && x.tx));
    // newest first
    assert.ok(h[0].time! >= h[h.length - 1].time!);
  });

  it("liquidity: add at the math's CLP amount, cooldown, remove", async () => {
    await lp.faucet();
    await lp.approve(10_000n * USD);
    const pool = await reader.getPool();
    const params = await reader.getParams();
    const amount = 1_000n * USD;
    const expected = clpToMint(amount - lpMintFee(amount, params.lpMintFeeBps), pool.aum, pool.clpSupply, 10n ** 12n);
    await assert.rejects(lp.addLiquidity(amount, expected + 1n), (e: Error & { code?: string }) => e.code === "Slippage");
    await lp.addLiquidity(amount, expected);
    const clp = await reader.getClpBalance(lpAddr);
    assert.equal(clp, expected);

    assert.ok((await reader.lpAvailableAt(lpAddr)) > 0);
    await assert.rejects(lp.removeLiquidity(clp, 0n), (e: Error & { code?: string }) => e.code === "CooldownActive" && /15 minutes/.test(e.message));
    await env.warp(901);
    const usdcBefore = await reader.getUsdcBalance(lpAddr);
    await lp.removeLiquidity(clp, 0n);
    assert.ok((await reader.getUsdcBalance(lpAddr)) > usdcBefore);
    assert.equal(await reader.getClpBalance(lpAddr), 0n);
  });

  it("cancel after expiry (keeper stopped so the order stays pending)", async () => {
    await keeper.stop();
    const res = await trader.requestIncrease({ market: "ETH-USD", isLong: false, collateralDelta: 100n * USD, sizeDelta: 500n * USD, acceptablePrice: 1n });
    const [pending] = await reader.getPendingRequests(traderAddr);
    assert.equal(pending.id, res.requestId);
    assert.equal(pending.kind, "increase");
    assert.equal(pending.cancellableAt - pending.createdAt, 60);
    await assert.rejects(trader.cancel(res.requestId!), (e: Error & { code?: string }) => e.code === "RequestNotExpired");
    await env.warp(61);
    const before = await reader.getUsdcBalance(traderAddr);
    await trader.cancel(res.requestId!);
    assert.deepEqual(await reader.getPendingRequests(traderAddr), []);
    assert.equal(await reader.getUsdcBalance(traderAddr), before + 100n * USD);
  });
});
