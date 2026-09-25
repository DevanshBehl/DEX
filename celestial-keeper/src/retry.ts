/** Backoff helpers and the job loop runner. */
import { errMsg, type Logger } from "./log.ts";

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });

/** Exponential backoff with ±25% jitter: base·2^(attempt−1), capped. */
export function backoffMs(attempt: number, baseMs = 500, maxMs = 30_000): number {
  const raw = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(raw * (0.75 + Math.random() * 0.5));
}

/** ±`pct` jitter around `ms` (funding schedule). */
export const jitter = (ms: number, pct = 0.05) => Math.round(ms * (1 - pct + Math.random() * 2 * pct));

/** Network-level failures worth a plain retry (reads only — sends have their own rules). */
export function isTransient(e: unknown): boolean {
  const m = errMsg(e);
  return /429|Too Many Requests|timeout|timed out|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|network|503|502|504|SERVER_ERROR|missing response|failed to detect network/i.test(
    m,
  );
}

/** Retry an idempotent read with backoff on transient errors. */
export async function withRetry<T>(fn: () => Promise<T>, opts: { retries?: number; signal?: AbortSignal } = {}): Promise<T> {
  const retries = opts.retries ?? 4;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt > retries || !isTransient(e) || opts.signal?.aborted) throw e;
      await sleep(backoffMs(attempt), opts.signal);
    }
  }
}

/**
 * Run `tick` every `intervalMs` until `signal` aborts. A failing tick is logged and the next one
 * is delayed with exponential backoff; the loop itself never throws, so one job can never stop
 * another. `intervalMs` may be a function (jittered schedules).
 */
export async function runLoop(
  name: string,
  intervalMs: number | (() => number),
  tick: () => Promise<void>,
  log: Logger,
  signal: AbortSignal,
  opts: { initialDelayMs?: number } = {},
): Promise<void> {
  const interval = typeof intervalMs === "function" ? intervalMs : () => intervalMs;
  let failures = 0;
  log.info("loop started", { loop: name });
  if (opts.initialDelayMs) await sleep(opts.initialDelayMs, signal);
  while (!signal.aborted) {
    try {
      await tick();
      if (failures > 0) log.info("loop recovered", { loop: name, after_failures: failures });
      failures = 0;
      await sleep(interval(), signal);
    } catch (e) {
      failures++;
      const delay = Math.max(interval(), backoffMs(failures, 1_000, 60_000));
      log[failures >= 5 ? "error" : "warn"]("loop tick failed", { loop: name, failures, retry_in_ms: delay, err: errMsg(e) });
      await sleep(delay, signal);
    }
  }
  log.info("loop stopped", { loop: name });
}

/** Log a repeating warning at most once per `everyMs` per key. */
export class RateLimitedLog {
  private last = new Map<string, number>();
  constructor(private everyMs = 60_000) {}
  should(key: string): boolean {
    const now = Date.now();
    if ((this.last.get(key) ?? 0) + this.everyMs > now) return false;
    this.last.set(key, now);
    return true;
  }
}
