// Coinbase Exchange public market data — chart candles (REST) + live ticker (WebSocket).
// No API key, CORS is open. Display/index price only: trades fill at the on-chain oracle price.

export type MarketId = "BTC-USD" | "ETH-USD" | "SOL-USD";

export const MARKETS: { id: MarketId; color: string }[] = [
  { id: "BTC-USD", color: "#f7931a" },
  { id: "ETH-USD", color: "#627eea" },
  { id: "SOL-USD", color: "#14f195" },
];
export const marketOf = (m: MarketId) => MARKETS.find((x) => x.id === m)!;
export const baseAsset = (m: MarketId) => m.split("-")[0];

export const MARKET_REST_URL =
  process.env.NEXT_PUBLIC_MARKET_REST_URL ?? "https://api.exchange.coinbase.com";
export const MARKET_WS_URL =
  process.env.NEXT_PUBLIC_MARKET_WS_URL ?? "wss://ws-feed.exchange.coinbase.com";

/* ------------------------------------------------------------------ */
/*  TIMEFRAMES                                                         */
/* ------------------------------------------------------------------ */

export type Timeframe = "1m" | "5m" | "15m" | "1H" | "4H" | "1D";
export const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1H", "4H", "1D"];

// `bucket` is the candle width on the chart; `granularity` is what Coinbase serves.
// Coinbase has no 4H (14400) granularity, so 4H is aggregated client-side from 1H.
const TF: Record<Timeframe, { bucket: number; granularity: number }> = {
  "1m": { bucket: 60, granularity: 60 },
  "5m": { bucket: 300, granularity: 300 },
  "15m": { bucket: 900, granularity: 900 },
  "1H": { bucket: 3600, granularity: 3600 },
  "4H": { bucket: 14400, granularity: 3600 },
  "1D": { bucket: 86400, granularity: 86400 },
};
export const bucketSeconds = (tf: Timeframe) => TF[tf].bucket;

/* ------------------------------------------------------------------ */
/*  REST                                                               */
/* ------------------------------------------------------------------ */

export type Candle = { time: number; open: number; high: number; low: number; close: number };

// Coinbase row: [time, low, high, open, close, volume], newest first.
type CoinbaseCandle = [number, number, number, number, number, number];

// Merge ascending candles into wider buckets aligned to UTC boundaries.
function aggregate(candles: Candle[], bucket: number): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const time = Math.floor(c.time / bucket) * bucket;
    const last = out[out.length - 1];
    if (last && last.time === time) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
    } else {
      out.push({ ...c, time });
    }
  }
  return out;
}

export async function fetchCandles(market: MarketId, tf: Timeframe, signal?: AbortSignal): Promise<Candle[]> {
  const { bucket, granularity } = TF[tf];
  const res = await fetch(`${MARKET_REST_URL}/products/${market}/candles?granularity=${granularity}`, { signal });
  if (!res.ok) throw new Error(`Coinbase candles ${res.status}`);
  const rows = (await res.json()) as CoinbaseCandle[];

  // Ascending + de-duplicated — lightweight-charts requires strictly increasing times.
  const seen = new Set<number>();
  const asc = rows
    .map(([time, low, high, open, close]) => ({ time, low, high, open, close }))
    .sort((a, b) => a.time - b.time)
    .filter((c) => (seen.has(c.time) ? false : (seen.add(c.time), true)));

  return granularity === bucket ? asc : aggregate(asc, bucket);
}

export async function fetchStats(market: MarketId, signal?: AbortSignal): Promise<{ open: number; last: number }> {
  const res = await fetch(`${MARKET_REST_URL}/products/${market}/stats`, { signal });
  if (!res.ok) throw new Error(`Coinbase stats ${res.status}`);
  const d = (await res.json()) as { open: string; last: string };
  return { open: parseFloat(d.open), last: parseFloat(d.last) };
}

/* ------------------------------------------------------------------ */
/*  WEBSOCKET                                                          */
/* ------------------------------------------------------------------ */

export type Tick = { market: MarketId; price: number; time: number; open24h: number };

// Parse one ws-feed message; returns null for anything that isn't a ticker for `market`.
export function parseTicker(raw: string, market: MarketId): Tick | null {
  const m = JSON.parse(raw) as { type?: string; product_id?: string; price?: string; open_24h?: string; time?: string };
  if (m.type !== "ticker" || m.product_id !== market || !m.price) return null;
  const price = parseFloat(m.price);
  if (!Number.isFinite(price)) return null;
  const ts = m.time ? Date.parse(m.time) / 1000 : NaN;
  return {
    market,
    price,
    time: Number.isFinite(ts) ? ts : Date.now() / 1000,
    open24h: parseFloat(m.open_24h ?? "NaN"),
  };
}
