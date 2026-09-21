"use client";

import { ChevronDown, X } from "lucide-react";
import type { Eip6963ProviderDetail, StandardWallet } from "@/lib/wallet";

function WalletOption({
  name,
  subtitle,
  iconSrc,
  fallbackGlyph,
  accentColor,
  disabled,
  onClick,
}: {
  name: string;
  subtitle: string;
  iconSrc?: string;
  fallbackGlyph: string;
  accentColor: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex w-full items-center gap-3 rounded-xl border border-white/10 bg-[#000000] p-3.5 text-left transition-colors hover:border-white/20 hover:bg-white/[0.03] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {iconSrc ? (
        // eslint-disable-next-line @next/next/no-img-element -- wallet icons are inline data URIs
        <img src={iconSrc} alt="" className="h-9 w-9 shrink-0 rounded-lg object-contain" />
      ) : (
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-lg font-bold"
          style={{ backgroundColor: `${accentColor}26`, color: accentColor }}
        >
          {fallbackGlyph}
        </span>
      )}
      <span className="flex flex-col">
        <span className="text-sm font-semibold text-white">{name}</span>
        <span className="text-xs text-[#888]">{subtitle}</span>
      </span>
      <ChevronDown className="ml-auto h-4 w-4 -rotate-90 text-[#888] transition-colors group-hover:text-white" />
    </button>
  );
}

export function WalletModal({
  evmWallets,
  solWallets,
  isConnecting,
  connectError,
  onClose,
  onConnectEvm,
  onConnectSolana,
}: {
  evmWallets: Eip6963ProviderDetail[];
  solWallets: StandardWallet[];
  isConnecting: boolean;
  connectError: string | null;
  onClose: () => void;
  onConnectEvm: (detail?: Eip6963ProviderDetail) => void;
  onConnectSolana: (wallet?: StandardWallet) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Connect a wallet"
    >
      <div
        className="w-96 max-w-full rounded-2xl border border-white/10 bg-[#121212] p-6 shadow-[0_40px_100px_-20px_rgba(0,0,0,0.8)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Connect Wallet</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded-md text-[#888] transition-colors hover:bg-white/5 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Ethereum (EVM) — EIP-6963 discovered wallets */}
          <div className="space-y-2">
            <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-[#888]">Ethereum</p>
            {evmWallets.length > 0 ? (
              evmWallets.map((w) => (
                <WalletOption
                  key={w.info.uuid}
                  name={w.info.name}
                  subtitle="Ethereum · EVM"
                  iconSrc={w.info.icon}
                  fallbackGlyph="Ξ"
                  accentColor="#627eea"
                  disabled={isConnecting}
                  onClick={() => onConnectEvm(w)}
                />
              ))
            ) : (
              <WalletOption
                name="Ethereum (EVM)"
                subtitle="Injected · window.ethereum"
                fallbackGlyph="Ξ"
                accentColor="#627eea"
                disabled={isConnecting}
                onClick={() => onConnectEvm()}
              />
            )}
          </div>

          {/* Solana — Wallet Standard discovered wallets */}
          <div className="space-y-2">
            <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-[#888]">Solana</p>
            {solWallets.length > 0 ? (
              solWallets.map((w) => (
                <WalletOption
                  key={w.name}
                  name={w.name}
                  subtitle="Solana"
                  iconSrc={w.icon}
                  fallbackGlyph="◎"
                  accentColor="#9945ff"
                  disabled={isConnecting}
                  onClick={() => onConnectSolana(w)}
                />
              ))
            ) : (
              <WalletOption
                name="Solana"
                subtitle="Injected · window.solana"
                fallbackGlyph="◎"
                accentColor="#9945ff"
                disabled={isConnecting}
                onClick={() => onConnectSolana()}
              />
            )}
          </div>
        </div>

        {isConnecting && <p className="mt-4 text-center text-xs text-[#888]">Awaiting wallet approval…</p>}
        {connectError && !isConnecting && (
          <p className="mt-4 rounded-lg border border-[#ef4444]/20 bg-[#ef4444]/10 px-3 py-2 text-center text-xs text-[#ef4444]">
            {connectError}
          </p>
        )}
      </div>
    </div>
  );
}
