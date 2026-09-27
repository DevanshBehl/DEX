// One interface for both chains. The UI talks only to `PerpsChain`; `evm.ts` (Sepolia) and
// `solana.ts` (devnet) implement it. Amounts are bigint in protocol units:
//   USD / USDC 1e6 · price 1e8 · funding rate & index 1e18 · CLP in the chain's CLP decimals.

import type { MarketId } from "@/lib/marketData";
import type { RiskParams } from "@/lib/perpMath";

export type ChainId = "sepolia" | "solana-devnet";

export type ProtocolParams = RiskParams & {
  paused: boolean;
  /** seconds after `createdAt` before the owner may cancel a request */
  requestExpiry: number;
  /** execution fee in the native unit (wei / lamports) */
  minExecutionFee: bigint;
  /** extra native amount a brand-new position costs (Solana: Position rent, refunded on close) */
  positionRent: bigint;
  maxProfitMultiplier: bigint;
  oiCapBps: bigint;
  lpMintFeeBps: bigint;
  lpCooldown: number;
  liquidationFeeBps: bigint;
};

export type MarketState = {
  market: MarketId;
  enabled: boolean;
  /** 8-dp oracle price, or null when the feed is stale/invalid (trading would cancel) */
  price: bigint | null;
  priceUpdatedAt: number | null;
  priceIssue?: string;
  longSize: bigint;
  shortSize: bigint;
  longCapacity: bigint;
  shortCapacity: bigint;
  fundingRateLongPerHour: bigint;
  fundingRateShortPerHour: bigint;
  cumFundingLong: bigint;
  cumFundingShort: bigint;
};

export type PoolState = {
  aum: bigint;
  poolAmount: bigint;
  reserved: bigint;
  /** poolAmount − reserved: what LPs can withdraw right now */
  available: bigint;
  clpSupply: bigint;
  clpDecimals: number;
  /** 8-dp USD value of 1 whole CLP */
  clpPrice: bigint;
};

export type Position = {
  /** EVM position key / Solana position PDA */
  id: string;
  market: MarketId;
  isLong: boolean;
  size: bigint;
  collateral: bigint;
  tokens: bigint;
  reserved: bigint;
  entryPrice: bigint;
  markPrice: bigint | null;
  /** raw PnL at the oracle price (formula 3) */
  pnl: bigint | null;
  fundingOwed: bigint;
  closeFee: bigint;
  /** what closing now would add to / remove from collateral: min(pnl, reserved) − fee − funding */
  netPnl: bigint | null;
  liquidationPrice: bigint;
  lastUpdated: number;
};

export type RequestKind = "increase" | "decrease";

export type PendingRequest = {
  /** EVM request id / Solana request PDA */
  id: string;
  kind: RequestKind;
  market: MarketId;
  isLong: boolean;
  collateralDelta: bigint;
  sizeDelta: bigint;
  acceptablePrice: bigint;
  executionFee: bigint;
  createdAt: number;
  cancellableAt: number;
};

export type HistoryItem = {
  key: string;
  time: number | null;
  tx: string;
  event:
    | "RequestCreated"
    | "RequestExecuted"
    | "RequestCancelled"
    | "PositionIncreased"
    | "PositionDecreased"
    | "PositionClosed"
    | "PositionLiquidated"
    | "LiquidityAdded"
    | "LiquidityRemoved"
    | "FaucetClaimed";
  market?: MarketId;
  isLong?: boolean;
  requestId?: string;
  sizeDelta?: bigint;
  collateralDelta?: bigint;
  executionPrice?: bigint;
  realisedPnl?: bigint;
  fee?: bigint;
  fundingPaid?: bigint;
  reason?: string;
  amount?: bigint;
};

export type OrderUpdate =
  | { status: "submitted"; tx: string }
  | { status: "pending"; requestId: string; tx: string; since: number }
  | { status: "filled"; requestId: string; tx?: string; executionPrice?: bigint; fee?: bigint }
  | { status: "cancelled"; requestId: string; tx?: string; reason: string }
  | { status: "failed"; error: string };

export type TxResult = { tx: string; requestId?: string };

export type KeeperStatus = { address: string; balance: bigint; active: boolean };

/** Operational health for the status page (reads only; works when the keeper is down). */
export type OpsStatus = {
  /** chain time (unix s) of the read */
  now: number;
  paused: boolean;
  /** requests waiting for the keeper, across all traders */
  pendingCount: number;
  oldestPendingAt: number | null;
  /** false when only the most recent requests were scanned (EVM keeps no global pending list) */
  pendingComplete: boolean;
  keepers: KeeperStatus[];
};

export type OrderParams = {
  market: MarketId;
  isLong: boolean;
  collateralDelta: bigint;
  sizeDelta: bigint;
  /** 8-dp worst acceptable execution price */
  acceptablePrice: bigint;
};

export interface PerpsChain {
  readonly id: ChainId;
  readonly nativeSymbol: "ETH" | "SOL";
  readonly nativeDecimals: number;
  /** can this chain trade `market` at all (SOL-USD is Solana-only) */
  supports(market: MarketId): boolean;
  explorerTx(tx: string): string;

  // ── reads (no wallet needed) ──
  getParams(): Promise<ProtocolParams>;
  getMarkets(): Promise<MarketId[]>;
  getMarketState(market: MarketId): Promise<MarketState>;
  getPool(): Promise<PoolState>;
  getUsdcBalance(owner: string): Promise<bigint>;
  getClpBalance(owner: string): Promise<bigint>;
  getNativeBalance(owner: string): Promise<bigint>;
  getPositions(owner: string): Promise<Position[]>;
  getPendingRequests(owner: string): Promise<PendingRequest[]>;
  getHistory(owner: string, opts?: { limit?: number }): Promise<HistoryItem[]>;
  faucetStatus(owner: string): Promise<{ canClaim: boolean; nextClaimAt: number | null }>;
  /** LP cooldown: unix seconds when `owner` may remove liquidity (0 = now) */
  lpAvailableAt(owner: string): Promise<number>;
  /** USDC allowance to the pool (EVM); Solana needs no approval → returns max */
  getAllowance(owner: string): Promise<bigint>;
  /**
   * Trading fees that went to LPs since `since` (unix s), for the APR estimate. `complete` is
   * false when the RPC could not return the whole window (the estimate is then a lower bound).
   */
  getFeesToPool(since: number): Promise<{ amount: bigint; complete: boolean }>;
  /** Protocol-wide operational health: pending requests, keepers, pause. */
  getOpsStatus(): Promise<OpsStatus>;

  // ── writes (need a signer) ──
  approve(amount: bigint): Promise<TxResult>;
  faucet(): Promise<TxResult>;
  requestIncrease(p: OrderParams): Promise<TxResult>;
  requestDecrease(p: OrderParams): Promise<TxResult>;
  cancel(requestId: string): Promise<TxResult>;
  addLiquidity(amount: bigint, minClp: bigint): Promise<TxResult>;
  removeLiquidity(clp: bigint, minUsdc: bigint): Promise<TxResult>;

  /** Poll a request until the keeper fills or cancels it. */
  trackRequest(requestId: string, tx: string, onUpdate: (u: OrderUpdate) => void, signal?: AbortSignal): Promise<OrderUpdate>;
}

/** An error with a message fit for users (decoded revert / program error / wallet rejection). */
export class ChainError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}
