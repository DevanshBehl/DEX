"use client";

import { useEffect, useState } from "react";
import { ExternalLink, History, ListOrdered, Loader2, Timer } from "lucide-react";

import type { HistoryItem, OrderParams, PendingRequest, PerpsChain, Position, ProtocolParams } from "@/lib/chains";
import { messageFor } from "@/lib/chains";
import { fmtUsd } from "@/lib/format";
import { BPS, executionPrice, isLiquidatable, mulDivCeil, mulDivFloor, parseUnits, pnl, positionFee, toPrice, toUsd } from "@/lib/perpMath";
import { PANEL } from "./ui";

type Tab = "positions" | "orders" | "history";

const signed = (v: bigint) => `${v >= 0n ? "+" : "−"}${fmtUsd(Math.abs(toUsd(v)))}`;
const pnlColor = (v: bigint | null) => (v === null ? "text-white" : v >= 0n ? "text-[#22c55e]" : "text-[#ef4444]");

/** Acceptable price for a decrease/close: execution price ∓ slippage (against the trader). */
function closeAcceptable(p: Position, params: ProtocolParams, slippageBps: number): bigint | null {
  if (p.markPrice === null) return null;
  const exec = executionPrice(p.markPrice, p.isLong, false, params.executionSpreadBps);
  return p.isLong ? mulDivFloor(exec, BPS - BigInt(slippageBps), BPS) : mulDivCeil(exec, BPS + BigInt(slippageBps), BPS);
}

