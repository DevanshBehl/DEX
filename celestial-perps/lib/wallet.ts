/* ------------------------------------------------------------------ */
/*  WEB3 — minimal injected-provider typings (EVM + Solana)            */
/* ------------------------------------------------------------------ */

export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<string[]>;
};

export type SolanaProvider = {
  connect: () => Promise<{ publicKey: { toString: () => string } }>;
  disconnect?: () => Promise<void>;
};

export type Web3Window = Window & {
  ethereum?: Eip1193Provider;
  solana?: SolanaProvider;
};

export type ConnectedWallet = {
  address: string;
  chain: "Ethereum" | "Solana";
  walletName?: string;
};

// --- EIP-6963 (multi-wallet discovery for EVM — MetaMask, Celestial, etc.) ---
export type Eip6963ProviderDetail = {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
};

// --- Wallet Standard (the modern Solana discovery mechanism Tensor/Phantom use) ---
type StandardConnectFeature = {
  connect: () => Promise<{ accounts: readonly { address: string }[] }>;
};
type StandardDisconnectFeature = { disconnect: () => Promise<void> };
export type StandardWallet = {
  name: string;
  icon?: string;
  chains?: readonly string[];
  features: Record<string, unknown> & {
    "standard:connect"?: StandardConnectFeature;
    "standard:disconnect"?: StandardDisconnectFeature;
  };
};

export const isSolanaWallet = (w: StandardWallet) =>
  !!w.features?.["standard:connect"] && (w.chains?.some((c) => c.startsWith("solana:")) ?? true);

export const chainColor = (chain: ConnectedWallet["chain"]) => (chain === "Ethereum" ? "#627eea" : "#9945ff");
