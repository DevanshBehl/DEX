// Sepolia implementation of `PerpsChain` (PerpEngine / LiquidityPool / CLP / MockUSDC).
// Reads go through a read-only JsonRpcProvider; writes through the signer of the CONNECTED
// wallet (EIP-6963 provider), after checking it is on the right chain.

import { AbiCoder, Contract, type ContractTransactionReceipt, type Interface, JsonRpcProvider, type Log, type Signer, keccak256 } from "ethers";

import CLPAbi from "@/src/abis/CLP.json";
import ChainlinkOracleAbi from "@/src/abis/ChainlinkOracle.json";
import LiquidityPoolAbi from "@/src/abis/LiquidityPool.json";
import MockUSDCAbi from "@/src/abis/MockUSDC.json";
import PerpEngineAbi from "@/src/abis/PerpEngine.json";
import { EVM_MARKET_IDS, SEPOLIA_CONTRACTS } from "@/lib/contracts";
import type { MarketId } from "@/lib/marketData";
import { fundingOwed as fundingOwedMath, pnl as pnlMath, positionFee } from "@/lib/perpMath";

import { isUserRejection, messageFor } from "./errors";
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
  type ProtocolParams,
  type TxResult,
} from "./types";

export type EvmChainConfig = {
  rpcUrl: string;
  chainId: number;
  engine: string;
  pool: string;
  clp: string;
  usdc: string;
  oracle: string;
  markets: Partial<Record<MarketId, string>>;
  deployBlock: number;
  explorer: string;
  /** eth_getLogs block range to start with (halved automatically on RPC range errors) */
  logRange?: number;
  /** poll interval for trackRequest */
  pollMs?: number;
};

export const SEPOLIA_CONFIG: EvmChainConfig = {
  rpcUrl: process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
  chainId: SEPOLIA_CONTRACTS.chainId,
  engine: SEPOLIA_CONTRACTS.perpEngine,
  pool: SEPOLIA_CONTRACTS.liquidityPool,
  clp: SEPOLIA_CONTRACTS.clp,
  usdc: SEPOLIA_CONTRACTS.mockUsdc,
  oracle: SEPOLIA_CONTRACTS.chainlinkOracle,
  markets: EVM_MARKET_IDS,
  deployBlock: SEPOLIA_CONTRACTS.deployBlock,
  explorer: "https://sepolia.etherscan.io",
};

const STATUS = { None: 0, Pending: 1, Executed: 2, Cancelled: 3 } as const;
const AGGREGATOR_ABI = ["function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)"];
const MAX_UINT = 2n ** 256n - 1n;

type CacheEntry<T> = { at: number; value: T };

export class EvmChain implements PerpsChain {
  readonly id = "sepolia" as const;
  readonly nativeSymbol = "ETH" as const;
  readonly nativeDecimals = 18;
  readonly provider: JsonRpcProvider;
  private engine: Contract;
  private pool: Contract;
  private usdc: Contract;
  private clp: Contract;
  private oracle: Contract;
  private symbolOf = new Map<string, MarketId>();
  private paramsCache?: CacheEntry<ProtocolParams>;
  private logRange: number;

  constructor(
    readonly cfg: EvmChainConfig,
    private signer?: Signer,
  ) {
    // cacheTimeout -1: ethers otherwise reuses identical requests for ~250 ms, so a pre-flight
    // estimate right after a transaction (a repeated faucet claim) could see stale state.
    this.provider = new JsonRpcProvider(cfg.rpcUrl, cfg.chainId, { staticNetwork: true, batchMaxCount: 10, cacheTimeout: -1 });
    this.engine = new Contract(cfg.engine, PerpEngineAbi, this.provider);
    this.pool = new Contract(cfg.pool, LiquidityPoolAbi, this.provider);
    this.usdc = new Contract(cfg.usdc, MockUSDCAbi, this.provider);
    this.clp = new Contract(cfg.clp, CLPAbi, this.provider);
    this.oracle = new Contract(cfg.oracle, ChainlinkOracleAbi, this.provider);
    for (const [m, id] of Object.entries(cfg.markets)) if (id) this.symbolOf.set(id.toLowerCase(), m as MarketId);
    this.logRange = cfg.logRange ?? 5_000;
  }

  supports(market: MarketId) {
    return !!this.cfg.markets[market];
  }

  explorerTx(tx: string) {
    return `${this.cfg.explorer}/tx/${tx}`;
  }

