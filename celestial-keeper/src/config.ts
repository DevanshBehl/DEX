/**
 * Environment → validated config. Fails fast with messages that name the variable but never its
 * value. Addresses come from `deployments/*.json`; only RPC URLs, the EVM key and the Solana
 * keypair PATH come from env (see .env.example).
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Level } from "./log.ts";

export const KEEPER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = resolve(KEEPER_ROOT, "..");

export type EvmConfig = {
  rpcUrl: string;
  /** Never logged; only passed to ethers.Wallet. */
  privateKey: string;
  expectedKeeper?: string;
  engine: string;
  oracle: string;
  markets: Record<string, string>; // symbol → bytes32
  startBlock: number;
  logRange: number;
  maxBatch: number;
  confirmTimeoutMs: number;
  minBalanceWei: bigint;
  pollingMs: number;
};

export type SolanaConfig = {
  rpcUrl: string;
  /** Path to the keeper keypair file; the file is only read inside `loadKeypair`. */
  keypairPath: string;
  expectedKeeper?: string;
  idlPath: string;
  maxBatch: number;
  computeUnitsPerExecute: number;
  confirmTimeoutMs: number;
  minBalanceLamports: bigint;
};

export type Config = {
  evm?: EvmConfig;
  solana?: SolanaConfig;
  intervals: { executorMs: number; liquidatorMs: number; fundingMs: number; healthMs: number };
  alertWebhookUrl?: string;
  logLevel: Level;
};

export class ConfigError extends Error {}

type Env = Record<string, string | undefined>;

const bool = (env: Env, key: string, def: boolean) => {
  const v = env[key];
  if (v === undefined || v === "") return def;
  if (/^(1|true|yes)$/i.test(v)) return true;
  if (/^(0|false|no)$/i.test(v)) return false;
  throw new ConfigError(`${key} must be true or false`);
};

const int = (env: Env, key: string, def: number, min = 1) => {
  const v = env[key];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new ConfigError(`${key} must be an integer ≥ ${min}`);
  return n;
};

const required = (env: Env, key: string) => {
  const v = env[key]?.trim();
  if (!v) throw new ConfigError(`${key} is required (see .env.example)`);
  return v;
};

const expandPath = (p: string, base = KEEPER_ROOT) => {
  const home = p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
  return isAbsolute(home) ? home : resolve(base, home);
};

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

export function loadConfig(env: Env = process.env): Config {
  const enableEvm = bool(env, "ENABLE_EVM", true);
  const enableSolana = bool(env, "ENABLE_SOLANA", true);
  if (!enableEvm && !enableSolana) throw new ConfigError("both ENABLE_EVM and ENABLE_SOLANA are false");

  const config: Config = {
    intervals: {
      executorMs: int(env, "EXECUTOR_INTERVAL_MS", 1_500, 100),
      liquidatorMs: int(env, "LIQUIDATOR_INTERVAL_MS", 5_000, 100),
      fundingMs: int(env, "FUNDING_INTERVAL_MS", 3_600_000, 100),
      healthMs: int(env, "HEALTH_INTERVAL_MS", 300_000, 100),
    },
    alertWebhookUrl: env.ALERT_WEBHOOK_URL?.trim() || undefined,
    logLevel: (env.LOG_LEVEL as Level) || "info",
  };
  if (!["debug", "info", "warn", "error", "alert"].includes(config.logLevel)) throw new ConfigError("LOG_LEVEL is invalid");

  if (enableEvm) {
    const deploymentsPath = expandPath(env.EVM_DEPLOYMENTS ?? join(REPO_ROOT, "deployments/sepolia.json"));
    const d = readJson(deploymentsPath);
    const engine = env.EVM_ENGINE ?? d.contracts?.PerpEngine?.address;
    const oracle = env.EVM_ORACLE ?? d.contracts?.ChainlinkOracle?.address;
    const markets = d.contracts?.PerpEngine?.marketIds ?? {};
    const startBlock = int(env, "EVM_START_BLOCK", Number(d.contracts?.PerpEngine?.deployBlock ?? 0), 0);
    if (!engine || !oracle) throw new ConfigError(`PerpEngine/ChainlinkOracle missing in ${deploymentsPath}`);
    const privateKey = required(env, "EVM_KEEPER_PRIVATE_KEY");
    if (!/^(0x)?[0-9a-fA-F]{64}$/.test(privateKey)) throw new ConfigError("EVM_KEEPER_PRIVATE_KEY is not a 32-byte hex key");
    config.evm = {
      rpcUrl: required(env, "SEPOLIA_RPC_URL"),
      privateKey: privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`,
      expectedKeeper: env.EVM_EXPECTED_KEEPER ?? d.contracts?.PerpEngine?.keepers?.[0],
      engine,
      oracle,
      markets,
      startBlock,
      logRange: int(env, "EVM_LOG_RANGE", 500),
      maxBatch: int(env, "EVM_MAX_BATCH", 10),
      confirmTimeoutMs: int(env, "EVM_CONFIRM_TIMEOUT_MS", 120_000),
      minBalanceWei: BigInt(Math.round(Number(env.EVM_MIN_BALANCE_ETH ?? "0.02") * 1e9)) * 10n ** 9n,
      pollingMs: int(env, "EVM_POLLING_MS", 1_000, 50),
    };
  }

  if (enableSolana) {
    const keypairPath = expandPath(required(env, "SOLANA_KEEPER_KEYPAIR_PATH"));
    if (!existsSync(keypairPath)) throw new ConfigError("SOLANA_KEEPER_KEYPAIR_PATH does not point to a file");
    const deploymentsPath = expandPath(env.SOLANA_DEPLOYMENTS ?? join(REPO_ROOT, "deployments/solana-devnet.json"));
    const d = existsSync(deploymentsPath) ? readJson(deploymentsPath) : {};
    config.solana = {
      rpcUrl: env.SOLANA_RPC_URL?.trim() || "https://api.devnet.solana.com",
      keypairPath,
      expectedKeeper: env.SOLANA_EXPECTED_KEEPER ?? d.perps?.keeper,
      idlPath: expandPath(env.SOLANA_IDL_PATH ?? join(REPO_ROOT, "celestial-perps/src/idl/celestial_perps.json")),
      maxBatch: int(env, "SOLANA_MAX_BATCH", 4),
      computeUnitsPerExecute: int(env, "SOLANA_CU_PER_EXECUTE", 90_000),
      confirmTimeoutMs: int(env, "SOLANA_CONFIRM_TIMEOUT_MS", 60_000),
      minBalanceLamports: BigInt(Math.round(Number(env.SOLANA_MIN_BALANCE_SOL ?? "1") * 1e9)),
    };
    if (!existsSync(config.solana.idlPath)) throw new ConfigError("SOLANA_IDL_PATH does not exist");
  }
  return config;
}
