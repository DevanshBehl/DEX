"use client";

// Celestial Perps — Trade terminal (V1 UI shell, mock data).
// Pure Tailwind arbitrary values; no config additions required.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  type UTCTimestamp,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
} from "lightweight-charts";
import {
  Orbit,
  ChevronDown,
  Loader2,
  Wallet,
  ArrowUp,
  ArrowDown,
  TrendingUp,
  TrendingDown,
  ListOrdered,
  History,
  X,
  LogOut,
  Copy,
  Check,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  WEB3 — minimal injected-provider typings (EVM + Solana)            */
/* ------------------------------------------------------------------ */

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<string[]>;
};

type SolanaProvider = {
  connect: () => Promise<{ publicKey: { toString: () => string } }>;
  disconnect?: () => Promise<void>;
};

type Web3Window = Window & {
  ethereum?: Eip1193Provider;
  solana?: SolanaProvider;
};

type ConnectedWallet = {
  address: string;
  chain: "Ethereum" | "Solana";
  walletName?: string;
};

// --- EIP-6963 (multi-wallet discovery for EVM — MetaMask, Celestial, etc.) ---
type Eip6963ProviderDetail = {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
};

// --- Wallet Standard (the modern Solana discovery mechanism Tensor/Phantom use) ---
type StandardConnectFeature = {
  connect: () => Promise<{ accounts: readonly { address: string }[] }>;
};
type StandardDisconnectFeature = { disconnect: () => Promise<void> };
type StandardWallet = {
  name: string;
  icon?: string;
  chains?: readonly string[];
  features: Record<string, unknown> & {
    "standard:connect"?: StandardConnectFeature;
    "standard:disconnect"?: StandardDisconnectFeature;
  };
};

const isSolanaWallet = (w: StandardWallet) =>
  !!w.features?.["standard:connect"] && (w.chains?.some((c) => c.startsWith("solana:")) ?? true);

/* ------------------------------------------------------------------ */
/*  MOCK DATA — swap these consts for live feeds later                 */
/* ------------------------------------------------------------------ */

const STATS = {
  market: "BTC-USD",
  price: "67,432.10",
  markPrice: 67432.1,
  change: "+2.34%",
  changeUp: true,
  volume: "$1.24B",
  funding: "+0.0102%",
  fundingUp: true,
  spread: "0.5",
};

const POSITION = {
  market: "BTC-USD",
  side: "Long",
  leverage: "10x",
  size: "0.75 BTC",
  entry: "$65,900.00",
  mark: "$67,432.10",
  liq: "$59,310.00",
  pnl: "+$1,149.08",
  pnlPct: "+17.4%",
};

/* ------------------------------------------------------------------ */
/*  BINANCE MARKETS — live REST + WebSocket data source                */
/* ------------------------------------------------------------------ */

type Market = "BTC-USD" | "ETH-USD" | "SOL-USD";

const MARKETS: { id: Market; symbol: string; color: string }[] = [
  { id: "BTC-USD", symbol: "BTCUSDT", color: "#f7931a" },
  { id: "ETH-USD", symbol: "ETHUSDT", color: "#627eea" },
  { id: "SOL-USD", symbol: "SOLUSDT", color: "#14f195" },
];
const marketOf = (m: Market) => MARKETS.find((x) => x.id === m)!;

const BINANCE_REST = "https://api.binance.com";
const BINANCE_WS = "wss://stream.binance.com:9443/ws";

const GREEN = "#22c55e";
const RED = "#ef4444";

// Binance raw depth level: ["price", "quantity"]
type DepthLevel = [string, string];
type BookLevel = { price: number; size: number; total: number };

// Turn raw depth into cumulative-total rows (best/nearest-spread level first).
function processDepth(raw: DepthLevel[], count = 10): { rows: BookLevel[]; maxTotal: number } {
  const rows: BookLevel[] = [];
  let total = 0;
  for (let i = 0; i < Math.min(count, raw.length); i++) {
    const price = parseFloat(raw[i][0]);
    const size = parseFloat(raw[i][1]);
    if (Number.isNaN(price) || Number.isNaN(size)) continue;
    total += size;
    rows.push({ price, size, total: +total.toFixed(4) });
  }
  return { rows, maxTotal: total || 1 };
}

const fmtPrice = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtVol = (v: number) =>
  v >= 1e9
    ? `$${(v / 1e9).toFixed(2)}B`
    : v >= 1e6
      ? `$${(v / 1e6).toFixed(2)}M`
      : `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/* ------------------------------------------------------------------ */
/*  SUB-COMPONENTS                                                     */
/* ------------------------------------------------------------------ */

function Stat({
  label,
  value,
  color = "text-white",
  className = "",
}: {
  label: string;
  value: string;
  color?: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-col leading-tight ${className}`}>
      <span className="text-[10px] uppercase tracking-wide text-[#888]">{label}</span>
      <span className={`font-mono text-sm tabular-nums ${color}`}>{value}</span>
    </div>
  );
}