  private marketId(m: MarketId): string {
    const id = this.cfg.markets[m];
    if (!id) throw new ChainError(`${m} is not listed on Sepolia (Solana only).`, "MarketNotListed");
    return id;
  }

  private sym(id: string): MarketId | undefined {
    return this.symbolOf.get(id.toLowerCase());
  }

  // ═══════════════════════ reads ═══════════════════════

  async getParams(): Promise<ProtocolParams> {
    if (this.paramsCache && Date.now() - this.paramsCache.at < 30_000) return this.paramsCache.value;
    const e = this.engine;
    const [maxLeverage, mm, fee, spread, minColl, paused, expiry, minFee, mpm, oiCap, liqFee, lpFee, lpCooldown] = await Promise.all([
      e.maxLeverage(),
      e.maintenanceMarginBps(),
      e.positionFeeBps(),
      e.executionSpreadBps(),
      e.minCollateral(),
      e.paused(),
      e.requestExpiry(),
      e.minExecutionFee(),
      e.maxProfitMultiplier(),
      e.oiCapBps(),
      e.liquidationFeeBps(),
      this.pool.lpMintFeeBps(),
      this.pool.lpCooldown(),
    ]);
    const value: ProtocolParams = {
      maxLeverage,
      maintenanceMarginBps: mm,
      positionFeeBps: fee,
      executionSpreadBps: spread,
      minCollateral: minColl,
      paused,
      requestExpiry: Number(expiry),
      minExecutionFee: minFee,
      positionRent: 0n,
      maxProfitMultiplier: mpm,
      oiCapBps: oiCap,
      liquidationFeeBps: liqFee,
      lpMintFeeBps: lpFee,
      lpCooldown: Number(lpCooldown),
    };
    this.paramsCache = { at: Date.now(), value };
    return value;
  }

  async getMarkets(): Promise<MarketId[]> {
    const listed: string[] = await this.engine.getMarketIds();
    return listed.map((id) => this.sym(id)).filter((m): m is MarketId => !!m);
  }

  /** Oracle price + age. A stale feed makes `getPrice` revert: reported as price = null. */
  private async oracleRound(id: string): Promise<{ price: bigint | null; updatedAt: number | null; issue?: string }> {
    let updatedAt: number | null = null;
    try {
      const [feed] = await this.oracle.feeds(id);
      const round = await new Contract(feed, AGGREGATOR_ABI, this.provider).latestRoundData();
      updatedAt = Number(round[3]);
    } catch {
      /* age unknown */
    }
    try {
      return { price: await this.oracle.getPrice(id), updatedAt };
    } catch (e) {
      return { price: null, updatedAt, issue: this.decodeError(e, "oracle unavailable").message };
    }
  }

  async getMarketState(market: MarketId): Promise<MarketState> {
    const id = this.marketId(market);
    const [raw, round] = await Promise.all([this.engine.markets(id), this.oracleRound(id)]);
    let info: { longCapacity: bigint; shortCapacity: bigint; fundingRateLongPerHour: bigint; fundingRateShortPerHour: bigint } | null = null;
    if (round.price !== null) {
      try {
        info = await this.engine.getMarketInfo(id);
      } catch {
        info = null; // AUM needs every market's oracle; one stale feed makes this view revert
      }
    }
    return {
      market,
      enabled: raw.enabled,
      price: round.price,
      priceUpdatedAt: round.updatedAt,
      priceIssue: round.issue,
      longSize: raw.longSize,
      shortSize: raw.shortSize,
      longCapacity: info?.longCapacity ?? 0n,
      shortCapacity: info?.shortCapacity ?? 0n,
      fundingRateLongPerHour: info?.fundingRateLongPerHour ?? 0n,
      fundingRateShortPerHour: info?.fundingRateShortPerHour ?? 0n,
      cumFundingLong: raw.cumFundingLong,
      cumFundingShort: raw.cumFundingShort,
    };
  }

  async getPool(): Promise<PoolState> {
    const [aum, poolAmount, reserved, supply, clpPrice]: bigint[] = await Promise.all([
      this.pool.getAum(),
      this.pool.poolAmount(),
      this.pool.reservedAmount(),
      this.clp.totalSupply(),
      this.pool.getClpPrice(),
    ]);
    return { aum, poolAmount, reserved, available: poolAmount - reserved, clpSupply: supply, clpDecimals: 18, clpPrice };
  }

  getUsdcBalance(owner: string): Promise<bigint> {
    return this.usdc.balanceOf(owner);
  }

  getClpBalance(owner: string): Promise<bigint> {
    return this.clp.balanceOf(owner);
  }

