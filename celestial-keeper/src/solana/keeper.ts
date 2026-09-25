/**
 * Solana (devnet) keeper for the `celestial_perps` Anchor program.
 *
 * - Pending requests / open positions: one `getProgramAccounts` per tick, filtered on the
 *   account discriminator from the IDL.
 * - Every `execute_request` / `liquidate` / `update_funding` carries all markets + oracles as
 *   remaining accounts in `Config.markets` order (read on chain), the affected market writable.
 * - Several `execute_request`s go in one transaction. A business failure cancels the request
 *   inside the program (the transaction still succeeds), so a failing batch means an account
 *   problem: it is retried one request at a time and the bad request is backed off.
 * - A request can never execute twice: its account is closed on execute/cancel, so a duplicate
 *   transaction fails validation. After any send whose outcome is unknown, the next tick
 *   re-reads the pending set before sending again.
 * - Confirmation polls `getSignatureStatuses` (no websocket), which works through flaky RPCs.
 */
import { readFileSync } from "node:fs";

import { BorshCoder, utils } from "@anchor-lang/core";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  type AccountInfo,
  type AccountMeta,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

import { type ChainKeeper, FatalError } from "../chain.ts";
import type { SolanaConfig } from "../config.ts";
import type { Alerter } from "../health.ts";
import { errMsg, type Logger } from "../log.ts";
import { checkLiquidatable, type RiskParams } from "../math.ts";
import { RateLimitedLog, backoffMs, sleep, withRetry } from "../retry.ts";
import { readOraclePrice } from "./oracle.ts";

type Decoded<T = any> = { pubkey: PublicKey; data: T };
type MarketSnap = { key: PublicKey; symbol: string; oracle: PublicKey; data: any; price: bigint | null; priceIssue?: string };

