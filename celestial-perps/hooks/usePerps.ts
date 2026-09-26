// Protocol data for the active market and the connected wallet, from the chain layer.
// Polls every 5 s while the tab is visible; `refresh()` forces a reload (after a fill, etc.).

import { useCallback, useEffect, useRef, useState } from "react";

import {
  readChain,
  walletChain,
  type HistoryItem,
  type MarketState,
  type PendingRequest,
  type PerpsChain,
  type PoolState,
  type Position,
  type ProtocolParams,
} from "@/lib/chains";
import type { MarketId } from "@/lib/marketData";
import type { ConnectedWallet } from "@/lib/wallet";

export type Account = {
  usdc: bigint;
  native: bigint;
  clp: bigint;
  allowance: bigint;
  positions: Position[];
  pending: PendingRequest[];
  faucet: { canClaim: boolean; nextClaimAt: number | null };
  lpAvailableAt: number;
};

export type PerpsData = {
  /** chain for the active market's data (Solana for SOL-USD, else the wallet's chain) */
  chain: PerpsChain;
  /** chain bound to the wallet (null when disconnected) — all writes go here */
  writeChain: PerpsChain | null;
  /** can the connected wallet trade the active market */
  tradable: boolean;
  params: ProtocolParams | null;
  market: MarketState | null;
  pool: PoolState | null;
  account: Account | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
};

/** setInterval that pauses while the tab is hidden and runs once on becoming visible. */
export function useVisibleInterval(fn: () => void, ms: number, enabled = true) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (document.visibilityState === "visible") saved.current();
    };
    const id = setInterval(tick, ms);
    const onVisible = () => document.visibilityState === "visible" && saved.current();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ms, enabled]);
}

export function usePerps(marketId: MarketId, wallet: ConnectedWallet | null): PerpsData {
  const [writeChain, setWriteChain] = useState<PerpsChain | null>(null);
  const [params, setParams] = useState<ProtocolParams | null>(null);
  const [market, setMarket] = useState<MarketState | null>(null);
  const [pool, setPool] = useState<PoolState | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  // Bind a chain to the wallet (signer) whenever the wallet changes.
  useEffect(() => {
    let cancelled = false;
    setWriteChain(null);
    setAccount(null);
    if (!wallet) return;
    walletChain(wallet)
      .then((c) => !cancelled && setWriteChain(c))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  const tradable = !!writeChain && writeChain.supports(marketId);
  // Market data: the wallet's chain when it lists the market, else the chain that does (SOL-USD → Solana).
  const chain = tradable ? writeChain! : readChain(marketId, wallet && wallet.chain === "Solana" ? wallet : null);

  // Results of a load that started for a previous chain/market are dropped.
  const current = useRef({ chain, marketId });
  current.current = { chain, marketId };

  // Never show one chain's numbers with another chain's units while the new chain loads.
  useEffect(() => {
    setParams(null);
    setPool(null);
    setMarket(null);
    setError(null);
  }, [chain.id]);

  const load = useCallback(async () => {
    try {
      const [p, m, pl] = await Promise.all([chain.getParams(), chain.getMarketState(marketId), chain.getPool()]);
      const stale = () => current.current.chain !== chain || current.current.marketId !== marketId;
      if (stale()) return;
      setParams(p);
      setMarket(m);
      setPool(pl);
      if (writeChain && wallet) {
        const owner = wallet.address;
        const [usdc, native, clp, allowance, positions, pending, faucet, lpAvailableAt] = await Promise.all([
          writeChain.getUsdcBalance(owner),
          writeChain.getNativeBalance(owner),
          writeChain.getClpBalance(owner),
          writeChain.getAllowance(owner),
          writeChain.getPositions(owner),
          writeChain.getPendingRequests(owner),
          writeChain.faucetStatus(owner),
          writeChain.lpAvailableAt(owner),
        ]);
        if (stale()) return;
        setAccount({ usdc, native, clp, allowance, positions, pending, faucet, lpAvailableAt });
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // chain identity changes with market / wallet
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, marketId, writeChain, wallet?.address]);

  useEffect(() => {
    setLoading(true);
    setMarket(null);
    void load();
  }, [load, nonce]);

  useVisibleInterval(() => void load(), 5_000);

  return { chain, writeChain, tradable, params, market, pool, account, error, loading, refresh: () => setNonce((n) => n + 1) };
}

/** Order history for the connected wallet (loaded on demand; cached per chain inside the layer). */
export function useHistory(chain: PerpsChain | null, owner: string | null, enabled: boolean, bump: number) {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!chain || !owner || !enabled) return;
    let cancelled = false;
    setLoading(true);
    chain
      .getHistory(owner, { limit: 50 })
      .then((h) => !cancelled && (setItems(h), setError(null)))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [chain, owner, enabled, bump]);
  return { items, error, loading };
}
