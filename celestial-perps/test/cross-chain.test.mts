// Cross-chain consistency: the same trading and LP scenario, through the same `PerpsChain` code,
// on Anvil (PerpEngine) and solana-test-validator (celestial_perps, mock-oracle build), with one
// in-process keeper serving both. Every fill, fee, position field, payout, AUM and CLP amount must
// match to the unit (CLP to 1 unit after scaling, per docs/perp-math.md Ex 10).
//
// Funding accrues on wall-clock time, which neither local chain can pin, so the lifecycle runs with
// a zero funding factor and funding is compared as rates at identical open interest and AUM (the
// accrual formula itself is covered by the shared perp-math vectors).
//
// Needs `forge build` in celestial-contracts and `pnpm build:test` in celestial-solana. Run with
// `npm run test:cross-chain` (--test-force-exit: web3.js keeps reconnecting its websocket to the
// stopped validator, which would keep Node alive after the suite).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { after, before, describe, it } from "node:test";

import { AuthorityType, TOKEN_2022_PROGRAM_ID, createSetAuthorityInstruction } from "@solana/spl-token";
import { Keypair, type Transaction } from "@solana/web3.js";
import { NonceManager, Wallet, parseEther } from "ethers";

import IDL from "../src/idl/celestial_perps.json";
import { EvmChain } from "../lib/chains/evm";
import { SolanaChain, type SolanaSigner } from "../lib/chains/solana";
import type { OrderParams, OrderUpdate, PerpsChain, Position } from "../lib/chains/types";
import type { MarketId } from "../lib/marketData";
import { startKeeper, type RunningKeeper } from "../../celestial-keeper/src/index.ts";
import { captureLogger } from "../../celestial-keeper/test/support/common.ts";
import { DEVNET_IDL_PATH, LocalSolana, MOCK_SO_PATH } from "../../celestial-keeper/test/support/solana-local.ts";
import { ANVIL_KEYS, BTC, ETH, startLocalEvm, type LocalEvm } from "./support/evm-local.mts";

const USD = 1_000_000n;
const PRICE = 100_000_000n; // 1e8
const MAXP = 2n ** 63n - 1n; // fits the Solana u64 argument; far above any fill
const MINP = 1n;
const FUNDING = { factor: 300_000_000_000_000n, max: 100_000_000_000_000n }; // protocol defaults

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

/** One deployment behind the shared scenario. */
type Side = {
  name: "evm" | "solana";
  chain: PerpsChain;
  owner: string;
  /** 10^(CLP decimals − 6): CLP amounts are compared in 6-decimal units */
  clpScale: bigint;
  setPrice: (market: MarketId, price8: bigint) => Promise<void>;
  /** keep the mock oracle fresh (Solana max age is short) */
  refresh: () => Promise<void>;
  setFunding: (factor: bigint, max: bigint) => Promise<void>;
};

