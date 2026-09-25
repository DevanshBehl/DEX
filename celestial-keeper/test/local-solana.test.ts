/**
 * Solana keeper against `solana-test-validator` running the `mock-oracle` build of
 * celestial_perps. The keeper runs in-process with the DEVNET IDL (proving it works with both)
 * and reaches the validator through a proxy that the outage scenario switches off.
 * Requires `pnpm build:test` in celestial-solana (produces the mock .so + IDL fixtures).
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { type Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";

import type { Config } from "../src/config.ts";
import { type RunningKeeper, startKeeper } from "../src/index.ts";
import { ToggleProxy, captureLogger, sleep, waitFor } from "./support/common.ts";
import { DEVNET_IDL_PATH, EXEC_FEE, LocalSolana, MOCK_SO_PATH, USD } from "./support/solana-local.ts";

const RPC_PORT = 18899;
const PROXY_PORT = 18897;

describe("Solana keeper (local validator, mock oracles)", { timeout: 300_000 }, () => {
  const chain = new LocalSolana(RPC_PORT);
  let proxy: ToggleProxy;
  let keeper: RunningKeeper;
  const { log, lines } = captureLogger();
  const users: Record<string, Keypair> = {};

  /** Send one request_increase (own tx) and return its request PDA. */
  async function requestIncrease(who: string, symbol: string, isLong: boolean, coll: bigint, size: bigint, acceptable?: bigint) {
    const u = users[who];
    const nonce = await chain.nextNonce(u.publicKey);
    await chain.send([chain.requestIncreaseIx(u.publicKey, nonce, symbol, isLong, coll, size, acceptable)], [u]);
    return chain.request(u.publicKey, nonce);
  }

  /** Wait for a keeper log line (logged just after confirmation, once events are fetched). */
  const logLine = (pred: (l: any) => boolean, label: string) => waitFor(async () => lines.find(pred), 10_000, label);

  const gone = async (pda: import("@solana/web3.js").PublicKey) => !(await chain.connection.getAccountInfo(pda, "confirmed"));

  before(async () => {
    if (!existsSync(MOCK_SO_PATH)) throw new Error("run `pnpm build:test` in celestial-solana first (mock-oracle build)");
    await chain.start();
    await chain.setup();
    for (const n of ["alice", "bob", "carol", "dave", "erin"]) users[n] = await chain.createUser();

    proxy = new ToggleProxy(PROXY_PORT, chain.rpcUrl);
    await proxy.start();
    const config: Config = {
      solana: {
        rpcUrl: proxy.url,
        keypairPath: chain.keeperKeypairPath,
        expectedKeeper: chain.keeper.publicKey.toBase58(),
        idlPath: DEVNET_IDL_PATH,
        maxBatch: 4,
        computeUnitsPerExecute: 90_000,
        confirmTimeoutMs: 20_000,
        minBalanceLamports: 1_000_000_000n,
      },
      intervals: { executorMs: 500, liquidatorMs: 1_000, fundingMs: 3_000, healthMs: 5_000 },
      logLevel: "debug",
    };
    keeper = startKeeper(config, log);
    await waitFor(async () => lines.some((l) => l.msg === "solana keeper ready"), 30_000, "keeper init");
  });

  after(async () => {
    await keeper?.stop();
    await proxy?.stop();
    chain.stop();
  });

  it("executes a request within 5 s", async () => {
    await chain.refreshPrices();
    const t0 = Date.now();
    const req = await requestIncrease("alice", "ETH-USD", true, 1_000n * USD, 10_000n * USD);
    await waitFor(() => gone(req), 5_000, "request executed");
    const p = await chain.fetch("Position", chain.position(users.alice.publicKey, "ETH-USD", true));
    assert.equal(BigInt(p.size.toString()), 10_000n * USD);
    assert.equal(BigInt(p.collateral.toString()), 994_000_000n); // Ex 1
    await logLine((l) => l.msg === "request executed" && l.request === req.toBase58(), "executed log");
    console.log(`  fill latency ${Date.now() - t0} ms`);
  });

  it("executes several requests in one transaction; a slippage failure is cancelled and every fee goes to the keeper", async () => {
    await chain.refreshPrices();
    const [bob, carol, dave] = [users.bob, users.carol, users.dave];
    const n = await Promise.all([bob, carol, dave].map((u) => chain.nextNonce(u.publicKey)));
    // All three requests land atomically (one tx, three signers), so the keeper sees them together.
    const tx = new Transaction().add(
      chain.requestIncreaseIx(bob.publicKey, n[0], "BTC-USD", false, 500n * USD, 2_500n * USD),
      chain.requestIncreaseIx(carol.publicKey, n[1], "ETH-USD", true, 1_000n * USD, 10_000n * USD, 300_000_000_000n), // exec 3,003 > 3,000
      chain.requestIncreaseIx(dave.publicKey, n[2], "SOL-USD", false, 100n * USD, 500n * USD),
    );
    await sendAndConfirmTransaction(chain.connection, tx, [bob, carol, dave], { commitment: "confirmed" });
    const reqs = [chain.request(bob.publicKey, n[0]), chain.request(carol.publicKey, n[1]), chain.request(dave.publicKey, n[2])];

    await waitFor(async () => (await Promise.all(reqs.map(gone))).every(Boolean), 8_000, "batch settled");
    await waitFor(async () => lines.filter((l) => (l.msg === "request executed" || l.msg === "request cancelled") && reqs.some((r) => r.toBase58() === l.request)).length === 3, 10_000, "batch logs");
    const executed = lines.filter((l) => l.msg === "request executed" && reqs.some((r) => r.toBase58() === l.request));
    const cancelled = lines.filter((l) => l.msg === "request cancelled" && reqs.some((r) => r.toBase58() === l.request));
    assert.equal(executed.length, 2);
    assert.equal(cancelled.length, 1);
    assert.equal(cancelled[0].request, reqs[1].toBase58());
    assert.equal(cancelled[0].reason, "SlippageExceeded");
    const sigs = new Set([...executed, ...cancelled].map((l) => l.tx));
    assert.equal(sigs.size, 1, "all three in ONE transaction");

    const [sig] = sigs;
    const t = await chain.connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const delta = BigInt(t!.meta!.postBalances[0] - t!.meta!.preBalances[0]);
    assert.equal(delta, 3n * EXEC_FEE - BigInt(t!.meta!.fee), "keeper (fee payer) earned 3 execution fees");
    assert.equal(await chain.fetch("Position", chain.position(carol.publicKey, "ETH-USD", true)), null, "no position for the cancelled request");
  });

  it("a request on a stale oracle is cancelled with StalePrice and the keeper is still paid", async () => {
    await chain.refreshPrices();
    const now = (await chain.connection.getBlockTime(await chain.connection.getSlot()))!;
    await chain.setPrice("SOL-USD", 11_600_000_000n, BigInt(now - 500));
    const before = await chain.usdcBalance(users.erin.publicKey);
    const req = await requestIncrease("erin", "SOL-USD", true, 100n * USD, 500n * USD);
    await waitFor(() => gone(req), 5_000, "stale request settled");
    const c = await logLine((l) => l.msg === "request cancelled" && l.request === req.toBase58(), "cancel log");
    assert.equal(c?.reason, "StalePrice");
    assert.equal(await chain.usdcBalance(users.erin.publicKey), before, "escrow refunded");
    const t = await chain.connection.getTransaction(c.tx, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    assert.equal(BigInt(t!.meta!.postBalances[0] - t!.meta!.preBalances[0]), EXEC_FEE - BigInt(t!.meta!.fee));
    await chain.refreshPrices();
    await chain.setPrice("SOL-USD", 11_600_000_000n);
  });

  it("liquidates a position within 10 s of the price crossing its liquidation price; healthy positions are left alone", async () => {
    await chain.refreshPrices();
    const pos = chain.position(users.alice.publicKey, "ETH-USD", true);
    const keeperUsdc = await chain.usdcBalance(chain.keeper.publicKey);
    await chain.setPrice("ETH-USD", 270_000_000_000n); // Ex 1 long liquidates below ≈ $2,781
    await waitFor(() => gone(pos), 10_000, "alice liquidated");
    const l = await logLine((x) => x.msg === "position liquidated" && x.position === pos.toBase58(), "liquidation log");
    assert.equal(l?.keeper_fee, (50n * USD).toString(), "0.5% of $10,000");
    assert.equal((await chain.usdcBalance(chain.keeper.publicKey)) - keeperUsdc, 50n * USD);
    // bob's BTC short and dave's SOL short are untouched.
    assert.ok(await chain.fetch("Position", chain.position(users.bob.publicKey, "BTC-USD", false)));
    assert.ok(await chain.fetch("Position", chain.position(users.dave.publicKey, "SOL-USD", false)));
    await chain.setPrice("ETH-USD", 300_000_000_000n);
  });

  it("updates funding on schedule; only the heavier side accrues", async () => {
    await chain.refreshPrices();
    const before = BigInt((await chain.fetch("Market", chain.market("BTC-USD"))).cum_funding_short.toString());
    await waitFor(
      async () => BigInt((await chain.fetch("Market", chain.market("BTC-USD"))).cum_funding_short.toString()) > before,
      15_000,
      "BTC short funding index moves",
    );
    const m = await chain.fetch("Market", chain.market("BTC-USD"));
    assert.equal(BigInt(m.cum_funding_long.toString()), 0n);
    assert.ok(lines.some((l) => l.msg === "funding updated" && l.market === "BTC-USD" && l.tx));
  });

  it("survives an RPC outage and executes exactly once afterwards", async () => {
    await chain.refreshPrices();
    await proxy.stop();
    const req = await requestIncrease("erin", "BTC-USD", true, 200n * USD, 1_000n * USD);
    // Reads retry with backoff first (~7 s), then the tick fails and the loop backs off.
    await waitFor(async () => lines.some((l) => l.msg === "loop tick failed" && l.loop === "executor"), 30_000, "executor tick failure");
    assert.equal(await gone(req), false, "nothing executes while the keeper's RPC is down");

    await proxy.start();
    await chain.refreshPrices();
    await waitFor(() => gone(req), 60_000, "executed after recovery");
    await logLine((l) => l.msg === "loop recovered" && l.loop === "executor", "executor recovered");
    const p = await chain.fetch("Position", chain.position(users.erin.publicKey, "BTC-USD", true));
    assert.equal(BigInt(p.size.toString()), 1_000n * USD, "executed exactly once (size not doubled)");
    await logLine((l) => l.msg === "request executed" && l.request === req.toBase58(), "executed log");
    await sleep(2_000);
    assert.equal(lines.filter((l) => l.msg === "request executed" && l.request === req.toBase58()).length, 1);
    assert.ok(!lines.some((l) => l.msg === "unhandled rejection" || l.msg === "uncaught exception"));
  });
});
