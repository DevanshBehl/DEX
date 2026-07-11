"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import {
  ArrowRight,
  Download,
  ChevronRight,
  Fingerprint,
  Wallet,
  Gauge,
  Github,
  Twitter,
  Linkedin,
  User,
} from "lucide-react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/* -------------------------- deterministic candles ------------------------- */
/* Seeded walk so server and client render identically (no hydration drift).  */

type Candle = { o: number; h: number; l: number; c: number; v: number };

function generateCandles(n: number): Candle[] {
  let price = 63820;
  let seed = 987654321;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const drift = (rand() - 0.44) * 78;
    const open = price;
    const close = open + drift;
    const high = Math.max(open, close) + rand() * 46;
    const low = Math.min(open, close) - rand() * 46;
    const v = 0.28 + rand() * 1.5;
    out.push({ o: open, h: high, l: low, c: close, v });
    price = close;
  }
  return out;
}

const CANDLES = generateCandles(38);
const LAST = CANDLES[CANDLES.length - 1].c;
const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/* -------- geometry (computed once, drives the SVG candlestick chart) ------- */

const CW = 700;
const CH = 340;
const PAD_T = 14;
const VOL_H = 46;
const AXIS_GAP = 8;
const PAD_R = 62;
const PLOT_BOTTOM = CH - VOL_H - AXIS_GAP;
const PLOT_W = CW - PAD_R;

const highs = CANDLES.map((c) => c.h);
const lows = CANDLES.map((c) => c.l);
const HI = Math.max(...highs) + 25;
const LO = Math.min(...lows) - 25;
const MAXV = Math.max(...CANDLES.map((c) => c.v));

const yPrice = (p: number) =>
  PAD_T + ((HI - p) / (HI - LO)) * (PLOT_BOTTOM - PAD_T);
const step = PLOT_W / CANDLES.length;
const bodyW = step * 0.58;

// 7-period moving average
const MA = CANDLES.map((_, i) => {
  const s = Math.max(0, i - 6);
  const slice = CANDLES.slice(s, i + 1);
  return slice.reduce((a, b) => a + b.c, 0) / slice.length;
});
const maPath = MA.map(
  (m, i) => `${i === 0 ? "M" : "L"}${(step * i + step / 2).toFixed(1)},${yPrice(m).toFixed(1)}`
).join(" ");

const priceLevels = Array.from({ length: 5 }, (_, i) => HI - ((HI - LO) / 4) * i);

const ORDER_ROWS = [
  { p: 64_452.5, s: 0.842, d: 34 },
  { p: 64_448.0, s: 1.204, d: 52 },
  { p: 64_443.5, s: 0.318, d: 24 },
  { p: 64_439.0, s: 2.671, d: 78 },
  { p: 64_434.5, s: 0.945, d: 44 },
];
const BID_ROWS = [
  { p: 64_425.0, s: 1.532, d: 66 },
  { p: 64_420.5, s: 0.764, d: 40 },
  { p: 64_416.0, s: 3.108, d: 92 },
  { p: 64_411.5, s: 0.427, d: 28 },
  { p: 64_407.0, s: 1.896, d: 58 },
];

