"use client";

import { useEffect, useRef, useState } from "react";
import { MARKET_WS_URL, parseTicker, type MarketId, type Tick } from "@/lib/marketData";

export type FeedStatus = "connecting" | "live" | "stale" | "error";

const STALE_AFTER_MS = 15_000;
const FLUSH_MS = 250; // cap re-renders at ~4/s — the ticker can fire many times per second
const MAX_BACKOFF_MS = 30_000;

type LivePrice = { tick: Tick | null; up: boolean; status: FeedStatus };

// Live Coinbase ticker for one market. Reconnects with exponential backoff and
// tears the socket down on market change / unmount.
export function useLivePrice(market: MarketId): LivePrice {
  const [state, setState] = useState<LivePrice>({ tick: null, up: true, status: "connecting" });
  const prevPriceRef = useRef<number | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pending: Tick | null = null;
    let lastTickAt = 0;

    prevPriceRef.current = null;
    setState({ tick: null, up: true, status: "connecting" });

    const flush = setInterval(() => {
      if (!pending) return;
      const tick = pending;
      pending = null;
      const prev = prevPriceRef.current;
      prevPriceRef.current = tick.price;
      setState((s) => ({
        tick,
        up: prev === null ? s.up : tick.price === prev ? s.up : tick.price > prev,
        status: "live",
      }));
    }, FLUSH_MS);

    const staleCheck = setInterval(() => {
      if (lastTickAt && Date.now() - lastTickAt > STALE_AFTER_MS) {
        setState((s) => (s.status === "live" ? { ...s, status: "stale" } : s));
      }
    }, 5_000);

    const connect = () => {
      if (closed) return;
      const socket = new WebSocket(MARKET_WS_URL);
      ws = socket;
      socket.onopen = () => {
        attempt = 0;
        socket.send(JSON.stringify({ type: "subscribe", product_ids: [market], channels: ["ticker"] }));
      };
      socket.onmessage = (ev) => {
        try {
          const tick = parseTicker(String(ev.data), market);
          if (!tick) return;
          pending = tick;
          lastTickAt = Date.now();
        } catch {
          /* malformed frame — ignore */
        }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (closed || ws !== socket) return;
        setState((s) => ({ ...s, status: s.tick ? "stale" : "error" }));
        const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt++);
        retryTimer = setTimeout(connect, delay);
      };
    };
    connect();

    return () => {
      closed = true;
      clearTimeout(retryTimer);
      clearInterval(flush);
      clearInterval(staleCheck);
      ws?.close();
    };
  }, [market]);

  return state;
}
