// Chain layer (lib/chains/solana.ts, DEVNET IDL) end-to-end on solana-test-validator running the
// mock-oracle build of celestial_perps, with the keeper in-process. A generated keypair stands in
// for the browser wallet. Needs `pnpm build:test` in celestial-solana (mock program fixtures).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { AuthorityType, TOKEN_2022_PROGRAM_ID, createSetAuthorityInstruction } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";

import IDL from "../src/idl/celestial_perps.json";
import { SolanaChain, type SolanaSigner } from "../lib/chains/solana";
import type { OrderUpdate } from "../lib/chains/types";
import { clpToMint, lpMintFee } from "../lib/perpMath";
import { startKeeper, type RunningKeeper } from "../../celestial-keeper/src/index.ts";
import { captureLogger, sleep } from "../../celestial-keeper/test/support/common.ts";
import { DEVNET_IDL_PATH, LocalSolana, MOCK_SO_PATH } from "../../celestial-keeper/test/support/solana-local.ts";

const USD = 1_000_000n;
const C = 1_000n * USD;
const S = 10_000n * USD;
const MAXP = 2n ** 63n - 1n;
const PARAM_KEYS = [
  "max_leverage",
  "maintenance_margin_bps",
  "position_fee_bps",
  "liquidation_fee_bps",
  "execution_spread_bps",
  "max_profit_multiplier",
  "oi_cap_bps",
  "funding_factor_per_hour",
  "max_funding_rate_per_hour",
  "request_expiry",
  "min_execution_fee_lamports",
  "min_collateral",
  "lp_mint_fee_bps",
  "protocol_fee_share_bps",
  "lp_cooldown",
];

const signerFor = (kp: Keypair): SolanaSigner => ({
  publicKey: kp.publicKey,
  signTransaction: async (tx: Transaction) => {
    tx.partialSign(kp);
    return tx;
  },
});

