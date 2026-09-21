"use client";

import { useState } from "react";
import { History, ListOrdered } from "lucide-react";
import { PANEL } from "./ui";

// Positions / order history. Empty until Phase 6 reads positions from the chain.
export function PositionsPanel() {
  const [tab, setTab] = useState<"positions" | "history">("positions");

  return (
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
          <div className="flex h-full min-w-[760px] flex-col">
            <table className="w-full text-left font-mono text-xs tabular-nums">
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
            </table>
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-[#666]">
              <ListOrdered className="h-6 w-6" strokeWidth={1.5} />
              <span className="text-xs">No open positions</span>
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-[#666]">
            <History className="h-6 w-6" strokeWidth={1.5} />
            <span className="text-xs">No order history yet</span>
          </div>
        )}
      </div>
    </div>
  );
}
