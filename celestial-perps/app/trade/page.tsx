"use client";

// Celestial Perps — Trade terminal.
// Chart + index price: Coinbase public API. Oracle (fill) price: Chainlink on Sepolia.
// Execute still calls the legacy CelestialVault until the new engine lands (Phase 6).

import { useCallback, useEffect, useState } from "react";
import { ethers } from "ethers";
import { Loader2 } from "lucide-react";
import CelestialVaultABI from "@/src/abis/CelestialVault.json";
import { fetchStats, TIMEFRAMES, type MarketId, type Timeframe } from "@/lib/marketData";
import { DEFAULT_LEVERAGE, LEGACY_VAULT_ADDRESS, MAX_LEVERAGE, OPEN_FEE_BPS } from "@/lib/protocol";
import type { Web3Window } from "@/lib/wallet";
import { useLivePrice } from "@/hooks/useLivePrice";
import { useOraclePrice } from "@/hooks/useOraclePrice";
import { useWallet } from "@/hooks/useWallet";
import { PriceChart } from "@/components/trade/PriceChart";
import { MarketInfo, type MarketInfoData } from "@/components/trade/MarketInfo";
import { PositionsPanel } from "@/components/trade/PositionsPanel";
import { TradeForm } from "@/components/trade/TradeForm";
import { TradeHeader } from "@/components/trade/TradeHeader";
import { WalletModal } from "@/components/trade/WalletModal";
import { PANEL } from "@/components/trade/ui";

export default function TradePage() {
  const [activeMarket, setActiveMarket] = useState<MarketId>("BTC-USD");
  const [activeTf, setActiveTf] = useState<Timeframe>("15m");
  const [side, setSide] = useState<"long" | "short">("long");
  const [leverage, setLeverage] = useState(DEFAULT_LEVERAGE);
  const [pay, setPay] = useState("0.01");
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [showConnectModal, setShowConnectModal] = useState<boolean>(false);
  const [isChartLoading, setIsChartLoading] = useState<boolean>(true);
  const [statsOpen24h, setStatsOpen24h] = useState<number | null>(null);

  const wallet = useWallet();
  const { connectedWallet } = wallet;

  // ---- Market data --------------------------------------------------------
  const live = useLivePrice(activeMarket);
  const oracle = useOraclePrice(activeMarket);
  const ethOracle = useOraclePrice("ETH-USD"); // collateral is ETH on the legacy vault

  const currentPrice = live.tick?.price ?? null;
  const handleChartLoading = useCallback((b: boolean) => setIsChartLoading(b), []);

  // Seed the 24h open from REST so the change shows before the first ticker frame.
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

  const marketInfo: MarketInfoData = {
    oraclePrice: oracle.price,
    oracleUpdatedAt: oracle.updatedAt,
    indexPrice: currentPrice,
    poolLiquidityUsd: null,
    longOiUsd: null,
    shortOiUsd: null,
    longCapacityUsd: null,
    shortCapacityUsd: null,
    fundingLongPerHour: null,
    fundingShortPerHour: null,
    maxLeverage: MAX_LEVERAGE,
    openFeeBps: OPEN_FEE_BPS,
  };

  const openConnectModal = () => {
    wallet.setConnectError(null);
    setShowConnectModal(true);
  };

  // ── Execute Trade: call openPosition on CelestialVault ──
  const executeTrade = async (goLong: boolean) => {
    if (!connectedWallet) {
      setShowConnectModal(true);
      return;
    }
    if (connectedWallet.chain !== "Ethereum") {
      setTxError("This contract is deployed on Ethereum Sepolia. Please connect an EVM wallet.");
      return;
    }

    try {
      setIsExecuting(true);
      setTxError(null);
      setTxHash(null);

      // 1. Connect to injected provider
      const provider = new ethers.BrowserProvider((window as Web3Window).ethereum!);
      const signer = await provider.getSigner();

      // 2. Instantiate contract
      const vault = new ethers.Contract(LEGACY_VAULT_ADDRESS, CelestialVaultABI, signer);

      // 3. Prepare params
      const collateralValue = ethers.parseEther(pay || "0");
      const sideEnum = goLong ? 0 : 1; // Side.Long = 0, Side.Short = 1
      const market = activeMarket; // e.g. "ETH-USD" or "BTC-USD"

      // 4. First deposit collateral, then open position
      //    The contract requires: deposit ETH → then openPosition uses freeCollateral.
      //    We deposit first, then open the position in one flow.
      const depositTx = await vault.deposit({ value: collateralValue });
      await depositTx.wait();

      // 5. Open the position using deposited collateral
      const openTx = await vault.openPosition(
        market,
        sideEnum,
        collateralValue,
        leverage
      );
      const receipt = await openTx.wait();
      setTxHash(receipt.hash);

    } catch (error: unknown) {
      console.error("Trade execution failed:", error);
      const msg = error instanceof Error ? error.message : "Transaction failed";
      // Extract revert reason if available
      if (msg.includes("user rejected")) {
        setTxError("Transaction rejected by user.");
      } else if (msg.includes("insufficient funds")) {
        setTxError("Insufficient Sepolia ETH for gas + collateral.");
      } else {
        setTxError(msg.length > 120 ? msg.slice(0, 120) + "…" : msg);
      }
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <main className="flex h-screen w-full flex-col overflow-hidden bg-[#000000] text-white">
      {/* ============================== NAVBAR ============================== */}
      <TradeHeader
        market={activeMarket}
        onMarketChange={setActiveMarket}
        price={currentPrice}
        priceUp={live.up}
        feedStatus={live.status}
        change24h={change24h}
        oraclePrice={oracle.price}
        oracleStatus={oracle.status}
        wallet={connectedWallet}
        onConnect={openConnectModal}
        onDisconnect={wallet.disconnectWallet}
      />

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
              <span className="ml-auto font-mono text-[10px] text-[#666]">Coinbase index</span>
            </div>
            <div className="relative flex-1">
              <PriceChart
                market={activeMarket}
                timeframe={activeTf}
                tick={live.tick}
                onLoadingChange={handleChartLoading}
              />
              {isChartLoading && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[#121212]/40">
                  <Loader2 className="h-6 w-6 animate-spin text-[#888]" />
                </div>
              )}
            </div>
          </div>

          <PositionsPanel />
        </section>

        {/* ---------------- MIDDLE: Market Info ---------------- */}
        <section className="order-3 min-h-[480px] lg:order-none lg:col-span-2 lg:min-h-0 col-span-12">
          <MarketInfo market={activeMarket} data={marketInfo} oracleStatus={oracle.status} />
        </section>

        {/* ---------------- RIGHT: Trade Form ---------------- */}
        <section className="order-2 lg:order-none lg:col-span-3 lg:min-h-0 col-span-12">
          <TradeForm
            market={activeMarket}
            side={side}
            onSideChange={setSide}
            leverage={leverage}
            onLeverageChange={setLeverage}
            pay={pay}
            onPayChange={setPay}
            walletBalance={wallet.walletBalance}
            isConnected={!!connectedWallet}
            oraclePrice={oracle.price}
            ethOraclePrice={ethOracle.price}
            isExecuting={isExecuting}
            txHash={txHash}
            txError={txError}
            onExecute={() => executeTrade(side === "long")}
            onConnect={openConnectModal}
          />
        </section>
      </div>

      {/* ============================== CONNECT MODAL ============================== */}
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
