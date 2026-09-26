"use client";

// Wallet discovery (EIP-6963 + Wallet Standard), connect/disconnect, and the connected wallet's
// provider + events. Writes always go through the provider the user picked, never through
// window.ethereum directly.

import { createContext, createElement, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  SEPOLIA_CHAIN_HEX,
  isSolanaWallet,
  type ConnectedWallet,
  type Eip1193Provider,
  type Eip6963ProviderDetail,
  type StandardWallet,
  type Web3Window,
} from "@/lib/wallet";

function useWalletState() {
  const [connectedWallet, setConnectedWallet] = useState<ConnectedWallet | null>(null);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [evmWallets, setEvmWallets] = useState<Eip6963ProviderDetail[]>([]);
  const [solWallets, setSolWallets] = useState<StandardWallet[]>([]);
  const [connectError, setConnectError] = useState<string | null>(null);
  /** EVM chain id (hex) of the connected wallet; null for Solana / disconnected */
  const [evmChainId, setEvmChainId] = useState<string | null>(null);

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
      setConnectError("No EVM wallet detected.");
      return false;
    }
    try {
      setIsConnecting(true);
      setConnectError(null);
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      if (accounts.length > 0) {
        setEvmChainId(((await provider.request({ method: "eth_chainId" })) as string).toLowerCase());
        setConnectedWallet({ address: accounts[0], chain: "Ethereum", walletName: detail?.info.name, evmProvider: provider });
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
          setEvmChainId(null);
          setConnectedWallet({ address, chain: "Solana", walletName: wallet.name, solanaWallet: wallet });
          return true;
        }
        return false;
      }

      const legacy = (window as Web3Window).solana;
      if (legacy) {
        const response = await legacy.connect();
        if (response.publicKey) {
          setEvmChainId(null);
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
        const disc = connectedWallet.solanaWallet?.features?.["standard:disconnect"];
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
      setEvmChainId(null);
      setConnectError(null);
    }
  };

  // Follow the connected EVM wallet: account switches and network switches.
  const evmProvider = connectedWallet?.evmProvider;
  useEffect(() => {
    if (!evmProvider?.on) return;
    const onAccounts = (accounts: string[]) => {
      if (!accounts?.length) {
        setConnectedWallet(null);
        setEvmChainId(null);
      } else {
        setConnectedWallet((w) => (w && w.chain === "Ethereum" ? { ...w, address: accounts[0] } : w));
      }
    };
    const onChain = (chainId: string) => setEvmChainId(String(chainId).toLowerCase());
    evmProvider.on("accountsChanged", onAccounts);
    evmProvider.on("chainChanged", onChain);
    return () => {
      evmProvider.removeListener?.("accountsChanged", onAccounts);
      evmProvider.removeListener?.("chainChanged", onChain);
    };
  }, [evmProvider]);

  // Follow the connected Solana wallet (Wallet Standard `change`: account switched / disconnected).
  const solanaWallet = connectedWallet?.solanaWallet;
  useEffect(() => {
    const events = solanaWallet?.features?.["standard:events"];
    if (!events) return;
    return events.on("change", ({ accounts }) => {
      if (!accounts) return;
      if (accounts.length === 0) setConnectedWallet(null);
      else setConnectedWallet((w) => (w && w.chain === "Solana" ? { ...w, address: accounts[0].address } : w));
    });
  }, [solanaWallet]);

  /** EVM network guard: ask the wallet to switch to Sepolia (adding it if unknown). */
  const switchToSepolia = useCallback(async (): Promise<boolean> => {
    const provider: Eip1193Provider | undefined = connectedWallet?.evmProvider;
    if (!provider) return false;
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA_CHAIN_HEX }] });
    } catch (e) {
      if ((e as { code?: number })?.code !== 4902) {
        setConnectError(e instanceof Error ? e.message : "Could not switch network.");
        return false;
      }
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: SEPOLIA_CHAIN_HEX,
            chainName: "Sepolia",
            nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
            rpcUrls: [process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"],
            blockExplorerUrls: ["https://sepolia.etherscan.io"],
          },
        ],
      });
    }
    setEvmChainId(((await provider.request({ method: "eth_chainId" })) as string).toLowerCase());
    return true;
  }, [connectedWallet]);

  /** true when writes are allowed: Solana always (app sends via devnet), EVM only on Sepolia */
  const onRightNetwork = !connectedWallet || connectedWallet.chain === "Solana" || evmChainId === SEPOLIA_CHAIN_HEX;

  return {
    connectedWallet,
    isConnecting,
    evmWallets,
    solWallets,
    connectError,
    setConnectError,
    evmChainId,
    onRightNetwork,
    switchToSepolia,
    connectEVM,
    connectSolana,
    disconnectWallet,
  };
}

type WalletState = ReturnType<typeof useWalletState>;
const WalletContext = createContext<WalletState | null>(null);

/** One wallet connection for the whole app, so navigating /trade ↔ /earn keeps it. */
export function WalletProvider({ children }: { children: ReactNode }) {
  return createElement(WalletContext.Provider, { value: useWalletState() }, children);
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