function BookRow({ level, side, maxTotal }: { level: BookLevel; side: "ask" | "bid"; maxTotal: number }) {
  const isAsk = side === "ask";
  const width = `${Math.min(100, (level.total / maxTotal) * 100)}%`;
  return (
    <div className="group relative flex cursor-pointer items-center px-2 font-mono text-[11px] tabular-nums leading-[19px] transition-colors hover:bg-white/[0.04]">
      <div
        className={`absolute inset-y-px right-0 ${
          isAsk
            ? "bg-gradient-to-l from-[#ef4444]/20 to-[#ef4444]/[0.03]"
            : "bg-gradient-to-l from-[#22c55e]/20 to-[#22c55e]/[0.03]"
        }`}
        style={{ width }}
        aria-hidden
      />
      <span className={`relative z-10 flex-1 ${isAsk ? "text-[#f87171]" : "text-[#34d399]"}`}>
        {fmtPrice(level.price)}
      </span>
      <span className="relative z-10 flex-1 text-right text-white/75">{level.size.toFixed(3)}</span>
      <span className="relative z-10 flex-1 text-right text-[#777] group-hover:text-[#999]">
        {level.total.toFixed(2)}
      </span>
    </div>
  );
}

function BookSkeleton() {
  return (
    <div className="animate-pulse space-y-[3px] px-2 py-1">
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="h-2 flex-1 rounded-sm bg-white/[0.05]" />
          <div className="h-2 w-7 rounded-sm bg-white/[0.03]" />
          <div className="h-2 w-7 rounded-sm bg-white/[0.03]" />
        </div>
      ))}
    </div>
  );
}

function PriceChart({
  symbol,
  onPrice,
  onLoadingChange,
}: {
  symbol: string;
  onPrice: (price: number) => void;
  onLoadingChange: (loading: boolean) => void;
}) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  // Create the chart + series once; the data source is swapped separately below.
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#888",
      },
      grid: {
        vertLines: { color: "rgba(255, 255, 255, 0.05)" },
        horzLines: { color: "rgba(255, 255, 255, 0.05)" },
      },
      width: container.clientWidth,
      height: container.clientHeight,
      timeScale: { timeVisible: true, borderVisible: false },
      rightPriceScale: { borderVisible: false },
      crosshair: { mode: CrosshairMode.Normal }, // free crosshair — pro-terminal feel
    });

    seriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });
    chartRef.current = chart;

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Load the REST snapshot, then stream 1m klines over WebSocket. Re-runs (and
  // tears down the old socket) whenever the symbol changes.
  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    onLoadingChange(true);

    (async () => {
      try {
        const res = await fetch(
          `${BINANCE_REST}/api/v3/klines?symbol=${symbol}&interval=1m&limit=100`
        );
        const raw = (await res.json()) as [number, string, string, string, string][];
        if (cancelled || !seriesRef.current) return;

        const data: CandlestickData<UTCTimestamp>[] = raw.map((k) => ({
          time: (k[0] / 1000) as UTCTimestamp,
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
        }));
        seriesRef.current.setData(data);
        chartRef.current?.timeScale().fitContent();
        if (data.length) onPrice(data[data.length - 1].close); // seed header immediately
      } catch (err) {
        console.error("Binance klines fetch failed:", err);
      } finally {
        if (!cancelled) onLoadingChange(false);
      }

      if (cancelled) return;

      ws = new WebSocket(`${BINANCE_WS}/${symbol.toLowerCase()}@kline_1m`);
      ws.onmessage = (ev) => {
        if (cancelled || !seriesRef.current) return;
        const msg = JSON.parse(ev.data) as {
          k?: { t: number; o: string; h: string; l: string; c: string };
        };
        const k = msg.k;
        if (!k) return;
        seriesRef.current.update({
          time: (k.t / 1000) as UTCTimestamp,
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
        });
        onPrice(parseFloat(k.c));
      };
    })();

    return () => {
      cancelled = true;
      if (ws) ws.close();
    };
  }, [symbol, onPrice, onLoadingChange]);

  return <div ref={chartContainerRef} className="absolute inset-0 h-full w-full min-h-[400px]" />;
}

function WalletOption({
  name,
  subtitle,
  iconSrc,
  fallbackGlyph,
  accentColor,
  disabled,
  onClick,
}: {
  name: string;
  subtitle: string;
  iconSrc?: string;
  fallbackGlyph: string;
  accentColor: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex w-full items-center gap-3 rounded-xl border border-white/10 bg-[#000000] p-3.5 text-left transition-colors hover:border-white/20 hover:bg-white/[0.03] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {iconSrc ? (
        // eslint-disable-next-line @next/next/no-img-element -- wallet icons are inline data URIs
        <img src={iconSrc} alt="" className="h-9 w-9 shrink-0 rounded-lg object-contain" />
      ) : (
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-lg font-bold"
          style={{ backgroundColor: `${accentColor}26`, color: accentColor }}
        >
          {fallbackGlyph}
        </span>
      )}
      <span className="flex flex-col">
        <span className="text-sm font-semibold text-white">{name}</span>
        <span className="text-xs text-[#888]">{subtitle}</span>
      </span>
      <ChevronDown className="ml-auto h-4 w-4 -rotate-90 text-[#888] transition-colors group-hover:text-white" />
    </button>
  );
}

