"use client";

// Client-side providers mounted once in the root layout.
import type { ReactNode } from "react";

import { WalletProvider } from "@/hooks/useWallet";

export function Providers({ children }: { children: ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}
