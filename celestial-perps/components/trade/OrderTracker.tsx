"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, ExternalLink, Loader2, X, XCircle } from "lucide-react";

import { fmtUsd } from "@/lib/format";
import { toPrice, toUsd } from "@/lib/perpMath";
import type { TrackedTx } from "@/hooks/useOrders";

const STATUS: Record<TrackedTx["status"], { label: string; color: string }> = {
  signing: { label: "Confirm in wallet", color: "text-[#888]" },
  submitted: { label: "Submitted", color: "text-[#888]" },
  pending: { label: "Pending keeper", color: "text-[#f7931a]" },
  filled: { label: "Filled", color: "text-[#22c55e]" },
  cancelled: { label: "Cancelled", color: "text-[#ef4444]" },
  done: { label: "Confirmed", color: "text-[#22c55e]" },
  failed: { label: "Failed", color: "text-[#ef4444]" },
};

/** Recent transactions: submitted → pending keeper (elapsed s) → filled / cancelled (reason). */
export function OrderTracker({ items, onDismiss }: { items: TrackedTx[]; onDismiss: (key: number) => void }) {
  const [, setNow] = useState(0);
  const live = items.some((x) => x.status === "pending" || x.status === "submitted" || x.status === "signing");
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [live]);

  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      {items.slice(0, 3).map((x) => {
        const s = STATUS[x.status];
        const busy = x.status === "pending" || x.status === "submitted" || x.status === "signing";
        const elapsed = Math.max(0, Math.floor((Date.now() - x.since) / 1000));
        return (
          <div key={x.key} className="rounded-lg border border-white/5 bg-black px-2.5 py-2 text-[11px]">
            <div className="flex items-center gap-1.5">
              {busy ? (
                x.status === "pending" ? <Clock className="h-3.5 w-3.5 text-[#f7931a]" /> : <Loader2 className="h-3.5 w-3.5 animate-spin text-[#888]" />
              ) : x.status === "filled" || x.status === "done" ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-[#22c55e]" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-[#ef4444]" />
              )}
              <span className="truncate font-semibold text-white">{x.label}</span>
              <span className={`ml-auto shrink-0 ${s.color}`}>
                {s.label}
                {x.status === "pending" ? ` · ${elapsed}s` : ""}
              </span>
              {!busy && (
                <button type="button" aria-label="Dismiss" onClick={() => onDismiss(x.key)} className="text-[#666] hover:text-white">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            {x.status === "pending" && (
              <p className="mt-0.5 text-[10px] text-[#666]">
                Waiting for the keeper — {x.chainId === "solana-devnet" ? "usually ~2 s" : "usually 1–2 blocks (~12–24 s)"}.
              </p>
            )}
            {x.status === "filled" && x.executionPrice !== undefined && (
              <p className="mt-0.5 font-mono text-[10px] text-[#888]">
                at {fmtUsd(toPrice(x.executionPrice))}
                {x.fee !== undefined ? ` · fee ${fmtUsd(toUsd(x.fee))}` : ""}
              </p>
            )}
            {x.detail && (x.status === "cancelled" || x.status === "failed") && <p className="mt-0.5 text-[10px] text-[#ef4444]/90">{x.detail}</p>}
            {(x.txUrl || x.fillUrl) && (
              <div className="mt-1 flex gap-3 text-[10px]">
                {x.txUrl && (
                  <a href={x.txUrl} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 text-[#888] underline hover:text-white">
                    {x.requestId ? "request" : "tx"} <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
                {x.fillUrl && (
                  <a href={x.fillUrl} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 text-[#888] underline hover:text-white">
                    {x.status === "cancelled" ? "cancel" : "fill"} <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
