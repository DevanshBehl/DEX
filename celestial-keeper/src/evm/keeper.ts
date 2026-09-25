/**
 * EVM (Sepolia) keeper for `PerpEngine`.
 *
 * - Requests: ids are sequential and there is no global pending list, so a cursor walks
 *   `[cursor, nextRequestId)` with `getRequest` and parks on the oldest still-pending id.
 * - Positions: no on-chain registry either, so an index is built from `PositionIncreased` /
 *   `PositionClosed` / `PositionLiquidated` logs (paged `eth_getLogs`, range halves on RPC limits)
 *   and each key is re-read with `getPosition` before use.
 * - Safety: `executeRequests` skips non-pending ids, so a re-sent batch can never double-execute;
 *   ids stay in an in-flight set until their transaction settles. Every send is gas-estimated
 *   first so a transaction that would revert is never paid for. One `NonceManager` serialises
 *   nonces and is reset after a confirmation timeout.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  Contract,
  type ContractTransactionResponse,
  type Interface,
  JsonRpcProvider,
  type Log,
  NonceManager,
  Wallet,
  formatEther,
} from "ethers";

import { type ChainKeeper, FatalError } from "../chain.ts";
import { REPO_ROOT, type EvmConfig } from "../config.ts";
import type { Alerter } from "../health.ts";
import { errMsg, type Logger } from "../log.ts";
import { checkLiquidatable, type RiskParams } from "../math.ts";
import { RateLimitedLog, backoffMs, withRetry } from "../retry.ts";

const abi = (name: string) => JSON.parse(readFileSync(join(REPO_ROOT, "celestial-perps/src/abis", `${name}.json`), "utf8"));

const STATUS_PENDING = 1n;

type IndexedPosition = { account: string; market: string; isLong: boolean };

export class EvmKeeper implements ChainKeeper {
  readonly chain = "evm" as const;
  provider!: JsonRpcProvider;
  private signer!: NonceManager;
  private engine!: Contract;
  private oracle!: Contract;
  private address!: string;
  private params: RiskParams = { positionFeeBps: 6n, maintenanceMarginBps: 250n };
  private marketIds: string[] = [];
  private symbols = new Map<string, string>();

  // executor state
  private cursor = 1n;
  private inFlight = new Set<bigint>();
  private retryAfter = new Map<bigint, { at: number; attempts: number }>();
  // liquidator state
  private positions = new Map<string, IndexedPosition>();
  private lastLogBlock: number;
  private logRange: number;
  /** Largest block range the RPC accepts (learned from range errors; never grown past). */
  private logCeiling: number;
  private liqInFlight = new Set<string>();
  // everything in flight (for drain)
  private tracking = new Set<Promise<void>>();
  private rl = new RateLimitedLog(60_000);

  constructor(
    private cfg: EvmConfig,
    private log: Logger,
    private alerter: Alerter,
  ) {
    this.lastLogBlock = cfg.startBlock - 1;
    this.logRange = cfg.logRange;
    this.logCeiling = cfg.logRange;
    for (const [symbol, id] of Object.entries(cfg.markets)) this.symbols.set(id.toLowerCase(), symbol);
  }

  get keeperAddress() {
    return this.address;
  }

  private get iface(): Interface {
    return this.engine.interface;
  }

  private sym(market: string) {
    return this.symbols.get(market.toLowerCase()) ?? market;
  }

  async init(): Promise<void> {
    const probe = new JsonRpcProvider(this.cfg.rpcUrl);
    const network = await withRetry(() => probe.getNetwork());
    probe.destroy();
    this.provider = new JsonRpcProvider(this.cfg.rpcUrl, network, { staticNetwork: network, pollingInterval: this.cfg.pollingMs });
    const wallet = new Wallet(this.cfg.privateKey, this.provider);
    this.address = wallet.address;
    this.signer = new NonceManager(wallet);
    this.engine = new Contract(this.cfg.engine, abi("PerpEngine"), this.signer);
    this.oracle = new Contract(this.cfg.oracle, abi("ChainlinkOracle"), this.provider);

    if (this.cfg.expectedKeeper && this.cfg.expectedKeeper.toLowerCase() !== this.address.toLowerCase()) {
      throw new FatalError(`EVM key derives ${this.address}, expected keeper ${this.cfg.expectedKeeper}`);
    }
    if (!(await withRetry(() => this.engine.isKeeper(this.address)))) {
      throw new FatalError(`${this.address} is not a whitelisted PerpEngine keeper`);
    }
    this.marketIds = (await withRetry(() => this.engine.getMarketIds())).map((m: string) => m.toLowerCase());
    await this.refreshParams();
    this.log.info("evm keeper ready", {
      chain_id: network.chainId,
      keeper: this.address,
      engine: this.cfg.engine,
      markets: this.marketIds.map((m) => this.sym(m)),
      start_block: this.cfg.startBlock,
    });
  }

  private async refreshParams() {
    const [fee, mm] = await Promise.all([this.engine.positionFeeBps(), this.engine.maintenanceMarginBps()]);
    this.params = { positionFeeBps: fee, maintenanceMarginBps: mm };
  }

  // ═══════════════════════════ executor ═══════════════════════════

  async executorTick(): Promise<void> {
    const next: bigint = await this.engine.nextRequestId();
    const pending: { id: bigint; createdAt: bigint }[] = [];
    let firstPending: bigint | null = null;
    const ids: bigint[] = [];
    for (let id = this.cursor; id < next; id++) ids.push(id);
    for (let i = 0; i < ids.length; i += 25) {
      const chunk = ids.slice(i, i + 25);
      const reqs = await Promise.all(chunk.map((id) => this.engine.getRequest(id)));
      reqs.forEach((r, j) => {
        if (r.status === STATUS_PENDING) {
          pending.push({ id: chunk[j], createdAt: r.createdAt });
          firstPending ??= chunk[j];
        }
      });
    }
    this.cursor = firstPending ?? next;

    const now = Date.now();
    const todo = pending.filter(({ id }) => !this.inFlight.has(id) && (this.retryAfter.get(id)?.at ?? 0) <= now);
    if (todo.length === 0) return;

    const batch = await this.estimableBatch(todo.slice(0, this.cfg.maxBatch).map((r) => r.id));
    if (batch.ids.length === 0) return;
    for (const id of batch.ids) this.inFlight.add(id);
    let tx: ContractTransactionResponse;
    try {
      tx = await this.engine.executeRequests(batch.ids, { gasLimit: (batch.gas * 12n) / 10n });
    } catch (e) {
      for (const id of batch.ids) this.inFlight.delete(id);
      this.signer.reset();
      throw e;
    }
    const created = new Map(todo.map((r) => [r.id, r.createdAt]));
    this.log.info("execute sent", { job: "executor", tx: tx.hash, ids: batch.ids });
    this.track(this.settleExecute(tx, batch.ids, created));
  }

  /** Gas-estimate the batch; on failure estimate each id alone and back off the failing ones. */
  private async estimableBatch(ids: bigint[]): Promise<{ ids: bigint[]; gas: bigint }> {
    try {
      return { ids, gas: await this.engine.executeRequests.estimateGas(ids) };
    } catch (e) {
      if (ids.length === 1) {
        this.backOff(ids[0], e);
        return { ids: [], gas: 0n };
      }
    }
    const ok: bigint[] = [];
    for (const id of ids) {
      try {
        await this.engine.executeRequests.estimateGas([id]);
        ok.push(id);
      } catch (e) {
        this.backOff(id, e);
      }
    }
    if (ok.length === 0) return { ids: [], gas: 0n };
    return { ids: ok, gas: await this.engine.executeRequests.estimateGas(ok) };
  }

  private backOff(id: bigint, e: unknown) {
    const prev = this.retryAfter.get(id)?.attempts ?? 0;
    const delay = backoffMs(prev + 1, 5_000, 300_000);
    this.retryAfter.set(id, { at: Date.now() + delay, attempts: prev + 1 });
    this.log.error("execute would revert; not sending", { job: "executor", id, retry_in_ms: delay, err: errMsg(e) });
  }

  private async settleExecute(tx: ContractTransactionResponse, ids: bigint[], created: Map<bigint, bigint>) {
    try {
      const rc = await tx.wait(1, this.cfg.confirmTimeoutMs);
      if (!rc) throw new Error("no receipt");
      const block = await this.provider.getBlock(rc.blockNumber);
      const seen = new Set<bigint>();
      for (const l of rc.logs) {
        const ev = this.parse(l);
        if (!ev) continue;
        const id: bigint = ev.args.id;
        const base = {
          job: "executor",
          id,
          account: ev.args.account,
          tx: rc.hash,
          block: rc.blockNumber,
          // Request block → fill block, in chain time.
          latency_s: block && created.has(id) ? block.timestamp - Number(created.get(id)) : undefined,
        };
        if (ev.name === "RequestExecuted") {
          seen.add(id);
          this.log.info("request executed", base);
        } else if (ev.name === "RequestCancelled") {
          seen.add(id);
          this.log.info("request cancelled", { ...base, reason: this.decodeReason(ev.args.reason) });
        }
      }
      for (const id of ids) {
        this.retryAfter.delete(id);
        if (!seen.has(id)) this.log.info("request already settled by another tx", { job: "executor", id });
      }
      this.log.info("execute confirmed", { job: "executor", tx: rc.hash, gas_used: rc.gasUsed, ids });
    } catch (e) {
      // Unknown outcome: release the ids; executeRequests skips anything no longer pending, so a
      // retry can never execute twice. Re-sync nonces in case the tx is stuck or was dropped.
      this.signer.reset();
      this.log.warn("execute not confirmed; will re-check", { job: "executor", tx: tx.hash, err: errMsg(e) });
    } finally {
      for (const id of ids) this.inFlight.delete(id);
    }
  }

  private decodeReason(data: string): string {
    if (!data || data === "0x") return "UserCancelled";
    try {
      const parsed = this.iface.parseError(data);
      if (parsed) return parsed.name;
    } catch {
      /* fall through */
    }
    return data.slice(0, 10);
  }

  private parse(l: Log) {
    if (l.address.toLowerCase() !== this.cfg.engine.toLowerCase()) return null;
    try {
      return this.iface.parseLog(l);
    } catch {
      return null;
    }
  }

  // ═══════════════════════════ liquidator ═══════════════════════════

  /** Bring the position index up to the chain head (paged logs; halves the range on RPC limits). */
  private async syncPositions() {
    const head = await this.provider.getBlockNumber();
    const topics = ["PositionIncreased", "PositionClosed", "PositionLiquidated"].map((n) => this.iface.getEvent(n)!.topicHash);
    while (this.lastLogBlock < head) {
      const from = this.lastLogBlock + 1;
      const to = Math.min(from + this.logRange - 1, head);
      let logs: Log[];
      try {
        logs = await this.provider.getLogs({ address: this.cfg.engine, topics: [topics], fromBlock: from, toBlock: to });
      } catch (e) {
        const m = errMsg(e);
        if (this.logRange > 1 && /range|limit|exceed|too many|10000|block/i.test(m)) {
          // Providers often say the limit outright ("up to a 10 block range"); else halve.
          const hinted = Number(m.match(/up to (?:a )?(\d+)[ -]block/i)?.[1] ?? 0);
          const next = hinted > 0 && hinted < this.logRange ? hinted : Math.max(1, Math.floor(this.logRange / 2));
          this.logRange = next;
          this.logCeiling = next;
          this.log.warn("eth_getLogs range reduced", { job: "liquidator", range: next });
          continue;
        }
        throw e;
      }
      logs.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
      for (const l of logs) {
        const ev = this.parse(l);
        if (!ev) continue;
        const key = (ev.args.key as string).toLowerCase();
        if (ev.name === "PositionIncreased") {
          this.positions.set(key, { account: ev.args.account, market: (ev.args.market as string).toLowerCase(), isLong: ev.args.isLong });
        } else {
          this.positions.delete(key);
        }
      }
      this.lastLogBlock = to;
      if (this.logRange < this.logCeiling) this.logRange = Math.min(this.logCeiling, this.logRange * 2);
      if (head - this.lastLogBlock > 1_000 && this.rl.should("log-sync")) {
        this.log.info("position index syncing", { job: "liquidator", at_block: this.lastLogBlock, head, range: this.logRange });
      }
    }
  }

  async liquidatorTick(): Promise<void> {
    await this.syncPositions();
    if (this.positions.size === 0) return;

    const markets = new Map<string, { price: bigint; cumLong: bigint; cumShort: bigint }>();
    for (const market of new Set([...this.positions.values()].map((p) => p.market))) {
      try {
        const [price, m] = await Promise.all([this.oracle.getPrice(market), this.engine.markets(market)]);
        markets.set(market, { price, cumLong: m.cumFundingLong, cumShort: m.cumFundingShort });
      } catch (e) {
        if (this.rl.should(`oracle-${market}`)) {
          this.log.warn("oracle unreadable (stale?); skipping market", { job: "liquidator", market: this.sym(market), err: errMsg(e) });
        }
      }
    }

    const entries = [...this.positions.entries()].filter(([, p]) => markets.has(p.market));
    let checked = 0;
    for (let i = 0; i < entries.length; i += 25) {
      const chunk = entries.slice(i, i + 25);
      const states = await Promise.all(chunk.map(([key]) => this.engine.getPosition(key)));
      for (let j = 0; j < chunk.length; j++) {
        const [key, meta] = chunk[j];
        const p = states[j];
        if (p.size === 0n) {
          this.positions.delete(key);
          continue;
        }
        checked++;
        const m = markets.get(meta.market)!;
        const pos = { isLong: p.isLong, size: p.size, collateral: p.collateral, tokens: p.tokens, entryFundingIndex: p.entryFundingIndex };
        if (!checkLiquidatable(pos, m.price, p.isLong ? m.cumLong : m.cumShort, this.params)) continue;
        if (this.liqInFlight.has(key)) continue;
        await this.liquidate(key, meta, p, m.price);
      }
    }
    this.log.debug("liquidator scan", { job: "liquidator", positions: this.positions.size, checked });
  }

  private async liquidate(key: string, meta: IndexedPosition, p: { size: bigint; collateral: bigint }, price: bigint) {
    const fields = { job: "liquidator", key, account: meta.account, market: this.sym(meta.market), is_long: meta.isLong, size: p.size, collateral: p.collateral, price };
    // Confirm on-chain first: the price may have moved since the scan.
    if (!(await this.engine.isLiquidatable(key))) {
      this.log.info("not liquidatable on-chain any more; skipped", fields);
      return;
    }
    let gas: bigint;
    try {
      gas = await this.engine.liquidate.estimateGas(key);
    } catch (e) {
      this.log.info("liquidation would revert (price moved?); skipped", { ...fields, err: errMsg(e) });
      return;
    }
    this.liqInFlight.add(key);
    try {
      const tx: ContractTransactionResponse = await this.engine.liquidate(key, { gasLimit: (gas * 12n) / 10n });
      this.log.info("liquidation sent", { ...fields, tx: tx.hash });
      this.track(
        (async () => {
          try {
            const rc = await tx.wait(1, this.cfg.confirmTimeoutMs);
            const ev = rc?.logs.map((l) => this.parse(l)).find((e) => e?.name === "PositionLiquidated");
            if (ev) this.positions.delete(key);
            this.log.info("position liquidated", { ...fields, tx: rc?.hash, keeper_fee: ev?.args.keeperFee });
          } catch (e) {
            this.signer.reset();
            this.log.warn("liquidation not confirmed; will re-check", { ...fields, tx: tx.hash, err: errMsg(e) });
          } finally {
            this.liqInFlight.delete(key);
          }
        })(),
      );
    } catch (e) {
      this.liqInFlight.delete(key);
      this.signer.reset();
      throw e;
    }
  }

  // ═══════════════════════════ funding ═══════════════════════════

  async fundingTick(): Promise<void> {
    for (const market of this.marketIds) {
      const m = await this.engine.markets(market);
      if (m.longSize === 0n && m.shortSize === 0n) {
        this.log.debug("funding skipped (no open interest)", { job: "funding", market: this.sym(market) });
        continue;
      }
      try {
        const gas = await this.engine.updateFunding.estimateGas(market);
        const tx: ContractTransactionResponse = await this.engine.updateFunding(market, { gasLimit: (gas * 12n) / 10n });
        const rc = await tx.wait(1, this.cfg.confirmTimeoutMs);
        const ev = rc?.logs.map((l) => this.parse(l)).find((e) => e?.name === "FundingUpdated");
        this.log.info("funding updated", {
          job: "funding",
          market: this.sym(market),
          tx: rc?.hash,
          rate_long_per_hour: ev?.args.rateLongPerHour,
          rate_short_per_hour: ev?.args.rateShortPerHour,
          cum_long: ev?.args.cumLong,
          cum_short: ev?.args.cumShort,
        });
      } catch (e) {
        this.signer.reset();
        this.log.warn("funding update failed", { job: "funding", market: this.sym(market), err: errMsg(e) });
      }
    }
  }

  // ═══════════════════════════ health ═══════════════════════════

  async healthTick(): Promise<boolean> {
    const [balance, isKeeper] = await Promise.all([this.provider.getBalance(this.address), this.engine.isKeeper(this.address)]);
    await this.refreshParams();
    this.log.info("health", { job: "health", keeper: this.address, balance_eth: formatEther(balance), is_keeper: isKeeper, positions_indexed: this.positions.size, request_cursor: this.cursor });
    if (balance < this.cfg.minBalanceWei) {
      await this.alerter.raise("evm-low-balance", "keeper ETH balance is low", { chain: "evm", keeper: this.address, balance_eth: formatEther(balance), min_eth: formatEther(this.cfg.minBalanceWei) });
    }
    if (!isKeeper) {
      await this.alerter.raise("evm-not-keeper", "keeper is no longer whitelisted on PerpEngine; stopping EVM loops", { chain: "evm", keeper: this.address });
      return false;
    }
    return true;
  }

  private track(p: Promise<void>) {
    this.tracking.add(p);
    void p.finally(() => this.tracking.delete(p));
  }

  async drain(timeoutMs: number) {
    await Promise.race([Promise.allSettled([...this.tracking]), new Promise((r) => setTimeout(r, timeoutMs))]);
    this.provider?.destroy();
  }
}