export function PositionsPanel({
  chain,
  positions,
  pending,
  params,
  history,
  historyLoading,
  historyError,
  isConnected,
  slippageBps,
  busy,
  onTab,
  onDecrease,
  onIncrease,
  onCancel,
}: {
  chain: PerpsChain | null;
  positions: Position[] | null;
  pending: PendingRequest[] | null;
  params: ProtocolParams | null;
  history: HistoryItem[] | null;
  historyLoading: boolean;
  historyError: string | null;
  isConnected: boolean;
  slippageBps: number;
  busy: boolean;
  onTab: (tab: Tab) => void;
  onDecrease: (label: string, p: OrderParams) => void;
  onIncrease: (label: string, p: OrderParams) => void;
  onCancel: (r: PendingRequest) => void;
}) {
  const [tab, setTab] = useState<Tab>("positions");
  const [edit, setEdit] = useState<{ id: string; mode: "partial" | "add" | "remove" } | null>(null);
  const [amount, setAmount] = useState("");
  const [, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const select = (t: Tab) => {
    setTab(t);
    onTab(t);
  };

  const tabs = [
    { id: "positions" as const, label: `Positions${positions?.length ? ` (${positions.length})` : ""}`, icon: ListOrdered },
    { id: "orders" as const, label: `Orders${pending?.length ? ` (${pending.length})` : ""}`, icon: Timer },
    { id: "history" as const, label: "History", icon: History },
  ];

  return (
    <div className={`${PANEL} flex min-h-[220px] shrink-0 flex-col overflow-hidden lg:h-[34%]`}>
      <div className="flex shrink-0 items-center gap-4 border-b border-white/5 px-3">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => select(id)}
            className={`flex items-center gap-1.5 border-b-2 py-2.5 text-xs font-semibold transition-colors ${
              tab === id ? "border-[#22c55e] text-white" : "border-transparent text-[#888] hover:text-white"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
        <span className="ml-auto hidden font-mono text-[10px] text-[#666] sm:block">Mark = oracle price</span>
      </div>

      <div className="thin-scroll min-h-0 flex-1 overflow-auto">
        {!isConnected ? (
          <Empty icon={ListOrdered} text="Connect a wallet to see positions" />
        ) : tab === "positions" ? (
          positions === null ? (
            <Empty icon={Loader2} text="Loading…" spin />
          ) : positions.length === 0 ? (
            <Empty icon={ListOrdered} text="No open positions" />
          ) : (
            <table className="w-full min-w-[900px] text-left font-mono text-xs tabular-nums">
              <thead className="sticky top-0 z-10 bg-[#101010] text-[10px] uppercase tracking-wide text-[#888]">
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                  <th>Market</th>
                  <th className="text-right">Size</th>
                  <th className="text-right">Collateral</th>
                  <th className="text-right">Entry</th>
                  <th className="text-right">Mark</th>
                  <th className="text-right">Liq. Price</th>
                  <th className="text-right" title="If closed now: PnL (capped by reserve) − close fee − funding owed">Net PnL</th>
                  <th className="text-right">Funding owed</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const lev = p.collateral > 0n ? Number((p.size * 100n) / p.collateral) / 100 : 0;
                  const isEditing = edit?.id === p.id;
                  return (
                    <tr key={p.id} className="border-t border-white/[0.04] align-top [&>td]:px-3 [&>td]:py-2">
                      <td>
                        <span className="font-sans font-semibold text-white">{p.market}</span>{" "}
                        <span className={p.isLong ? "text-[#22c55e]" : "text-[#ef4444]"}>
                          {p.isLong ? "Long" : "Short"} {lev.toFixed(1)}x
                        </span>
                      </td>
                      <td className="text-right text-white">{fmtUsd(toUsd(p.size))}</td>
                      <td className="text-right text-white">{fmtUsd(toUsd(p.collateral))}</td>
                      <td className="text-right text-white/80">{fmtUsd(toPrice(p.entryPrice))}</td>
                      <td className="text-right text-white/80">{p.markPrice !== null ? fmtUsd(toPrice(p.markPrice)) : "stale"}</td>
                      <td className="text-right text-[#ef4444]/80">{p.liquidationPrice > 0n ? fmtUsd(toPrice(p.liquidationPrice)) : "—"}</td>
                      <td className={`text-right ${pnlColor(p.netPnl)}`}>
                        {p.netPnl !== null ? signed(p.netPnl) : "—"}
                        {p.netPnl !== null && p.collateral > 0n && (
                          <div className="text-[10px] opacity-70">{((Number(p.netPnl) / Number(p.collateral)) * 100).toFixed(2)}%</div>
                        )}
                      </td>
                      <td className="text-right text-white/70">{fmtUsd(toUsd(p.fundingOwed))}</td>
                      <td className="text-right font-sans">
                        {isEditing && params ? (
                          <EditRow
                            p={p}
                            mode={edit!.mode}
                            params={params}
                            amount={amount}
                            setAmount={setAmount}
                            busy={busy}
                            slippageBps={slippageBps}
                            onCancel={() => setEdit(null)}
                            onDecrease={(label, o) => {
                              onDecrease(label, o);
                              setEdit(null);
                            }}
                            onIncrease={(label, o) => {
                              onIncrease(label, o);
                              setEdit(null);
                            }}
                          />
                        ) : (
                          <div className="flex justify-end gap-1">
                            <SmallBtn
                              disabled={busy || !params}
                              onClick={() => {
                                const acc = params && closeAcceptable(p, params, slippageBps);
                                if (acc !== null && acc !== undefined)
                                  onDecrease(`Close ${p.market} ${p.isLong ? "long" : "short"}`, { market: p.market, isLong: p.isLong, collateralDelta: 0n, sizeDelta: p.size, acceptablePrice: acc });
                              }}
                            >
                              Close
                            </SmallBtn>
                            <SmallBtn disabled={busy} onClick={() => (setEdit({ id: p.id, mode: "partial" }), setAmount("50"))}>
                              Partial
                            </SmallBtn>
                            <SmallBtn disabled={busy} onClick={() => (setEdit({ id: p.id, mode: "add" }), setAmount(""))}>
                              +Coll
                            </SmallBtn>
                            <SmallBtn disabled={busy} onClick={() => (setEdit({ id: p.id, mode: "remove" }), setAmount(""))}>
                              −Coll
                            </SmallBtn>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : tab === "orders" ? (
          pending === null ? (
            <Empty icon={Loader2} text="Loading…" spin />
          ) : pending.length === 0 ? (
            <Empty icon={Timer} text="No pending orders" />
          ) : (
            <table className="w-full min-w-[720px] text-left font-mono text-xs tabular-nums">
              <thead className="sticky top-0 z-10 bg-[#101010] text-[10px] uppercase tracking-wide text-[#888]">
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                  <th>Order</th>
                  <th className="text-right">Collateral Δ</th>
                  <th className="text-right">Size Δ</th>
                  <th className="text-right">Acceptable</th>
                  <th className="text-right">Age</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((r) => {
                  const now = Math.floor(Date.now() / 1000);
                  const canCancel = now >= r.cancellableAt;
                  return (
                    <tr key={r.id} className="border-t border-white/[0.04] [&>td]:px-3 [&>td]:py-2">
                      <td className="font-sans">
                        <span className="font-semibold text-white">{r.market}</span>{" "}
                        <span className={r.isLong ? "text-[#22c55e]" : "text-[#ef4444]"}>
                          {r.kind === "increase" ? "Increase" : "Decrease"} {r.isLong ? "long" : "short"}
                        </span>
                      </td>
                      <td className="text-right text-white">{fmtUsd(toUsd(r.collateralDelta))}</td>
                      <td className="text-right text-white">{fmtUsd(toUsd(r.sizeDelta))}</td>
                      <td className="text-right text-white/70">{fmtUsd(toPrice(r.acceptablePrice))}</td>
                      <td className="text-right text-white/70">{Math.max(0, now - r.createdAt)}s</td>
                      <td className="text-right font-sans">
                        <SmallBtn disabled={busy || !canCancel} onClick={() => onCancel(r)} title={canCancel ? "Cancel and refund" : `Cancellable in ${r.cancellableAt - now}s`}>
                          {canCancel ? "Cancel" : `Cancel in ${r.cancellableAt - now}s`}
                        </SmallBtn>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : historyError ? (
          <Empty icon={History} text={`History unavailable: ${historyError.slice(0, 120)}`} />
        ) : history === null || historyLoading ? (
          <Empty icon={Loader2} text="Loading history…" spin />
        ) : history.length === 0 ? (
          <Empty icon={History} text="No order history yet" />
        ) : (
          <table className="w-full min-w-[760px] text-left font-mono text-xs tabular-nums">
            <thead className="sticky top-0 z-10 bg-[#101010] text-[10px] uppercase tracking-wide text-[#888]">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                <th>Time</th>
                <th>Event</th>
                <th className="text-right">Size Δ</th>
                <th className="text-right">Price</th>
                <th className="text-right">PnL / Amount</th>
                <th className="text-right">Fee</th>
                <th className="text-right">Tx</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.key} className="border-t border-white/[0.04] [&>td]:px-3 [&>td]:py-1.5">
                  <td className="text-white/60">{h.time ? new Date(h.time * 1000).toLocaleString() : "—"}</td>
                  <td className="font-sans text-white">
                    {LABEL[h.event]}
                    {h.market ? ` · ${h.market}` : ""}
                    {h.isLong !== undefined ? ` ${h.isLong ? "long" : "short"}` : ""}
                    {h.reason ? <span className="text-[#ef4444]/80"> — {messageFor(h.reason, h.reason)}</span> : null}
                  </td>
                  <td className="text-right text-white/80">{h.sizeDelta !== undefined && h.sizeDelta > 0n ? fmtUsd(toUsd(h.sizeDelta)) : ""}</td>
                  <td className="text-right text-white/80">{h.executionPrice !== undefined ? fmtUsd(toPrice(h.executionPrice)) : ""}</td>
                  <td className={`text-right ${h.realisedPnl !== undefined ? pnlColor(h.realisedPnl) : "text-white/80"}`}>
                    {h.realisedPnl !== undefined ? signed(h.realisedPnl) : h.amount !== undefined ? fmtUsd(toUsd(h.amount)) : ""}
                  </td>
                  <td className="text-right text-white/60">{h.fee !== undefined && h.fee > 0n ? fmtUsd(toUsd(h.fee)) : ""}</td>
                  <td className="text-right">
                    {chain && (
                      <a href={chain.explorerTx(h.tx)} target="_blank" rel="noreferrer" className="inline-flex items-center text-[#888] hover:text-white">
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const LABEL: Record<HistoryItem["event"], string> = {
  RequestCreated: "Order placed",
  RequestExecuted: "Order filled",
  RequestCancelled: "Order cancelled",
  PositionIncreased: "Increased",
  PositionDecreased: "Decreased",
  PositionClosed: "Closed",
  PositionLiquidated: "Liquidated",
  LiquidityAdded: "Liquidity added",
  LiquidityRemoved: "Liquidity removed",
  FaucetClaimed: "Faucet",
};

/** Inline editor: partial close (% of size), add collateral, remove collateral (checked). */
function EditRow({
  p,
  mode,
  params,
  amount,
  setAmount,
  busy,
  slippageBps,
  onCancel,
  onDecrease,
  onIncrease,
}: {
  p: Position;
  mode: "partial" | "add" | "remove";
  params: ProtocolParams;
  amount: string;
  setAmount: (v: string) => void;
  busy: boolean;
  slippageBps: number;
  onCancel: () => void;
  onDecrease: (label: string, o: OrderParams) => void;
  onIncrease: (label: string, o: OrderParams) => void;
}) {
  const acc = closeAcceptable(p, params, slippageBps);
  let error: string | null = null;
  let submit: (() => void) | null = null;
  const name = `${p.market} ${p.isLong ? "long" : "short"}`;

  if (mode === "partial") {
    const pct = Number(amount);
    if (!Number.isInteger(pct) || pct <= 0 || pct >= 100) error = "1–99%";
    else if (acc === null) error = "oracle stale";
    else {
      const sizeDelta = (p.size * BigInt(pct)) / 100n;
      submit = () => onDecrease(`Close ${pct}% of ${name}`, { market: p.market, isLong: p.isLong, collateralDelta: 0n, sizeDelta, acceptablePrice: acc! });
    }
  } else {
    const v = parseUnits(amount || "0", 6);
    if (v === null || v === 0n) error = "amount";
    else if (mode === "add") {
      const exec = p.markPrice !== null ? executionPrice(p.markPrice, p.isLong, true, params.executionSpreadBps) : null;
      const accInc = exec === null ? null : p.isLong ? mulDivCeil(exec, BPS + BigInt(slippageBps), BPS) : mulDivFloor(exec, BPS - BigInt(slippageBps), BPS);
      if (accInc === null) error = "oracle stale";
      else submit = () => onIncrease(`Add ${amount} USDC to ${name}`, { market: p.market, isLong: p.isLong, collateralDelta: v, sizeDelta: 0n, acceptablePrice: accInc });
    } else {
      // Remove: the engine re-validates min collateral, max leverage and liquidation at the oracle price.
      const newColl = p.collateral - p.fundingOwed - v;
      if (newColl < params.minCollateral) error = "below min collateral";
      else if (p.size > newColl * params.maxLeverage) error = "above max leverage";
      else if (p.markPrice !== null && isLiquidatable(newColl, pnl(p.isLong, p.size, p.tokens, p.markPrice), 0n, positionFee(p.size, params.positionFeeBps), p.size, params.maintenanceMarginBps))
        error = "would be liquidatable";
      else if (acc === null) error = "oracle stale";
      else submit = () => onDecrease(`Remove ${amount} USDC from ${name}`, { market: p.market, isLong: p.isLong, collateralDelta: v, sizeDelta: 0n, acceptablePrice: acc! });
    }
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <input
        autoFocus
        value={amount}
        onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
        placeholder={mode === "partial" ? "%" : "USDC"}
        className="w-16 rounded border border-white/10 bg-black px-1.5 py-0.5 text-right font-mono text-[11px] text-white outline-none focus:border-white/30"
      />
      <span className="text-[10px] text-[#666]">{mode === "partial" ? "%" : "USDC"}</span>
      <SmallBtn disabled={busy || !submit} onClick={() => submit?.()} title={error ?? undefined}>
        {mode === "partial" ? "Close" : mode === "add" ? "Add" : "Remove"}
      </SmallBtn>
      <SmallBtn onClick={onCancel}>✕</SmallBtn>
      {error && amount && <span className="text-[10px] text-[#f7931a]">{error}</span>}
    </div>
  );
}

function SmallBtn({ children, onClick, disabled, title }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded-md border border-white/10 bg-black px-2 py-0.5 text-[10px] font-semibold text-white/85 transition-colors hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function Empty({ icon: Icon, text, spin }: { icon: typeof History; text: string; spin?: boolean }) {
  return (
    <div className="flex h-full min-h-[140px] flex-col items-center justify-center gap-2 py-6 text-[#666]">
      <Icon className={`h-6 w-6 ${spin ? "animate-spin" : ""}`} strokeWidth={1.5} />
      <span className="text-xs">{text}</span>
    </div>
  );
}