describe("Solana chain layer (local validator + keeper)", { timeout: 400_000 }, () => {
  const local = new LocalSolana(18999);
  let keeper: RunningKeeper;
  let traderKp: Keypair;
  let lpKp: Keypair;
  let trader: SolanaChain;
  let lp: SolanaChain;
  let reader: SolanaChain;
  const owner = () => traderKp.publicKey.toBase58();

  const setParams = async (fields: Record<string, bigint>) => {
    const params = Object.fromEntries(PARAM_KEYS.map((k) => [k, fields[k] ?? null]));
    await local.send([local.ix("set_params", { admin: local.admin.publicKey, config: local.pda("config"), pool: local.pda("pool") }, { params })], [local.admin]);
  };

  async function order(kind: "requestIncrease" | "requestDecrease", p: Parameters<SolanaChain["requestIncrease"]>[0]) {
    await local.refreshPrices();
    const res = await trader[kind](p);
    const updates: OrderUpdate[] = [];
    const final = await trader.trackRequest(res.requestId!, res.tx, (u) => updates.push(u), AbortSignal.timeout(30_000));
    assert.equal(updates[0].status, "pending");
    return final;
  }

  /** Simulate a program view with a funded payer and return its return data. */
  async function view(name: string, args: Record<string, unknown> = {}) {
    // Build with this package's web3.js (the helper's instances come from the keeper's copy).
    const ix = local.ix(name, { config: local.pda("config"), pool: local.pda("pool") }, args, local.marketAccounts());
    const conn = new Connection(local.rpcUrl, "confirmed");
    const tx = new Transaction().add({
      programId: new PublicKey(ix.programId.toBase58()),
      keys: ix.keys.map((k) => ({ ...k, pubkey: new PublicKey(k.pubkey.toBase58()) })),
      data: ix.data,
    });
    tx.feePayer = new PublicKey(local.admin.publicKey.toBase58());
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    const sim = await conn.simulateTransaction(tx);
    assert.equal(sim.value.err, null, JSON.stringify(sim.value.logs));
    return Buffer.from(sim.value.returnData!.data[0], "base64");
  }

  before(async () => {
    if (!existsSync(MOCK_SO_PATH)) throw new Error("run `pnpm build:test` in celestial-solana first");
    await local.start();
    await local.setup();
    // Faucet: the mock USDC mint authority moves to the program PDA (as on devnet).
    await local.send(
      [createSetAuthorityInstruction(local.usdc.publicKey, local.admin.publicKey, AuthorityType.MintTokens, local.pda("mint_authority"), [], TOKEN_2022_PROGRAM_ID)],
      [local.admin],
    );
    traderKp = Keypair.generate();
    lpKp = Keypair.generate();
    await local.airdrop(traderKp.publicKey, 10);
    await local.airdrop(lpKp.publicKey, 10);
    const cfg = { rpcUrl: local.rpcUrl, idl: IDL, explorerTx: (s: string) => s, pollMs: 400 };
    trader = new SolanaChain(cfg, signerFor(traderKp));
    lp = new SolanaChain(cfg, signerFor(lpKp));
    reader = new SolanaChain(cfg);

    const { log } = captureLogger();
    keeper = startKeeper(
      {
        solana: {
          rpcUrl: local.rpcUrl,
          keypairPath: local.keeperKeypairPath,
          expectedKeeper: local.keeper.publicKey.toBase58(),
          idlPath: DEVNET_IDL_PATH,
          maxBatch: 4,
          computeUnitsPerExecute: 90_000,
          confirmTimeoutMs: 20_000,
          minBalanceLamports: 1_000_000_000n,
        },
        intervals: { executorMs: 400, liquidatorMs: 2_000, fundingMs: 60_000, healthMs: 60_000 },
        logLevel: "warn",
      },
      log,
    );
  });

  after(async () => {
    await keeper?.stop();
    local.stop();
  });

  it("reads params, markets (Config order), oracle and pool", async () => {
    await local.refreshPrices();
    const params = await reader.getParams();
    assert.equal(params.maxLeverage, 20n);
    assert.equal(params.minExecutionFee, 50_000n);
    assert.ok(params.positionRent > 1_000_000n, "position rent shown in the order summary");
    assert.deepEqual(await reader.getMarkets(), ["SOL-USD", "BTC-USD", "ETH-USD"]);
    const eth = await reader.getMarketState("ETH-USD");
    assert.equal(eth.price, 300_000_000_000n);
    assert.equal(eth.longCapacity, 1_500_000n * USD);
    const pool = await reader.getPool();
    assert.equal(pool.aum, 5_000_000n * USD);
    assert.equal(pool.clpDecimals, 6);
    assert.equal(pool.aum, (await view("get_aum")).readBigUInt64LE(0), "client AUM == on-chain get_aum");
  });

  it("faucet: 10,000 USDC (creates the token account), then a readable cooldown error", async () => {
    assert.equal((await trader.faucetStatus(owner())).canClaim, true);
    await trader.faucet();
    assert.equal(await trader.getUsdcBalance(owner()), 10_000n * USD);
    assert.equal((await trader.faucetStatus(owner())).canClaim, false);
    await assert.rejects(trader.faucet(), (e: Error & { code?: string }) => e.code === "FaucetCooldown" && /24 h/.test(e.message));
    assert.equal(await trader.getAllowance(), 2n ** 256n - 1n, "no approval step on Solana");
  });

  it("open → filled; getPositions shows the Ex 1 numbers; client state == on-chain views", async () => {
    const final = await order("requestIncrease", { market: "ETH-USD", isLong: true, collateralDelta: C, sizeDelta: S, acceptablePrice: 303_300_000_000n });
    assert.equal(final.status, "filled");
    assert.equal(final.status === "filled" && final.executionPrice, 300_300_000_000n);
    assert.equal(final.status === "filled" && final.fee, 6_000_000n);
    const [p] = await reader.getPositions(owner());
    assert.equal(p.market, "ETH-USD");
    assert.equal(p.size, S);
    assert.equal(p.collateral, 994_000_000n);
    assert.equal(p.entryPrice, 300_300_000_000n);
    assert.equal(p.liquidationPrice, 278_137_860_001n);
    assert.equal(p.pnl, -9_990_010n);

    // The UI computes these client-side; they must equal the program's own views.
    const pool = await reader.getPool();
    assert.equal(pool.aum, (await view("get_aum")).readBigUInt64LE(0));
    const st = await reader.getMarketState("ETH-USD");
    const info = local.coder.types.decode("MarketInfo", await view("get_market_info", { market: local.market("ETH-USD") }));
    assert.equal(st.longCapacity, BigInt(info.long_capacity.toString()));
    assert.equal(st.shortCapacity, BigInt(info.short_capacity.toString()));
    assert.equal(st.fundingRateLongPerHour, BigInt(info.funding_rate_long_per_hour.toString()));
  });

  it("add collateral, remove collateral, partial close", async () => {
    let coll = (await reader.getPositions(owner()))[0].collateral;
    assert.equal((await order("requestIncrease", { market: "ETH-USD", isLong: true, collateralDelta: 100n * USD, sizeDelta: 0n, acceptablePrice: MAXP })).status, "filled");
    let [p] = await reader.getPositions(owner());
    const funding1 = (await reader.getHistory(owner())).find((x) => x.event === "PositionIncreased")!.fundingPaid!;
    assert.equal(p.collateral, coll + 100n * USD - funding1);
    coll = p.collateral;

    assert.equal((await order("requestDecrease", { market: "ETH-USD", isLong: true, collateralDelta: 50n * USD, sizeDelta: 0n, acceptablePrice: 1n })).status, "filled");
    [p] = await reader.getPositions(owner());
    const funding2 = (await reader.getHistory(owner())).find((x) => x.event === "PositionDecreased")!.fundingPaid!;
    assert.equal(p.collateral, coll - 50n * USD - funding2);

    assert.equal((await order("requestDecrease", { market: "ETH-USD", isLong: true, collateralDelta: 0n, sizeDelta: S / 2n, acceptablePrice: 1n })).status, "filled");
    assert.equal((await reader.getPositions(owner()))[0].size, S / 2n);
  });

  it("slippage → cancelled with the decoded reason; escrow refunded", async () => {
    const before = await reader.getUsdcBalance(owner());
    const final = await order("requestIncrease", { market: "BTC-USD", isLong: true, collateralDelta: 100n * USD, sizeDelta: 500n * USD, acceptablePrice: 6_000_000_000_000n });
    assert.equal(final.status, "cancelled");
    assert.equal(final.status === "cancelled" && final.reason, "SlippageExceeded");
    assert.equal(await reader.getUsdcBalance(owner()), before);
  });

  it("full close → no positions (position rent refunded)", async () => {
    const [p] = await reader.getPositions(owner());
    assert.equal((await order("requestDecrease", { market: "ETH-USD", isLong: true, collateralDelta: 0n, sizeDelta: p.size, acceptablePrice: 1n })).status, "filled");
    assert.deepEqual(await reader.getPositions(owner()), []);
  });

  it("history lists every step with its details", async () => {
    const h = await reader.getHistory(owner());
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
    assert.ok(fees.amount > 0n, "LP share of trading fees is visible for the APR estimate");
    assert.equal(h.find((x) => x.event === "PositionIncreased" && x.sizeDelta === S)?.executionPrice, 300_300_000_000n);
    assert.ok(h.every((x) => x.tx && x.market !== undefined || !["PositionIncreased", "PositionDecreased", "PositionClosed"].includes(x.event)));
  });

  it("liquidity: add at the math's CLP amount (6-dec CLP), cooldown, remove", async () => {
    await setParams({ lp_cooldown: 5n });
    await lp.faucet();
    await local.refreshPrices();
    const pool = await reader.getPool();
    const params = await reader.getParams();
    const amount = 1_000n * USD;
    const expected = clpToMint(amount - lpMintFee(amount, params.lpMintFeeBps), pool.aum, pool.clpSupply, 1n);
    await assert.rejects(lp.addLiquidity(amount, expected + 1n), (e: Error & { code?: string }) => e.code === "Slippage");
    await lp.addLiquidity(amount, expected);
    const clp = await reader.getClpBalance(lpKp.publicKey.toBase58());
    assert.equal(clp, expected);
    assert.ok((await reader.lpAvailableAt(lpKp.publicKey.toBase58())) > 0);
    await assert.rejects(lp.removeLiquidity(clp, 0n), (e: Error & { code?: string }) => e.code === "CooldownActive");
    await sleep(6_000);
    await local.refreshPrices();
    const before = await reader.getUsdcBalance(lpKp.publicKey.toBase58());
    await lp.removeLiquidity(clp, 0n);
    assert.ok((await reader.getUsdcBalance(lpKp.publicKey.toBase58())) > before);
    assert.equal(await reader.getClpBalance(lpKp.publicKey.toBase58()), 0n);
  });

  it("cancel after expiry (keeper stopped so the order stays pending)", async () => {
    await keeper.stop();
    await setParams({ request_expiry: 10n });
    await local.refreshPrices();
    const res = await trader.requestIncrease({ market: "SOL-USD", isLong: false, collateralDelta: 100n * USD, sizeDelta: 500n * USD, acceptablePrice: 1n });
    const fresh = new SolanaChain({ rpcUrl: local.rpcUrl, idl: IDL, explorerTx: (x: string) => x }); // no config cache
    const [pending] = await fresh.getPendingRequests(owner());
    assert.equal(pending.id, res.requestId);
    const ops = await fresh.getOpsStatus();
    assert.equal(ops.pendingCount, 1, "status page sees the stuck request");
    assert.equal(ops.oldestPendingAt, pending.createdAt);
    assert.ok(ops.now >= pending.createdAt);
    assert.equal(ops.paused, false);
    assert.deepEqual(ops.keepers.map((k) => k.address), [local.keeper.publicKey.toBase58()]);
    assert.ok(ops.keepers[0].balance > 0n);
    assert.equal(pending.kind, "increase");
    assert.equal(pending.market, "SOL-USD");
    assert.equal(pending.cancellableAt - pending.createdAt, 10);
    await assert.rejects(trader.cancel(res.requestId!), (e: Error & { code?: string }) => e.code === "RequestNotExpired");
    await sleep(11_000);
    const before = await reader.getUsdcBalance(owner());
    await trader.cancel(res.requestId!);
    assert.deepEqual(await reader.getPendingRequests(owner()), []);
    assert.equal(await reader.getUsdcBalance(owner()), before + 100n * USD);
  });
});