function SummaryRow({ label, value, color = "text-white" }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-[#888]">{label}</span>
      <span className={`font-mono tabular-nums ${color}`}>{value}</span>
    </div>
  );
}

const PANEL =
  "rounded-xl border border-white/[0.07] bg-gradient-to-b from-[#131313]/90 to-[#0d0d0d]/90 backdrop-blur-sm shadow-[inset_0_1px_0_0_rgba(255,255,255,0.035),0_10px_30px_-18px_rgba(0,0,0,0.9)]";
const TIMEFRAMES = ["1m", "5m", "15m", "1H", "4H", "1D"];
const LEV_PRESETS = [2, 5, 10, 25, 50];
const SIZE_PCTS = [25, 50, 75, 100];
const MOCK_BALANCE = 12450; // available USDC (mock — swap for live wallet balance)

/* ------------------------------------------------------------------ */
/*  PAGE                                                               */
/* ------------------------------------------------------------------ */

export default function TradePage() {
  const [tab, setTab] = useState<"positions" | "history">("positions");
  const [side, setSide] = useState<"long" | "short">("long");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [leverage, setLeverage] = useState(10);
  const [activeTf, setActiveTf] = useState("15m");
  const [pay, setPay] = useState("2,500");
  const [size, setSize] = useState("0.037");
  const [limitPrice, setLimitPrice] = useState("67,400.0");
  const [connectedWallet, setConnectedWallet] = useState<ConnectedWallet | null>(null);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [showConnectModal, setShowConnectModal] = useState<boolean>(false);
  const [evmWallets, setEvmWallets] = useState<Eip6963ProviderDetail[]>([]);
  const [solWallets, setSolWallets] = useState<StandardWallet[]>([]);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [showAccountMenu, setShowAccountMenu] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  // ---- Live Binance market data --------------------------------------------
  const [activeMarket, setActiveMarket] = useState<Market>("BTC-USD");
  const [showMarketMenu, setShowMarketMenu] = useState<boolean>(false);
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceUp, setPriceUp] = useState<boolean>(true);
  const [bids, setBids] = useState<DepthLevel[]>([]);
  const [asks, setAsks] = useState<DepthLevel[]>([]);
  const [ticker, setTicker] = useState<{ change: number; volume: number } | null>(null);
  const [isChartLoading, setIsChartLoading] = useState<boolean>(true);
  const lastPriceRef = useRef<number | null>(null);

  const market = marketOf(activeMarket);

  // Stable callbacks so the chart's data effect isn't re-triggered every render.
  const handlePrice = useCallback((p: number) => {
    const prev = lastPriceRef.current;
    setPriceUp(prev === null ? true : p >= prev);
    lastPriceRef.current = p;
    setCurrentPrice(p);
  }, []);
  const handleChartLoading = useCallback((b: boolean) => setIsChartLoading(b), []);

  // Order book stream (@depth20@100ms) — reconnects cleanly on market change.
  useEffect(() => {
    setBids([]);
    setAsks([]);
    setCurrentPrice(null);
    lastPriceRef.current = null;

    const ws = new WebSocket(`${BINANCE_WS}/${market.symbol.toLowerCase()}@depth20@100ms`);
    ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data) as { bids?: DepthLevel[]; asks?: DepthLevel[] };
      if (data.bids) setBids(data.bids);
      if (data.asks) setAsks(data.asks);
    };
    return () => ws.close();
  }, [market.symbol]);

  // 24h ticker (change % + volume) — one-shot REST per market.
  useEffect(() => {
    let cancelled = false;
    setTicker(null);
    fetch(`${BINANCE_REST}/api/v3/ticker/24hr?symbol=${market.symbol}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setTicker({ change: parseFloat(d.priceChangePercent), volume: parseFloat(d.quoteVolume) });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [market.symbol]);

  // Derived order-book view: top 10 each side with cumulative depth bars.
  const askBook = processDepth(asks, 10);
  const bidBook = processDepth(bids, 10);
  const bookMax = Math.max(askBook.maxTotal, bidBook.maxTotal);
  const bestAsk = asks[0] ? parseFloat(asks[0][0]) : null;
  const bestBid = bids[0] ? parseFloat(bids[0][0]) : null;
  const spread = bestAsk !== null && bestBid !== null ? bestAsk - bestBid : null;
  const markPrice = currentPrice ?? bestAsk;

  const isLong = side === "long";
  const accent = isLong ? GREEN : RED;
  const levPct = ((leverage - 1) / (50 - 1)) * 100;

  const shortAddress = connectedWallet
    ? `${connectedWallet.address.substring(0, 6)}...${connectedWallet.address.slice(-4)}`
    : null;

  // Persistent wallet discovery on mount. Both standards are handshake-based, so
  // we must have listeners registered *before* asking wallets to announce — a
  // one-shot poll at click-time misses wallets (like Celestial) that register once.
  useEffect(() => {
    // EIP-6963: EVM multi-wallet discovery (MetaMask, Celestial, …).
    const onEvmAnnounce = (e: Event) => {
      const detail = (e as CustomEvent<Eip6963ProviderDetail>).detail;
      if (!detail?.info?.uuid) return;
      setEvmWallets((prev) =>
        prev.some((w) => w.info.uuid === detail.info.uuid) ? prev : [...prev, detail]
      );
    };
    window.addEventListener("eip6963:announceProvider", onEvmAnnounce as EventListener);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    // Wallet Standard: Solana multi-wallet discovery (Celestial, Phantom, …).
    const register = (wallet: StandardWallet) => {
      if (wallet?.name && isSolanaWallet(wallet)) {
        setSolWallets((prev) => (prev.some((w) => w.name === wallet.name) ? prev : [...prev, wallet]));
      }
      return () => {};
    };
    const api = { register, on: () => () => {} };
    const onSolRegister = (e: Event) => {
      const cb = (e as CustomEvent).detail;
      if (typeof cb === "function") cb(api);
    };
    window.addEventListener("wallet-standard:register-wallet", onSolRegister);
    window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: api }));

    return () => {
      window.removeEventListener("eip6963:announceProvider", onEvmAnnounce as EventListener);
      window.removeEventListener("wallet-standard:register-wallet", onSolRegister);
    };
  }, []);

  // Connect a specific EVM wallet chosen from the list (EIP-1193 request).
  const connectEVM = async (detail?: Eip6963ProviderDetail) => {
    const provider = detail?.provider ?? (window as Web3Window).ethereum;
    if (!provider) {
      alert("No EVM wallet detected.");
      return;
    }
    try {
      setIsConnecting(true);
      setConnectError(null);
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      if (accounts.length > 0) {
        setConnectedWallet({ address: accounts[0], chain: "Ethereum", walletName: detail?.info.name });
        setShowConnectModal(false);
      }
    } catch (error) {
      console.error("EVM Connection Error:", error);
      setConnectError(error instanceof Error ? error.message : "Connection failed.");
    } finally {
      setIsConnecting(false);
    }
  };

  // Connect a specific Solana wallet chosen from the list (Wallet Standard connect),
  // falling back to the legacy window.solana injection if none were discovered.
  const connectSolana = async (wallet?: StandardWallet) => {
    try {
      setIsConnecting(true);
      setConnectError(null);

      if (wallet) {
        const res = await wallet.features["standard:connect"]!.connect();
        const address = res?.accounts?.[0]?.address;
        if (address) {
          setConnectedWallet({ address, chain: "Solana", walletName: wallet.name });
          setShowConnectModal(false);
        }
        return;
      }

      const legacy = (window as Web3Window).solana;
      if (legacy) {
        const response = await legacy.connect();
        if (response.publicKey) {
          setConnectedWallet({ address: response.publicKey.toString(), chain: "Solana" });
          setShowConnectModal(false);
        }
        return;
      }

      setConnectError("No Solana wallet detected.");
    } catch (error) {
      console.error("Solana Connection Error:", error);
      setConnectError(error instanceof Error ? error.message : "Connection failed.");
    } finally {
      setIsConnecting(false);
    }
  };

  // Disconnect — for Solana, also tell the wallet to drop the session (Wallet
  // Standard disconnect, or legacy window.solana.disconnect). EIP-1193 has no
  // reliable programmatic disconnect, so for EVM we just clear local state.
  const disconnectWallet = async () => {
    try {
      if (connectedWallet?.chain === "Solana") {
        const w = solWallets.find((x) => x.name === connectedWallet.walletName);
        const disc = w?.features?.["standard:disconnect"];
        if (disc?.disconnect) {
          await disc.disconnect();
        } else {
          await (window as Web3Window).solana?.disconnect?.();
        }
      }
    } catch (error) {
      console.error("Disconnect error:", error);
    } finally {
      setConnectedWallet(null);
      setShowAccountMenu(false);
      setConnectError(null);
    }
  };

  const copyAddress = async () => {
    if (!connectedWallet) return;
    try {
      await navigator.clipboard.writeText(connectedWallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  return (
    <main className="flex h-screen w-full flex-col overflow-hidden bg-[#000000] text-white">
      {/* ============================== NAVBAR ============================== */}
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
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: market.color }} />
              <span className="text-sm font-semibold">{activeMarket}</span>
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
                        setActiveMarket(m.id);
                        setShowMarketMenu(false);
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                        activeMarket === m.id
                          ? "bg-white/10 text-white"
                          : "text-[#888] hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: m.color }} />
                      <span className="font-semibold">{m.id}</span>
                      {activeMarket === m.id && <Check className="ml-auto h-3.5 w-3.5 text-[#22c55e]" />}
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
              {currentPrice !== null && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22c55e]/70" />
              )}
              <span
                className="relative inline-flex h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: currentPrice !== null ? "#22c55e" : "#f7931a" }}
              />
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#888]">
              {currentPrice !== null ? "Live" : "Sync"}
            </span>
          </span>

          <div className="flex items-center gap-3 sm:gap-4">
            <Stat
              label="Price"
              value={currentPrice !== null ? `$${fmtPrice(currentPrice)}` : "—"}
              color={priceUp ? "text-[#22c55e]" : "text-[#ef4444]"}
            />
            <span className="hidden h-7 w-px bg-white/[0.07] sm:block" />
            <Stat
              label="24h Change"
              value={ticker ? `${ticker.change >= 0 ? "+" : ""}${ticker.change.toFixed(2)}%` : "—"}
              color={ticker && ticker.change >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"}
              className="hidden sm:flex"
            />
            <span className="hidden h-7 w-px bg-white/[0.07] md:block" />
            <Stat
              label="24h Volume"
              value={ticker ? fmtVol(ticker.volume) : "—"}
              className="hidden md:flex"
            />
            <span className="hidden h-7 w-px bg-white/[0.07] lg:block" />
            <Stat
              label="Funding"
              value={STATS.funding}
              color={STATS.fundingUp ? "text-[#22c55e]/80" : "text-[#ef4444]/80"}
              className="hidden lg:flex"
            />
          </div>
          {connectedWallet ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowAccountMenu((v) => !v)}
                title={`${connectedWallet.chain}: ${connectedWallet.address}`}
                className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#121212]/80 px-3.5 py-2 text-sm font-bold text-white backdrop-blur-sm transition-colors hover:border-white/20"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: connectedWallet.chain === "Ethereum" ? "#627eea" : "#9945ff",
                    boxShadow: `0 0 8px ${connectedWallet.chain === "Ethereum" ? "#627eea" : "#9945ff"}`,
                  }}
                />
                <span className="hidden font-mono sm:inline">{shortAddress}</span>
                <span className="font-mono sm:hidden">{connectedWallet.chain}</span>
                <ChevronDown
                  className={`h-4 w-4 text-[#888] transition-transform ${showAccountMenu ? "rotate-180" : ""}`}
                />
              </button>

              {showAccountMenu && (
                <>
                  {/* click-away backdrop */}
                  <div className="fixed inset-0 z-40" onClick={() => setShowAccountMenu(false)} />
                  <div className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-white/10 bg-[#121212] p-3 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#888]">
                        {connectedWallet.walletName ?? connectedWallet.chain}
                      </span>
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{
                          color: connectedWallet.chain === "Ethereum" ? "#627eea" : "#9945ff",
                          backgroundColor: `${connectedWallet.chain === "Ethereum" ? "#627eea" : "#9945ff"}26`,
                        }}
                      >
                        {connectedWallet.chain}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={copyAddress}
                      className="mt-2 flex w-full items-center justify-between gap-2 rounded-lg border border-white/5 bg-[#000000] px-3 py-2 text-left transition-colors hover:border-white/10"
                    >
                      <span className="truncate font-mono text-xs text-white/80">
                        {connectedWallet.address}
                      </span>
                      {copied ? (
                        <Check className="h-3.5 w-3.5 shrink-0 text-[#22c55e]" />
                      ) : (
                        <Copy className="h-3.5 w-3.5 shrink-0 text-[#888]" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={disconnectWallet}
                      className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-[#ef4444]/20 bg-[#ef4444]/10 py-2 text-sm font-semibold text-[#ef4444] transition-colors hover:bg-[#ef4444]/20"
                    >
                      <LogOut className="h-4 w-4" />
                      Disconnect
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setConnectError(null); setShowConnectModal(true); }}
              className="flex items-center gap-2 rounded-lg bg-[#22c55e] px-3.5 py-2 text-sm font-bold text-black shadow-[0_0_20px_-6px_rgba(34,197,94,0.6)] transition-colors hover:bg-[#16a34a]"
            >
              <Wallet className="h-4 w-4" strokeWidth={2.5} />
              <span className="hidden sm:inline">Connect Wallet</span>
              <span className="sm:hidden">Connect</span>
            </button>
          )}
        </div>
      </header>

      {/* ============================== MAIN GRID ============================== */}
      <div className="grid min-h-0 flex-1 grid-cols-12 gap-1 overflow-y-auto p-1 lg:grid-rows-1 lg:overflow-hidden">
        {/* ---------------- LEFT: Chart + Positions ---------------- */}
        <section className="order-1 flex min-h-0 flex-col gap-1 lg:order-none lg:col-span-7 lg:overflow-hidden col-span-12">
          {/* chart panel */}
          <div className={`${PANEL} flex min-h-[360px] flex-1 flex-col overflow-hidden lg:min-h-0`}>
            <div className="flex shrink-0 items-center gap-1 border-b border-white/5 px-2 py-1.5">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => setActiveTf(tf)}
                  className={`rounded px-2 py-0.5 font-mono text-[11px] transition-colors ${
                    activeTf === tf ? "bg-white/10 text-white" : "text-[#888] hover:text-white"
                  }`}
                >
                  {tf}
                </button>
              ))}
              <span
                className={`ml-auto flex items-center gap-1 font-mono text-[11px] ${
                  ticker && ticker.change < 0 ? "text-[#ef4444]" : "text-[#22c55e]"
                }`}
              >
                {ticker && ticker.change < 0 ? (
                  <TrendingDown className="h-3.5 w-3.5" />
                ) : (
                  <TrendingUp className="h-3.5 w-3.5" />
                )}
                {ticker ? `${ticker.change >= 0 ? "+" : ""}${ticker.change.toFixed(2)}%` : "—"}
              </span>
            </div>
            <div className="relative flex-1">
              <PriceChart
                symbol={market.symbol}
                onPrice={handlePrice}
                onLoadingChange={handleChartLoading}
              />
              {isChartLoading && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[#121212]/40">
                  <Loader2 className="h-6 w-6 animate-spin text-[#888]" />
                </div>
              )}
            </div>
          </div>

          {/* positions / history panel */}
          <div className={`${PANEL} flex min-h-[220px] shrink-0 flex-col overflow-hidden lg:h-[34%]`}>
            <div className="flex shrink-0 items-center gap-4 border-b border-white/5 px-3">
              {(
                [
                  { id: "positions", label: "Positions", icon: ListOrdered },
                  { id: "history", label: "Order History", icon: History },
                ] as const
              ).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={`flex items-center gap-1.5 border-b-2 py-2.5 text-xs font-semibold transition-colors ${
                    tab === id
                      ? "border-[#22c55e] text-white"
                      : "border-transparent text-[#888] hover:text-white"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>

            {/* scroll body */}
            <div className="thin-scroll min-h-0 flex-1 overflow-y-auto overflow-x-auto">
              {tab === "positions" ? (
                <table className="w-full min-w-[760px] text-left font-mono text-xs tabular-nums">
                  <thead className="sticky top-0 z-10 bg-[#101010] text-[10px] uppercase tracking-wide text-[#888]">
                    <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                      <th>Market</th>
                      <th>Side</th>
                      <th className="text-right">Size</th>
                      <th className="text-right">Entry Price</th>
                      <th className="text-right">Mark Price</th>
                      <th className="text-right">Liq. Price</th>
                      <th className="text-right">Unrealized PnL</th>
                      <th className="text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="group border-t border-white/5 transition-colors hover:bg-white/[0.025] [&>td]:px-3 [&>td]:py-2.5">
                      <td className="font-semibold text-white">
                        <span className="relative flex items-center gap-2 before:absolute before:-left-3 before:h-4 before:w-0.5 before:rounded-full before:bg-[#22c55e]">
                          {POSITION.market}
                        </span>
                      </td>
                      <td>
                        <span className="rounded bg-[#22c55e]/10 px-1.5 py-0.5 text-[#22c55e]">
                          {POSITION.side} {POSITION.leverage}
                        </span>
                      </td>
                      <td className="text-right text-white/90">{POSITION.size}</td>
                      <td className="text-right text-white/90">{POSITION.entry}</td>
                      <td className="text-right text-white/90">{POSITION.mark}</td>
                      <td className="text-right text-[#ef4444]/80">{POSITION.liq}</td>
                      <td className="text-right text-[#22c55e]">
                        {POSITION.pnl}{" "}
                        <span className="text-[#22c55e]/70">({POSITION.pnlPct})</span>
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          className="rounded-md border border-white/10 px-2 py-1 text-[10px] font-semibold text-[#888] transition-colors hover:border-[#ef4444]/40 hover:bg-[#ef4444]/10 hover:text-[#ef4444]"
                        >
                          Close
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-[#666]">
                  <History className="h-6 w-6" strokeWidth={1.5} />
                  <span className="text-xs">No order history yet</span>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ---------------- MIDDLE: Order Book ---------------- */}
        <section className="order-3 min-h-[480px] lg:order-none lg:col-span-2 lg:min-h-0 col-span-12">
          <div className={`${PANEL} flex h-full flex-col overflow-hidden`}>
            <div className="flex shrink-0 items-center justify-between border-b border-white/5 px-2.5 py-2">
              <span className="text-xs font-semibold text-white">Order Book</span>
              <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-[#888]">
                {activeMarket}
              </span>
            </div>
            <div className="flex shrink-0 items-center border-b border-white/[0.04] px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-[#777]">
              <span className="flex-1">Price</span>
              <span className="flex-1 text-right">Size</span>
              <span className="flex-1 text-right">Total</span>
            </div>

            {/* asks — highest at top, tightest to spread at bottom */}
            <div className="thin-scroll flex min-h-0 flex-1 flex-col justify-end overflow-y-auto">
              {askBook.rows.length === 0 ? (
                <BookSkeleton />
              ) : (
                [...askBook.rows].reverse().map((lvl) => (
                  <BookRow key={`a-${lvl.price}`} level={lvl} side="ask" maxTotal={bookMax} />
                ))
              )}
            </div>

            {/* spread strip — the order book's focal point */}
            <div className="flex shrink-0 items-center justify-between border-y border-white/[0.08] bg-white/[0.025] px-2.5 py-2">
              <div className="flex items-center gap-1.5">
                {priceUp ? (
                  <ArrowUp className="h-4 w-4 text-[#22c55e]" strokeWidth={2.5} />
                ) : (
                  <ArrowDown className="h-4 w-4 text-[#ef4444]" strokeWidth={2.5} />
                )}
                <span
                  className={`font-mono text-lg font-bold tabular-nums ${
                    priceUp ? "text-[#22c55e]" : "text-[#ef4444]"
                  }`}
                >
                  {markPrice !== null && markPrice !== undefined ? fmtPrice(markPrice) : "—"}
                </span>
              </div>
              <div className="flex flex-col items-end leading-tight">
                <span className="text-[8px] uppercase tracking-wider text-[#777]">Spread</span>
                <span className="font-mono text-[10px] text-[#aaa]">
                  {spread !== null ? spread.toFixed(2) : "—"}
                </span>
              </div>
            </div>

            {/* bids */}
            <div className="thin-scroll flex min-h-0 flex-1 flex-col overflow-y-auto">
              {bidBook.rows.length === 0 ? (
                <BookSkeleton />
              ) : (
                bidBook.rows.map((lvl) => (
                  <BookRow key={`b-${lvl.price}`} level={lvl} side="bid" maxTotal={bookMax} />
                ))
              )}
            </div>
          </div>
        </section>

        {/* ---------------- RIGHT: Trade Form ---------------- */}
        <section className="order-2 lg:order-none lg:col-span-3 lg:min-h-0 col-span-12">
          <div className={`${PANEL} flex h-full flex-col overflow-hidden`}>
            {/* scrollable form body */}
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              {/* side toggle */}
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/5 bg-black p-1">
                <button
                  type="button"
                  onClick={() => setSide("long")}
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
                  onClick={() => setSide("short")}
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

              {/* order type — segmented control */}
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-black p-1 text-[11px] font-semibold">
                {(["market", "limit"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setOrderType(t)}
                    className={`rounded-md py-1.5 capitalize transition-colors ${
                      orderType === t ? "bg-white/10 text-white" : "text-[#888] hover:text-white"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {/* limit price (conditional) */}
              {orderType === "limit" && (
                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-wide text-[#888]">
                    Limit Price
                  </span>
                  <div className="flex items-center rounded-lg border border-white/5 bg-black px-3 transition-colors focus-within:border-white/20">
                    <input
                      aria-label="Limit price"
                      value={limitPrice}
                      onChange={(e) => setLimitPrice(e.target.value)}
                      inputMode="decimal"
                      className="w-full bg-transparent py-2.5 text-right font-mono text-sm tabular-nums text-white outline-none"
                    />
                    <span className="ml-2 text-xs text-[#888]">USD</span>
                  </div>
                </label>
              )}

              {/* pay */}
              <label className="block">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wide text-[#888]">Pay</span>
                  <span className="font-mono text-[10px] text-[#666]">
                    Avail {MOCK_BALANCE.toLocaleString("en-US")} USDC
                  </span>
                </div>
                <div className="flex items-center rounded-lg border border-white/5 bg-black px-3 transition-colors focus-within:border-white/20">
                  <input
                    aria-label="Pay amount in USDC"
                    value={pay}
                    onChange={(e) => setPay(e.target.value)}
                    inputMode="decimal"
                    className="w-full bg-transparent py-2.5 text-right font-mono text-sm tabular-nums text-white outline-none"
                  />
                  <span className="ml-2 text-xs text-[#888]">USDC</span>
                </div>
                <div className="mt-1.5 grid grid-cols-4 gap-1">
                  {SIZE_PCTS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() =>
                        setPay(
                          Math.round((MOCK_BALANCE * p) / 100).toLocaleString("en-US")
                        )
                      }
                      className="rounded-md border border-white/5 bg-black py-1 font-mono text-[10px] text-[#888] transition-colors hover:border-white/15 hover:text-white"
                    >
                      {p === 100 ? "Max" : `${p}%`}
                    </button>
                  ))}
                </div>
              </label>

              {/* size */}
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wide text-[#888]">Size</span>
                <div className="flex items-center rounded-lg border border-white/5 bg-black px-3 transition-colors focus-within:border-white/20">
                  <input
                    aria-label="Size in BTC"
                    value={size}
                    onChange={(e) => setSize(e.target.value)}
                    inputMode="decimal"
                    className="w-full bg-transparent py-2.5 text-right font-mono text-sm tabular-nums text-white outline-none"
                  />
                  <span className="ml-2 text-xs text-[#888]">{marketOf(activeMarket).id.split("-")[0]}</span>
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
                  max={50}
                  value={leverage}
                  onChange={(e) => setLeverage(Number(e.target.value))}
                  aria-label="Leverage"
                  style={{
                    background: `linear-gradient(to right, ${accent} 0%, ${accent} ${levPct}%, rgba(255,255,255,0.08) ${levPct}%, rgba(255,255,255,0.08) 100%)`,
                  }}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow"
                />
                <div className="mt-1 flex justify-between font-mono text-[9px] text-[#666]">
                  <span>1x</span>
                  <span>25x</span>
                  <span>50x</span>
                </div>
                <div className="mt-2 flex gap-1">
                  {LEV_PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setLeverage(p)}
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
                  label="Entry Price"
                  value={currentPrice !== null ? `$${fmtPrice(currentPrice)}` : "—"}
                />
                <SummaryRow label="Liq. Price" value="$59,310.00" color="text-[#ef4444]/80" />
                <SummaryRow label="Fees" value="$1.75" />
                <SummaryRow label="Slippage" value="0.05%" />
              </div>
            </div>

            {/* pinned action button */}
            <div className="shrink-0 border-t border-white/5 p-3">
              {connectedWallet ? (
                <button
                  type="button"
                  style={{ backgroundColor: accent, boxShadow: `0 8px 26px -8px ${accent}` }}
                  className="flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-bold text-black transition-all hover:brightness-110 active:scale-[0.99]"
                >
                  {isLong ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                  {isLong ? "Execute Long" : "Execute Short"} · {leverage}x
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setConnectError(null);
                    setShowConnectModal(true);
                  }}
                  style={{ backgroundColor: accent, boxShadow: `0 8px 26px -8px ${accent}` }}
                  className="flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-bold text-black transition-all hover:brightness-110 active:scale-[0.99]"
                >
                  <Wallet className="h-4 w-4" strokeWidth={2.5} />
                  Connect Wallet to Trade
                </button>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* ============================== CONNECT MODAL ============================== */}
      {showConnectModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setShowConnectModal(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Connect a wallet"
        >
          <div
            className="w-96 max-w-full rounded-2xl border border-white/10 bg-[#121212] p-6 shadow-[0_40px_100px_-20px_rgba(0,0,0,0.8)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-base font-bold text-white">Connect Wallet</h2>
              <button
                type="button"
                onClick={() => setShowConnectModal(false)}
                aria-label="Close"
                className="grid h-7 w-7 place-items-center rounded-md text-[#888] transition-colors hover:bg-white/5 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Ethereum (EVM) — EIP-6963 discovered wallets */}
              <div className="space-y-2">
                <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-[#888]">
                  Ethereum
                </p>
                {evmWallets.length > 0 ? (
                  evmWallets.map((w) => (
                    <WalletOption
                      key={w.info.uuid}
                      name={w.info.name}
                      subtitle="Ethereum · EVM"
                      iconSrc={w.info.icon}
                      fallbackGlyph="Ξ"
                      accentColor="#627eea"
                      disabled={isConnecting}
                      onClick={() => connectEVM(w)}
                    />
                  ))
                ) : (
                  <WalletOption
                    name="Ethereum (EVM)"
                    subtitle="Injected · window.ethereum"
                    fallbackGlyph="Ξ"
                    accentColor="#627eea"
                    disabled={isConnecting}
                    onClick={() => connectEVM()}
                  />
                )}
              </div>

              {/* Solana — Wallet Standard discovered wallets */}
              <div className="space-y-2">
                <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-[#888]">
                  Solana
                </p>
                {solWallets.length > 0 ? (
                  solWallets.map((w) => (
                    <WalletOption
                      key={w.name}
                      name={w.name}
                      subtitle="Solana"
                      iconSrc={w.icon}
                      fallbackGlyph="◎"
                      accentColor="#9945ff"
                      disabled={isConnecting}
                      onClick={() => connectSolana(w)}
                    />
                  ))
                ) : (
                  <WalletOption
                    name="Solana"
                    subtitle="Injected · window.solana"
                    fallbackGlyph="◎"
                    accentColor="#9945ff"
                    disabled={isConnecting}
                    onClick={() => connectSolana()}
                  />
                )}
              </div>
            </div>

            {isConnecting && (
              <p className="mt-4 text-center text-xs text-[#888]">Awaiting wallet approval…</p>
            )}
            {connectError && !isConnecting && (
              <p className="mt-4 rounded-lg border border-[#ef4444]/20 bg-[#ef4444]/10 px-3 py-2 text-center text-xs text-[#ef4444]">
                {connectError}
              </p>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