/* ---- ambient blockchain logos (arc behind hero) ---- */
const CHAIN_LOGOS: React.ReactNode[] = [
  // Ethereum
  <svg key="eth" viewBox="0 0 256 417" className="h-full w-full">
    <path fill="#627EEA" d="M127.96 0 0 212.32l127.96 75.64 127.96-75.64z" />
    <path
      fill="#627EEA"
      opacity="0.55"
      d="M127.96 312.3 0 212.3l127.96 204.45L256 212.3z"
    />
  </svg>,
  // Solana
  <svg key="sol" viewBox="0 0 400 400" className="h-full w-full">
    <defs>
      <linearGradient id="solg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#14F195" />
        <stop offset="100%" stopColor="#9945FF" />
      </linearGradient>
    </defs>
    <path
      d="M64 268l42-42h230l-42 42H64zm0-136l42-42h230l-42 42H64zm42 68l-42-42h230l42 42H106z"
      fill="url(#solg)"
    />
  </svg>,
  // Bitcoin
  <svg key="btc" viewBox="0 0 64 64" className="h-full w-full">
    <circle cx="32" cy="32" r="32" fill="#F7931A" />
    <text
      x="32"
      y="45"
      textAnchor="middle"
      fontSize="40"
      fontWeight="700"
      fill="#fff"
    >
      ₿
    </text>
  </svg>,
  // Arbitrum
  <svg key="arb" viewBox="0 0 64 64" className="h-full w-full">
    <circle cx="32" cy="32" r="32" fill="#213147" />
    <path d="M32 14 48 46h-9L32 30 25 46h-9z" fill="#28A0F0" />
    <path d="M38 46 32 34l-3 6 3 6z" fill="#96BEDC" />
  </svg>,
  // Base
  <svg key="base" viewBox="0 0 64 64" className="h-full w-full">
    <circle cx="32" cy="32" r="32" fill="#0052FF" />
    <path
      d="M32 50c9.94 0 18-8.06 18-18S41.94 14 32 14 14 22.06 14 32c0 .34.01.67.03 1H40v2H14.03c-.02.33-.03.66-.03 1 9.94 0 18 8.06 18 18z"
      fill="#fff"
    />
  </svg>,
  // Optimism
  <svg key="op" viewBox="0 0 64 64" className="h-full w-full">
    <circle cx="32" cy="32" r="32" fill="#FF0420" />
    <text
      x="32"
      y="40"
      textAnchor="middle"
      fontSize="20"
      fontWeight="800"
      fill="#fff"
    >
      OP
    </text>
  </svg>,
];

const FEATURES = [
  {
    icon: Fingerprint,
    title: "Self-custodial by default",
    body: "Orders are signed locally by your Celestial Wallet. Funds never leave your control — not to us, not to anyone.",
  },
  {
    icon: Wallet,
    title: "Works with any wallet",
    body: "Connect the Celestial Wallet or bring your own. No new accounts, no email, no sign-up flow.",
  },
  {
    icon: Gauge,
    title: "Built for real trading",
    body: "A deep order book, precise leverage control, and an execution engine tuned for perpetuals.",
  },
];

/* -------------------------------- component ------------------------------- */

