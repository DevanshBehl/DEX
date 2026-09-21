"use client";

import { useEffect, useState } from "react";
import type { MarketId } from "@/lib/marketData";
import { ORACLE_MAX_AGE_S, readOracle } from "@/lib/oracle";

export type OracleStatus = "loading" | "live" | "stale" | "error" | "unavailable";

type OraclePrice = { price: number | null; updatedAt: number | null; status: OracleStatus };

const POLL_MS = 30_000;

// Polls the Chainlink Sepolia feed for `market`. "unavailable" when the market
// has no feed on Sepolia (SOL-USD).
export function useOraclePrice(market: MarketId): OraclePrice {
  const [state, setState] = useState<OraclePrice>({ price: null, updatedAt: null, status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ price: null, updatedAt: null, status: "loading" });

    const poll = async () => {
      try {
        const round = await readOracle(market);
        if (cancelled) return;
        if (!round) {
          setState({ price: null, updatedAt: null, status: "unavailable" });
          return;
        }
        const age = Date.now() / 1000 - round.updatedAt;
        setState({ ...round, status: age > ORACLE_MAX_AGE_S ? "stale" : "live" });
      } catch (err) {
        console.error(`Chainlink read failed (${market}):`, err);
        if (!cancelled) setState((s) => ({ ...s, status: "error" }));
      }
    };

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [market]);

  return state;
}
