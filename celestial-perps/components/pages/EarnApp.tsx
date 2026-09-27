"use client";

// Celestial Perps — Earn (liquidity pool). LPs deposit USDC for CLP and are the counterparty to
// every trade: they earn 90% of trading fees plus funding, and take the other side of trader PnL.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Droplets, Info, Loader2, Orbit, Wallet } from "lucide-react";

import { BPS, clpToMint, formatUnits, lpMintFee, mulDivFloor, parseUnits, toPrice, toUsd, usdcForClp } from "@/lib/perpMath";
import { DEFAULT_SLIPPAGE_BPS } from "@/lib/protocol";
import { fmtUsd, fmtUsdCompact } from "@/lib/format";
import type { MarketId } from "@/lib/marketData";
import { useOrders } from "@/hooks/useOrders";
import { usePerps } from "@/hooks/usePerps";
import { useWallet } from "@/hooks/useWallet";
import { AccountMenu } from "@/components/trade/AccountMenu";
import { OrderTracker } from "@/components/trade/OrderTracker";
import { WalletModal } from "@/components/trade/WalletModal";
import { PANEL } from "@/components/trade/ui";

const WEEK = 7 * 86_400;

export default function EarnApp() {
  const wallet = useWallet();
  const { connectedWallet } = wallet;
  const [viewChain, setViewChain] = useState<"sepolia" | "solana">("sepolia");
  // The pool is per chain: follow the wallet when connected, else the selector.
  const onSolana = connectedWallet ? connectedWallet.chain === "Solana" : viewChain === "solana";
  const market: MarketId = onSolana ? "SOL-USD" : "ETH-USD";
  const perps = usePerps(market, connectedWallet);
  const refresh = useCallback(() => perps.refresh(), [perps]);
  const orders = useOrders(refresh);
  const [showConnect, setShowConnect] = useState(false);
  const [tab, setTab] = useState<"add" | "remove">("add");
  const [amount, setAmount] = useState("");
  const [apr, setApr] = useState<{ value: number; complete: boolean } | null>(null);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => clearInterval(id);
  }, []);

  const { pool, params, account, chain, writeChain } = perps;
  const clpDecimals = pool?.clpDecimals ?? 6;
  const scale = 10n ** BigInt(clpDecimals - 6);

  // Fee APR estimate: LP share of fees over the last 7 days ÷ AUM × 52.
  useEffect(() => {
    let cancelled = false;
    setApr(null);
    if (!pool || pool.aum === 0n) return;
    chain
      .getFeesToPool(Math.floor(Date.now() / 1000) - WEEK)
      .then(({ amount, complete }) => !cancelled && setApr({ value: (toUsd(amount) / toUsd(pool.aum)) * 52 * 100, complete }))
      .catch(() => !cancelled && setApr(null));
    return () => {
      cancelled = true;
    };
    // recompute when the chain changes, not on every pool poll
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, pool === null]);

  const busy = orders.items.some((x) => x.status === "signing");
  const share = pool && account && pool.clpSupply > 0n ? Number((account.clp * 1_000_000n) / pool.clpSupply) / 10_000 : 0;
  const myValue = pool && account && pool.clpSupply > 0n ? usdcForClp(account.clp, pool.aum, pool.clpSupply) : 0n;

  // ── add ──
  const addAmt = tab === "add" ? parseUnits(amount || "0", 6) : null;
  const addFee = addAmt && params ? lpMintFee(addAmt, params.lpMintFeeBps) : 0n;
  const expectedClp = addAmt && pool ? clpToMint(addAmt - addFee, pool.aum, pool.clpSupply, scale) : 0n;
  const minClp = mulDivFloor(expectedClp, BPS - BigInt(DEFAULT_SLIPPAGE_BPS), BPS);
  const needsApproval = tab === "add" && !!account && !!addAmt && account.allowance < addAmt;

  // ── remove ──
  const remClp = tab === "remove" ? parseUnits(amount || "0", clpDecimals) : null;
  const expectedUsdc = remClp && pool && pool.clpSupply > 0n ? usdcForClp(remClp, pool.aum, pool.clpSupply) : 0n;
  const minUsdc = mulDivFloor(expectedUsdc, BPS - BigInt(DEFAULT_SLIPPAGE_BPS), BPS);
  const cooldownLeft = account ? Math.max(0, account.lpAvailableAt - now) : 0;

  let block: string | null = null;
  if (!connectedWallet) block = null;
  else if (!wallet.onRightNetwork) block = "Switch your wallet to Sepolia.";
  else if (!pool || !params || !account) block = "Loading…";
  else if (tab === "add") {
    if (addAmt === null || addAmt === 0n) block = "Enter an amount.";
    else if (addAmt > account.usdc) block = "Not enough USDC — use the faucet.";
    else if (expectedClp === 0n) block = "Amount too small.";
  } else {
    if (remClp === null || remClp === 0n) block = "Enter a CLP amount.";
    else if (remClp > account.clp) block = "More than your CLP balance.";
    else if (cooldownLeft > 0) block = `Cooldown: withdrawals open in ${fmtDuration(cooldownLeft)} (15 min after your last deposit).`;
    else if (expectedUsdc > pool.available) block = `Only ${fmtUsd(toUsd(pool.available))} is unreserved right now — open positions reserve the rest.`;
  }

  const submit = () => {
    if (!writeChain || block) return;
    if (tab === "add") {
      const add = () => orders.run(writeChain, `Add ${amount} USDC`, () => writeChain.addLiquidity(addAmt!, minClp)).then((ok) => ok && setAmount(""));
      // EVM: approve, then deposit — two wallet confirmations from one click.
      if (needsApproval) void orders.run(writeChain, "Approve USDC", () => writeChain.approve(addAmt!)).then((ok) => ok && add());
      else void add();
    } else {
      void orders.run(writeChain, `Remove ${amount} CLP`, () => writeChain.removeLiquidity(remClp!, minUsdc)).then((ok) => ok && setAmount(""));
    }
  };

  const chainName = onSolana ? "Solana devnet" : "Sepolia";

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
            <Link href="/earn" className="rounded-md px-2 py-1 text-white">Earn</Link>
            <Link href="/status" className="rounded-md px-2 py-1 text-[#888] hover:text-white">Status</Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {connectedWallet && account && writeChain && (
            <button
              type="button"
              disabled={!account.faucet.canClaim || busy || !wallet.onRightNetwork}
              onClick={() => void orders.run(writeChain, "Faucet: 10,000 test USDC", () => writeChain.faucet())}
              title={account.faucet.canClaim ? "Get 10,000 test USDC" : `Next claim ${account.faucet.nextClaimAt ? new Date(account.faucet.nextClaimAt * 1000).toLocaleString() : "later"}`}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-semibold text-white/85 hover:border-white/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Droplets className="h-3.5 w-3.5" />
              {account.faucet.canClaim ? "Get test USDC" : "Faucet claimed"}
            </button>
          )}
          {connectedWallet ? (
            <AccountMenu wallet={connectedWallet} onDisconnect={wallet.disconnectWallet} />
          ) : (
            <button
              type="button"
              onClick={() => setShowConnect(true)}
              className="flex items-center gap-2 rounded-lg bg-[#22c55e] px-3.5 py-2 text-sm font-bold text-black hover:bg-[#16a34a]"
            >
              <Wallet className="h-4 w-4" strokeWidth={2.5} /> Connect Wallet
            </button>
          )}
        </div>
      </header>

      {connectedWallet && !wallet.onRightNetwork && (
        <div className="flex items-center justify-center gap-2 border-b border-[#f7931a]/30 bg-[#f7931a]/10 px-4 py-1.5 text-xs text-[#f7931a]">
          <AlertTriangle className="h-3.5 w-3.5" /> Your wallet is not on Sepolia.
          <button type="button" onClick={() => void wallet.switchToSepolia()} className="rounded border border-[#f7931a]/40 px-2 py-0.5 font-semibold">
            Switch to Sepolia
          </button>
        </div>
      )}

      <div className="mx-auto grid max-w-5xl gap-3 p-4 md:grid-cols-5">
        {/* pool stats */}
        <section className={`${PANEL} p-4 md:col-span-3`}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold">CLP Liquidity Pool</h1>
              <p className="text-xs text-[#888]">Counterparty to every trade · earns 90% of trading fees + funding</p>
            </div>
            {!connectedWallet ? (
              <div className="flex rounded-lg border border-white/10 p-0.5 text-[11px] font-semibold">
                {(["sepolia", "solana"] as const).map((c) => (
                  <button key={c} type="button" onClick={() => setViewChain(c)} className={`rounded-md px-2 py-1 ${viewChain === c ? "bg-white/10 text-white" : "text-[#888]"}`}>
                    {c === "sepolia" ? "Sepolia" : "Solana"}
                  </button>
                ))}
              </div>
            ) : (
              <span className="rounded bg-white/5 px-2 py-1 font-mono text-[10px] text-[#888]">{chainName}</span>
            )}
          </div>

          {perps.error && !pool ? (
            <p className="text-sm text-[#f7931a]">{chainName} RPC unavailable: {perps.error.slice(0, 160)}</p>
          ) : !pool ? (
            <Loader2 className="h-5 w-5 animate-spin text-[#888]" />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Big label="Pool AUM" value={fmtUsdCompact(toUsd(pool.aum))} />
              <Big label="CLP price" value={fmtUsd(toPrice(pool.clpPrice))} />
              <Big
                label="Fee APR (7d est.)"
                value={apr ? `${apr.value.toFixed(2)}%${apr.complete ? "" : "+"}` : "—"}
                hint={apr && !apr.complete ? "Lower bound: the RPC limits log range" : "LP fees over the last 7 days × 52 ÷ AUM — an estimate"}
              />
              <Big label="Available (unreserved)" value={fmtUsdCompact(toUsd(pool.available))} />
              <Big label="Reserved for traders" value={fmtUsdCompact(toUsd(pool.reserved))} />
              <Big label="CLP supply" value={formatUnits(pool.clpSupply, clpDecimals, 2)} />
            </div>
          )}

          {connectedWallet && account && pool && (
            <div className="mt-5 grid grid-cols-3 gap-3 border-t border-white/5 pt-4">
              <Big label="Your CLP" value={formatUnits(account.clp, clpDecimals, 4)} />
              <Big label="Your share" value={`${share.toFixed(4)}%`} />
              <Big label="Value" value={fmtUsd(toUsd(myValue))} />
            </div>
          )}

          <p className="mt-5 flex items-start gap-1.5 text-[11px] text-[#666]">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            Deposits pay a {params ? (Number(params.lpMintFeeBps) / 100).toFixed(1) : "0.1"}% mint fee. Withdrawals open{" "}
            {params ? Math.round(params.lpCooldown / 60) : 15} minutes after your last deposit and can only use unreserved liquidity. LPs take the other
            side of trader PnL.
          </p>
        </section>

        {/* add / remove */}
        <section className={`${PANEL} flex flex-col gap-3 p-4 md:col-span-2`}>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/5 bg-black p-1">
            {(["add", "remove"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => (setTab(t), setAmount(""))}
                className={`rounded-md py-2 text-sm font-bold ${tab === t ? "bg-white/10 text-white" : "text-[#888] hover:text-white"}`}
              >
                {t === "add" ? "Add liquidity" : "Remove"}
              </button>
            ))}
          </div>

          <label className="block">
            <div className="mb-1 flex justify-between text-[10px] text-[#888]">
              <span className="uppercase tracking-wide">{tab === "add" ? "Deposit" : "Burn"}</span>
              {account && (
                <button
                  type="button"
                  className="font-mono hover:text-white"
                  onClick={() => setAmount(tab === "add" ? formatUnits(account.usdc, 6, 6) : formatUnits(account.clp, clpDecimals, clpDecimals))}
                >
                  Max {tab === "add" ? `${formatUnits(account.usdc, 6, 2)} USDC` : `${formatUnits(account.clp, clpDecimals, 4)} CLP`}
                </button>
              )}
            </div>
            <div className="flex items-center rounded-lg border border-white/5 bg-black px-3 focus-within:border-white/20">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                placeholder="0.0"
                className="w-full bg-transparent py-2.5 text-right font-mono text-sm text-white outline-none"
              />
              <span className="ml-2 text-xs text-[#888]">{tab === "add" ? "USDC" : "CLP"}</span>
            </div>
          </label>

          <div className="space-y-1.5 rounded-lg border border-white/5 bg-black p-2.5 text-xs">
            {tab === "add" ? (
              <>
                <Row label="Mint fee" value={addAmt ? fmtUsd(toUsd(addFee)) : "—"} />
                <Row label="You receive (est.)" value={expectedClp ? `${formatUnits(expectedClp, clpDecimals, 4)} CLP` : "—"} />
                <Row label="Minimum (0.5% slippage)" value={expectedClp ? `${formatUnits(minClp, clpDecimals, 4)} CLP` : "—"} />
              </>
            ) : (
              <>
                <Row label="You receive (est.)" value={expectedUsdc ? fmtUsd(toUsd(expectedUsdc)) : "—"} />
                <Row label="Minimum (0.5% slippage)" value={expectedUsdc ? fmtUsd(toUsd(minUsdc)) : "—"} />
                <Row label="Withdrawals open" value={!account ? "—" : cooldownLeft > 0 ? `in ${fmtDuration(cooldownLeft)}` : "now"} />
              </>
            )}
          </div>

          {connectedWallet && block && <p className="text-center text-[11px] text-[#f7931a]">{block}</p>}

          {!connectedWallet ? (
            <button type="button" onClick={() => setShowConnect(true)} className="rounded-lg bg-[#22c55e] py-3 text-sm font-bold text-black">
              Connect Wallet
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || !!block}
              onClick={submit}
              className="flex items-center justify-center gap-2 rounded-lg bg-[#22c55e] py-3 text-sm font-bold text-black transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {tab === "add" ? (needsApproval ? `Approve ${amount} USDC & add liquidity` : "Add liquidity") : "Remove liquidity"}
            </button>
          )}

          <OrderTracker items={orders.items} onDismiss={orders.dismiss} />
        </section>
      </div>

      {showConnect && (
        <WalletModal
          evmWallets={wallet.evmWallets}
          solWallets={wallet.solWallets}
          isConnecting={wallet.isConnecting}
          connectError={wallet.connectError}
          onClose={() => setShowConnect(false)}
          onConnectEvm={async (w) => {
            if (await wallet.connectEVM(w)) setShowConnect(false);
          }}
          onConnectSolana={async (w) => {
            if (await wallet.connectSolana(w)) setShowConnect(false);
          }}
        />
      )}
    </main>
  );
}

function Big({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div title={hint}>
      <div className="text-[10px] uppercase tracking-wide text-[#888]">{label}</div>
      <div className="font-mono text-base font-semibold tabular-nums text-white">{value}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-[#888]">{label}</span>
      <span className="font-mono tabular-nums text-white">{value}</span>
    </div>
  );
}

const fmtDuration = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);
