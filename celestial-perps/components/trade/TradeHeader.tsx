"use client";

import { useState } from "react";
import { Check, ChevronDown, Orbit, Wallet } from "lucide-react";
import { fmtPct, fmtUsd } from "@/lib/format";
import { MARKETS, marketOf, type MarketId } from "@/lib/marketData";
import type { ConnectedWallet } from "@/lib/wallet";
import type { FeedStatus } from "@/hooks/useLivePrice";
import type { OracleStatus } from "@/hooks/useOraclePrice";
import { AccountMenu } from "./AccountMenu";
import { Stat } from "./ui";

const STATUS_STYLE: Record<FeedStatus, { label: string; color: string; ping: boolean }> = {
  live: { label: "Live", color: "#22c55e", ping: true },
  connecting: { label: "Sync", color: "#f7931a", ping: false },
  stale: { label: "Stale", color: "#f7931a", ping: false },
  error: { label: "Offline", color: "#ef4444", ping: false },
};

export function TradeHeader({
  market,
  onMarketChange,
  price,
  priceUp,
  feedStatus,
  change24h,
  oraclePrice,
  oracleStatus,
  wallet,
  onConnect,
  onDisconnect,
}: {
  market: MarketId;
  onMarketChange: (m: MarketId) => void;
  price: number | null;
  priceUp: boolean;
  feedStatus: FeedStatus;
  change24h: number | null;
  oraclePrice: number | null;
  oracleStatus: OracleStatus;
  wallet: ConnectedWallet | null;
  onConnect: () => void;
  onDisconnect: () => Promise<void>;
}) {
  const [showMarketMenu, setShowMarketMenu] = useState(false);
  const status = STATUS_STYLE[feedStatus];

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/5 px-4">
      {/* left cluster */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#22c55e]/10 ring-1 ring-inset ring-[#22c55e]/25">
            <Orbit className="h-4 w-4 text-[#22c55e]" strokeWidth={2.25} />
          </span>
          <span className="hidden text-sm font-bold tracking-tight sm:block">CELESTIAL PERPS</span>
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowMarketMenu((v) => !v)}
            className="flex items-center gap-2 rounded-md border border-white/5 bg-[#121212]/80 px-2.5 py-1.5 backdrop-blur-sm transition-colors hover:border-white/10 hover:bg-[#1a1a1a]"
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: marketOf(market).color }} />
            <span className="text-sm font-semibold">{market}</span>
            <ChevronDown
              className={`h-4 w-4 text-[#888] transition-transform ${showMarketMenu ? "rotate-180" : ""}`}
            />
          </button>
          {showMarketMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMarketMenu(false)} />
              <div className="absolute left-0 z-50 mt-2 w-44 rounded-xl border border-white/10 bg-[#121212] p-1.5 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]">
                {MARKETS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      onMarketChange(m.id);
                      setShowMarketMenu(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                      market === m.id ? "bg-white/10 text-white" : "text-[#888] hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: m.color }} />
                    <span className="font-semibold">{m.id}</span>
                    {market === m.id && <Check className="ml-auto h-3.5 w-3.5 text-[#22c55e]" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* right cluster */}
      <div className="flex items-center gap-3 sm:gap-4">
        {/* live data-stream status */}
        <span className="hidden items-center gap-1.5 rounded-md border border-white/[0.06] bg-[#0d0d0d] px-2 py-1 sm:flex">
          <span className="relative flex h-1.5 w-1.5">
            {status.ping && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22c55e]/70" />
            )}
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ backgroundColor: status.color }} />
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#888]">{status.label}</span>
        </span>

        <div className="flex items-center gap-3 sm:gap-4">
          <Stat
            label="Price"
            value={price !== null ? fmtUsd(price) : "—"}
            color={priceUp ? "text-[#22c55e]" : "text-[#ef4444]"}
            title="Coinbase index price"
          />
          <span className="hidden h-7 w-px bg-white/[0.07] sm:block" />
          <Stat
            label="24h Change"
            value={change24h !== null ? fmtPct(change24h) : "—"}
            color={change24h !== null && change24h >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"}
            className="hidden sm:flex"
          />
          <span className="hidden h-7 w-px bg-white/[0.07] md:block" />
          <Stat
            label="Oracle"
            value={oraclePrice !== null ? fmtUsd(oraclePrice) : "—"}
            color={oracleStatus === "stale" || oracleStatus === "error" ? "text-[#f7931a]" : "text-white"}
            className="hidden md:flex"
            title={oracleStatus === "unavailable" ? "No Chainlink feed on Sepolia" : "Chainlink (Sepolia)"}
          />
          <span className="hidden h-7 w-px bg-white/[0.07] lg:block" />
          <Stat label="Funding" value="—" className="hidden lg:flex" title="Available after the pool launches" />
        </div>
        {wallet ? (
          <AccountMenu wallet={wallet} onDisconnect={onDisconnect} />
        ) : (
          <button
            type="button"
            onClick={onConnect}
            className="flex items-center gap-2 rounded-lg bg-[#22c55e] px-3.5 py-2 text-sm font-bold text-black shadow-[0_0_20px_-6px_rgba(34,197,94,0.6)] transition-colors hover:bg-[#16a34a]"
          >
            <Wallet className="h-4 w-4" strokeWidth={2.5} />
            <span className="hidden sm:inline">Connect Wallet</span>
            <span className="sm:hidden">Connect</span>
          </button>
        )}
      </div>
    </header>
  );
}
