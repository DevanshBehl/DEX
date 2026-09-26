"use client";

// Celestial Perps — Trade terminal.
// Chart + index price: Coinbase public API. Oracle (fill) price, positions and orders: the perps
// protocol on the connected wallet's chain (Sepolia or Solana devnet) through lib/chains.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import type { OrderParams, PendingRequest } from "@/lib/chains";
import { fetchStats, TIMEFRAMES, type MarketId, type Timeframe } from "@/lib/marketData";
import { toPrice, toUsd } from "@/lib/perpMath";
import { DEFAULT_LEVERAGE, DEFAULT_SLIPPAGE_BPS, MAX_LEVERAGE, OPEN_FEE_BPS } from "@/lib/protocol";
import { useLivePrice } from "@/hooks/useLivePrice";
import { useOrders } from "@/hooks/useOrders";
import { useHistory, usePerps } from "@/hooks/usePerps";
import { useWallet } from "@/hooks/useWallet";
import { PriceChart } from "@/components/trade/PriceChart";
import { MarketInfo, type MarketInfoData, type OracleStatus } from "@/components/trade/MarketInfo";
import { OrderTracker } from "@/components/trade/OrderTracker";
import { PositionsPanel } from "@/components/trade/PositionsPanel";
import { TradeForm } from "@/components/trade/TradeForm";
import { TradeHeader } from "@/components/trade/TradeHeader";
import { WalletModal } from "@/components/trade/WalletModal";
import { PANEL } from "@/components/trade/ui";

