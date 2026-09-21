"use client";

import { Loader2, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { fmtUsd } from "@/lib/format";
import type { MarketId } from "@/lib/marketData";
import {
  LEGACY_VAULT_FEE_BPS,
  LEGACY_VAULT_MARKETS,
  LEV_PRESETS,
  MAX_LEVERAGE,
} from "@/lib/protocol";
import { GREEN, PANEL, RED, SummaryRow } from "./ui";

const SIZE_PCTS = [25, 50, 75, 100];

export function TradeForm({
  market,
  side,
  onSideChange,
  leverage,
  onLeverageChange,
  pay,
  onPayChange,
  walletBalance,
  isConnected,
  oraclePrice,
  ethOraclePrice,
  isExecuting,
  txHash,
  txError,
  onExecute,
  onConnect,
}: {
  market: MarketId;
  side: "long" | "short";
  onSideChange: (side: "long" | "short") => void;
  leverage: number;
  onLeverageChange: (lev: number) => void;
  pay: string;
  onPayChange: (pay: string) => void;
  walletBalance: string | null;
  isConnected: boolean;
  oraclePrice: number | null;
  ethOraclePrice: number | null;
  isExecuting: boolean;
  txHash: string | null;
  txError: string | null;
  onExecute: () => void;
  onConnect: () => void;
}) {
  const isLong = side === "long";
  const accent = isLong ? GREEN : RED;
  const levPct = ((leverage - 1) / (MAX_LEVERAGE - 1)) * 100;

  // Collateral is still ETH on the legacy vault (USDC arrives in Phase 2).
  const payNum = parseFloat(pay);
  const collateralEth = Number.isFinite(payNum) && payNum > 0 ? payNum : 0;
  const collateralUsd = ethOraclePrice !== null ? collateralEth * ethOraclePrice : null;
  const sizeUsd = collateralUsd !== null ? collateralUsd * leverage : null;
  const feeEth = (collateralEth * LEGACY_VAULT_FEE_BPS) / 10_000;
  const feeUsd = ethOraclePrice !== null ? feeEth * ethOraclePrice : null;

  const marketTradable = LEGACY_VAULT_MARKETS.includes(market);

  return (
    <div className={`${PANEL} flex h-full flex-col overflow-hidden`}>
      {/* scrollable form body */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {/* side toggle */}
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/5 bg-black p-1">
          <button
            type="button"
            onClick={() => onSideChange("long")}
            className={`flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-bold transition-all ${
              isLong
                ? "bg-[#22c55e] text-black shadow-[0_4px_16px_-4px_rgba(34,197,94,0.55)]"
                : "text-[#888] hover:text-white"
            }`}
          >
            <TrendingUp className="h-4 w-4" strokeWidth={2.5} />
            Long
          </button>
          <button
            type="button"
            onClick={() => onSideChange("short")}
            className={`flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-bold transition-all ${
              !isLong
                ? "bg-[#ef4444] text-white shadow-[0_4px_16px_-4px_rgba(239,68,68,0.55)]"
                : "text-[#888] hover:text-white"
            }`}
          >
            <TrendingDown className="h-4 w-4" strokeWidth={2.5} />
            Short
          </button>
        </div>

        {/* order type — market only until keeper-triggered orders exist */}
        <div className="flex items-center justify-between rounded-lg bg-black px-3 py-2 text-[11px] font-semibold">
          <span className="text-white">Market order</span>
          <span className="font-normal text-[#666]">Fills at oracle price</span>
        </div>

        {/* pay (ETH collateral) */}
        <label className="block">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide text-[#888]">Collateral</span>
            <span className="font-mono text-[10px] text-[#666]">
              {walletBalance !== null
                ? `Avail ${parseFloat(walletBalance).toFixed(4)} ETH`
                : isConnected ? "Loading…" : "Connect wallet"}
            </span>
          </div>
          <div className="flex items-center rounded-lg border border-white/5 bg-black px-3 transition-colors focus-within:border-white/20">
            <input
              aria-label="Collateral amount in ETH"
              value={pay}
              onChange={(e) => onPayChange(e.target.value)}
              inputMode="decimal"
              placeholder="0.01"
              className="w-full bg-transparent py-2.5 text-right font-mono text-sm tabular-nums text-white outline-none"
            />
            <span className="ml-2 text-xs text-[#888]">ETH</span>
          </div>
          <div className="mt-1.5 grid grid-cols-4 gap-1">
            {SIZE_PCTS.map((p) => {
              const bal = walletBalance ? parseFloat(walletBalance) : 0;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => onPayChange(((bal * p) / 100).toFixed(4))}
                  disabled={!walletBalance}
                  className="rounded-md border border-white/5 bg-black py-1 font-mono text-[10px] text-[#888] transition-colors hover:border-white/15 hover:text-white disabled:opacity-40"
                >
                  {p === 100 ? "Max" : `${p}%`}
                </button>
              );
            })}
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
            max={MAX_LEVERAGE}
            value={leverage}
            onChange={(e) => onLeverageChange(Number(e.target.value))}
            aria-label="Leverage"
            style={{
              background: `linear-gradient(to right, ${accent} 0%, ${accent} ${levPct}%, rgba(255,255,255,0.08) ${levPct}%, rgba(255,255,255,0.08) 100%)`,
            }}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow"
          />
          <div className="mt-1 flex justify-between font-mono text-[9px] text-[#666]">
            <span>1x</span>
            <span>{MAX_LEVERAGE / 2}x</span>
            <span>{MAX_LEVERAGE}x</span>
          </div>
          <div className="mt-2 flex gap-1">
            {LEV_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => onLeverageChange(p)}
                className={`flex-1 rounded-md border py-1 font-mono text-[11px] transition-colors ${
                  leverage === p
                    ? "border-white/20 bg-white/10 text-white"
                    : "border-white/5 bg-black text-[#888] hover:text-white"
                }`}
              >
                {p}x
              </button>
            ))}
          </div>
        </div>

        {/* summary */}
        <div className="space-y-1.5 rounded-lg border border-white/5 bg-black p-2.5">
          <span className="mb-0.5 block text-[9px] font-semibold uppercase tracking-wider text-[#666]">
            Order Summary
          </span>
          <SummaryRow
            label="Entry Price (oracle)"
            value={oraclePrice !== null ? fmtUsd(oraclePrice) : "—"}
            title="Chainlink price the vault fills at"
          />
          <SummaryRow
            label="Position Size"
            value={sizeUsd !== null ? fmtUsd(sizeUsd) : "—"}
            title="Collateral × ETH oracle price × leverage"
          />
          <SummaryRow
            label="Liq. Price"
            value="—"
            color="text-[#ef4444]/80"
            title="Calculated on-chain after launch"
          />
          <SummaryRow
            label="Fee (0.1% of collateral)"
            value={
              collateralEth > 0
                ? `${feeEth.toFixed(6)} ETH${feeUsd !== null ? ` · ${fmtUsd(feeUsd)}` : ""}`
                : "—"
            }
            title="Charged by the current (legacy) vault on open"
          />
        </div>
      </div>

      {/* tx feedback */}
      {txHash && (
        <div className="mx-3 mb-1 rounded-lg border border-[#22c55e]/20 bg-[#22c55e]/10 px-3 py-2">
          <p className="text-xs font-semibold text-[#22c55e]">✓ Trade executed successfully!</p>
          <a
            href={`https://sepolia.etherscan.io/tx/${txHash}`}
            target="_blank"
            rel="noreferrer"
            className="mt-1 block truncate font-mono text-[10px] text-[#22c55e]/70 underline"
          >
            View on Etherscan →
          </a>
        </div>
      )}
      {txError && (
        <div className="mx-3 mb-1 rounded-lg border border-[#ef4444]/20 bg-[#ef4444]/10 px-3 py-2">
          <p className="text-xs text-[#ef4444]">{txError}</p>
        </div>
      )}

      {/* pinned action button */}
      <div className="shrink-0 border-t border-white/5 p-3">
        {isConnected ? (
          <button
            type="button"
            onClick={onExecute}
            disabled={isExecuting || !marketTradable || !pay || parseFloat(pay) <= 0}
            style={{ backgroundColor: accent, boxShadow: `0 8px 26px -8px ${accent}` }}
            className="flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-bold text-black transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isExecuting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Executing…
              </>
            ) : !marketTradable ? (
              <>{market} trading opens with the new engine</>
            ) : (
              <>
                {isLong ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                {isLong ? "Execute Long" : "Execute Short"} · {leverage}x
              </>
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            style={{ backgroundColor: accent, boxShadow: `0 8px 26px -8px ${accent}` }}
            className="flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-bold text-black transition-all hover:brightness-110 active:scale-[0.99]"
          >
            <Wallet className="h-4 w-4" strokeWidth={2.5} />
            Connect Wallet to Trade
          </button>
        )}
      </div>
    </div>
  );
}
