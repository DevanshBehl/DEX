"use client";

import { Loader2, TrendingDown, TrendingUp, Wallet } from "lucide-react";

import type { OrderParams } from "@/lib/chains";
import type { MarketId } from "@/lib/marketData";
import {
  BPS,
  executionPrice,
  formatUnits,
  isLiquidatable,
  liquidationPrice,
  mulDivCeil,
  mulDivFloor,
  parseUnits,
  pnl,
  positionFee,
  previewOpen,
  tokensFor,
  toPrice,
  toUsd,
} from "@/lib/perpMath";
import { LEV_PRESETS, SLIPPAGE_PRESETS_BPS } from "@/lib/protocol";
import { fmtUsd } from "@/lib/format";
import type { PerpsData } from "@/hooks/usePerps";
import { GREEN, PANEL, RED, SummaryRow } from "./ui";

const SIZE_PCTS = [25, 50, 75, 100];

export function TradeForm({
  market,
  side,
  onSideChange,
  leverage,
  onLeverageChange,
  collateral,
  onCollateralChange,
  slippageBps,
  onSlippageChange,
  data,
  isConnected,
  onRightNetwork,
  busy,
  onConnect,
  onSwitchNetwork,
  onApprove,
  onSubmit,
}: {
  market: MarketId;
  side: "long" | "short";
  onSideChange: (side: "long" | "short") => void;
  leverage: number;
  onLeverageChange: (lev: number) => void;
  collateral: string;
  onCollateralChange: (v: string) => void;
  slippageBps: number;
  onSlippageChange: (bps: number) => void;
  data: PerpsData;
  isConnected: boolean;
  onRightNetwork: boolean;
  busy: boolean;
  onConnect: () => void;
  onSwitchNetwork: () => void;
  /** approve `amount` USDC, then place `then` (EVM: two wallet confirmations from one click) */
  onApprove: (amount: bigint, then: OrderParams | null) => void;
  onSubmit: (p: OrderParams) => void;
}) {
  const isLong = side === "long";
  const accent = isLong ? GREEN : RED;
  const { params, market: st, account, writeChain, tradable } = data;
  const maxLev = params ? Number(params.maxLeverage) : 20;
  const levPct = ((leverage - 1) / (maxLev - 1)) * 100;
  const native = writeChain?.nativeSymbol ?? data.chain.nativeSymbol;
  const nativeDecimals = writeChain?.nativeDecimals ?? data.chain.nativeDecimals;

  // ── order maths (bigint, same rounding as the chain) ──
  const coll = parseUnits(collateral || "0", 6) ?? null;
  const size = coll !== null ? coll * BigInt(leverage) : 0n;
  const price = st?.price ?? null;
  const existing = account?.positions.find((p) => p.market === market && p.isLong === isLong) ?? null;

  let exec: bigint | null = null;
  let acceptable: bigint | null = null;
  let fee = 0n;
  let liq: bigint | null = null;
  let entry: bigint | null = null;
  let problem: string | null = null;
  if (params && price !== null && coll !== null && coll > 0n) {
    exec = executionPrice(price, isLong, true, params.executionSpreadBps);
    acceptable = isLong
      ? mulDivCeil(exec, BPS + BigInt(slippageBps), BPS)
      : mulDivFloor(exec, BPS - BigInt(slippageBps), BPS);
    fee = positionFee(size, params.positionFeeBps);
    if (!existing) {
      const pv = previewOpen(isLong, coll, size, price, params);
      liq = pv.liquidationPrice;
      entry = pv.entryPrice;
      if (pv.problem) problem = PROBLEM[pv.problem];
    } else {
      // Adds to the existing position: funding is settled, fee charged, tokens accumulate.
      const funding = existing.fundingOwed;
      const newSize = existing.size + size;
      const newTokens = existing.tokens + tokensFor(size, exec, isLong);
      const newColl = existing.collateral + coll - funding - fee;
      entry = newTokens > 0n ? (newSize * 10n ** 20n) / newTokens : null;
      const closeFee = positionFee(newSize, params.positionFeeBps);
      liq = liquidationPrice(isLong, newSize, newTokens, newColl, 0n, closeFee, params.maintenanceMarginBps);
      if (newColl < params.minCollateral) problem = PROBLEM.CollateralTooLow;
      else if (newSize > newColl * params.maxLeverage) problem = PROBLEM.LeverageTooHigh;
      else if (isLiquidatable(newColl, pnl(isLong, newSize, newTokens, price), 0n, closeFee, newSize, params.maintenanceMarginBps))
        problem = PROBLEM.PositionLiquidatable;
    }
  }

  const capacity = st ? (isLong ? st.longCapacity : st.shortCapacity) : null;
  const fundingRate = st ? (isLong ? st.fundingRateLongPerHour : st.fundingRateShortPerHour) : null;
  const execFee = params?.minExecutionFee ?? 0n;
  const rent = !existing ? (params?.positionRent ?? 0n) : 0n;
  const needsApproval = !!account && coll !== null && coll > 0n && account.allowance < coll;
  const order: OrderParams | null =
    coll !== null && acceptable !== null ? { market, isLong, collateralDelta: coll, sizeDelta: size, acceptablePrice: acceptable } : null;

  // Pre-flight checks: the first failing one blocks the button (nothing is sent).
  let block: string | null = null;
  if (!params || !st) block = "Loading market…";
  else if (params.paused) block = "Trading is paused — new positions are disabled.";
  else if (!st.enabled) block = "This market is disabled.";
  else if (price === null) block = `Oracle price unavailable${st.priceIssue ? ` (${st.priceIssue})` : ""}.`;
  else if (coll === null) block = "Enter a valid USDC amount (max 6 decimals).";
  else if (coll === 0n) block = "Enter collateral.";
  else if (problem) block = problem;
  else if (capacity !== null && size > capacity) block = `Size above the remaining ${isLong ? "long" : "short"} capacity (${fmtUsd(toUsd(capacity))}).`;
  else if (account && coll > account.usdc) block = "Not enough USDC — use the faucet.";
  else if (account && account.native < execFee + rent) block = `Not enough ${native} for the execution fee.`;

  const marketBlocked = isConnected && !tradable ? `${market} trades on Solana — connect a Solana wallet.` : null;

  const fmtNative = (v: bigint) => `${formatUnits(v, nativeDecimals, 6)} ${native}`;

  return (
    <div className={`${PANEL} flex h-full flex-col overflow-hidden`}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {/* side toggle */}
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/5 bg-black p-1">
          <button
            type="button"
            onClick={() => onSideChange("long")}
            className={`flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-bold transition-all ${
              isLong ? "bg-[#22c55e] text-black shadow-[0_4px_16px_-4px_rgba(34,197,94,0.55)]" : "text-[#888] hover:text-white"
            }`}
          >
            <TrendingUp className="h-4 w-4" strokeWidth={2.5} />
            Long
          </button>
          <button
            type="button"
            onClick={() => onSideChange("short")}
            className={`flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-bold transition-all ${
              !isLong ? "bg-[#ef4444] text-white shadow-[0_4px_16px_-4px_rgba(239,68,68,0.55)]" : "text-[#888] hover:text-white"
            }`}
          >
            <TrendingDown className="h-4 w-4" strokeWidth={2.5} />
            Short
          </button>
        </div>

        <div className="flex items-center justify-between rounded-lg bg-black px-3 py-2 text-[11px] font-semibold">
          <span className="text-white">Market order</span>
          <span className="font-normal text-[#666]">Fills at oracle price</span>
        </div>

        {/* USDC collateral */}
        <label className="block">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide text-[#888]">Collateral</span>
            <span className="font-mono text-[10px] text-[#666]">
              {account ? `Avail ${formatUnits(account.usdc, 6, 2)} USDC` : isConnected ? "Loading…" : "Connect wallet"}
            </span>
          </div>
          <div className="flex items-center rounded-lg border border-white/5 bg-black px-3 transition-colors focus-within:border-white/20">
            <input
              aria-label="Collateral amount in USDC"
              value={collateral}
              onChange={(e) => onCollateralChange(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              placeholder="100"
              className="w-full bg-transparent py-2.5 text-right font-mono text-sm tabular-nums text-white outline-none"
            />
            <span className="ml-2 text-xs text-[#888]">USDC</span>
          </div>
          <div className="mt-1.5 grid grid-cols-4 gap-1">
            {SIZE_PCTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => account && onCollateralChange(formatUnits((account.usdc * BigInt(p)) / 100n, 6, 2))}
                disabled={!account || account.usdc === 0n}
                className="rounded-md border border-white/5 bg-black py-1 font-mono text-[10px] text-[#888] transition-colors hover:border-white/15 hover:text-white disabled:opacity-40"
              >
                {p === 100 ? "Max" : `${p}%`}
              </button>
            ))}
          </div>
        </label>

        {/* leverage */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide text-[#888]">Leverage</span>
            <span className="font-mono text-sm font-bold tabular-nums" style={{ color: accent }}>
              {leverage}x
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={maxLev}
            value={Math.min(leverage, maxLev)}
            onChange={(e) => onLeverageChange(Number(e.target.value))}
            aria-label="Leverage"
            style={{
              background: `linear-gradient(to right, ${accent} 0%, ${accent} ${levPct}%, rgba(255,255,255,0.08) ${levPct}%, rgba(255,255,255,0.08) 100%)`,
            }}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow"
          />
          <div className="mt-1 flex justify-between font-mono text-[9px] text-[#666]">
            <span>1x</span>
            <span>{Math.round(maxLev / 2)}x</span>
            <span>{maxLev}x</span>
          </div>
          <div className="mt-2 flex gap-1">
            {LEV_PRESETS.filter((p) => p <= maxLev).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onLeverageChange(p)}
                className={`flex-1 rounded-md border py-1 font-mono text-[11px] transition-colors ${
                  leverage === p ? "border-white/20 bg-white/10 text-white" : "border-white/5 bg-black text-[#888] hover:text-white"
                }`}
              >
                {p}x
              </button>
            ))}
          </div>
        </div>

        {/* slippage */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-[#888]">Slippage</span>
          <div className="flex gap-1">
            {SLIPPAGE_PRESETS_BPS.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => onSlippageChange(b)}
                className={`rounded-md border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                  slippageBps === b ? "border-white/20 bg-white/10 text-white" : "border-white/5 bg-black text-[#888] hover:text-white"
                }`}
              >
                {(b / 100).toFixed(1)}%
              </button>
            ))}
          </div>
        </div>

        {/* summary */}
        <div className="space-y-1.5 rounded-lg border border-white/5 bg-black p-2.5">
          <span className="mb-0.5 block text-[9px] font-semibold uppercase tracking-wider text-[#666]">
            Order Summary{existing ? " · adds to your position" : ""}
          </span>
          <SummaryRow label="Position size" value={size > 0n ? fmtUsd(toUsd(existing ? existing.size + size : size)) : "—"} title="Collateral × leverage" />
          <SummaryRow label="Est. entry (oracle ± 0.1%)" value={exec !== null ? fmtUsd(toPrice(entry ?? exec)) : "—"} />
          <SummaryRow label={`Acceptable price (${(slippageBps / 100).toFixed(1)}%)`} value={acceptable !== null ? fmtUsd(toPrice(acceptable)) : "—"} title="The keeper cancels the order if the fill is worse than this" />
          <SummaryRow label="Liq. price" value={liq !== null && liq > 0n ? fmtUsd(toPrice(liq)) : "—"} color="text-[#ef4444]/80" />
          <SummaryRow label={`Open fee (${params ? (Number(params.positionFeeBps) / 100).toFixed(2) : "0.06"}%)`} value={size > 0n ? fmtUsd(toUsd(fee)) : "—"} />
          <SummaryRow label="Execution fee (keeper)" value={params ? fmtNative(execFee) : "—"} />
          {rent > 0n && <SummaryRow label="Position rent (refunded on close)" value={fmtNative(rent)} />}
          <SummaryRow
            label="Funding / hour"
            value={fundingRate !== null ? (fundingRate > 0n ? `${(Number(fundingRate) / 1e16).toFixed(4)}% (you pay)` : "0%") : "—"}
          />
          <SummaryRow label={`${isLong ? "Long" : "Short"} capacity left`} value={capacity !== null ? fmtUsd(toUsd(capacity)) : "—"} />
          <p className="pt-1 text-[10px] text-[#666]">
            Filled by the keeper at the next oracle price — {data.chain.id === "solana-devnet" ? "usually ~2 s" : "usually 1–2 blocks (~12–24 s)"}.
          </p>
        </div>
      </div>

      {/* pinned action */}
      <div className="shrink-0 space-y-1.5 border-t border-white/5 p-3">
        {isConnected && onRightNetwork && (marketBlocked ?? block) && (
          <p className="text-center text-[11px] text-[#f7931a]">{marketBlocked ?? block}</p>
        )}
        {!isConnected ? (
          <ActionButton accent={accent} onClick={onConnect}>
            <Wallet className="h-4 w-4" strokeWidth={2.5} />
            Connect Wallet to Trade
          </ActionButton>
        ) : !onRightNetwork ? (
          <ActionButton accent="#f7931a" onClick={onSwitchNetwork}>
            Switch wallet to Sepolia
          </ActionButton>
        ) : needsApproval && !block && !marketBlocked ? (
          <div className="space-y-1">
            <ActionButton accent={accent} disabled={busy || acceptable === null} onClick={() => coll && onApprove(coll, order)}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Approve {collateral} USDC & {isLong ? "Open Long" : "Open Short"}
            </ActionButton>
            <p className="text-center text-[10px] text-[#888]">Two confirmations in your wallet: the USDC approval, then the order.</p>
            <button type="button" disabled={busy || acceptable === null} onClick={() => onApprove(2n ** 256n - 1n, order)} className="w-full text-center text-[10px] text-[#888] underline hover:text-white">
              Approve max instead (no approval next time)
            </button>
          </div>
        ) : (
          <ActionButton
            accent={accent}
            disabled={busy || !!block || !!marketBlocked || acceptable === null}
            onClick={() => order && onSubmit(order)}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : isLong ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            {isLong ? "Open Long" : "Open Short"} · {leverage}x
          </ActionButton>
        )}
      </div>
    </div>
  );
}

const PROBLEM: Record<string, string> = {
  CollateralTooLow: "Collateral after the open fee is below the 10 USDC minimum.",
  LeverageTooLow: "Size must be at least the collateral (1x).",
  LeverageTooHigh: "Leverage above the maximum after fees — lower it slightly.",
  PositionLiquidatable: "This position would be liquidatable right away.",
};

function ActionButton({ accent, disabled, onClick, children }: { accent: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{ backgroundColor: accent, boxShadow: `0 8px 26px -8px ${accent}` }}
      className="flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-bold text-black transition-all hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}