export default function TradeApp() {
  const [activeMarket, setActiveMarket] = useState<MarketId>("ETH-USD");
  const [activeTf, setActiveTf] = useState<Timeframe>("15m");
  const [side, setSide] = useState<"long" | "short">("long");
  const [leverage, setLeverage] = useState(DEFAULT_LEVERAGE);
  const [collateral, setCollateral] = useState("100");
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const [showConnectModal, setShowConnectModal] = useState<boolean>(false);
  const [isChartLoading, setIsChartLoading] = useState<boolean>(true);
  const [statsOpen24h, setStatsOpen24h] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyBump, setHistoryBump] = useState(0);

  const wallet = useWallet();
  const { connectedWallet } = wallet;
  const perps = usePerps(activeMarket, connectedWallet);
  const refreshAll = useCallback(() => {
    perps.refresh();
    setHistoryBump((n) => n + 1);
    // perps.refresh is a new function each render; the bump is what matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perps.refresh]);
  const orders = useOrders(refreshAll);
  const history = useHistory(perps.writeChain, connectedWallet?.address ?? null, historyOpen, historyBump);

  // A wallet on Solana can trade SOL-USD; an EVM wallet can't — keep the market valid for it.
  useEffect(() => {
    if (connectedWallet?.chain === "Ethereum" && activeMarket === "SOL-USD") setActiveMarket("ETH-USD");
  }, [connectedWallet?.chain, activeMarket]);

  // ---- Market data --------------------------------------------------------
  const live = useLivePrice(activeMarket);
  const currentPrice = live.tick?.price ?? null;
  const handleChartLoading = useCallback((b: boolean) => setIsChartLoading(b), []);

  useEffect(() => {
    const controller = new AbortController();
    setStatsOpen24h(null);
    fetchStats(activeMarket, controller.signal)
      .then((s) => setStatsOpen24h(s.open))
      .catch(() => {});
    return () => controller.abort();
  }, [activeMarket]);

  const open24h = live.tick && Number.isFinite(live.tick.open24h) ? live.tick.open24h : statsOpen24h;
  const change24h = currentPrice !== null && open24h ? ((currentPrice - open24h) / open24h) * 100 : null;

  const st = perps.market;
  const oraclePrice = st?.price != null ? toPrice(st.price) : null;
  const oracleStatus: OracleStatus = perps.error && !st ? "error" : !st ? "loading" : st.price === null ? "stale" : "live";
  const chainLabel = perps.chain.id === "solana-devnet" ? "Solana devnet" : "Sepolia";
  const fundingPerHour = st
    ? st.fundingRateLongPerHour > 0n
      ? Number(st.fundingRateLongPerHour) / 1e18
      : st.fundingRateShortPerHour > 0n
        ? -Number(st.fundingRateShortPerHour) / 1e18
        : 0
    : null;

  const marketInfo: MarketInfoData = useMemo(
    () => ({
      oraclePrice,
      oracleUpdatedAt: st?.priceUpdatedAt ?? null,
      indexPrice: currentPrice,
      poolLiquidityUsd: perps.pool ? toUsd(perps.pool.available) : null,
      longOiUsd: st ? toUsd(st.longSize) : null,
      shortOiUsd: st ? toUsd(st.shortSize) : null,
      longCapacityUsd: st ? toUsd(st.longCapacity) : null,
      shortCapacityUsd: st ? toUsd(st.shortCapacity) : null,
      fundingLongPerHour: st ? Number(st.fundingRateLongPerHour) / 1e18 : null,
      fundingShortPerHour: st ? Number(st.fundingRateShortPerHour) / 1e18 : null,
      maxLeverage: perps.params ? Number(perps.params.maxLeverage) : MAX_LEVERAGE,
      openFeeBps: perps.params ? Number(perps.params.positionFeeBps) : OPEN_FEE_BPS,
      chainLabel,
      oracleIssue: st?.priceIssue,
    }),
    [oraclePrice, st, currentPrice, perps.pool, perps.params, chainLabel],
  );

  const openConnectModal = () => {
    wallet.setConnectError(null);
    setShowConnectModal(true);
  };

  // ---- Writes (all through the wallet-bound chain) ----------------------------
  const wc = perps.writeChain;
  const busy = orders.items.some((x) => x.status === "signing");
  const guard = () => wc && wallet.onRightNetwork;

  const submitOrder = (label: string, kind: "increase" | "decrease", p: OrderParams) => {
    if (!guard()) return;
    void orders.run(wc!, label, () => (kind === "increase" ? wc!.requestIncrease(p) : wc!.requestDecrease(p)), true);
  };

  const orderLabel = (p: OrderParams) => `${p.isLong ? "Long" : "Short"} ${p.market} ${leverage}x`;

  /** Approve, then place the order the user clicked for (EVM needs the allowance first). */
  const approve = (amount: bigint, then: OrderParams | null) => {
    if (!guard()) return;
    void orders
      .run(wc!, amount >= 2n ** 255n ? "Approve USDC (max)" : "Approve USDC", () => wc!.approve(amount))
      .then((ok) => ok && then && submitOrder(orderLabel(then), "increase", then));
  };

  const cancelOrder = (r: PendingRequest) => {
    if (!guard()) return;
    void orders.run(wc!, `Cancel ${r.market} ${r.kind}`, () => wc!.cancel(r.id));
  };

  const claimFaucet = () => {
    if (!guard()) return;
    void orders.run(wc!, "Faucet: 10,000 test USDC", () => wc!.faucet());
  };

  return (
    <main className="flex h-screen w-full flex-col overflow-hidden bg-[#000000] text-white">
      <TradeHeader
        market={activeMarket}
        onMarketChange={setActiveMarket}
        price={currentPrice}
        priceUp={live.up}
        feedStatus={live.status}
        change24h={change24h}
        oraclePrice={oraclePrice}
        oracleStatus={oracleStatus}
        fundingPerHour={fundingPerHour}
        faucet={
          connectedWallet && perps.account
            ? { ...perps.account.faucet, busy, onClaim: claimFaucet }
            : null
        }
        wallet={connectedWallet}
        onConnect={openConnectModal}
        onDisconnect={wallet.disconnectWallet}
      />

      {connectedWallet && !wallet.onRightNetwork && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-[#f7931a]/30 bg-[#f7931a]/10 px-4 py-1.5 text-xs text-[#f7931a]">
          <AlertTriangle className="h-3.5 w-3.5" />
          Your wallet is not on Sepolia — transactions are blocked until you switch.
          <button type="button" onClick={() => void wallet.switchToSepolia()} className="rounded border border-[#f7931a]/40 px-2 py-0.5 font-semibold hover:bg-[#f7931a]/20">
            Switch to Sepolia
          </button>
        </div>
      )}
      {perps.error && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-white/5 bg-white/[0.03] px-4 py-1 text-[11px] text-[#888]">
          <AlertTriangle className="h-3 w-3" /> {chainLabel} RPC: {perps.error.slice(0, 140)} — retrying
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-12 gap-1 overflow-y-auto p-1 lg:grid-rows-1 lg:overflow-hidden">
        {/* ---------------- LEFT: Chart + Positions ---------------- */}
        <section className="order-1 col-span-12 flex min-h-0 flex-col gap-1 lg:order-none lg:col-span-7 lg:overflow-hidden">
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
              <span className="ml-auto font-mono text-[10px] text-[#666]">Coinbase index (display only)</span>
            </div>
            <div className="relative flex-1">
              <PriceChart market={activeMarket} timeframe={activeTf} tick={live.tick} onLoadingChange={handleChartLoading} />
              {isChartLoading && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[#121212]/40">
                  <Loader2 className="h-6 w-6 animate-spin text-[#888]" />
                </div>
              )}
            </div>
          </div>

          <PositionsPanel
            chain={wc}
            positions={perps.account?.positions ?? (connectedWallet ? null : [])}
            pending={perps.account?.pending ?? (connectedWallet ? null : [])}
            params={perps.params}
            history={history.items}
            historyLoading={history.loading && !history.items}
            historyError={history.error}
            isConnected={!!connectedWallet}
            slippageBps={slippageBps}
            busy={busy || !wallet.onRightNetwork}
            onTab={(t) => setHistoryOpen(t === "history")}
            onDecrease={(label, p) => submitOrder(label, "decrease", p)}
            onIncrease={(label, p) => submitOrder(label, "increase", p)}
            onCancel={cancelOrder}
          />
        </section>

        {/* ---------------- MIDDLE: Market Info ---------------- */}
        <section className="order-3 col-span-12 min-h-[480px] lg:order-none lg:col-span-2 lg:min-h-0">
          <MarketInfo market={activeMarket} data={marketInfo} oracleStatus={oracleStatus} />
        </section>

        {/* ---------------- RIGHT: Trade Form + order tracker ---------------- */}
        <section className="order-2 col-span-12 flex flex-col gap-1 lg:order-none lg:col-span-3 lg:min-h-0">
          <div className="min-h-0 flex-1">
            <TradeForm
              market={activeMarket}
              side={side}
              onSideChange={setSide}
              leverage={leverage}
              onLeverageChange={setLeverage}
              collateral={collateral}
              onCollateralChange={setCollateral}
              slippageBps={slippageBps}
              onSlippageChange={setSlippageBps}
              data={perps}
              isConnected={!!connectedWallet}
              onRightNetwork={wallet.onRightNetwork}
              busy={busy}
              onConnect={openConnectModal}
              onSwitchNetwork={() => void wallet.switchToSepolia()}
              onApprove={approve}
              onSubmit={(p) => submitOrder(orderLabel(p), "increase", p)}
            />
          </div>
          <OrderTracker items={orders.items} onDismiss={orders.dismiss} />
        </section>
      </div>

      {showConnectModal && (
        <WalletModal
          evmWallets={wallet.evmWallets}
          solWallets={wallet.solWallets}
          isConnecting={wallet.isConnecting}
          connectError={wallet.connectError}
          onClose={() => setShowConnectModal(false)}
          onConnectEvm={async (w) => {
            if (await wallet.connectEVM(w)) setShowConnectModal(false);
          }}
          onConnectSolana={async (w) => {
            if (await wallet.connectSolana(w)) setShowConnectModal(false);
          }}
        />
      )}
    </main>
  );
}