describe("cross-chain consistency (Anvil ⇄ solana-test-validator)", { timeout: 600_000 }, () => {
  let env: LocalEvm;
  const local = new LocalSolana(19099);
  let keeper: RunningKeeper;
  let evm: Side;
  let sol: Side;

  /** Assert equal on both chains (|a − b| ≤ tol) and return the value. */
  function same(label: string, a: bigint, b: bigint, tol = 0n): bigint {
    const d = a > b ? a - b : b - a;
    assert.ok(d <= tol, `${label}: evm ${a} ≠ solana ${b}${tol ? ` (tolerance ${tol})` : ""}`);
    return a;
  }

  async function order(side: Side, kind: "requestIncrease" | "requestDecrease", p: OrderParams) {
    await side.refresh();
    const res = await side.chain[kind](p);
    const final = await side.chain.trackRequest(res.requestId!, res.tx, (_u: OrderUpdate) => {}, AbortSignal.timeout(60_000));
    assert.equal(final.status, "filled", `${side.name} ${kind} ${p.market}: ${JSON.stringify(final, (_, v) => (typeof v === "bigint" ? v.toString() : v))}`);
    return final as Extract<OrderUpdate, { status: "filled" }>;
  }

  /** Same order on both chains; fill price and fee must match. */
  async function both(kind: "requestIncrease" | "requestDecrease", p: OrderParams) {
    const [a, b] = await Promise.all([order(evm, kind, p), order(sol, kind, p)]);
    same(`${p.market} ${kind} execution price`, a.executionPrice!, b.executionPrice!);
    same(`${p.market} ${kind} fee`, a.fee!, b.fee!);
    return a;
  }

  async function positions(market: MarketId, isLong: boolean): Promise<[Position | undefined, Position | undefined]> {
    await Promise.all([evm.refresh(), sol.refresh()]);
    const pick = async (s: Side) => (await s.chain.getPositions(s.owner)).find((x) => x.market === market && x.isLong === isLong);
    return Promise.all([pick(evm), pick(sol)]);
  }

  function samePosition(label: string, a: Position | undefined, b: Position | undefined) {
    assert.ok(a && b, `${label}: position missing (evm ${!!a}, solana ${!!b})`);
    for (const k of ["size", "collateral", "tokens", "reserved", "entryPrice", "liquidationPrice", "closeFee", "fundingOwed"] as const) same(`${label} ${k}`, a[k], b[k]);
    for (const k of ["markPrice", "pnl", "netPnl"] as const) same(`${label} ${k}`, a[k]!, b[k]!);
  }

  const usdc = (s: Side) => s.chain.getUsdcBalance(s.owner);

  before(async () => {
    if (!existsSync(MOCK_SO_PATH)) throw new Error("run `pnpm build:test` in celestial-solana first");

    // ---- EVM ----
    env = await startLocalEvm(18745);
    const cfg = { rpcUrl: env.url, chainId: 31337, ...env.addresses, markets: { "ETH-USD": ETH, "BTC-USD": BTC }, deployBlock: 0, explorer: "http://localhost", pollMs: 300 };
    const traderWallet = new NonceManager(new Wallet(ANVIL_KEYS[2], env.provider));
    const feeds: Partial<Record<MarketId, typeof env.ethFeed>> = { "ETH-USD": env.ethFeed, "BTC-USD": env.btcFeed };
    evm = {
      name: "evm",
      chain: new EvmChain(cfg, traderWallet),
      owner: await traderWallet.getAddress(),
      clpScale: 10n ** 12n,
      setPrice: async (m, p) => void (await (await feeds[m]!.updateAnswer(p)).wait()),
      refresh: async () => {},
      setFunding: async (factor, max) => void (await (await env.engine.setFundingParams(factor, max)).wait()),
    };

    // ---- Solana ----
    await local.start();
    await local.setup();
    await local.send(
      [createSetAuthorityInstruction(local.usdc.publicKey, local.admin.publicKey, AuthorityType.MintTokens, local.pda("mint_authority"), [], TOKEN_2022_PROGRAM_ID)],
      [local.admin],
    );
    const kp = Keypair.generate();
    await local.airdrop(kp.publicKey, 10);
    const signer: SolanaSigner = {
      publicKey: kp.publicKey,
      signTransaction: async (tx: Transaction) => {
        tx.partialSign(kp);
        return tx;
      },
    };
    const writableMarkets = local.marketAccounts().map((a, i) => ({ ...a, isWritable: i % 2 === 0 }));
    sol = {
      name: "solana",
      chain: new SolanaChain({ rpcUrl: local.rpcUrl, idl: IDL, explorerTx: (s: string) => s, pollMs: 400 }, signer),
      owner: kp.publicKey.toBase58(),
      clpScale: 1n,
      setPrice: (m, p) => local.setPrice(m, p),
      refresh: () => local.refreshPrices(),
      setFunding: async (factor, max) => {
        const params = Object.fromEntries(
          PARAM_KEYS.map((k) => [k, k === "funding_factor_per_hour" ? factor : k === "max_funding_rate_per_hour" ? max : null]),
        );
        await local.send(
          [local.ix("set_params", { admin: local.admin.publicKey, config: local.pda("config"), pool: local.pda("pool") }, { params }, writableMarkets)],
          [local.admin],
        );
      },
    };

    // ---- one keeper, both chains ----
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
        intervals: { executorMs: 400, liquidatorMs: 60_000, fundingMs: 600_000, healthMs: 600_000 },
        logLevel: "warn",
      },
      log,
    );

    // Same starting point: 10,000 USDC each, pool approved (EVM), no funding during the lifecycle.
    await Promise.all([evm.chain.faucet(), sol.chain.faucet()]);
    await evm.chain.approve(2n ** 256n - 1n);
    await Promise.all([evm.setFunding(0n, 0n), sol.setFunding(0n, 0n)]);
  });

  after(async () => {
    await keeper?.stop();
    (evm?.chain as EvmChain | undefined)?.provider.destroy();
    env?.stop();
    local.stop();
  });

  it("starts from the same pool and balances", async () => {
    same("trader USDC", await usdc(evm), await usdc(sol));
    const [a, b] = await Promise.all([evm.chain.getPool(), sol.chain.getPool()]);
    same("AUM", a.aum, b.aum);
    same("pool amount", a.poolAmount, b.poolAmount);
    same("CLP price", a.clpPrice, b.clpPrice);
    for (const m of ["ETH-USD", "BTC-USD"] as const) {
      const [x, y] = await Promise.all([evm.chain.getMarketState(m), sol.chain.getMarketState(m)]);
      same(`${m} oracle price`, x.price!, y.price!);
    }
  });

  it("open ETH long 10x and BTC short 5x: identical fills and positions", async () => {
    await both("requestIncrease", { market: "ETH-USD", isLong: true, collateralDelta: 1_000n * USD, sizeDelta: 10_000n * USD, acceptablePrice: MAXP });
    await both("requestIncrease", { market: "BTC-USD", isLong: false, collateralDelta: 500n * USD, sizeDelta: 2_500n * USD, acceptablePrice: MINP });
    samePosition("ETH long", ...(await positions("ETH-USD", true)));
    samePosition("BTC short", ...(await positions("BTC-USD", false)));
    same("trader USDC after opens", await usdc(evm), await usdc(sol));
  });

  it("prices move (ETH +10%, BTC −5%): identical PnL, AUM and CLP price", async () => {
    await Promise.all([evm.setPrice("ETH-USD", 3_300n * PRICE), sol.setPrice("ETH-USD", 3_300n * PRICE)]);
    await Promise.all([evm.setPrice("BTC-USD", 57_000n * PRICE), sol.setPrice("BTC-USD", 57_000n * PRICE)]);
    samePosition("ETH long", ...(await positions("ETH-USD", true)));
    samePosition("BTC short", ...(await positions("BTC-USD", false)));
    const [a, b] = await Promise.all([evm.chain.getPool(), sol.chain.getPool()]);
    same("AUM", a.aum, b.aum);
    same("reserved", a.reserved, b.reserved);
    same("available", a.available, b.available);
    same("CLP price", a.clpPrice, b.clpPrice, 1n);
  });

  it("partial close of the ETH long with a collateral withdrawal: identical payout and remainder", async () => {
    const [before0, before1] = await Promise.all([usdc(evm), usdc(sol)]);
    await both("requestDecrease", { market: "ETH-USD", isLong: true, collateralDelta: 100n * USD, sizeDelta: 5_000n * USD, acceptablePrice: MINP });
    same("partial close payout", (await usdc(evm)) - before0, (await usdc(sol)) - before1);
    samePosition("ETH long after partial close", ...(await positions("ETH-USD", true)));
  });

  it("full close of the BTC short in profit: identical payout (profit + collateral − fees)", async () => {
    const [p] = await positions("BTC-USD", false);
    const [before0, before1] = await Promise.all([usdc(evm), usdc(sol)]);
    await both("requestDecrease", { market: "BTC-USD", isLong: false, collateralDelta: 0n, sizeDelta: p!.size, acceptablePrice: MAXP });
    const paid = same("full close payout", (await usdc(evm)) - before0, (await usdc(sol)) - before1);
    assert.ok(paid > 500n * USD, "a profitable short returns more than its collateral");
    const [a, b] = await positions("BTC-USD", false);
    assert.equal(a, undefined);
    assert.equal(b, undefined);
  });

  it("funding rates at identical open interest and AUM", async () => {
    await Promise.all([evm.setFunding(FUNDING.factor, FUNDING.max), sol.setFunding(FUNDING.factor, FUNDING.max)]);
    await Promise.all([evm.refresh(), sol.refresh()]);
    // A fresh Solana client: the trader's instance caches Config (funding params) for 15 s.
    const solReader = new SolanaChain({ rpcUrl: local.rpcUrl, idl: IDL, explorerTx: (s: string) => s });
    const [x, y] = await Promise.all([evm.chain.getMarketState("ETH-USD"), solReader.getMarketState("ETH-USD")]);
    same("ETH long OI", x.longSize, y.longSize);
    same("ETH short OI", x.shortSize, y.shortSize);
    same("ETH long funding rate", x.fundingRateLongPerHour, y.fundingRateLongPerHour);
    same("ETH short funding rate", x.fundingRateShortPerHour, y.fundingRateShortPerHour);
    assert.ok(x.fundingRateLongPerHour > 0n && x.fundingRateShortPerHour === 0n, "only the heavier (long) side pays");
    same("ETH long capacity", x.longCapacity, y.longCapacity);
  });

  it("LP deposit: identical CLP (to 1 unit after scaling) and AUM", async () => {
    const [clp0, clp1] = await Promise.all([evm.chain.getClpBalance(evm.owner), sol.chain.getClpBalance(sol.owner)]);
    await Promise.all([evm.refresh(), sol.refresh()]);
    await Promise.all([evm.chain.addLiquidity(1_000n * USD, 0n), sol.chain.addLiquidity(1_000n * USD, 0n)]);
    const mintedEvm = ((await evm.chain.getClpBalance(evm.owner)) - clp0) / evm.clpScale;
    const mintedSol = ((await sol.chain.getClpBalance(sol.owner)) - clp1) / sol.clpScale;
    same("CLP minted (6-dec units)", mintedEvm, mintedSol, 1n);
    await Promise.all([evm.refresh(), sol.refresh()]);
    const [a, b] = await Promise.all([evm.chain.getPool(), sol.chain.getPool()]);
    same("AUM after deposit", a.aum, b.aum);
    same("trader USDC at the end", await usdc(evm), await usdc(sol));
  });
});
