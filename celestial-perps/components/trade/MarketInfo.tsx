"use client";

import { Info } from "lucide-react";
import { fmtAgo, fmtPct, fmtPrice, fmtUsdCompact } from "@/lib/format";
import type { MarketId } from "@/lib/marketData";
import type { OracleStatus } from "@/hooks/useOraclePrice";
import { PANEL } from "./ui";

export type MarketInfoData = {
  oraclePrice: number | null;
  oracleUpdatedAt: number | null;
  indexPrice: number | null;
  poolLiquidityUsd: number | null;
  longOiUsd: number | null;
  shortOiUsd: number | null;
  longCapacityUsd: number | null;
  shortCapacityUsd: number | null;
  fundingLongPerHour: number | null;
  fundingShortPerHour: number | null;
  maxLeverage: number;
  openFeeBps: number;
};

const usd = (v: number | null) => (v === null ? "—" : fmtUsdCompact(v));
const rate = (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(4)}%`);

function Row({ label, value, color = "text-white/90" }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-[7px] text-[11px]">
      <span className="text-[#888]">{label}</span>
      <span className={`font-mono tabular-nums ${color}`}>{value}</span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-t border-white/[0.05] px-3 pb-1 pt-3 text-[9px] font-semibold uppercase tracking-wider text-[#666]">
      {children}
    </div>
  );
}

export function MarketInfo({
  market,
  data,
  oracleStatus,
}: {
  market: MarketId;
  data: MarketInfoData;
  oracleStatus: OracleStatus;
}) {
  const { oraclePrice, oracleUpdatedAt, indexPrice } = data;
  const gapPct =
    oraclePrice !== null && indexPrice !== null && oraclePrice > 0
      ? ((indexPrice - oraclePrice) / oraclePrice) * 100
      : null;

  const hasOi = data.longOiUsd !== null && data.shortOiUsd !== null;
  const oiTotal = hasOi ? data.longOiUsd! + data.shortOiUsd! : 0;
  const longShare = hasOi && oiTotal > 0 ? (data.longOiUsd! / oiTotal) * 100 : 50;

  const oracleLine =
    oracleStatus === "unavailable"
      ? "No Sepolia oracle for this market"
      : oracleStatus === "error"
        ? "Oracle unreachable"
        : oracleUpdatedAt !== null
          ? `Chainlink · updated ${fmtAgo(oracleUpdatedAt)}${oracleStatus === "stale" ? " · stale" : ""}`
          : "Chainlink · loading…";

  return (
    <div className={`${PANEL} flex h-full flex-col overflow-hidden`}>
      <div className="flex shrink-0 items-center justify-between border-b border-white/5 px-2.5 py-2">
        <span className="text-xs font-semibold text-white">Market Info</span>
        <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-[#888]">{market}</span>
      </div>

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
        {/* oracle price — the price trades fill at */}
        <div className="border-b border-white/[0.08] bg-white/[0.025] px-3 py-3">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-[#777]">Oracle Price</span>
          <div className="mt-0.5 font-mono text-xl font-bold tabular-nums text-white">
            {oraclePrice !== null ? `$${fmtPrice(oraclePrice)}` : "—"}
          </div>
          <div
            className={`mt-0.5 text-[10px] ${
              oracleStatus === "stale" || oracleStatus === "error" ? "text-[#f7931a]" : "text-[#777]"
            }`}
          >
            {oracleLine}
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px]">
            <span className="text-[#777]">Index (Coinbase)</span>
            <span className="font-mono tabular-nums text-white/75">
              {indexPrice !== null ? `$${fmtPrice(indexPrice)}` : "—"}
              {gapPct !== null && (
                <span className={`ml-1 ${Math.abs(gapPct) >= 0.5 ? "text-[#f7931a]" : "text-[#666]"}`}>
                  ({fmtPct(gapPct)})
                </span>
              )}
            </span>
          </div>
        </div>

        <SectionLabel>Pool</SectionLabel>
        <Row label="Available liquidity" value={usd(data.poolLiquidityUsd)} />

        <SectionLabel>Open Interest</SectionLabel>
        <div className="px-3 pb-1 pt-1">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className={hasOi ? "bg-[#22c55e]/70" : "bg-white/[0.12]"}
              style={{ width: `${longShare}%` }}
            />
            <div className={`flex-1 ${hasOi ? "bg-[#ef4444]/70" : "bg-white/[0.06]"}`} />
          </div>
        </div>
        <Row label="Long OI" value={usd(data.longOiUsd)} color="text-[#34d399]" />
        <Row label="Short OI" value={usd(data.shortOiUsd)} color="text-[#f87171]" />
        <Row label="Long capacity" value={usd(data.longCapacityUsd)} />
        <Row label="Short capacity" value={usd(data.shortCapacityUsd)} />

        <SectionLabel>Funding (per hour)</SectionLabel>
        <Row label="Longs pay" value={rate(data.fundingLongPerHour)} />
        <Row label="Shorts pay" value={rate(data.fundingShortPerHour)} />

        <SectionLabel>Parameters</SectionLabel>
        <Row label="Max leverage" value={`${data.maxLeverage}x`} />
        <Row label="Open / close fee" value={`${(data.openFeeBps / 100).toFixed(2)}%`} />
      </div>

      {data.poolLiquidityUsd === null && (
        <div className="flex shrink-0 items-center gap-1.5 border-t border-white/5 px-3 py-2 text-[10px] text-[#666]">
          <Info className="h-3 w-3 shrink-0" />
          Pool, OI and funding are available after the pool launches
        </div>
      )}
    </div>
  );
}