  getNativeBalance(owner: string): Promise<bigint> {
    return this.provider.getBalance(owner);
  }

  getAllowance(owner: string): Promise<bigint> {
    return this.usdc.allowance(owner, this.cfg.pool);
  }

  positionKey(owner: string, market: MarketId, isLong: boolean): string {
    return keccak256(AbiCoder.defaultAbiCoder().encode(["address", "bytes32", "bool"], [owner, this.marketId(market), isLong]));
  }

  async getPositions(owner: string): Promise<Position[]> {
    const params = await this.getParams();
    const markets = Object.keys(this.cfg.markets) as MarketId[];
    const slots = markets.flatMap((m) => [true, false].map((isLong) => ({ m, isLong, key: this.positionKey(owner, m, isLong) })));
    const raw = await Promise.all(slots.map((s) => this.engine.getPosition(s.key)));
    const open = slots.map((s, i) => ({ ...s, p: raw[i] })).filter((x) => x.p.size > 0n);
    if (open.length === 0) return [];

    const states = new Map<MarketId, MarketState>();
    await Promise.all([...new Set(open.map((x) => x.m))].map(async (m) => states.set(m, await this.getMarketState(m))));
    return Promise.all(
      open.map(async ({ m, isLong, key, p }) => {
        const st = states.get(m)!;
        const funding = fundingOwedMath(p.size, isLong ? st.cumFundingLong : st.cumFundingShort, p.entryFundingIndex);
        const closeFee = positionFee(p.size, params.positionFeeBps);
        const rawPnl = st.price !== null ? pnlMath(isLong, p.size, p.tokens, st.price) : null;
        let liq = 0n;
        try {
          liq = await this.engine.getLiquidationPrice(key);
        } catch {
          /* view unavailable (stale oracle elsewhere) */
        }
        return {
          id: key,
          market: m,
          isLong,
          size: p.size,
          collateral: p.collateral,
          tokens: p.tokens,
          reserved: p.reserved,
          entryPrice: p.tokens > 0n ? (p.size * 10n ** 20n) / p.tokens : 0n,
          markPrice: st.price,
          pnl: rawPnl,
          fundingOwed: funding,
          closeFee,
          netPnl: rawPnl === null ? null : (rawPnl > p.reserved ? p.reserved : rawPnl) - closeFee - funding,
          liquidationPrice: liq,
          lastUpdated: Number(p.lastUpdated),
        } as Position;
      }),
    );
  }

