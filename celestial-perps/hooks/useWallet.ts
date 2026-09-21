"use client";

// Wallet discovery + connect/disconnect + ETH balance, moved out of the trade page
// without behaviour changes.

import { useEffect, useState } from "react";
import { ethers } from "ethers";
import {
  isSolanaWallet,
  type ConnectedWallet,
  type Eip6963ProviderDetail,
  type StandardWallet,
  type Web3Window,
} from "@/lib/wallet";

export function useWallet() {
  const [connectedWallet, setConnectedWallet] = useState<ConnectedWallet | null>(null);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [evmWallets, setEvmWallets] = useState<Eip6963ProviderDetail[]>([]);
  const [solWallets, setSolWallets] = useState<StandardWallet[]>([]);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);

  // Persistent wallet discovery on mount. Both standards are handshake-based, so
  // we must have listeners registered *before* asking wallets to announce — a
  // one-shot poll at click-time misses wallets (like Celestial) that register once.
  useEffect(() => {
    // EIP-6963: EVM multi-wallet discovery (MetaMask, Celestial, …).
    const onEvmAnnounce = (e: Event) => {
      const detail = (e as CustomEvent<Eip6963ProviderDetail>).detail;
      if (!detail?.info?.uuid) return;
      setEvmWallets((prev) =>
        prev.some((w) => w.info.uuid === detail.info.uuid) ? prev : [...prev, detail]
      );
    };
    window.addEventListener("eip6963:announceProvider", onEvmAnnounce as EventListener);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    // Wallet Standard: Solana multi-wallet discovery (Celestial, Phantom, …).
    const register = (wallet: StandardWallet) => {
      if (wallet?.name && isSolanaWallet(wallet)) {
        setSolWallets((prev) => (prev.some((w) => w.name === wallet.name) ? prev : [...prev, wallet]));
      }
      return () => {};
    };
    const api = { register, on: () => () => {} };
    const onSolRegister = (e: Event) => {
      const cb = (e as CustomEvent).detail;
      if (typeof cb === "function") cb(api);
    };
    window.addEventListener("wallet-standard:register-wallet", onSolRegister);
    window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: api }));

    return () => {
      window.removeEventListener("eip6963:announceProvider", onEvmAnnounce as EventListener);
      window.removeEventListener("wallet-standard:register-wallet", onSolRegister);
    };
  }, []);

  // Connect a specific EVM wallet chosen from the list (EIP-1193 request).
  // Resolves true when a wallet was connected.
  const connectEVM = async (detail?: Eip6963ProviderDetail): Promise<boolean> => {
    const provider = detail?.provider ?? (window as Web3Window).ethereum;
    if (!provider) {
      alert("No EVM wallet detected.");
      return false;
    }
    try {
      setIsConnecting(true);
      setConnectError(null);
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      if (accounts.length > 0) {
        setConnectedWallet({ address: accounts[0], chain: "Ethereum", walletName: detail?.info.name });
        return true;
      }
      return false;
    } catch (error) {
      console.error("EVM Connection Error:", error);
      setConnectError(error instanceof Error ? error.message : "Connection failed.");
      return false;
    } finally {
      setIsConnecting(false);
    }
  };

  // Connect a specific Solana wallet chosen from the list (Wallet Standard connect),
  // falling back to the legacy window.solana injection if none were discovered.
  const connectSolana = async (wallet?: StandardWallet): Promise<boolean> => {
    try {
      setIsConnecting(true);
      setConnectError(null);

      if (wallet) {
        const res = await wallet.features["standard:connect"]!.connect();
        const address = res?.accounts?.[0]?.address;
        if (address) {
          setConnectedWallet({ address, chain: "Solana", walletName: wallet.name });
          return true;
        }
        return false;
      }

      const legacy = (window as Web3Window).solana;
      if (legacy) {
        const response = await legacy.connect();
        if (response.publicKey) {
          setConnectedWallet({ address: response.publicKey.toString(), chain: "Solana" });
          return true;
        }
        return false;
      }

      setConnectError("No Solana wallet detected.");
      return false;
    } catch (error) {
      console.error("Solana Connection Error:", error);
      setConnectError(error instanceof Error ? error.message : "Connection failed.");
      return false;
    } finally {
      setIsConnecting(false);
    }
  };

  // Disconnect — for Solana, also tell the wallet to drop the session (Wallet
  // Standard disconnect, or legacy window.solana.disconnect). EIP-1193 has no
  // reliable programmatic disconnect, so for EVM we just clear local state.
  const disconnectWallet = async () => {
    try {
      if (connectedWallet?.chain === "Solana") {
        const w = solWallets.find((x) => x.name === connectedWallet.walletName);
        const disc = w?.features?.["standard:disconnect"];
        if (disc?.disconnect) {
          await disc.disconnect();
        } else {
          await (window as Web3Window).solana?.disconnect?.();
        }
      }
    } catch (error) {
      console.error("Disconnect error:", error);
    } finally {
      setConnectedWallet(null);
      setConnectError(null);
    }
  };

  // Fetch wallet balance when connected
  useEffect(() => {
    if (!connectedWallet || connectedWallet.chain !== "Ethereum") {
      setWalletBalance(null);
      return;
    }
    let cancelled = false;
    const fetchBalance = async () => {
      try {
        const provider = new ethers.BrowserProvider((window as Web3Window).ethereum!);
        const bal = await provider.getBalance(connectedWallet.address);
        if (!cancelled) setWalletBalance(ethers.formatEther(bal));
      } catch {
        if (!cancelled) setWalletBalance(null);
      }
    };
    fetchBalance();
    const interval = setInterval(fetchBalance, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [connectedWallet]);

  return {
    connectedWallet,
    isConnecting,
    evmWallets,
    solWallets,
    connectError,
    setConnectError,
    walletBalance,
    connectEVM,
    connectSolana,
    disconnectWallet,
  };
}
