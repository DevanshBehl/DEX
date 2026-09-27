"use client";

// Celestial Perps — /status. Protocol health for both deployments, read straight from the chains
// (so it still works when the keeper is down): order queue, keepers, oracles, pool and markets.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Loader2, Orbit, XCircle } from "lucide-react";

import { sepoliaReader, solanaReader, type MarketState, type OpsStatus, type PerpsChain, type PoolState } from "@/lib/chains";
import { fmtAgo, fmtUsd, fmtUsdCompact } from "@/lib/format";
import { chainChecks, worst, type Check, type Level } from "@/lib/opsHealth";
import { toPrice, toUsd } from "@/lib/perpMath";
import { useVisibleInterval } from "@/hooks/usePerps";
import { PANEL } from "@/components/trade/ui";

const REFRESH_MS = 15_000;

type ChainSnapshot = { pool: PoolState; ops: OpsStatus; markets: MarketState[]; at: number };
type ChainView = { chain: PerpsChain; name: string; data: ChainSnapshot | null; error: string | null };

const TONE: Record<Level, { text: string; bg: string; label: string }> = {
  ok: { text: "text-[#22c55e]", bg: "bg-[#22c55e]/10 ring-[#22c55e]/25", label: "Operational" },
  warn: { text: "text-[#f7931a]", bg: "bg-[#f7931a]/10 ring-[#f7931a]/25", label: "Degraded" },
  down: { text: "text-[#ef4444]", bg: "bg-[#ef4444]/10 ring-[#ef4444]/25", label: "Down" },
};

async function readChain(chain: PerpsChain): Promise<ChainSnapshot> {
  const ids = await chain.getMarkets();
  const [pool, ops, markets] = await Promise.all([chain.getPool(), chain.getOpsStatus(), Promise.all(ids.map((m) => chain.getMarketState(m)))]);
  return { pool, ops, markets, at: Date.now() };
}

function LevelIcon({ level, className = "h-4 w-4" }: { level: Level; className?: string }) {
  const Icon = level === "ok" ? CheckCircle2 : level === "warn" ? AlertTriangle : XCircle;
  return <Icon className={`${className} ${TONE[level].text} shrink-0`} />;
}

function CheckRow({ c }: { c: Check }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      <LevelIcon level={c.level} className="mt-0.5 h-3.5 w-3.5" />
      <span className="w-40 shrink-0 font-semibold text-white/85">{c.label}</span>
      <span className="text-[#aaa]">{c.detail}</span>
    </li>
  );
}

