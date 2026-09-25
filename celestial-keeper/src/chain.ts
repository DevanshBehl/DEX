/** What `index.ts` runs for each chain: one method per job loop. */
export interface ChainKeeper {
  readonly chain: "evm" | "solana";
  /** Connect, verify the keeper is whitelisted and load static state. Throws on a fatal problem. */
  init(): Promise<void>;
  executorTick(): Promise<void>;
  liquidatorTick(): Promise<void>;
  fundingTick(): Promise<void>;
  /** Balance / whitelist checks. Returns `false` when this chain's loops must stop. */
  healthTick(): Promise<boolean>;
  /** Wait for in-flight transactions to settle (graceful shutdown). */
  drain(timeoutMs: number): Promise<void>;
}

export class FatalError extends Error {}
