// Solana devnet implementation of `PerpsChain` (the `celestial_perps` Anchor program).
//
// Reads: one batched getMultipleAccountsInfo (Config, Pool, CLP mint, every market + oracle,
// the Clock sysvar) → market state, AUM, capacity, funding and CLP price are computed with
// lib/perpMath exactly as the program computes them. (The program's `get_*` views need a funded
// fee payer to simulate; a visitor without a wallet has none, so the UI computes the same numbers
// from the accounts. test/ cross-checks both against each other.)
//
// Writes: instructions are encoded from the IDL, signed by the connected wallet
// (Wallet Standard `solana:signTransaction`, or signAndSend as a fallback) and sent through the
// app's own devnet Connection. Confirmation polls signature status with backoff; reads use
// `minContextSlot` so a lagging RPC node never shows state older than the app's own last tx.

import * as anchorNs from "@anchor-lang/core";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  type AccountInfo,
  type AccountMeta,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SendTransactionError,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";
import { Buffer } from "buffer";

import IDL from "@/src/idl/celestial_perps.json";
import type { MarketId } from "@/lib/marketData";
import {
  BPS,
  fundingOwed as fundingOwedMath,
  fundingRatePerHour,
  liquidationPrice as liqPriceMath,
  mulDivFloor,
  pnl as pnlMath,
  positionFee,
} from "@/lib/perpMath";

import { isUserRejection, messageFor } from "./errors";
import { readOraclePrice } from "./solanaOracle";
import {
  ChainError,
  type HistoryItem,
  type MarketState,
  type OrderParams,
  type OrderUpdate,
  type PendingRequest,
  type PerpsChain,
  type PoolState,
  type Position,
  type OpsStatus,
  type ProtocolParams,
  type TxResult,
} from "./types";

const { BorshCoder } = anchorNs;

export type SolanaSigner = {
  publicKey: PublicKey;
  /** preferred: sign only; the app sends through its own devnet connection */
  signTransaction?: (tx: Transaction) => Promise<Transaction>;
  /** fallback for wallets without signTransaction: the wallet sends (on solana:devnet) */
  signAndSendTransaction?: (tx: Transaction) => Promise<string>;
};

export type SolanaChainConfig = {
  rpcUrl: string;
  idl: any;
  /** explorer link builder */
  explorerTx: (sig: string) => string;
  pollMs?: number;
};