export default function Page() {
  const mainRef = useRef<HTMLElement>(null);
  const termRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      // Ambient blockchain logos — gentle multi-directional oscillation
      gsap.utils.toArray<HTMLElement>(".chain-logo").forEach((el, i) => {
        const dir = i % 2 === 0 ? 1 : -1;
        gsap.to(el, {
          y: `+=${14 + (i % 3) * 8}`,
          x: `+=${dir * (10 + (i % 2) * 8)}`,
          rotation: dir * (4 + (i % 3)),
          duration: 4.5 + (i % 3) * 1.3,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true,
          delay: i * 0.35,
        });
      });

      // Hero entrance
      gsap.from(".hero-stagger", {
        y: 26,
        opacity: 0,
        duration: 0.9,
        ease: "power3.out",
        stagger: 0.09,
      });

      // Generic scroll reveals
      gsap.utils.toArray<HTMLElement>(".reveal").forEach((el) => {
        gsap.from(el, {
          y: 34,
          opacity: 0,
          duration: 0.8,
          ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 86%" },
        });
      });

      // Terminal reveal + candlestick draw
      const showCandles = () => {
        gsap.from(".candle", {
          opacity: 0,
          y: 12,
          scaleY: 0.6,
          transformOrigin: "50% 100%",
          duration: 0.5,
          ease: "power2.out",
          stagger: 0.018,
        });
        gsap.fromTo(
          ".ma-line",
          { strokeDashoffset: 1600 },
          { strokeDashoffset: 0, duration: 1.6, ease: "power2.out" }
        );
      };

      gsap.fromTo(
        termRef.current,
        { opacity: 0, scale: 0.965, y: 28 },
        {
          opacity: 1,
          scale: 1,
          y: 0,
          duration: 1,
          ease: "power3.out",
          scrollTrigger: {
            trigger: termRef.current,
            start: "top 82%",
            onEnter: showCandles,
          },
        }
      );

      // Live last-price pulse
      gsap.to(".price-pulse", {
        scale: 1.9,
        opacity: 0,
        duration: 1.8,
        ease: "power1.out",
        repeat: -1,
        transformOrigin: "center",
      });
    },
    { scope: mainRef }
  );

  return (
    <main ref={mainRef} className="relative bg-[#0b0b0e]">
      {/* ============================ NAV ============================ */}
      <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[#0b0b0e]/70 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-baseline gap-1.5">
            <span className="wordmark text-lg text-white">Celestial</span>
            <span className="wordmark text-lg text-[var(--muted)]">Perps</span>
          </div>
          <div className="hidden items-center gap-8 md:flex">
            {["Trade", "Markets", "Docs"].map((l) => (
              <a
                key={l}
                href="#"
                className="text-sm font-medium text-[var(--ink-2)] transition-colors hover:text-white"
              >
                {l}
              </a>
            ))}
          </div>
          <button className="btn-primary !px-4 !py-2 text-sm">
            Launch App
            <ChevronRight className="h-4 w-4" />
          </button>
        </nav>
      </header>

      {/* ============================ HERO ============================ */}
      <section className="relative overflow-hidden bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#3700b3]/20 via-[#0b0b0e] to-[#0b0b0e] px-6 pt-24 pb-6 text-center md:pt-32">
        {/* ambient blockchain logos, scattered through the hero's empty sides */}
        <div className="pointer-events-none absolute inset-0 z-0 hidden md:block">
          {CHAIN_LOGOS.map((logo, i) => {
            // scattered around the copy — asymmetric, in the empty side spaces
            const spots: { top: string; size: number; left?: string; right?: string }[] = [
              { left: "10%", top: "19%", size: 74 }, // ETH  upper-left
              { left: "4%", top: "61%", size: 50 }, //  SOL  lower-left
              { left: "18%", top: "87%", size: 62 }, // BTC  bottom-left
              { right: "13%", top: "13%", size: 58 }, // ARB  upper-right
              { right: "6%", top: "43%", size: 80 }, //  Base mid-right
              { right: "16%", top: "79%", size: 52 }, // OP   lower-right
            ];
            const s = spots[i];
            return (
              <div
                key={i}
                className="chain-logo absolute opacity-50 blur-[1px]"
                style={{
                  top: s.top,
                  left: s.left,
                  right: s.right,
                  width: s.size,
                  height: s.size,
                }}
              >
                {logo}
              </div>
            );
          })}
        </div>

        <div className="relative z-10 mx-auto max-w-6xl">
          <h1 className="hero-stagger mx-auto max-w-4xl text-5xl font-black leading-[0.98] tracking-tight text-black md:text-7xl lg:text-8xl">
            Trade Perps.
            <br />
            <span className="text-[var(--muted)]">Stay Sovereign.</span>
          </h1>

          <p className="hero-stagger mx-auto mt-6 max-w-xl text-lg text-[var(--ink-2)]">
            The decentralized trading terminal built for the Celestial
            ecosystem. Trade perpetuals directly from your wallet — with zero
            custody.
          </p>

          <div className="hero-stagger mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button className="btn-primary w-full sm:w-auto">
              Launch App
              <ArrowRight className="h-4.5 w-4.5" />
            </button>
            <button className="btn-secondary w-full sm:w-auto">
              <Download className="h-4.5 w-4.5" />
              Download Wallet
            </button>
          </div>
        </div>
      </section>

      {/* ====================== TRADING TERMINAL ====================== */}
      <section className="relative mx-auto max-w-6xl px-6 pt-10 pb-24">
        <div
          ref={termRef}
          className="relative mx-auto w-full max-w-5xl overflow-hidden rounded-2xl border border-black/10 bg-[#0b0b0d] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.55)]"
        >
          {/* window bar */}
          <div className="flex h-12 items-center gap-4 border-b border-white/10 px-4">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
              <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
              <span className="h-3 w-3 rounded-full bg-[#28c840]" />
            </div>
            <div className="flex items-center gap-2.5 text-sm">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-[#f7931a] text-[10px] font-black text-white">
                ₿
              </span>
              <span className="font-semibold text-white">BTC-PERP</span>
              <span className="font-mono text-white/50">·</span>
              <span className="font-mono text-white">${fmt(LAST)}</span>
              <span className="font-mono text-xs text-[var(--up)]">+0.94%</span>
            </div>
            <div className="ml-auto hidden items-center gap-5 font-mono text-xs text-white/40 lg:flex">
              <span>Mark ${fmt(LAST + 1.5)}</span>
              <span>Funding 0.0091%</span>
              <span>24h Vol 4,182 BTC</span>
            </div>
          </div>

          <div className="flex min-h-0 flex-col lg:flex-row">
            {/* chart pane */}
            <div className="relative flex-1 p-3">
              {/* timeframe tabs */}
              <div className="mb-2 flex items-center gap-1 px-1 font-mono text-[11px] text-white/40">
                {["1m", "5m", "15m", "1H", "4H", "1D"].map((t) => (
                  <span
                    key={t}
                    className={`rounded px-1.5 py-0.5 ${
                      t === "15m"
                        ? "bg-white/10 font-semibold text-white"
                        : "hover:text-white/70"
                    }`}
                  >
                    {t}
                  </span>
                ))}
                <span className="ml-auto rounded px-1.5 py-0.5 text-white/40">
                  MA 7
                </span>
              </div>

              {/* candlestick svg */}
              <svg
                viewBox={`0 0 ${CW} ${CH}`}
                className="h-[300px] w-full md:h-[360px]"
                preserveAspectRatio="none"
              >
                {/* grid + price axis */}
                {priceLevels.map((p, i) => (
                  <g key={i}>
                    <line
                      x1="0"
                      x2={PLOT_W}
                      y1={yPrice(p)}
                      y2={yPrice(p)}
                      stroke="rgba(255,255,255,0.05)"
                      strokeWidth="1"
                    />
                    <text
                      x={CW - PAD_R + 8}
                      y={yPrice(p) + 3.5}
                      fill="rgba(255,255,255,0.38)"
                      fontSize="10"
                      fontFamily="monospace"
                    >
                      {p.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                    </text>
                  </g>
                ))}

                {/* moving average */}
                <path
                  className="ma-line"
                  d={maPath}
                  fill="none"
                  stroke="rgba(255,255,255,0.32)"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="1600"
                />

                {/* candles + volume */}
                {CANDLES.map((c, i) => {
                  const up = c.c >= c.o;
                  const color = up ? "#10b981" : "#ef4444";
                  const cx = step * i + step / 2;
                  const bodyTop = yPrice(Math.max(c.o, c.c));
                  const bodyH = Math.max(1.5, Math.abs(yPrice(c.o) - yPrice(c.c)));
                  const vH = (c.v / MAXV) * VOL_H;
                  return (
                    <g key={i} className="candle">
                      <line
                        x1={cx}
                        x2={cx}
                        y1={yPrice(c.h)}
                        y2={yPrice(c.l)}
                        stroke={color}
                        strokeWidth="1.2"
                      />
                      <rect
                        x={cx - bodyW / 2}
                        y={bodyTop}
                        width={bodyW}
                        height={bodyH}
                        rx="0.6"
                        fill={color}
                      />
                      <rect
                        x={cx - bodyW / 2}
                        y={CH - vH}
                        width={bodyW}
                        height={vH}
                        rx="0.6"
                        fill={color}
                        opacity="0.28"
                      />
                    </g>
                  );
                })}

                {/* last-price marker */}
                <line
                  x1="0"
                  x2={PLOT_W}
                  y1={yPrice(LAST)}
                  y2={yPrice(LAST)}
                  stroke="#10b981"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  opacity="0.7"
                />
                <rect
                  x={CW - PAD_R + 2}
                  y={yPrice(LAST) - 8}
                  width={PAD_R - 4}
                  height="16"
                  rx="3"
                  fill="#10b981"
                />
                <text
                  x={CW - PAD_R / 2}
                  y={yPrice(LAST) + 3.5}
                  fill="#04231a"
                  fontSize="10"
                  fontFamily="monospace"
                  fontWeight="700"
                  textAnchor="middle"
                >
                  {fmt(LAST)}
                </text>
                <circle
                  className="price-pulse"
                  cx={step * (CANDLES.length - 1) + step / 2}
                  cy={yPrice(LAST)}
                  r="4"
                  fill="#10b981"
                />
              </svg>
            </div>

            {/* order book + ticket */}
            <div className="flex w-full shrink-0 flex-col border-t border-white/10 lg:w-72 lg:border-l lg:border-t-0">
              <div className="flex flex-col gap-1 p-3">
                <div className="flex justify-between px-1 pb-1 font-mono text-[10px] uppercase tracking-wider text-white/35">
                  <span>Price</span>
                  <span>Size (BTC)</span>
                </div>
                {ORDER_ROWS.map((r, i) => (
                  <div
                    key={`a${i}`}
                    className="relative flex justify-between px-1 font-mono text-xs"
                  >
                    <div
                      className="absolute inset-y-0 right-0 bg-[#ef4444]/12"
                      style={{ width: `${r.d}%` }}
                    />
                    <span className="relative text-[#f87171]">
                      {fmt(r.p)}
                    </span>
                    <span className="relative text-white/45">
                      {r.s.toFixed(3)}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between px-1 py-1.5">
                  <span className="font-mono text-sm font-bold text-[var(--up)]">
                    {fmt(LAST)}
                  </span>
                  <span className="font-mono text-[10px] text-white/35">
                    Spread 0.8
                  </span>
                </div>
                {BID_ROWS.map((r, i) => (
                  <div
                    key={`b${i}`}
                    className="relative flex justify-between px-1 font-mono text-xs"
                  >
                    <div
                      className="absolute inset-y-0 right-0 bg-[#10b981]/12"
                      style={{ width: `${r.d}%` }}
                    />
                    <span className="relative text-[#34d399]">
                      {fmt(r.p)}
                    </span>
                    <span className="relative text-white/45">
                      {r.s.toFixed(3)}
                    </span>
                  </div>
                ))}
              </div>

              {/* ticket */}
              <div className="mt-auto border-t border-white/10 p-3">
                <div className="mb-2 flex gap-1 rounded-lg bg-white/5 p-1 text-center text-[11px] font-semibold">
                  <span className="flex-1 rounded-md bg-white/10 py-1 text-white">
                    Market
                  </span>
                  <span className="flex-1 py-1 text-white/40">Limit</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-white/10 px-2.5 py-2 font-mono text-xs text-white/60">
                  <span>Size</span>
                  <span className="text-white">0.50 BTC</span>
                </div>
                <div className="mt-2 flex items-center justify-between px-1 font-mono text-[11px] text-white/40">
                  <span>Leverage</span>
                  <span className="text-white/70">10×</span>
                </div>
                <div className="mt-1.5 h-1 w-full rounded-full bg-white/10">
                  <div className="h-full w-1/5 rounded-full bg-white/60" />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button className="rounded-lg bg-[var(--up)] py-2.5 text-xs font-bold text-[#04231a]">
                    Long
                  </button>
                  <button className="rounded-lg bg-[var(--down)] py-2.5 text-xs font-bold text-white">
                    Short
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============================ FEATURES ============================ */}
      <section className="relative mx-auto max-w-6xl px-6 py-20">
        <div className="reveal mx-auto max-w-2xl">
          <span className="eyebrow">Why Celestial Perps</span>
          <h2 className="mt-4 text-4xl font-black tracking-tight text-black md:text-5xl">
            The exchange that never
            <br className="hidden md:block" /> holds your funds.
          </h2>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="reveal card p-8">
              <span className="grid h-11 w-11 place-items-center rounded-xl border border-[var(--line)] bg-[var(--bg-soft)] text-black">
                <f.icon className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <h3 className="mt-6 text-lg font-bold tracking-tight text-black">
                {f.title}
              </h3>
              <p className="mt-2.5 text-[15px] leading-relaxed text-[var(--ink-2)]">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ============================ CTA ============================ */}
      <section className="relative mx-auto max-w-6xl px-6 pb-24">
        <div className="reveal flex flex-col items-center justify-between gap-6 rounded-2xl border border-[var(--line)] bg-[var(--bg-soft)] px-8 py-12 text-center md:flex-row md:text-left">
          <div>
            <h2 className="text-3xl font-black tracking-tight text-black md:text-4xl">
              Ready to trade sovereign?
            </h2>
            <p className="mt-2 text-[var(--ink-2)]">
              Launch the terminal in seconds. No sign-ups, no custody.
            </p>
          </div>
          <button className="btn-primary shrink-0">
            Launch App
            <ArrowRight className="h-4.5 w-4.5" />
          </button>
        </div>
      </section>

      {/* ============================ FOOTER ============================ */}
      <footer className="relative mt-8 overflow-hidden bg-black px-6 pt-16 pb-8 lg:px-12">
        <div className="pointer-events-none absolute left-1/4 top-0 h-96 w-96 rounded-full bg-white/[0.04] blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 right-1/4 h-64 w-64 rounded-full bg-white/[0.04] blur-2xl" />

        <div className="relative z-10 mx-auto max-w-6xl">
          <div className="flex flex-col items-start justify-between gap-8 border-b border-white/10 pb-12 md:flex-row md:items-end md:gap-0">
            <div className="flex flex-col gap-4">
              <h2 className="wordmark text-2xl text-white">Celestial Perps.</h2>
              <p className="max-w-sm text-sm font-medium leading-relaxed text-neutral-400">
                The non-custodial perpetuals terminal for the Celestial
                ecosystem. Trade directly from your wallet — nothing held, ever.
              </p>
            </div>

            <div className="flex flex-col items-start gap-3 md:items-end md:text-right">
              <span className="mb-1 text-xs font-bold uppercase tracking-widest text-neutral-500">
                Engineering &amp; Design
              </span>
              <div className="group flex cursor-default items-center gap-3 rounded-full border border-white/10 bg-white/5 py-1 pl-1 pr-4 transition-all duration-300 hover:border-white/20 hover:bg-white/10">
                <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-white/20 bg-gradient-to-tr from-neutral-800 to-black transition-transform group-hover:scale-110">
                  <User className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
                </div>
                <span className="text-sm font-bold tracking-tight text-white">
                  Devansh Behl
                </span>
              </div>
              <div className="mt-2 flex items-center gap-4">
                {[Github, Twitter, Linkedin].map((Icon, i) => (
                  <a
                    key={i}
                    href="#"
                    className="text-neutral-400 transition-all duration-200 hover:-translate-y-1 hover:text-white"
                  >
                    <Icon className="h-5 w-5" strokeWidth={1.75} />
                  </a>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-col items-center justify-between gap-4 text-xs font-medium text-neutral-500 md:flex-row md:gap-0">
            <p>© {new Date().getFullYear()} Celestial Labs. All rights reserved.</p>
            <p className="text-neutral-600">
              Decentralized trading involves significant risk. Non-custodial.
            </p>
            <div className="flex gap-6">
              {["Terms", "Privacy"].map((t) => (
                <a
                  key={t}
                  href="#"
                  className="group relative transition-colors hover:text-white"
                >
                  {t}
                  <span className="absolute -bottom-1 left-0 h-px w-0 bg-white transition-all group-hover:w-full" />
                </a>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
