/**
 * EVM keeper against Anvil + locally deployed Phase 3 contracts (MockV3Aggregator prices).
 * Deploys from the forge artifacts in `celestial-contracts/out` (run `forge build` there first);
 * nothing in `celestial-contracts/src` is touched. The keeper runs in-process and reaches Anvil
 * through a proxy that the outage scenario switches off.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { Contract, ContractFactory, JsonRpcProvider, NonceManager, Wallet, id as keccakId, parseEther } from "ethers";

import { REPO_ROOT, type Config } from "../src/config.ts";
import { type RunningKeeper, startKeeper } from "../src/index.ts";
import { ToggleProxy, captureLogger, sleep, spawnQuiet, waitFor } from "./support/common.ts";

// Anvil's well-known development keys (public test keys, never used on a real network).
const ANVIL_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // deployer / admin
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // keeper
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // alice
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // bob
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a", // carol
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba", // dave
];
const ANVIL_PORT = 18545;
const PROXY_PORT = 18546;
const ANVIL = `http://127.0.0.1:${ANVIL_PORT}`;

const ETH = keccakId("ETH-USD");
const BTC = keccakId("BTC-USD");
const USD = 1_000_000n;
const EXEC_FEE = parseEther("0.0002");
const MAX = 2n ** 256n - 1n;

const OUT = join(REPO_ROOT, "celestial-contracts/out");
const artifact = (file: string, name = file) => JSON.parse(readFileSync(join(OUT, `${file}.sol`, `${name}.json`), "utf8"));

describe("EVM keeper (Anvil)", { timeout: 240_000 }, () => {
  let anvil: ReturnType<typeof spawnQuiet>;
  let proxy: ToggleProxy;
  let provider: JsonRpcProvider;
  let admin: NonceManager;
  let engine: Contract, pool: Contract, usdc: Contract, ethFeed: Contract, btcFeed: Contract;
  const users: Record<string, NonceManager> = {};
  let keeperAddr: string;
  let keeper: RunningKeeper;
  const { log, lines } = captureLogger();

  const connect = (c: Contract, who: NonceManager) => c.connect(who) as Contract;

  async function requestIncrease(who: string, market: string, isLong: boolean, coll: bigint, size: bigint, acceptable?: bigint) {
    const tx = await connect(engine, users[who]).requestIncrease(market, isLong, coll, size, acceptable ?? (isLong ? MAX : 0n), { value: EXEC_FEE });
    return idOf(await tx.wait());
  }

  /** The request id from a requestIncrease/requestDecrease receipt (its `RequestCreated` log). */
  const idOf = (rc: any) =>
    rc.logs.map((l: any) => engine.interface.parseLog(l)).find((e: any) => e?.name === "RequestCreated")!.args.id as bigint;

  const status = async (id: bigint) => Number((await engine.getRequest(id)).status); // 1 pending 2 executed 3 cancelled

  before(async () => {
    if (!existsSync(join(OUT, "PerpEngine.sol/PerpEngine.json"))) throw new Error("run `forge build` in celestial-contracts first");
    anvil = spawnQuiet("anvil", ["--port", String(ANVIL_PORT), "--silent"]);
    provider = new JsonRpcProvider(ANVIL, undefined, { pollingInterval: 100 });
    await waitFor(() => provider.getBlockNumber().then(() => true), 20_000, "anvil");

    admin = new NonceManager(new Wallet(ANVIL_KEYS[0], provider));
    keeperAddr = new Wallet(ANVIL_KEYS[1]).address;
    ["alice", "bob", "carol", "dave"].forEach((n, i) => (users[n] = new NonceManager(new Wallet(ANVIL_KEYS[i + 2], provider))));

    const deploy = async (file: string, args: unknown[] = [], name = file) => {
      const a = artifact(file, name);
      const c = await new ContractFactory(a.abi, a.bytecode.object, admin).deploy(...args);
      await c.waitForDeployment();
      return c as Contract;
    };
    usdc = await deploy("MockUSDC");
    ethFeed = await deploy("MockV3Aggregator", [8, 3_000n * 10n ** 8n]);
    btcFeed = await deploy("MockV3Aggregator", [8, 60_000n * 10n ** 8n]);
    const oracle = await deploy("ChainlinkOracle");
    await (await oracle.setFeed(ETH, await ethFeed.getAddress(), 3960)).wait();
    await (await oracle.setFeed(BTC, await btcFeed.getAddress(), 3960)).wait();
    const clp = await deploy("CLP");
    pool = await deploy("LiquidityPool", [await usdc.getAddress(), await clp.getAddress()]);
    await (await clp.setPool(await pool.getAddress())).wait();
    engine = await deploy("PerpEngine", [await oracle.getAddress(), await pool.getAddress()]);
    await (await pool.setEngine(await engine.getAddress())).wait();
    await (await engine.listMarket(ETH)).wait();
    await (await engine.listMarket(BTC)).wait();
    await (await engine.setKeeper(keeperAddr, true)).wait();

    const adminAddr = await admin.getAddress();
    await (await usdc.mint(adminAddr, 5_000_000n * USD)).wait();
    await (await usdc.approve(await pool.getAddress(), MAX)).wait();
    await (await pool.addLiquidity(5_000_000n * USD, 0)).wait();
    for (const u of Object.values(users)) {
      await (await usdc.mint(await u.getAddress(), 1_000_000n * USD)).wait();
      await (await connect(usdc, u).approve(await pool.getAddress(), MAX)).wait();
    }

    proxy = new ToggleProxy(PROXY_PORT, ANVIL);
    await proxy.start();
    const config: Config = {
      evm: {
        rpcUrl: proxy.url,
        privateKey: ANVIL_KEYS[1],
        expectedKeeper: keeperAddr,
        engine: await engine.getAddress(),
        oracle: await oracle.getAddress(),
        markets: { "ETH-USD": ETH, "BTC-USD": BTC },
        startBlock: 0,
        logRange: 500,
        maxBatch: 10,
        confirmTimeoutMs: 20_000,
        minBalanceWei: parseEther("0.02"),
        pollingMs: 100,
      },
      intervals: { executorMs: 500, liquidatorMs: 1_000, fundingMs: 2_000, healthMs: 5_000 },
      logLevel: "debug",
    };
    keeper = startKeeper(config, log);
    await waitFor(async () => lines.some((l) => l.msg === "evm keeper ready"), 20_000, "keeper init");
  });

  after(async () => {
    await keeper?.stop();
    await proxy?.stop();
    provider?.destroy();
    anvil?.kill("SIGINT");
  });

  it("executes a request within 5 s", async () => {
    const t0 = Date.now();
    const id = await requestIncrease("alice", ETH, true, 1_000n * USD, 10_000n * USD);
    await waitFor(async () => (await status(id)) === 2, 5_000, "request executed");
    const p = await engine.getPosition(await engine.getPositionKey(await users.alice.getAddress(), ETH, true));
    assert.equal(p.size, 10_000n * USD);
    assert.equal(p.collateral, 994_000_000n); // Ex 1
    console.log(`  fill latency ${Date.now() - t0} ms`);
  });

  it("batches requests: a slippage failure is cancelled, the others fill, and every fee goes to the keeper", async () => {
    await provider.send("evm_setAutomine", [false]);
    const txs = await Promise.all([
      connect(engine, users.bob).requestIncrease(BTC, false, 500n * USD, 2_500n * USD, 0n, { value: EXEC_FEE }),
      connect(engine, users.carol).requestIncrease(ETH, true, 1_000n * USD, 10_000n * USD, 3_000n * 10n ** 8n, { value: EXEC_FEE }), // exec 3,003 > 3,000
      connect(engine, users.dave).requestIncrease(ETH, false, 1_000n * USD, 5_000n * USD, 0n, { value: EXEC_FEE }),
    ]);
    await provider.send("evm_mine", []);
    await provider.send("evm_setAutomine", [true]);
    const ids = await Promise.all(
      txs.map(async (tx) => idOf(await tx.wait())),
    );
    const keeperBefore = await provider.getBalance(keeperAddr);
    await waitFor(async () => (await Promise.all(ids.map(status))).every((s) => s !== 1), 8_000, "batch settled");
    assert.deepEqual(await Promise.all(ids.map(status)), [2, 3, 2]);

    const sent = lines.find((l) => l.msg === "execute sent" && l.ids?.length === 3);
    assert.ok(sent, "one executeRequests transaction with all three ids");
    const cancelled = lines.find((l) => l.msg === "request cancelled" && l.id === ids[1].toString());
    assert.equal(cancelled?.reason, "SlippageExceeded");
    const rc = await provider.getTransactionReceipt(sent.tx);
    const gasCost = rc!.gasUsed * rc!.gasPrice;
    assert.equal((await provider.getBalance(keeperAddr)) - keeperBefore, 3n * EXEC_FEE - gasCost, "keeper received 3 execution fees");
    assert.equal(await provider.getBalance(await engine.getAddress()), 0n, "engine holds no leftover fees");
  });

  it("liquidates a position within 10 s of the price crossing its liquidation price", async () => {
    const key = await engine.getPositionKey(await users.alice.getAddress(), ETH, true);
    const usdcBefore = await usdc.balanceOf(keeperAddr);
    await (await ethFeed.updateAnswer(2_700n * 10n ** 8n)).wait(); // Ex 1 long liquidates below ≈ $2,781
    await waitFor(async () => (await engine.getPosition(key)).size === 0n, 10_000, "alice liquidated");
    const liq = lines.find((l) => l.msg === "position liquidated" && l.key === key.toLowerCase());
    assert.ok(liq, "keeper logged the liquidation");
    assert.equal(liq.keeper_fee, (50n * USD).toString(), "0.5% of $10,000");
    assert.ok((await usdc.balanceOf(keeperAddr)) - usdcBefore >= 50n * USD);
    // Healthy positions are left alone: dave's short profits from the drop.
    assert.ok((await engine.getPosition(await engine.getPositionKey(await users.dave.getAddress(), ETH, false))).size > 0n);
    const dave = await users.dave.getAddress();
    assert.ok(!lines.some((l) => l.msg === "liquidation sent" && l.account === dave));
    await (await ethFeed.updateAnswer(3_000n * 10n ** 8n)).wait();
  });

  it("updates funding on schedule for markets with open interest", async () => {
    await provider.send("evm_increaseTime", [3_600]);
    await (await btcFeed.updateAnswer(60_000n * 10n ** 8n)).wait();
    await (await ethFeed.updateAnswer(3_000n * 10n ** 8n)).wait();
    const m = await waitFor(async () => {
      const x = await engine.markets(BTC);
      return x.cumFundingShort > 0n ? x : null;
    }, 10_000, "BTC short funding index moves");
    assert.equal(m.cumFundingLong, 0n, "only the heavier side (shorts) pays");
    assert.ok(lines.some((l) => l.msg === "funding updated" && l.market === "BTC-USD" && l.tx));
  });

  it("survives an RPC outage and executes exactly once afterwards", async () => {
    await proxy.stop();
    const id = await requestIncrease("bob", ETH, true, 200n * USD, 1_000n * USD);
    await sleep(3_000);
    assert.equal(await status(id), 1, "nothing can be executed while the keeper's RPC is down");
    assert.ok(lines.some((l) => l.msg === "loop tick failed" && l.loop === "executor"));

    await proxy.start();
    await waitFor(async () => (await status(id)) === 2, 15_000, "executed after recovery");
    assert.ok(lines.some((l) => l.msg === "loop recovered" && l.loop === "executor"));
    const logs = await provider.getLogs({ address: await engine.getAddress(), topics: [engine.interface.getEvent("RequestExecuted")!.topicHash], fromBlock: 0 });
    const forId = logs.filter((l) => BigInt(l.topics[1]) === id);
    assert.equal(forId.length, 1, "executed exactly once");
    assert.ok(!lines.some((l) => l.msg === "unhandled rejection" || l.msg === "uncaught exception"));
  });
});
