"use client";

import { useState } from "react";
import { Check, ChevronDown, Copy, LogOut } from "lucide-react";
import { chainColor, type ConnectedWallet } from "@/lib/wallet";

export function AccountMenu({
  wallet,
  onDisconnect,
}: {
  wallet: ConnectedWallet;
  onDisconnect: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const color = chainColor(wallet.chain);
  const shortAddress = `${wallet.address.substring(0, 6)}...${wallet.address.slice(-4)}`;

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`${wallet.chain}: ${wallet.address}`}
        className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#121212]/80 px-3.5 py-2 text-sm font-bold text-white backdrop-blur-sm transition-colors hover:border-white/20"
      >
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }} />
        <span className="hidden font-mono sm:inline">{shortAddress}</span>
        <span className="font-mono sm:hidden">{wallet.chain}</span>
        <ChevronDown className={`h-4 w-4 text-[#888] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          {/* click-away backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-white/10 bg-[#121212] p-3 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#888]">
                {wallet.walletName ?? wallet.chain}
              </span>
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ color, backgroundColor: `${color}26` }}
              >
                {wallet.chain}
              </span>
            </div>

            <button
              type="button"
              onClick={copyAddress}
              className="mt-2 flex w-full items-center justify-between gap-2 rounded-lg border border-white/5 bg-[#000000] px-3 py-2 text-left transition-colors hover:border-white/10"
            >
              <span className="truncate font-mono text-xs text-white/80">{wallet.address}</span>
              {copied ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-[#22c55e]" />
              ) : (
                <Copy className="h-3.5 w-3.5 shrink-0 text-[#888]" />
              )}
            </button>

            <button
              type="button"
              onClick={async () => {
                await onDisconnect();
                setOpen(false);
              }}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-[#ef4444]/20 bg-[#ef4444]/10 py-2 text-sm font-semibold text-[#ef4444] transition-colors hover:bg-[#ef4444]/20"
            >
              <LogOut className="h-4 w-4" />
              Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  );
}