function ChainPanel({ view }: { view: ChainView }) {
  const { data, error, chain, name } = view;
  if (!data) {
    return (
      <section className={`${PANEL} p-4`}>
        <h2 className="mb-3 text-base font-bold">{name}</h2>
        {error ? (
          <p className="flex items-center gap-2 text-sm text-[#ef4444]">
            <XCircle className="h-4 w-4" /> RPC unavailable: {error.slice(0, 160)}
          </p>
        ) : (
          <Loader2 className="h-5 w-5 animate-spin text-[#888]" />
        )}
      </section>
    );
  }
  const checks = chainChecks(data.ops, data.markets, chain.nativeSymbol, chain.nativeDecimals);
  const level = worst(checks.map((c) => c.level));
  const tone = TONE[level];
  return (
    <section className={`${PANEL} p-4`}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold">{name}</h2>
        <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset ${tone.bg} ${tone.text}`}>
          <LevelIcon level={level} className="h-3.5 w-3.5" /> {tone.label}
        </span>
      </div>

      <ul className="mb-5 space-y-2">{checks.map((c) => <CheckRow key={c.label} c={c} />)}</ul>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Pool AUM" value={fmtUsdCompact(toUsd(data.pool.aum))} />
        <Metric label="CLP price" value={fmtUsd(toPrice(data.pool.clpPrice))} />
        <Metric label="Reserved" value={fmtUsdCompact(toUsd(data.pool.reserved))} />
        <Metric label="Unreserved" value={fmtUsdCompact(toUsd(data.pool.available))} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[10px] uppercase tracking-wide text-[#888]">
            <tr>
              <th className="py-1 pr-3 font-medium">Market</th>
              <th className="py-1 pr-3 font-medium">Oracle</th>
              <th className="py-1 pr-3 font-medium">Long OI / cap</th>
              <th className="py-1 pr-3 font-medium">Short OI / cap</th>
              <th className="py-1 font-medium">Funding / h</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {data.markets.map((m) => (
              <tr key={m.market} className="border-t border-white/5">
                <td className="py-1.5 pr-3 font-sans font-semibold">{m.market}</td>
                <td className={`py-1.5 pr-3 ${m.price === null ? "text-[#f7931a]" : ""}`}>
                  {m.price === null ? "stale" : `${fmtUsd(toPrice(m.price))}${m.priceUpdatedAt ? ` · ${fmtAgo(m.priceUpdatedAt)}` : ""}`}
                </td>
                <td className="py-1.5 pr-3">{utilisation(m.longSize, m.longCapacity)}</td>
                <td className="py-1.5 pr-3">{utilisation(m.shortSize, m.shortCapacity)}</td>
                <td className="py-1.5">{fundingLabel(m)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-[10px] text-[#666]">
        Chain time {new Date(data.ops.now * 1000).toLocaleTimeString()} · read {fmtAgo(data.at / 1000)}
        {error ? <span className="text-[#f7931a]"> · last refresh failed: {error.slice(0, 80)}</span> : null}
      </p>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-black/30 p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-[#888]">{label}</p>
      <p className="font-mono text-sm tabular-nums">{value}</p>
    </div>
  );
}

function utilisation(size: bigint, capacity: bigint): string {
  const cap = size + capacity;
  const pct = cap > 0n ? Math.round((Number(size) / Number(cap)) * 100) : 0;
  return `${fmtUsdCompact(toUsd(size))} / ${fmtUsdCompact(toUsd(cap))} (${pct}%)`;
}

function fundingLabel(m: MarketState): string {
  const rate = m.fundingRateLongPerHour > 0n ? m.fundingRateLongPerHour : m.fundingRateShortPerHour;
  if (rate === 0n) return "—";
  return `${((Number(rate) / 1e18) * 100).toFixed(4)}% ${m.fundingRateLongPerHour > 0n ? "longs pay" : "shorts pay"}`;
}

const CHAINS: { chain: () => PerpsChain; name: string }[] = [
  { chain: sepoliaReader, name: "Ethereum Sepolia" },
  { chain: solanaReader, name: "Solana devnet" },
];

export default function StatusApp() {
  const [views, setViews] = useState<ChainView[]>(() => CHAINS.map((c) => ({ chain: c.chain(), name: c.name, data: null, error: null })));

  // Each chain loads on its own: one slow or failing RPC never blanks the other.
  const load = useCallback(() => {
    CHAINS.forEach((c, i) => {
      readChain(c.chain())
        .then((data) => setViews((vs) => vs.map((x, j) => (j === i ? { ...x, data, error: null } : x))))
        .catch((e) => setViews((vs) => vs.map((x, j) => (j === i ? { ...x, error: e instanceof Error ? e.message : String(e) } : x))));
    });
  }, []);

  useEffect(() => load(), [load]);
  useVisibleInterval(load, REFRESH_MS);

  const levels = views.map((v) => (v.data ? worst(chainChecks(v.data.ops, v.data.markets, v.chain.nativeSymbol, v.chain.nativeDecimals).map((c) => c.level)) : v.error ? "down" : "ok"));
  const overall = worst(levels);

  return (
    <main className="min-h-screen w-full bg-black text-white">
      <header className="flex h-14 items-center justify-between border-b border-white/5 px-4">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#22c55e]/10 ring-1 ring-inset ring-[#22c55e]/25">
              <Orbit className="h-4 w-4 text-[#22c55e]" strokeWidth={2.25} />
            </span>
            <span className="hidden text-sm font-bold tracking-tight sm:block">CELESTIAL PERPS</span>
          </Link>
          <nav className="flex items-center gap-1 text-xs font-semibold">
            <Link href="/trade" className="rounded-md px-2 py-1 text-[#888] hover:text-white">Trade</Link>
            <Link href="/earn" className="rounded-md px-2 py-1 text-[#888] hover:text-white">Earn</Link>
            <Link href="/status" className="rounded-md px-2 py-1 text-white">Status</Link>
          </nav>
        </div>
        <span className={`flex items-center gap-1.5 text-xs font-semibold ${TONE[overall].text}`}>
          <LevelIcon level={overall} className="h-3.5 w-3.5" />
          {overall === "ok" ? "All systems operational" : overall === "warn" ? "Degraded" : "Outage"}
        </span>
      </header>

      <div className="mx-auto max-w-5xl space-y-3 p-4">
        <p className="text-xs text-[#888]">
          Read directly from the chains every {REFRESH_MS / 1000} s — independent of the keeper. Orders normally fill within ~2 s.
        </p>
        {views.map((v) => (
          <ChainPanel key={v.name} view={v} />
        ))}
      </div>
    </main>
  );
}