/** Read the keeper keypair from its file. Only called here; the bytes never leave this object. */
function loadKeypair(path: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

export class SolanaKeeper implements ChainKeeper {
  readonly chain = "solana" as const;
  connection: Connection;
  private keypair: Keypair;
  private coder: BorshCoder;
  private idl: any;
  readonly programId: PublicKey;
  private discriminators: Record<string, string> = {};

  private config: any;
  private markets: { key: PublicKey; oracle: PublicKey; symbol: string }[] = [];
  private params: RiskParams = { positionFeeBps: 6n, maintenanceMarginBps: 250n };
  private keeperUsdc!: PublicKey;

  private inFlight = new Set<string>();
  /** Requests / positions this keeper just settled → ignored for a while (lagging RPC nodes). */
  private settled = new Map<string, number>();
  /** Requests already logged as seen (bounded by `settled` pruning below). */
  private seen = new Set<string>();
  /** Highest slot seen in a confirmed keeper transaction; reads must be at least this fresh. */
  private minSlot = 0;
  private retryAfter = new Map<string, { at: number; attempts: number }>();
  private liqInFlight = new Set<string>();
  private tracking = new Set<Promise<void>>();
  private rl = new RateLimitedLog(60_000);

  constructor(
    private cfg: SolanaConfig,
    private log: Logger,
    private alerter: Alerter,
  ) {
    this.connection = new Connection(cfg.rpcUrl, { commitment: "confirmed", disableRetryOnRateLimit: true });
    this.keypair = loadKeypair(cfg.keypairPath);
    this.idl = JSON.parse(readFileSync(cfg.idlPath, "utf8"));
    this.coder = new BorshCoder(this.idl);
    this.programId = new PublicKey(this.idl.address);
    for (const a of this.idl.accounts ?? []) this.discriminators[a.name] = utils.bytes.bs58.encode(Buffer.from(a.discriminator));
  }

  get keeperAddress() {
    return this.keypair.publicKey;
  }

  // ── PDAs ──
  private pda = (...seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, this.programId)[0];
  private configPda = () => this.pda(Buffer.from("config"));
  private poolPda = () => this.pda(Buffer.from("pool"));
  private vaultPda = () => this.pda(Buffer.from("vault"));

  async init(): Promise<void> {
    if (this.cfg.expectedKeeper && this.cfg.expectedKeeper !== this.keypair.publicKey.toBase58()) {
      throw new FatalError(`keypair is ${this.keypair.publicKey.toBase58()}, expected keeper ${this.cfg.expectedKeeper}`);
    }
    await this.refreshConfig();
    const keepers: PublicKey[] = this.config.keepers;
    if (!keepers.some((k) => k.equals(this.keypair.publicKey))) {
      throw new FatalError(`${this.keypair.publicKey.toBase58()} is not in Config.keepers`);
    }
    // The keeper's USDC account receives liquidation fees (`keeper_usdc`); create it if missing.
    this.keeperUsdc = getAssociatedTokenAddressSync(this.config.usdc_mint, this.keypair.publicKey, true, this.config.token_program);
    if (!(await withRetry(() => this.connection.getAccountInfo(this.keeperUsdc)))) {
      const sig = await this.send([
        createAssociatedTokenAccountIdempotentInstruction(
          this.keypair.publicKey,
          this.keeperUsdc,
          this.keypair.publicKey,
          this.config.usdc_mint,
          this.config.token_program,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      ]);
      this.log.info("created keeper USDC account", { account: this.keeperUsdc, tx: sig });
    }
    this.log.info("solana keeper ready", {
      keeper: this.keypair.publicKey,
      program: this.programId,
      markets: this.markets.map((m) => m.symbol),
      rpc_is_public_devnet: this.cfg.rpcUrl.includes("api.devnet.solana.com"),
    });
  }

  /** Config (market order, keepers, risk params) + each market's oracle and symbol. */
  private async refreshConfig() {
    const info = await withRetry(() => this.connection.getAccountInfo(this.configPda()));
    if (!info) throw new FatalError(`Config ${this.configPda().toBase58()} not found (wrong program or RPC?)`);
    this.config = this.coder.accounts.decode("Config", info.data);
    this.params = {
      positionFeeBps: BigInt(this.config.position_fee_bps.toString()),
      maintenanceMarginBps: BigInt(this.config.maintenance_margin_bps.toString()),
    };
    const keys: PublicKey[] = this.config.markets;
    const infos = await withRetry(() => this.connection.getMultipleAccountsInfo(keys));
    this.markets = keys.map((key, i) => {
      if (!infos[i]) throw new FatalError(`market ${key.toBase58()} listed in Config does not exist`);
      const m = this.coder.accounts.decode("Market", infos[i]!.data);
      return { key, oracle: m.oracle, symbol: m.symbol };
    });
  }

  /** `[market_0, oracle_0, …]` in Config order; `writable` markets are marked writable. */
  private marketAccounts(writable: PublicKey[] = []): AccountMeta[] {
    return this.markets.flatMap((m) => [
      { pubkey: m.key, isSigner: false, isWritable: writable.some((w) => w.equals(m.key)) },
      { pubkey: m.oracle, isSigner: false, isWritable: false },
    ]);
  }

  private ix(name: string, accounts: Record<string, PublicKey>, args: Record<string, unknown> = {}, remaining: AccountMeta[] = []) {
    const def = this.idl.instructions.find((i: any) => i.name === name);
    if (!def) throw new FatalError(`IDL has no instruction ${name}`);
    const keys: AccountMeta[] = def.accounts.map((a: any) => {
      const pubkey = accounts[a.name] ?? (a.address ? new PublicKey(a.address) : undefined);
      if (!pubkey) throw new Error(`${name}: missing account ${a.name}`);
      return { pubkey, isSigner: !!a.signer, isWritable: !!a.writable };
    });
    return new TransactionInstruction({ programId: this.programId, keys: [...keys, ...remaining], data: this.coder.instruction.encode(name, args) });
  }

  /**
   * All accounts of `type`, read no older than the last slot this keeper confirmed
   * (`minContextSlot`): a load-balanced RPC node that lags behind errors out (retried) instead of
   * returning a request or position that was already closed. Recently settled accounts are
   * dropped as a second guard.
   */
  private async programAccounts(type: string): Promise<Decoded[]> {
    const res = await withRetry(() =>
      this.connection.getProgramAccounts(this.programId, {
        filters: [{ memcmp: { offset: 0, bytes: this.discriminators[type] } }],
        minContextSlot: this.minSlot || undefined,
      }),
    );
    const now = Date.now();
    for (const [k, until] of this.settled) {
      if (until < now) {
        this.settled.delete(k);
        this.seen.delete(k);
      }
    }
    return res
      .filter(({ pubkey }) => !this.settled.has(pubkey.toBase58()))
      .map(({ pubkey, account }) => ({ pubkey, data: this.coder.accounts.decode(type, account.data) }));
  }

  private markSettled(keys: string[]) {
    const until = Date.now() + 120_000;
    for (const k of keys) this.settled.set(k, until);
  }

  private seenSlot(slot?: number) {
    if (slot && slot > this.minSlot) this.minSlot = slot;
  }

  /** Every market, its oracle price (null when stale/invalid) and the cluster clock, in one call. */
  private async snapshot(): Promise<{ now: bigint; markets: MarketSnap[] }> {
    const keys = [...this.markets.flatMap((m) => [m.key, m.oracle]), SYSVAR_CLOCK_PUBKEY];
    const infos = await withRetry(() => this.connection.getMultipleAccountsInfo(keys));
    const clock = infos[infos.length - 1];
    if (!clock) throw new Error("clock sysvar unavailable");
    const now = clock.data.readBigInt64LE(32);
    const markets = this.markets.map((m, i) => {
      const data = this.coder.accounts.decode("Market", (infos[2 * i] as AccountInfo<Buffer>).data);
      const oracleInfo = infos[2 * i + 1];
      const read = readOraclePrice(oracleInfo, this.programId, now, BigInt(data.max_age));
      return { key: m.key, symbol: m.symbol, oracle: m.oracle, data, price: read.price, priceIssue: read.issue };
    });
    return { now, markets };
  }

  // ═══════════════════════════ executor ═══════════════════════════

  async executorTick(): Promise<void> {
    const all = await this.programAccounts("Request");
    const now = Date.now();
    const pending = all
      .filter((r) => !this.inFlight.has(r.pubkey.toBase58()) && (this.retryAfter.get(r.pubkey.toBase58())?.at ?? 0) <= now)
      .sort((a, b) => Number(BigInt(a.data.created_at.toString()) - BigInt(b.data.created_at.toString())));
    if (pending.length === 0) return;
    const nowS = Math.floor(now / 1000);
    for (const r of pending) {
      const id = r.pubkey.toBase58();
      if (this.seen.has(id)) continue;
      this.seen.add(id);
      // age at first sighting = how far behind the RPC's view of the chain the keeper is
      this.log.info("request seen", { job: "executor", request: id, age_s: nowS - Number(r.data.created_at.toString()) });
    }

    for (let i = 0; i < pending.length; i += this.cfg.maxBatch) {
      const batch = pending.slice(i, i + this.cfg.maxBatch);
      const ok = await this.executeBatch(batch);
      if (!ok && batch.length > 1) {
        // The batch failed validation as a whole: find the bad request(s) one by one.
        for (const r of batch) await this.executeBatch([r]);
      }
    }
  }

  private executeIx(r: Decoded) {
    const owner: PublicKey = r.data.owner;
    return this.ix(
      "execute_request",
      {
        keeper: this.keypair.publicKey,
        config: this.configPda(),
        pool: this.poolPda(),
        vault: this.vaultPda(),
        usdc_mint: this.config.usdc_mint,
        request: r.pubkey,
        owner,
        owner_usdc: getAssociatedTokenAddressSync(this.config.usdc_mint, owner, true, this.config.token_program),
        position: r.data.position,
        token_program: this.config.token_program,
        system_program: SystemProgram.programId,
      },
      {},
      this.marketAccounts([r.data.market]),
    );
  }

  /** Returns false when the transaction failed before landing (bad account / preflight error). */
  /**
   * Submit one batch. Returns false when it was rejected before landing (preflight: a bad
   * account). Confirmation and event reporting continue in the background, so the executor can
   * pick up new requests meanwhile; the ids stay in-flight until the outcome is known.
   */
  private async executeBatch(batch: Decoded[]): Promise<boolean> {
    const ids = batch.map((r) => r.pubkey.toBase58());
    for (const id of ids) this.inFlight.add(id);
    const cu = Math.min(1_400_000, this.cfg.computeUnitsPerExecute * batch.length + 20_000);
    let sub: { sig: string; lastValidBlockHeight: number };
    try {
      sub = await this.submit(batch.map((r) => this.executeIx(r)), cu);
    } catch (e) {
      for (const id of ids) this.inFlight.delete(id);
      const m = errMsg(e);
      if (batch.length === 1 && /AccountNotInitialized/.test(m)) {
        // The request account is gone: it was executed or cancelled (possibly by another keeper).
        this.markSettled(ids);
        this.log.info("request already settled; skipped", { job: "executor", request: ids[0] });
        return false;
      }
      if (batch.length === 1) {
        const prev = this.retryAfter.get(ids[0])?.attempts ?? 0;
        const delay = backoffMs(prev + 1, 5_000, 300_000);
        this.retryAfter.set(ids[0], { at: Date.now() + delay, attempts: prev + 1 });
        this.log.error("execute_request failed; backing off", { job: "executor", request: ids[0], retry_in_ms: delay, err: m });
      } else {
        this.log.warn("batch failed; retrying one by one", { job: "executor", requests: ids, err: m });
      }
      return false;
    }
    this.log.info("execute sent", { job: "executor", tx: sub.sig, requests: ids });
    const t0 = Date.now();
    this.track(
      (async () => {
        try {
          await this.confirm(sub.sig, sub.lastValidBlockHeight);
          this.markSettled(ids);
          this.log.debug("execute confirmed after", { job: "executor", tx: sub.sig, confirm_ms: Date.now() - t0 });
          for (const id of ids) this.retryAfter.delete(id);
          await this.reportExecution(sub.sig, batch);
        } catch (e) {
          // Unknown or failed outcome: release the ids; the next tick re-reads which still exist.
          this.log.warn("execute not confirmed; will re-check", { job: "executor", tx: sub.sig, err: errMsg(e) });
        } finally {
          for (const id of ids) this.inFlight.delete(id);
        }
      })(),
    );
    return true;
  }

  private track(p: Promise<void>) {
    this.tracking.add(p);
    void p.finally(() => this.tracking.delete(p));
  }

  private async reportExecution(sig: string, batch: Decoded[]) {
    const { events, blockTime, slot } = await this.transactionEvents(sig);
    const byRequest = new Map(batch.map((r) => [r.pubkey.toBase58(), r]));
    for (const ev of events) {
      if (ev.name !== "RequestExecuted" && ev.name !== "RequestCancelled") continue;
      const r = byRequest.get(ev.data.request.toBase58());
      const created = r ? Number(r.data.created_at.toString()) : undefined;
      const base = {
        job: "executor",
        request: ev.data.request,
        owner: ev.data.owner,
        market: r ? this.markets.find((m) => m.key.equals(r.data.market))?.symbol : undefined,
        kind: r ? Object.keys(r.data.kind)[0] : undefined,
        tx: sig,
        slot,
        latency_s: blockTime && created ? blockTime - created : undefined,
      };
      if (ev.name === "RequestExecuted") this.log.info("request executed", base);
      else this.log.info("request cancelled", { ...base, reason: Object.keys(ev.data.reason)[0] });
    }
    this.log.info("execute confirmed", { job: "executor", tx: sig, requests: batch.length });
  }

  // ═══════════════════════════ liquidator ═══════════════════════════

  async liquidatorTick(): Promise<void> {
    const positions = await this.programAccounts("Position");
    if (positions.length === 0) return;
    const snap = await this.snapshot();
    for (const p of positions) {
      const m = snap.markets.find((x) => x.key.equals(p.data.market));
      if (!m) continue;
      if (m.price === null) {
        if (this.rl.should(`oracle-${m.symbol}`)) this.log.warn("oracle stale or invalid; skipping market", { job: "liquidator", market: m.symbol, issue: m.priceIssue });
        continue;
      }
      const pos = {
        isLong: p.data.is_long as boolean,
        size: BigInt(p.data.size.toString()),
        collateral: BigInt(p.data.collateral.toString()),
        tokens: BigInt(p.data.tokens.toString()),
        entryFundingIndex: BigInt(p.data.entry_funding_index.toString()),
      };
      const cum = BigInt((pos.isLong ? m.data.cum_funding_long : m.data.cum_funding_short).toString());
      if (!checkLiquidatable(pos, m.price, cum, this.params)) continue;
      const id = p.pubkey.toBase58();
      if (this.liqInFlight.has(id)) continue;
      await this.liquidate(p, m, pos, m.price);
    }
  }

  private async liquidate(p: Decoded, m: MarketSnap, pos: { size: bigint; collateral: bigint; isLong: boolean }, price: bigint) {
    const id = p.pubkey.toBase58();
    const fields = { job: "liquidator", position: p.pubkey, owner: p.data.owner, market: m.symbol, is_long: pos.isLong, size: pos.size, collateral: pos.collateral, price };
    const ix = this.ix(
      "liquidate",
      {
        keeper: this.keypair.publicKey,
        config: this.configPda(),
        pool: this.poolPda(),
        vault: this.vaultPda(),
        usdc_mint: this.config.usdc_mint,
        keeper_usdc: this.keeperUsdc,
        position: p.pubkey,
        owner: p.data.owner,
        token_program: this.config.token_program,
      },
      {},
      this.marketAccounts([m.key]),
    );
    // Confirm on-chain first (simulation): the price may have moved since the snapshot.
    const sim = await this.simulate([ix], 200_000);
    if (sim) {
      this.log.info("liquidation would fail on-chain (price moved?); skipped", { ...fields, err: sim });
      return;
    }
    this.liqInFlight.add(id);
    try {
      const sig = await this.send([ix], 200_000);
      this.markSettled([id]);
      const { events } = await this.transactionEvents(sig);
      const ev = events.find((e) => e.name === "PositionLiquidated");
      this.log.info("position liquidated", { ...fields, tx: sig, keeper_fee: ev?.data.keeper_fee?.toString() });
    } catch (e) {
      this.log.warn("liquidation failed; will re-check next tick", { ...fields, err: errMsg(e) });
    } finally {
      this.liqInFlight.delete(id);
    }
  }

  // ═══════════════════════════ funding ═══════════════════════════

  async fundingTick(): Promise<void> {
    await this.refreshConfig();
    const infos = await withRetry(() => this.connection.getMultipleAccountsInfo(this.markets.map((m) => m.key)));
    for (let i = 0; i < this.markets.length; i++) {
      const m = this.markets[i];
      const data = this.coder.accounts.decode("Market", infos[i]!.data);
      if (BigInt(data.long_size.toString()) === 0n && BigInt(data.short_size.toString()) === 0n) {
        this.log.debug("funding skipped (no open interest)", { job: "funding", market: m.symbol });
        continue;
      }
      try {
        const ix = this.ix("update_funding", { config: this.configPda(), pool: this.poolPda() }, { market: m.key }, this.marketAccounts([m.key]));
        const sig = await this.send([ix], 200_000);
        const ev = (await this.transactionEvents(sig)).events.find((e) => e.name === "FundingUpdated");
        this.log.info("funding updated", {
          job: "funding",
          market: m.symbol,
          tx: sig,
          rate_long_per_hour: ev?.data.rate_long_per_hour?.toString(),
          rate_short_per_hour: ev?.data.rate_short_per_hour?.toString(),
          cum_long: ev?.data.cum_long?.toString(),
          cum_short: ev?.data.cum_short?.toString(),
        });
      } catch (e) {
        this.log.warn("funding update failed", { job: "funding", market: m.symbol, err: errMsg(e) });
      }
    }
  }

  // ═══════════════════════════ health ═══════════════════════════

  async healthTick(): Promise<boolean> {
    await this.refreshConfig();
    const balance = BigInt(await withRetry(() => this.connection.getBalance(this.keypair.publicKey)));
    const isKeeper = (this.config.keepers as PublicKey[]).some((k) => k.equals(this.keypair.publicKey));
    this.log.info("health", { job: "health", keeper: this.keypair.publicKey, balance_sol: Number(balance) / LAMPORTS_PER_SOL, is_keeper: isKeeper, markets: this.markets.length });
    if (balance < this.cfg.minBalanceLamports) {
      await this.alerter.raise("solana-low-balance", "keeper SOL balance is low", {
        chain: "solana",
        keeper: this.keypair.publicKey.toBase58(),
        balance_sol: Number(balance) / LAMPORTS_PER_SOL,
        min_sol: Number(this.cfg.minBalanceLamports) / LAMPORTS_PER_SOL,
      });
    }
    if (!isKeeper) {
      await this.alerter.raise("solana-not-keeper", "keeper is no longer in Config.keepers; stopping Solana loops", { chain: "solana", keeper: this.keypair.publicKey.toBase58() });
      return false;
    }
    return true;
  }

  // ═══════════════════════════ transactions ═══════════════════════════

  private async buildTx(ixs: TransactionInstruction[], computeUnits?: number) {
    const { blockhash, lastValidBlockHeight } = await withRetry(() => this.connection.getLatestBlockhash("confirmed"));
    const tx = new Transaction({ feePayer: this.keypair.publicKey, blockhash, lastValidBlockHeight });
    if (computeUnits) tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
    tx.add(...ixs);
    tx.sign(this.keypair);
    return { tx, lastValidBlockHeight };
  }

  /** Simulate; returns an error string, or null when the transaction would succeed. */
  private async simulate(ixs: TransactionInstruction[], computeUnits?: number): Promise<string | null> {
    const { tx } = await this.buildTx(ixs, computeUnits);
    const res = await withRetry(() => this.connection.simulateTransaction(tx));
    if (!res.value.err) return null;
    const logs = res.value.logs ?? [];
    const named = logs.map((l) => l.match(/Error Code: (\w+)/)?.[1]).find(Boolean);
    return named ?? JSON.stringify(res.value.err);
  }

  /**
   * Send and confirm by polling signature status. Preflight is on, so a transaction that would
   * fail is rejected before it lands (no fee). Only pre-acceptance failures (429, stale
   * blockhash) are retried here; anything else is thrown and re-evaluated on the next tick.
   */
  private async send(ixs: TransactionInstruction[], computeUnits?: number): Promise<string> {
    const { sig, lastValidBlockHeight } = await this.submit(ixs, computeUnits);
    return this.confirm(sig, lastValidBlockHeight);
  }

  /** Sign and submit (preflight on). Throws when rejected before landing. */
  private async submit(ixs: TransactionInstruction[], computeUnits?: number): Promise<{ sig: string; lastValidBlockHeight: number }> {
    for (let attempt = 1; ; attempt++) {
      const { tx, lastValidBlockHeight } = await this.buildTx(ixs, computeUnits);
      try {
        const sig = await this.connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 5 });
        return { sig, lastValidBlockHeight };
      } catch (e) {
        const m = errMsg(e);
        const preAcceptance = /Blockhash not found|429|Too Many Requests/.test(m) && !/custom program error|Error Code/.test(m);
        if (preAcceptance && attempt < 5) {
          await sleep(backoffMs(attempt, 1_000, 15_000));
          continue;
        }
        throw new Error(programError(e) ?? m);
      }
    }
  }

  /**
   * Poll the signature status until confirmed. Backs off when the RPC rate-limits (a 429 must not
   * turn into a tighter polling loop) and checks blockhash expiry only every few polls.
   */
  private async confirm(sig: string, lastValidBlockHeight: number): Promise<string> {
    const deadline = Date.now() + this.cfg.confirmTimeoutMs;
    let delay = 400;
    for (let poll = 1; Date.now() < deadline; poll++) {
      try {
        const { value } = await this.connection.getSignatureStatuses([sig]);
        const st = value[0];
        if (st?.err) throw new Error(`transaction ${sig} failed: ${JSON.stringify(st.err)}`);
        if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) {
          this.seenSlot(st.slot);
          return sig;
        }
        if (!st && poll % 5 === 0 && (await this.connection.getBlockHeight("confirmed")) > lastValidBlockHeight) {
          throw new Error(`transaction ${sig} expired before landing`);
        }
        delay = 400;
      } catch (e) {
        if (/failed:|expired/.test(errMsg(e))) throw e;
        delay = Math.min(4_000, delay * 2); // rate-limited / RPC error: back off
      }
      await sleep(delay);
    }
    throw new Error(`transaction ${sig} not confirmed within ${this.cfg.confirmTimeoutMs} ms (outcome unknown; state is re-read next tick)`);
  }

  private async transactionEvents(sig: string): Promise<{ events: { name: string; data: any }[]; blockTime?: number; slot?: number }> {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const tx = await withRetry(() => this.connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }));
      if (tx) {
        const events: { name: string; data: any }[] = [];
        for (const line of tx.meta?.logMessages ?? []) {
          const m = line.match(/^Program data: (.+)$/);
          if (!m) continue;
          const ev = this.coder.events.decode(m[1]);
          if (ev) events.push({ name: ev.name, data: ev.data });
        }
        return { events, blockTime: tx.blockTime ?? undefined, slot: tx.slot };
      }
      await sleep(500 * attempt);
    }
    return { events: [] };
  }

  async drain(timeoutMs: number) {
    await Promise.race([Promise.allSettled([...this.tracking]), new Promise((r) => setTimeout(r, timeoutMs))]);
  }
}

/** The Anchor error name from a failed preflight, when there is one. */
function programError(e: unknown): string | null {
  const logs: string[] = (e as any)?.logs ?? (e as any)?.transactionLogs ?? [];
  const named = logs.map((l) => l.match(/Error Code: (\w+)/)?.[1]).find(Boolean);
  return named ? `program error ${named}` : null;
}