export const DEVNET_CONFIG: SolanaChainConfig = {
  rpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
  idl: IDL,
  explorerTx: (sig) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`,
};

const FAUCET_COOLDOWN = 86_400;
const MAX = 2n ** 256n - 1n;

type Snapshot = {
  now: bigint;
  config: any;
  pool: any;
  clpSupply: bigint;
  markets: { key: PublicKey; symbol: MarketId; data: any; price: bigint | null; updatedAt: number | null; issue?: string }[];
  aum: bigint | null;
};

const big = (v: { toString(): string } | bigint | number): bigint => (typeof v === "bigint" ? v : BigInt(v.toString()));

export class SolanaChain implements PerpsChain {
  readonly id = "solana-devnet" as const;
  readonly nativeSymbol = "SOL" as const;
  readonly nativeDecimals = 9;
  readonly connection: Connection;
  readonly programId: PublicKey;
  private coder: InstanceType<typeof BorshCoder>;
  private disc: Record<string, string> = {};
  private minSlot = 0;
  /** Varies each transaction's compute-unit limit, see `send`. */
  private txSalt = Math.floor(Math.random() * 1000);
  private configCache?: { at: number; value: any };

  constructor(
    readonly cfg: SolanaChainConfig,
    private signer?: SolanaSigner,
  ) {
    this.connection = new Connection(cfg.rpcUrl, {
      commitment: "confirmed",
      disableRetryOnRateLimit: true,
      // A hung RPC (public devnet sometimes never answers getMultipleAccounts) must surface as
      // an error the UI can show and retry, not a request that never settles.
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }),
    });
    this.coder = new BorshCoder(cfg.idl);
    this.programId = new PublicKey(cfg.idl.address);
    for (const a of cfg.idl.accounts ?? []) this.disc[a.name] = anchorNs.utils.bytes.bs58.encode(Buffer.from(a.discriminator));
  }

  supports(_market: MarketId) {
    return true; // SOL-USD, BTC-USD and ETH-USD are all listed on Solana
  }

  explorerTx(sig: string) {
    return this.cfg.explorerTx(sig);
  }

  // ── PDAs ──
  private pda = (...seeds: (Buffer | Uint8Array | string)[]) =>
    PublicKey.findProgramAddressSync(seeds.map((s) => (typeof s === "string" ? Buffer.from(s) : s)), this.programId)[0];
  configPda = () => this.pda("config");
  poolPda = () => this.pda("pool");
  vaultPda = () => this.pda("vault");
  clpMintPda = () => this.pda("clp_mint");
  mintAuthorityPda = () => this.pda("mint_authority");
  marketPda = (symbol: string) => this.pda("market", symbol);
  userStatePda = (owner: PublicKey) => this.pda("user", owner.toBuffer());
  requestPda = (owner: PublicKey, nonce: bigint) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(nonce);
    return this.pda("request", owner.toBuffer(), b);
  };
  positionPda = (owner: PublicKey, market: PublicKey, isLong: boolean) =>
    this.pda("position", owner.toBuffer(), market.toBuffer(), Buffer.from([isLong ? 1 : 0]));

  private decode(type: string, info: AccountInfo<Uint8Array> | null): any | null {
    return info && info.data.length > 0 ? this.coder.accounts.decode(type, Buffer.from(info.data)) : null;
  }

  private seen(slot?: number) {
    if (slot && slot > this.minSlot) this.minSlot = slot;
  }

  private async accounts(keys: PublicKey[]) {
    const { context, value } = await this.connection.getMultipleAccountsInfoAndContext(keys, {
      commitment: "confirmed",
      minContextSlot: this.minSlot || undefined,
    });
    this.seen(context.slot);
    return value;
  }

  private async getConfig(): Promise<any> {
    if (this.configCache && Date.now() - this.configCache.at < 15_000) return this.configCache.value;
    const [info] = await this.accounts([this.configPda()]);
    const value = this.decode("Config", info);
    if (!value) throw new ChainError("Perps program not initialised on this cluster.");
    this.configCache = { at: Date.now(), value };
    return value;
  }

  /** Everything the read views need, in one RPC call, with the program's AUM logic. */
  private async snapshot(): Promise<Snapshot> {
    const config = await this.getConfig();
    const marketKeys: PublicKey[] = config.markets;
    const marketInfos = await this.accounts([this.poolPda(), this.clpMintPda(), SYSVAR_CLOCK_PUBKEY, ...marketKeys]);
    const [poolInfo, clpInfo, clockInfo] = marketInfos;
    const pool = this.decode("Pool", poolInfo);
    const now = Buffer.from(clockInfo!.data).readBigInt64LE(32);
    const clpSupply = clpInfo ? Buffer.from(clpInfo.data).readBigUInt64LE(36) : 0n;
    const marketData = marketKeys.map((_, i) => this.decode("Market", marketInfos[3 + i]));
    const oracleInfos = await this.accounts(marketData.map((m) => m.oracle));

    const markets = marketKeys.map((key, i) => {
      const data = marketData[i];
      const read = readOraclePrice(oracleInfos[i], this.programId, now, big(data.max_age));
      return { key, symbol: data.symbol as MarketId, data, price: read.price, updatedAt: read.updatedAt, issue: read.issue };
    });

    // AUM = max(0, pool_amount − Σ net trader PnL); markets without OI are skipped (no oracle read).
    let net = 0n;
    let aumKnown = true;
    for (const m of markets) {
      const longSize = big(m.data.long_size);
      const shortSize = big(m.data.short_size);
      if (longSize === 0n && shortSize === 0n) continue;
      if (m.price === null) {
        aumKnown = false;
        break;
      }
      const marketPnl = pnlMath(true, longSize, big(m.data.long_tokens), m.price) + pnlMath(false, shortSize, big(m.data.short_tokens), m.price);
      const floor = -(big(m.data.long_collateral) + big(m.data.short_collateral));
      net += marketPnl > floor ? marketPnl : floor;
    }
    const aumRaw = big(pool.pool_amount) - net;
    return { now, config, pool, clpSupply, markets, aum: aumKnown ? (aumRaw > 0n ? aumRaw : 0n) : null };
  }

  // ═══════════════════════ reads ═══════════════════════

  async getParams(): Promise<ProtocolParams> {
    const [config, [poolInfo], rent] = await Promise.all([
      this.getConfig(),
      this.accounts([this.poolPda()]),
      this.connection.getMinimumBalanceForRentExemption(this.positionSpace()),
    ]);
    const pool = this.decode("Pool", poolInfo);
    return {
      maxLeverage: big(config.max_leverage),
      maintenanceMarginBps: big(config.maintenance_margin_bps),
      positionFeeBps: big(config.position_fee_bps),
      executionSpreadBps: big(config.execution_spread_bps),
      minCollateral: big(config.min_collateral),
      paused: config.paused,
      requestExpiry: Number(big(config.request_expiry)),
      minExecutionFee: big(config.min_execution_fee_lamports),
      positionRent: BigInt(rent),
      maxProfitMultiplier: big(config.max_profit_multiplier),
      oiCapBps: big(config.oi_cap_bps),
      liquidationFeeBps: big(config.liquidation_fee_bps),
      lpMintFeeBps: big(pool.lp_mint_fee_bps),
      lpCooldown: Number(big(pool.lp_cooldown)),
    };
  }

  /** 8-byte discriminator + Position fields (see state.rs; InitSpace). */
  private positionSpace() {
    return 8 + 32 + 32 + 1 + 8 + 8 + 16 + 8 + 16 + 8 + 1;
  }

  async getMarkets(): Promise<MarketId[]> {
    const s = await this.snapshot();
    return s.markets.map((m) => m.symbol);
  }

  async getMarketState(market: MarketId): Promise<MarketState> {
    const s = await this.snapshot();
    const m = s.markets.find((x) => x.symbol === market);
    if (!m) throw new ChainError(`${market} is not listed on Solana.`, "MarketNotListed");
    const longSize = big(m.data.long_size);
    const shortSize = big(m.data.short_size);
    const cap = s.aum === null ? null : mulDivFloor(s.aum, big(s.config.oi_cap_bps), BPS);
    const rate =
      s.aum === null
        ? 0n
        : fundingRatePerHour(longSize, shortSize, s.aum, big(s.config.funding_factor_per_hour), big(s.config.max_funding_rate_per_hour));
    return {
      market,
      enabled: m.data.enabled,
      price: m.price,
      priceUpdatedAt: m.updatedAt,
      priceIssue: m.issue,
      longSize,
      shortSize,
      longCapacity: cap === null ? 0n : cap > longSize ? cap - longSize : 0n,
      shortCapacity: cap === null ? 0n : cap > shortSize ? cap - shortSize : 0n,
      fundingRateLongPerHour: longSize > shortSize ? rate : 0n,
      fundingRateShortPerHour: shortSize > longSize ? rate : 0n,
      cumFundingLong: big(m.data.cum_funding_long),
      cumFundingShort: big(m.data.cum_funding_short),
    };
  }

  async getPool(): Promise<PoolState> {
    const s = await this.snapshot();
    const poolAmount = big(s.pool.pool_amount);
    const reserved = big(s.pool.reserved_amount);
    const aum = s.aum ?? 0n;
    return {
      aum,
      poolAmount,
      reserved,
      available: poolAmount - reserved,
      clpSupply: s.clpSupply,
      clpDecimals: 6,
      clpPrice: s.clpSupply === 0n ? 100_000_000n : mulDivFloor(aum, 100_000_000n, s.clpSupply),
    };
  }

  private async tokenBalance(mint: PublicKey, owner: string): Promise<bigint> {
    const ata = getAssociatedTokenAddressSync(mint, new PublicKey(owner), true, TOKEN_2022_PROGRAM_ID);
    const [info] = await this.accounts([ata]);
    return info ? Buffer.from(info.data).readBigUInt64LE(64) : 0n;
  }

  async getUsdcBalance(owner: string) {
    const config = await this.getConfig();
    return this.tokenBalance(config.usdc_mint, owner);
  }

  getClpBalance(owner: string) {
    return this.tokenBalance(this.clpMintPda(), owner);
  }

  async getNativeBalance(owner: string) {
    return BigInt(await this.connection.getBalance(new PublicKey(owner), "confirmed"));
  }

  async getAllowance() {
    return MAX; // SPL transfers are signed by the owner in the same transaction: no approval step
  }

  async getPositions(owner: string): Promise<Position[]> {
    const ownerPk = new PublicKey(owner);
    const s = await this.snapshot();
    const slots = s.markets.flatMap((m) => [true, false].map((isLong) => ({ m, isLong, pda: this.positionPda(ownerPk, m.key, isLong) })));
    const infos = await this.accounts(slots.map((x) => x.pda));
    const feeBps = big(s.config.position_fee_bps);
    const mm = big(s.config.maintenance_margin_bps);
    const out: Position[] = [];
    slots.forEach(({ m, isLong, pda }, i) => {
      const p = this.decode("Position", infos[i]);
      if (!p || big(p.size) === 0n) return;
      const size = big(p.size);
      const tokens = big(p.tokens);
      const collateral = big(p.collateral);
      const reserved = big(p.reserved);
      const funding = fundingOwedMath(size, big(isLong ? m.data.cum_funding_long : m.data.cum_funding_short), big(p.entry_funding_index));
      const closeFee = positionFee(size, feeBps);
      const rawPnl = m.price !== null ? pnlMath(isLong, size, tokens, m.price) : null;
      out.push({
        id: pda.toBase58(),
        market: m.symbol,
        isLong,
        size,
        collateral,
        tokens,
        reserved,
        entryPrice: tokens > 0n ? (size * 10n ** 20n) / tokens : 0n,
        markPrice: m.price,
        pnl: rawPnl,
        fundingOwed: funding,
        closeFee,
        netPnl: rawPnl === null ? null : (rawPnl > reserved ? reserved : rawPnl) - closeFee - funding,
        liquidationPrice: liqPriceMath(isLong, size, tokens, collateral, funding, closeFee, mm),
        lastUpdated: Number(big(p.last_updated)),
      });
    });
    return out;
  }

  async getPendingRequests(owner: string): Promise<PendingRequest[]> {
    const config = await this.getConfig();
    const symbols = await this.symbolMap();
    const res = await this.connection.getProgramAccounts(this.programId, {
      commitment: "confirmed",
      minContextSlot: this.minSlot || undefined,
      filters: [{ memcmp: { offset: 0, bytes: this.disc.Request } }, { memcmp: { offset: 8, bytes: owner } }],
    });
    const expiry = Number(big(config.request_expiry));
    return res
      .map(({ pubkey, account }) => {
        const r = this.coder.accounts.decode("Request", Buffer.from(account.data));
        const createdAt = Number(big(r.created_at));
        return {
          id: pubkey.toBase58(),
          kind: "Increase" in r.kind ? ("increase" as const) : ("decrease" as const),
          market: symbols.get(r.market.toBase58()) ?? ("SOL-USD" as MarketId),
          isLong: r.is_long,
          collateralDelta: big(r.collateral_delta),
          sizeDelta: big(r.size_delta),
          acceptablePrice: big(r.acceptable_price),
          executionFee: big(r.execution_fee),
          createdAt,
          cancellableAt: createdAt + expiry,
        };
      })
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async getOpsStatus(): Promise<OpsStatus> {
    const [config, requests] = await Promise.all([
      this.getConfig(),
      this.connection.getProgramAccounts(this.programId, {
        commitment: "confirmed",
        minContextSlot: this.minSlot || undefined,
        filters: [{ memcmp: { offset: 0, bytes: this.disc.Request } }],
      }),
    ]);
    const keeperKeys = (config.keepers as PublicKey[]).filter((k) => !k.equals(PublicKey.default));
    const [clock, ...keeperInfos] = await this.accounts([SYSVAR_CLOCK_PUBKEY, ...keeperKeys]);
    const created = requests.map(({ account }) => Number(big(this.coder.accounts.decode("Request", Buffer.from(account.data)).created_at)));
    return {
      now: Number(Buffer.from(clock!.data).readBigInt64LE(32)),
      paused: !!config.paused,
      pendingCount: created.length,
      oldestPendingAt: created.length ? Math.min(...created) : null,
      pendingComplete: true,
      keepers: keeperKeys.map((k, i) => ({ address: k.toBase58(), balance: BigInt(keeperInfos[i]?.lamports ?? 0), active: true })),
    };
  }

  private async symbolMap(): Promise<Map<string, MarketId>> {
    const config = await this.getConfig();
    const keys: PublicKey[] = config.markets;
    const infos = await this.accounts(keys);
    return new Map(keys.map((k, i) => [k.toBase58(), this.decode("Market", infos[i])?.symbol as MarketId]));
  }

  async faucetStatus(owner: string) {
    const [info] = await this.accounts([this.userStatePda(new PublicKey(owner))]);
    const st = this.decode("UserState", info);
    const last = st ? Number(big(st.last_faucet_at)) : 0;
    const next = last === 0 ? 0 : last + FAUCET_COOLDOWN;
    const now = Math.floor(Date.now() / 1000);
    return { canClaim: next <= now, nextClaimAt: next > now ? next : null };
  }

  async lpAvailableAt(owner: string) {
    const [info, poolInfo] = await this.accounts([this.userStatePda(new PublicKey(owner)), this.poolPda()]);
    const st = this.decode("UserState", info);
    const pool = this.decode("Pool", poolInfo);
    const last = st ? Number(big(st.last_lp_add_at)) : 0;
    return last === 0 ? 0 : last + Number(big(pool.lp_cooldown));
  }

  /** FeesAdded.to_pool from recent program transactions touching the pool (newest first). */
  async getFeesToPool(since: number): Promise<{ amount: bigint; complete: boolean }> {
    let amount = 0n;
    let before: string | undefined;
    for (let page = 0; page < 5; page++) {
      const sigs = await this.connection.getSignaturesForAddress(this.poolPda(), { limit: 100, before }, "confirmed");
      if (sigs.length === 0) return { amount, complete: true };
      const inWindow = sigs.filter((s) => !s.err && (s.blockTime ?? 0) >= since);
      for (let i = 0; i < inWindow.length; i += 10) {
        const txs = await this.transactions(inWindow.slice(i, i + 10).map((s) => s.signature));
        for (const tx of txs) {
          for (const ev of this.eventsFromLogs(tx?.meta?.logMessages ?? [])) if (ev.name === "FeesAdded") amount += big(ev.data.to_pool);
        }
      }
      if ((sigs[sigs.length - 1].blockTime ?? 0) < since) return { amount, complete: true };
      before = sigs[sigs.length - 1].signature;
    }
    return { amount, complete: false };
  }

  // ── history: the owner signs every request and is an account in every fill/liquidation ──

  async getHistory(owner: string, opts: { limit?: number } = {}): Promise<HistoryItem[]> {
    const ownerPk = new PublicKey(owner);
    const limit = opts.limit ?? 50;
    const symbols = await this.symbolMap();
    const sigs = (await this.connection.getSignaturesForAddress(ownerPk, { limit }, "confirmed")).filter((s) => !s.err);
    const items: HistoryItem[] = [];
    // Small batches keep public RPCs happy.
    for (let i = 0; i < sigs.length; i += 10) {
      const chunk = sigs.slice(i, i + 10);
      const txs = await this.transactions(chunk.map((s) => s.signature));
      txs.forEach((tx, j) => {
        if (!tx?.meta?.logMessages?.some((l) => l.includes(this.programId.toBase58()))) return;
        const inTx: HistoryItem[] = [];
        let idx = 0;
        for (const ev of this.eventsFromLogs(tx.meta.logMessages)) {
          const item = this.toHistory(ev, chunk[j].signature, tx.blockTime ?? null, idx++, ownerPk, symbols);
          if (item) inTx.push(item);
        }
        items.push(...inTx.reverse());
      });
    }
    // Signatures come newest-first and each transaction's events were reversed above, so `items`
    // is newest-first in exact chain order (a timestamp sort would misorder same-second events).
    return items;
  }

  /**
   * Transactions by signature, one request each, 3 at a time. (`getTransactions` sends a JSON-RPC
   * batch, which many hosted RPC plans reject with 413 / -32413.) Retries a request on rate limits.
   */
  private async transactions(sigs: string[]) {
    const out: Awaited<ReturnType<Connection["getTransaction"]>>[] = new Array(sigs.length).fill(null);
    for (let i = 0; i < sigs.length; i += 3) {
      await Promise.all(
        sigs.slice(i, i + 3).map(async (sig, j) => {
          for (let attempt = 0; attempt < 4; attempt++) {
            try {
              out[i + j] = await this.connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
              return;
            } catch (e) {
              if (!/429|413|Too many requests/i.test(String((e as Error).message)) || attempt === 3) throw e;
              await sleep(500 * 2 ** attempt);
            }
          }
        }),
      );
    }
    return out;
  }

  private eventsFromLogs(logs: string[]): { name: string; data: any }[] {
    const out: { name: string; data: any }[] = [];
    for (const l of logs) {
      const m = l.match(/^Program data: (.+)$/);
      if (!m) continue;
      try {
        const e = this.coder.events.decode(m[1]);
        if (e) out.push({ name: e.name, data: e.data });
      } catch {
        /* not ours */
      }
    }
    return out;
  }

  private toHistory(ev: { name: string; data: any }, tx: string, time: number | null, idx: number, owner: PublicKey, symbols: Map<string, MarketId>): HistoryItem | null {
    const d = ev.data;
    const mine = (k?: PublicKey) => !!k && k.equals(owner);
    const base = { key: `${tx}:${idx}`, tx, time, event: ev.name as HistoryItem["event"] };
    const market = d.market ? symbols.get(d.market.toBase58()) : undefined;
    switch (ev.name) {
      case "RequestCreated":
        return mine(d.owner) ? { ...base, requestId: d.request.toBase58(), market, isLong: d.is_long, sizeDelta: big(d.size_delta), collateralDelta: big(d.collateral_delta) } : null;
      case "RequestExecuted":
        return mine(d.owner) ? { ...base, requestId: d.request.toBase58() } : null;
      case "RequestCancelled":
        return mine(d.owner) ? { ...base, requestId: d.request.toBase58(), reason: Object.keys(d.reason)[0] } : null;
      case "PositionIncreased":
        return mine(d.owner)
          ? { ...base, market, isLong: d.is_long, sizeDelta: big(d.size_delta), collateralDelta: big(d.collateral_delta), executionPrice: big(d.execution_price), fee: big(d.fee), fundingPaid: big(d.funding_paid) }
          : null;
      case "PositionDecreased":
        return mine(d.owner)
          ? {
              ...base,
              market,
              isLong: d.is_long,
              sizeDelta: big(d.size_delta),
              collateralDelta: big(d.collateral_out),
              executionPrice: big(d.execution_price),
              realisedPnl: big(d.realised_pnl),
              fee: big(d.fee),
              fundingPaid: big(d.funding_paid),
            }
          : null;
      case "PositionClosed":
        return mine(d.owner) ? { ...base, market, isLong: d.is_long } : null;
      case "PositionLiquidated":
        return mine(d.owner) ? { ...base, market, isLong: d.is_long, sizeDelta: big(d.size), collateralDelta: big(d.collateral), executionPrice: big(d.price), fee: big(d.keeper_fee) } : null;
      case "LiquidityAdded":
        return mine(d.owner) ? { ...base, amount: big(d.amount), fee: big(d.fee) } : null;
      case "LiquidityRemoved":
        return mine(d.owner) ? { ...base, amount: big(d.amount_out) } : null;
      case "FaucetClaimed":
        return mine(d.user) ? { ...base, amount: big(d.amount) } : null;
      default:
        return null;
    }
  }

  // ═══════════════════════ writes ═══════════════════════

  private ix(name: string, accounts: Record<string, PublicKey>, args: Record<string, unknown> = {}, remaining: AccountMeta[] = []) {
    const def = this.cfg.idl.instructions.find((i: any) => i.name === name);
    if (!def) throw new ChainError(`Unknown instruction ${name}`);
    const keys: AccountMeta[] = def.accounts.map((a: any) => {
      const pubkey = accounts[a.name] ?? (a.address ? new PublicKey(a.address) : undefined);
      if (!pubkey) throw new ChainError(`${name}: missing account ${a.name}`);
      return { pubkey, isSigner: !!a.signer, isWritable: !!a.writable };
    });
    const encoded = Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === "bigint" ? new BN(v.toString()) : v]));
    return new TransactionInstruction({ programId: this.programId, keys: [...keys, ...remaining], data: this.coder.instruction.encode(name, encoded) });
  }

  private async marketAccounts(): Promise<AccountMeta[]> {
    const config = await this.getConfig();
    const keys: PublicKey[] = config.markets;
    const infos = await this.accounts(keys);
    return keys.flatMap((k, i) => [
      { pubkey: k, isSigner: false, isWritable: false },
      { pubkey: this.decode("Market", infos[i]).oracle as PublicKey, isSigner: false, isWritable: false },
    ]);
  }

  private owner(): PublicKey {
    if (!this.signer) throw new ChainError("Connect a wallet first.", "NoWallet");
    return this.signer.publicKey;
  }

  /** Sign with the wallet, send via our connection (preflight on), confirm by polling. */
  private async send(ixs: TransactionInstruction[], computeUnits = 200_000): Promise<string> {
    const signer = this.signer;
    if (!signer) throw new ChainError("Connect a wallet first.", "NoWallet");
    // A finalized blockhash: every RPC node knows it, so the wallet's own simulation (run on the
    // wallet's RPC, which may lag the app's) doesn't fail with "blockhash not found" and show a
    // misleading "not enough SOL" warning. Still valid for ~60 s — plenty for an approval.
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("finalized");
    // The finalized blockhash stays the same for several seconds, so two identical actions in a row
    // (a repeated faucet claim, the same deposit twice) would be byte-identical and the second one
    // rejected as "already processed". A different compute-unit limit per transaction keeps each one
    // unique; with no priority fee the limit doesn't change the fee.
    this.txSalt = (this.txSalt + 1) % 1000;
    const tx = new Transaction({ feePayer: signer.publicKey, blockhash, lastValidBlockHeight }).add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits + this.txSalt }),
      ...ixs,
    );
    let sig: string;
    try {
      if (signer.signTransaction) {
        const signed = await signer.signTransaction(tx);
        sig = await this.connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 5 });
      } else if (signer.signAndSendTransaction) {
        sig = await signer.signAndSendTransaction(tx);
      } else {
        throw new ChainError("This wallet cannot sign Solana transactions.", "NoSigner");
      }
    } catch (e) {
      throw await this.decodeError(e);
    }
    await this.confirm(sig, lastValidBlockHeight);
    return sig;
  }

  private async confirm(sig: string, lastValidBlockHeight: number) {
    let delay = 400;
    const deadline = Date.now() + 90_000;
    for (let poll = 1; Date.now() < deadline; poll++) {
      try {
        const st = (await this.connection.getSignatureStatuses([sig])).value[0];
        if (st?.err) throw new ChainError(`Transaction failed: ${JSON.stringify(st.err)}`, "Failed");
        if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) {
          this.seen(st.slot);
          return;
        }
        if (!st && poll % 5 === 0 && (await this.connection.getBlockHeight("confirmed")) > lastValidBlockHeight) {
          throw new ChainError("Transaction expired before it landed — try again.", "Expired");
        }
        delay = 400;
      } catch (e) {
        if (e instanceof ChainError) throw e;
        delay = Math.min(4_000, delay * 2); // RPC error / rate limit: back off
      }
      await sleep(delay);
    }
    throw new ChainError("Not confirmed yet — check the explorer; the page refreshes when it lands.", "Timeout");
  }

  async decodeError(e: unknown): Promise<ChainError> {
    if (e instanceof ChainError) return e;
    if (isUserRejection(e)) return new ChainError(messageFor("UserRejected"), "UserRejected");
    let logs: string[] = [];
    if (e instanceof SendTransactionError) {
      try {
        logs = (await e.getLogs(this.connection)) ?? [];
      } catch {
        logs = e.logs ?? [];
      }
    }
    return this.errorFrom(String((e as Error)?.message ?? e), logs);
  }

  /** Readable error from an RPC / simulation message and its program logs. */
  private errorFrom(msg: string, logs: string[]): ChainError {
    const named = logs.map((l) => l.match(/Error Code: (\w+)/)?.[1]).find(Boolean) ?? msg.match(/Error Code: (\w+)/)?.[1];
    if (named) return new ChainError(messageFor(named), named);
    const custom = msg.match(/custom program error: 0x([0-9a-f]+)/i);
    if (custom) {
      const code = parseInt(custom[1], 16);
      const err = this.cfg.idl.errors?.find((x: any) => x.code === code);
      if (err) return new ChainError(messageFor(err.name), err.name);
    }
    if (/Blockhash not found|block height exceeded|expired/i.test(msg)) {
      return new ChainError("The network moved on before the transaction was sent — please try again.", "Expired");
    }
    if (/insufficient (lamports|funds)|no record of a prior credit/i.test(msg + logs.join(" "))) {
      return new ChainError("Not enough SOL for fees and rent.", "InsufficientFunds");
    }
    return new ChainError(msg.replace(/https?:\/\/\S+/g, "").slice(0, 200) || "Transaction failed.");
  }

  async approve(): Promise<TxResult> {
    return { tx: "" };
  }

  async faucet(): Promise<TxResult> {
    const owner = this.owner();
    const config = await this.getConfig();
    const tx = await this.send([
      this.ix("faucet", {
        user: owner,
        config: this.configPda(),
        user_state: this.userStatePda(owner),
        usdc_mint: config.usdc_mint,
        mint_authority: this.mintAuthorityPda(),
        user_usdc: getAssociatedTokenAddressSync(config.usdc_mint, owner, true, config.token_program),
        token_program: config.token_program,
        associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
        system_program: SystemProgram.programId,
      }),
    ]);
    return { tx };
  }

  private async nextNonce(owner: PublicKey): Promise<bigint> {
    const [info] = await this.accounts([this.userStatePda(owner)]);
    const st = this.decode("UserState", info);
    return st ? big(st.request_nonce) : 0n;
  }

  private async request(kind: "request_increase" | "request_decrease", p: OrderParams): Promise<TxResult> {
    const owner = this.owner();
    const config = await this.getConfig();
    const market = this.marketPda(p.market);
    const nonce = await this.nextNonce(owner);
    const request = this.requestPda(owner, nonce);
    const ownerUsdc = getAssociatedTokenAddressSync(config.usdc_mint, owner, true, config.token_program);
    const ixs: TransactionInstruction[] = [];
    if (kind === "request_increase") {
      // The escrow transfer needs the trader's USDC account (created by the faucet, but not always).
      ixs.push(createAssociatedTokenAccountIdempotentInstruction(owner, ownerUsdc, owner, config.usdc_mint, config.token_program));
    }
    ixs.push(
      this.ix(
        kind,
        {
          owner,
          config: this.configPda(),
          pool: this.poolPda(),
          vault: this.vaultPda(),
          usdc_mint: config.usdc_mint,
          owner_usdc: ownerUsdc,
          market,
          position: this.positionPda(owner, market, p.isLong),
          user_state: this.userStatePda(owner),
          request,
          token_program: config.token_program,
          system_program: SystemProgram.programId,
        },
        {
          nonce,
          is_long: p.isLong,
          collateral_delta: p.collateralDelta,
          size_delta: p.sizeDelta,
          acceptable_price: p.acceptablePrice,
          execution_fee: big(config.min_execution_fee_lamports),
        },
      ),
    );
    const tx = await this.send(ixs);
    return { tx, requestId: request.toBase58() };
  }

  requestIncrease(p: OrderParams) {
    return this.request("request_increase", p);
  }

  requestDecrease(p: OrderParams) {
    return this.request("request_decrease", p);
  }

  async cancel(requestId: string): Promise<TxResult> {
    const owner = this.owner();
    const config = await this.getConfig();
    const tx = await this.send([
      this.ix("cancel_request", {
        owner,
        config: this.configPda(),
        pool: this.poolPda(),
        vault: this.vaultPda(),
        usdc_mint: config.usdc_mint,
        owner_usdc: getAssociatedTokenAddressSync(config.usdc_mint, owner, true, config.token_program),
        request: new PublicKey(requestId),
        token_program: config.token_program,
      }),
    ]);
    return { tx, requestId };
  }

  private async lpAccounts(owner: PublicKey) {
    const config = await this.getConfig();
    return {
      user: owner,
      config: this.configPda(),
      pool: this.poolPda(),
      vault: this.vaultPda(),
      clp_mint: this.clpMintPda(),
      usdc_mint: config.usdc_mint,
      user_usdc: getAssociatedTokenAddressSync(config.usdc_mint, owner, true, config.token_program),
      user_clp: getAssociatedTokenAddressSync(this.clpMintPda(), owner, true, config.token_program),
      user_state: this.userStatePda(owner),
      token_program: config.token_program,
      associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
      system_program: SystemProgram.programId,
    };
  }

  async addLiquidity(amount: bigint, minClp: bigint): Promise<TxResult> {
    const owner = this.owner();
    const tx = await this.send([this.ix("add_liquidity", await this.lpAccounts(owner), { amount, min_clp: minClp }, await this.marketAccounts())], 300_000);
    return { tx };
  }

  async removeLiquidity(clp: bigint, minUsdc: bigint): Promise<TxResult> {
    const owner = this.owner();
    const tx = await this.send([this.ix("remove_liquidity", await this.lpAccounts(owner), { clp_amount: clp, min_usdc: minUsdc }, await this.marketAccounts())], 300_000);
    return { tx };
  }

  /** Poll until the Request account is closed, then read the fill from the closing transaction. */
  async trackRequest(requestId: string, tx: string, onUpdate: (u: OrderUpdate) => void, signal?: AbortSignal): Promise<OrderUpdate> {
    const since = Date.now();
    const request = new PublicKey(requestId);
    onUpdate({ status: "pending", requestId, tx, since });
    let delay = this.cfg.pollMs ?? 1_500;
    while (!signal?.aborted) {
      try {
        const [info] = await this.accounts([request]);
        if (!info || info.data.length === 0) {
          const update = await this.settlement(request, tx);
          onUpdate(update);
          return update;
        }
        delay = this.cfg.pollMs ?? 1_500;
      } catch {
        delay = Math.min(8_000, delay * 2);
      }
      await sleep(delay, signal);
    }
    return { status: "failed", error: "stopped tracking" };
  }

  private async settlement(request: PublicKey, createTx: string): Promise<OrderUpdate> {
    const requestId = request.toBase58();
    for (let attempt = 0; attempt < 6; attempt++) {
      const sigs = await this.connection.getSignaturesForAddress(request, { limit: 5 }, "confirmed").catch(() => []);
      const fill = sigs.find((s) => s.signature !== createTx && !s.err);
      if (fill) {
        const t = await this.connection.getTransaction(fill.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
        const events = this.eventsFromLogs(t?.meta?.logMessages ?? []);
        const cancelled = events.find((e) => e.name === "RequestCancelled" && e.data.request.equals(request));
        if (cancelled) return { status: "cancelled", requestId, tx: fill.signature, reason: Object.keys(cancelled.data.reason)[0] };
        const executed = events.find((e) => e.name === "RequestExecuted" && e.data.request.equals(request));
        if (executed) {
          // In a batch, the position event just before this request's RequestExecuted is its fill.
          const i = events.indexOf(executed);
          const pos = [...events.slice(0, i)].reverse().find((e) => e.name === "PositionIncreased" || e.name === "PositionDecreased");
          return { status: "filled", requestId, tx: fill.signature, executionPrice: pos ? big(pos.data.execution_price) : undefined, fee: pos ? big(pos.data.fee) : undefined };
        }
      }
      await sleep(500 * (attempt + 1));
    }
    return { status: "filled", requestId }; // account closed; details not yet indexed by the RPC
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });
