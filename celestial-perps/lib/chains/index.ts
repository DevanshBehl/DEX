// Chain factory + browser wallet adapters. The UI calls `readChain(market)` for data that needs
// no wallet and `walletChain(wallet)` for everything a connected wallet does.

import { BrowserProvider } from "ethers";
import { Transaction, PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";

import type { MarketId } from "@/lib/marketData";
import type { ConnectedWallet, Eip1193Provider, StandardWallet } from "@/lib/wallet";

import { EvmChain, SEPOLIA_CONFIG } from "./evm";
import { DEVNET_CONFIG, SolanaChain, type SolanaSigner } from "./solana";
import { ChainError, type PerpsChain } from "./types";

export * from "./types";
export { messageFor } from "./errors";

let evmReader: EvmChain | null = null;
let solReader: SolanaChain | null = null;

export const sepoliaReader = () => (evmReader ??= new EvmChain(SEPOLIA_CONFIG));
export const solanaReader = () => (solReader ??= new SolanaChain(DEVNET_CONFIG));

/** Read-only chain for a market when no wallet is connected: SOL-USD lives on Solana only. */
export function readChain(market: MarketId, wallet?: ConnectedWallet | null): PerpsChain {
  if (wallet?.chain === "Solana" || market === "SOL-USD") return solanaReader();
  return sepoliaReader();
}

/** Chain bound to the connected wallet (writes go through it). */
export async function walletChain(w: ConnectedWallet): Promise<PerpsChain> {
  if (w.chain === "Ethereum") {
    if (!w.evmProvider) throw new Error("EVM provider missing");
    const signer = await new BrowserProvider(w.evmProvider as Eip1193Provider).getSigner(w.address);
    return new EvmChain(SEPOLIA_CONFIG, signer);
  }
  if (!w.solanaWallet) {
    return new SolanaChain(DEVNET_CONFIG); // legacy window.solana: read-only
  }
  return new SolanaChain(DEVNET_CONFIG, standardSigner(w.solanaWallet, w.address));
}

// ── Wallet Standard → SolanaSigner ──

type StdAccount = { address: string; publicKey?: Uint8Array; chains?: readonly string[]; features?: readonly string[] };
type SignTxFeature = {
  signTransaction: (...inputs: { account: StdAccount; transaction: Uint8Array; chain?: string }[]) => Promise<readonly { signedTransaction: Uint8Array }[]>;
};
type SignAndSendFeature = {
  signAndSendTransaction: (
    ...inputs: { account: StdAccount; transaction: Uint8Array; chain: string; options?: { preflightCommitment?: string } }[]
  ) => Promise<readonly { signature: Uint8Array }[]>;
};

export function standardSigner(wallet: StandardWallet, address: string): SolanaSigner {
  const accounts = ((wallet as unknown as { accounts?: readonly StdAccount[] }).accounts ?? []) as readonly StdAccount[];
  const account = accounts.find((a) => a.address === address) ?? { address };
  const signTx = wallet.features["solana:signTransaction"] as SignTxFeature | undefined;
  const signAndSend = wallet.features["solana:signAndSendTransaction"] as SignAndSendFeature | undefined;
  const serialize = (tx: Transaction) => tx.serialize({ requireAllSignatures: false, verifySignatures: false });

  return {
    publicKey: new PublicKey(address),
    signTransaction: signTx
      ? async (tx) => {
          const res = await signTx.signTransaction({ account, transaction: serialize(tx), chain: "solana:devnet" });
          const out = Array.isArray(res) ? res[0] : (res as unknown as { signedTransaction?: Uint8Array } | undefined);
          if (!out?.signedTransaction) throw unsupported(wallet.name);
          return Transaction.from(out.signedTransaction);
        }
      : undefined,
    signAndSendTransaction: signAndSend
      ? async (tx) => {
          const res = await signAndSend.signAndSendTransaction({ account, transaction: serialize(tx), chain: "solana:devnet", options: { preflightCommitment: "confirmed" } });
          const out = Array.isArray(res) ? res[0] : (res as unknown as { signature?: Uint8Array } | undefined);
          if (!out?.signature) throw unsupported(wallet.name);
          const { utils } = await import("@anchor-lang/core");
          return utils.bytes.bs58.encode(Buffer.from(out.signature));
        }
      : undefined,
  };
}

/** A wallet that advertises a Solana signing feature but returns nothing (e.g. a stub). */
const unsupported = (name: string) =>
  new ChainError(`${name} can't sign Solana transactions yet — connect a wallet such as Phantom for Solana.`, "NoSigner");