  async getPendingRequests(owner: string): Promise<PendingRequest[]> {
    const [ids, params] = await Promise.all([this.engine.getPendingRequestIds(owner) as Promise<bigint[]>, this.getParams()]);
    const reqs = await Promise.all(ids.map((id) => this.engine.getRequest(id)));
    return reqs
      .map((r, i) => ({
        id: ids[i].toString(),
        kind: Number(r.kind) === 0 ? ("increase" as const) : ("decrease" as const),
        market: this.sym(r.market) ?? ("ETH-USD" as MarketId),
        isLong: r.isLong,
        collateralDelta: r.collateralDelta,
        sizeDelta: r.sizeDelta,
        acceptablePrice: r.acceptablePrice,
        executionFee: r.executionFee,
        createdAt: Number(r.createdAt),
        cancellableAt: Number(r.createdAt) + params.requestExpiry,
      }))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async faucetStatus(owner: string) {
    const next = Number(await this.usdc.nextClaimAt(owner));
    const now = Math.floor(Date.now() / 1000);
    return { canClaim: next <= now, nextClaimAt: next > now ? next : null };
  }

  async lpAvailableAt(owner: string): Promise<number> {
    const [last, cooldown] = await Promise.all([this.pool.lastAddedAt(owner), this.pool.lpCooldown()]);
    return last === 0n ? 0 : Number(last + cooldown);
  }

  async getFeesToPool(since: number): Promise<{ amount: bigint; complete: boolean }> {
    const head = await this.provider.getBlock("latest");
    if (!head) return { amount: 0n, complete: false };
    // ~12 s blocks; never scan before the deploy block.
    const from = Math.max(this.cfg.deployBlock, head.number - Math.ceil((head.timestamp - since) / 12));
    const topic = this.pool.interface.getEvent("FeesAdded")!.topicHash;
    let amount = 0n;
    let range = Math.max(this.logRange, 1_000);
    for (let start = from; start <= head.number; ) {
      const end = Math.min(start + range - 1, head.number);
      try {
        const logs = await this.provider.getLogs({ address: this.cfg.pool, topics: [topic], fromBlock: start, toBlock: end });
        for (const l of logs) amount += this.pool.interface.parseLog(l)!.args.toPool as bigint;
        start = end + 1;
      } catch {
        // Tight provider limits (e.g. 10-block ranges) would need thousands of calls: stop and
        // report a partial (lower-bound) estimate instead.
        if (range <= 1_000) return { amount, complete: false };
        range = Math.floor(range / 2);
      }
    }
    return { amount, complete: true };
  }

  // ── history (events; paged getLogs, cached per owner in localStorage) ──

  async getHistory(owner: string, opts: { limit?: number } = {}): Promise<HistoryItem[]> {
    const cacheKey = `celestial:evm-history:${this.cfg.chainId}:${this.cfg.engine}:${owner.toLowerCase()}`;
    const cached = readCache<{ lastBlock: number; items: HistoryItem[] }>(cacheKey);
    let from = cached ? cached.lastBlock + 1 : this.cfg.deployBlock;
    const items = cached?.items ?? [];
    const head = await this.provider.getBlockNumber();
    const account = "0x" + owner.toLowerCase().replace(/^0x/, "").padStart(64, "0");
    const eng = this.engine.interface;
    const engineTopics = ["RequestCreated", "RequestExecuted", "RequestCancelled", "PositionIncreased", "PositionDecreased", "PositionClosed", "PositionLiquidated"].map(
      (n) => eng.getEvent(n)!.topicHash,
    );
    const poolTopics = ["LiquidityAdded", "LiquidityRemoved"].map((n) => this.pool.interface.getEvent(n)!.topicHash);
    const faucetTopic = this.usdc.interface.getEvent("FaucetClaimed")!.topicHash;

    while (from <= head) {
      const to = Math.min(from + this.logRange - 1, head);
      let logs: Log[];
      try {
        const [e, p, f] = await Promise.all([
          this.provider.getLogs({ address: this.cfg.engine, topics: [engineTopics, null, account], fromBlock: from, toBlock: to }),
          this.provider.getLogs({ address: this.cfg.pool, topics: [poolTopics, account], fromBlock: from, toBlock: to }),
          this.provider.getLogs({ address: this.cfg.usdc, topics: [faucetTopic, account], fromBlock: from, toBlock: to }),
        ]);
        logs = [...e, ...p, ...f];
      } catch (err) {
        const m = String((err as Error).message ?? err);
        if (this.logRange > 1 && /range|limit|exceed|too many|block|10000/i.test(m)) {
          const hinted = Number(m.match(/up to (?:a )?(\d+)[ -]block/i)?.[1] ?? 0);
          this.logRange = hinted > 0 && hinted < this.logRange ? hinted : Math.max(1, Math.floor(this.logRange / 2));
          continue;
        }
        throw err;
      }
      logs.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
      const times = new Map<number, number>();
      for (const l of logs) {
        if (!times.has(l.blockNumber)) times.set(l.blockNumber, (await this.provider.getBlock(l.blockNumber))?.timestamp ?? 0);
        const item = this.toHistory(l, times.get(l.blockNumber) ?? null);
        if (item) items.push(item);
      }
      from = to + 1;
    }
    writeCache(cacheKey, { lastBlock: head, items });
    const out = [...items].sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
    return opts.limit ? out.slice(0, opts.limit) : out;
  }

  private toHistory(l: Log, time: number | null): HistoryItem | null {
    const iface: Interface =
      l.address.toLowerCase() === this.cfg.engine.toLowerCase() ? this.engine.interface : l.address.toLowerCase() === this.cfg.pool.toLowerCase() ? this.pool.interface : this.usdc.interface;
    const ev = iface.parseLog(l);
    if (!ev) return null;
    const a = ev.args;
    const base = { key: `${l.transactionHash}:${l.index}`, time, tx: l.transactionHash, event: ev.name as HistoryItem["event"] };
    switch (ev.name) {
      case "RequestCreated":
        return { ...base, requestId: a.id.toString(), market: this.sym(a.market), isLong: a.isLong, sizeDelta: a.sizeDelta, collateralDelta: a.collateralDelta };
      case "RequestExecuted":
        return { ...base, requestId: a.id.toString() };
      case "RequestCancelled":
        return { ...base, requestId: a.id.toString(), reason: this.reasonName(a.reason) };
      case "PositionIncreased":
        return { ...base, market: this.sym(a.market), isLong: a.isLong, sizeDelta: a.sizeDelta, collateralDelta: a.collateralDelta, executionPrice: a.executionPrice, fee: a.fee, fundingPaid: a.fundingPaid };
      case "PositionDecreased":
        return { ...base, market: this.sym(a.market), isLong: a.isLong, sizeDelta: a.sizeDelta, collateralDelta: a.collateralOut, executionPrice: a.executionPrice, realisedPnl: a.realisedPnl, fee: a.fee, fundingPaid: a.fundingPaid };
      case "PositionClosed":
        return { ...base, market: this.sym(a.market), isLong: a.isLong };
      case "PositionLiquidated":
        return { ...base, market: this.sym(a.market), isLong: a.isLong, sizeDelta: a.size, collateralDelta: a.collateral, executionPrice: a.price, fee: a.keeperFee };
      case "LiquidityAdded":
        return { ...base, amount: a.amount, fee: a.fee };
      case "LiquidityRemoved":
        return { ...base, amount: a.amountOut };
      case "FaucetClaimed":
        return { ...base, amount: a.amount };
      default:
        return null;
    }
  }

  private reasonName(data: string): string {
    if (!data || data === "0x") return "UserCancelled";
    for (const iface of [this.engine.interface, this.pool.interface]) {
      try {
        const e = iface.parseError(data);
        if (e) return e.name;
      } catch {
        /* try next */
      }
    }
    return "Unknown";
  }

  // ═══════════════════════ writes ═══════════════════════

  private async withSigner(): Promise<Signer> {
    if (!this.signer) throw new ChainError("Connect a wallet first.", "NoWallet");
    const net = await this.signer.provider?.getNetwork();
    if (net && Number(net.chainId) !== this.cfg.chainId) throw new ChainError(messageFor("WrongNetwork"), "WrongNetwork");
    return this.signer;
  }

  /** Send a contract call: pre-flight with estimateGas (decodes reverts before the wallet opens). */
  private async send(contract: Contract, method: string, args: unknown[], value?: bigint): Promise<ContractTransactionReceipt> {
    const signer = await this.withSigner();
    const c = contract.connect(signer) as Contract;
    try {
      const overrides = value !== undefined ? { value } : {};
      // Pre-flight on the app's own RPC (uncached, see the constructor), with `from` and the pending
      // nonce, so reverts are decoded before the wallet opens. Wallets only proxy some JSON-RPC
      // methods (Celestial rejected eth_getTransactionCount); the wallet is needed only to sign.
      const from = await signer.getAddress();
      const nonce = await this.provider.getTransactionCount(from, "pending");
      const read = contract.connect(this.provider) as Contract;
      const gas: bigint = await read[method].estimateGas(...args, { ...overrides, from, nonce });
      const tx = await c[method](...args, { ...overrides, gasLimit: (gas * 12n) / 10n });
      const rc = (await tx.wait()) as ContractTransactionReceipt | null;
      if (!rc || rc.status !== 1) throw new ChainError("Transaction reverted.", "Reverted");
      return rc;
    } catch (e) {
      throw this.decodeError(e);
    }
  }

  decodeError(e: unknown, fallback = "Transaction failed."): ChainError {
    if (e instanceof ChainError) return e;
    if (isUserRejection(e)) return new ChainError(messageFor("UserRejected"), "UserRejected");
    const x = e as { code?: string; revert?: { name?: string }; data?: string; info?: { error?: { data?: string } }; shortMessage?: string };
    if (x?.code === "INSUFFICIENT_FUNDS") return new ChainError(messageFor("InsufficientFunds"), "InsufficientFunds");
    let name = x?.revert?.name;
    const data = x?.data ?? x?.info?.error?.data;
    if (!name && typeof data === "string" && data.length >= 10) {
      for (const iface of [this.engine.interface, this.pool.interface, this.usdc.interface]) {
        try {
          name = iface.parseError(data)?.name;
          if (name) break;
        } catch {
          /* next */
        }
      }
    }
    if (name) return new ChainError(messageFor(name, fallback), name);
    return new ChainError(x?.shortMessage ?? fallback);
  }

  async approve(amount: bigint): Promise<TxResult> {
    const rc = await this.send(this.usdc, "approve", [this.cfg.pool, amount === MAX_UINT ? MAX_UINT : amount]);
    return { tx: rc.hash };
  }

  async faucet(): Promise<TxResult> {
    const rc = await this.send(this.usdc, "faucet", []);
    return { tx: rc.hash };
  }

  private requestIdFrom(rc: ContractTransactionReceipt): string {
    for (const l of rc.logs) {
      if (l.address.toLowerCase() !== this.cfg.engine.toLowerCase()) continue;
      const ev = this.engine.interface.parseLog(l);
      if (ev?.name === "RequestCreated") return ev.args.id.toString();
    }
    throw new ChainError("Request id not found in the receipt.");
  }

  async requestIncrease(p: OrderParams): Promise<TxResult> {
    const { minExecutionFee } = await this.getParams();
    const rc = await this.send(this.engine, "requestIncrease", [this.marketId(p.market), p.isLong, p.collateralDelta, p.sizeDelta, p.acceptablePrice], minExecutionFee);
    return { tx: rc.hash, requestId: this.requestIdFrom(rc) };
  }

  async requestDecrease(p: OrderParams): Promise<TxResult> {
    const { minExecutionFee } = await this.getParams();
    const rc = await this.send(this.engine, "requestDecrease", [this.marketId(p.market), p.isLong, p.collateralDelta, p.sizeDelta, p.acceptablePrice], minExecutionFee);
    return { tx: rc.hash, requestId: this.requestIdFrom(rc) };
  }

  async cancel(requestId: string): Promise<TxResult> {
    const rc = await this.send(this.engine, "cancelRequest", [BigInt(requestId)]);
    return { tx: rc.hash, requestId };
  }

  async addLiquidity(amount: bigint, minClp: bigint): Promise<TxResult> {
    const rc = await this.send(this.pool, "addLiquidity", [amount, minClp]);
    return { tx: rc.hash };
  }

  async removeLiquidity(clp: bigint, minUsdc: bigint): Promise<TxResult> {
    const rc = await this.send(this.pool, "removeLiquidity", [clp, minUsdc]);
    return { tx: rc.hash };
  }

  async trackRequest(requestId: string, tx: string, onUpdate: (u: OrderUpdate) => void, signal?: AbortSignal): Promise<OrderUpdate> {
    const since = Date.now();
    onUpdate({ status: "pending", requestId, tx, since });
    const rc = await this.provider.getTransactionReceipt(tx);
    const fromBlock = rc?.blockNumber ?? (await this.provider.getBlockNumber()) - 5;
    const idTopic = "0x" + BigInt(requestId).toString(16).padStart(64, "0");
    while (!signal?.aborted) {
      const r = await this.engine.getRequest(BigInt(requestId)).catch(() => null);
      const status = r ? Number(r.status) : STATUS.Pending;
      if (status === STATUS.Executed || status === STATUS.Cancelled) {
        const name = status === STATUS.Executed ? "RequestExecuted" : "RequestCancelled";
        const logs = await this.provider
          .getLogs({ address: this.cfg.engine, topics: [this.engine.interface.getEvent(name)!.topicHash, idTopic], fromBlock })
          .catch(() => [] as Log[]);
        const fill = logs[0];
        let update: OrderUpdate;
        if (status === STATUS.Executed) {
          let executionPrice: bigint | undefined;
          let fee: bigint | undefined;
          if (fill) {
            const frc = await this.provider.getTransactionReceipt(fill.transactionHash);
            for (const l of frc?.logs ?? []) {
              if (l.address.toLowerCase() !== this.cfg.engine.toLowerCase()) continue;
              const ev = this.engine.interface.parseLog(l);
              if ((ev?.name === "PositionIncreased" || ev?.name === "PositionDecreased") && l.index < fill.index) {
                executionPrice = ev.args.executionPrice;
                fee = ev.args.fee;
              }
            }
          }
          update = { status: "filled", requestId, tx: fill?.transactionHash, executionPrice, fee };
        } else {
          const reason = fill ? this.reasonName(this.engine.interface.parseLog(fill)!.args.reason) : "Unknown";
          update = { status: "cancelled", requestId, tx: fill?.transactionHash, reason };
        }
        onUpdate(update);
        return update;
      }
      await sleep(this.cfg.pollMs ?? 3_000, signal);
    }
    return { status: "failed", error: "stopped tracking" };
  }
}

// ── small helpers ──

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });

const bigintReviver = (_: string, v: unknown) => (typeof v === "string" && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v);
const bigintReplacer = (_: string, v: unknown) => (typeof v === "bigint" ? `${v}n` : v);

function readCache<T>(key: string): T | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s, bigintReviver) as T) : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: unknown) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, JSON.stringify(value, bigintReplacer));
  } catch {
    /* storage full / unavailable: history is refetched next time */
  }
}
