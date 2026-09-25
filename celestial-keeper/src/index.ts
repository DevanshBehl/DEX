/**
 * Celestial Perps keeper — one process, both chains.
 *
 *   pnpm keeper            # EVM + Solana (per ENABLE_EVM / ENABLE_SOLANA)
 *   pnpm keeper:evm        # Sepolia only
 *   pnpm keeper:solana     # Solana devnet only
 *
 * Per chain: executor (EXECUTOR_INTERVAL_MS), liquidator (LIQUIDATOR_INTERVAL_MS), funding
 * (FUNDING_INTERVAL_MS ±5%), health (HEALTH_INTERVAL_MS). Every loop is independent: a failing
 * tick backs off and retries without affecting the others.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { type ChainKeeper, FatalError } from "./chain.ts";
import { type Config, ConfigError, KEEPER_ROOT, loadConfig } from "./config.ts";
import { EvmKeeper } from "./evm/keeper.ts";
import { Alerter } from "./health.ts";
import { type Logger, createLogger, errMsg } from "./log.ts";
import { backoffMs, jitter, runLoop, sleep } from "./retry.ts";
import { SolanaKeeper } from "./solana/keeper.ts";

export type RunningKeeper = { keepers: ChainKeeper[]; stop: () => Promise<void>; done: Promise<void> };

/** Start every enabled chain. Used by the CLI and, in-process, by the local integration tests. */
export function startKeeper(config: Config, log: Logger): RunningKeeper {
  const controller = new AbortController();
  const alerter = new Alerter(log, config.alertWebhookUrl);
  const keepers: ChainKeeper[] = [];
  if (config.evm) keepers.push(new EvmKeeper(config.evm, log.child({ chain: "evm" }), alerter));
  if (config.solana) keepers.push(new SolanaKeeper(config.solana, log.child({ chain: "solana" }), alerter));

  const runs = keepers.map((k) => runChain(k, config, log.child({ chain: k.chain }), alerter, controller.signal));
  const done = Promise.all(runs).then(() => undefined);
  return {
    keepers,
    done,
    stop: async () => {
      controller.abort();
      await done;
      await Promise.all(keepers.map((k) => k.drain(10_000)));
    },
  };
}

async function runChain(k: ChainKeeper, config: Config, log: Logger, alerter: Alerter, parent: AbortSignal) {
  // init with backoff: an RPC outage at start-up must not kill the process.
  for (let attempt = 1; !parent.aborted; attempt++) {
    try {
      await k.init();
      break;
    } catch (e) {
      if (e instanceof FatalError) {
        await alerter.raise(`${k.chain}-fatal`, "keeper cannot run on this chain", { chain: k.chain, err: errMsg(e) });
        return;
      }
      const delay = backoffMs(attempt, 2_000, 60_000);
      log.warn("init failed; retrying", { attempt, retry_in_ms: delay, err: errMsg(e) });
      await sleep(delay, parent);
    }
  }
  if (parent.aborted) return;

  // A chain-local abort lets health stop this chain without touching the other one.
  const chain = new AbortController();
  const onParentAbort = () => chain.abort();
  parent.addEventListener("abort", onParentAbort, { once: true });
  const { executorMs, liquidatorMs, fundingMs, healthMs } = config.intervals;

  await Promise.all([
    runLoop("executor", executorMs, () => k.executorTick(), log.child({ job: "executor" }), chain.signal),
    runLoop("liquidator", liquidatorMs, () => k.liquidatorTick(), log.child({ job: "liquidator" }), chain.signal, { initialDelayMs: 250 }),
    runLoop("funding", () => jitter(fundingMs), () => k.fundingTick(), log.child({ job: "funding" }), chain.signal, { initialDelayMs: 500 }),
    runLoop(
      "health",
      healthMs,
      async () => {
        if (!(await k.healthTick())) {
          log.error("stopping this chain's loops", { reason: "health check failed" });
          chain.abort();
        }
      },
      log.child({ job: "health" }),
      chain.signal,
    ),
  ]);
  parent.removeEventListener("abort", onParentAbort);
}

// ── CLI ──
async function main() {
  const envFile = join(KEEPER_ROOT, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  let config: Config;
  try {
    config = loadConfig();
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`config error: ${e.message}`);
      process.exit(2);
    }
    throw e;
  }
  const log = createLogger({ level: config.logLevel, bindings: { service: "celestial-keeper" } });
  process.on("unhandledRejection", (e) => log.error("unhandled rejection", { err: errMsg(e) }));
  process.on("uncaughtException", (e) => log.error("uncaught exception", { err: errMsg(e) }));

  log.info("starting", {
    chains: [config.evm && "evm", config.solana && "solana"].filter(Boolean),
    intervals: config.intervals,
    alert_webhook: !!config.alertWebhookUrl,
  });
  const keeper = startKeeper(config, log);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info("shutting down", { signal });
    await keeper.stop();
    log.info("stopped");
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  await keeper.done;
  if (!stopping) {
    log.error("all chain loops have stopped");
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
