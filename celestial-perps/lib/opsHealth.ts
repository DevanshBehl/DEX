// Health rules for the /status page. Pure: the page reads the chain, this turns the numbers into
// checks. Thresholds match the keeper's own alerts (celestial-keeper: health + stuck-request).

import type { MarketState, OpsStatus } from "@/lib/chains";

export type Level = "ok" | "warn" | "down";
export type Check = { level: Level; label: string; detail: string };

export const PENDING_WARN_S = 15; // a fill normally takes ~2 s
export const PENDING_DOWN_S = 60; // past the request expiry: the keeper is effectively down
export const OI_WARN_UTILISATION = 0.9;

/** Native balance below which a keeper runs out of gas soon (same as the keeper's health alert). */
export const KEEPER_MIN_BALANCE: Record<"ETH" | "SOL", bigint> = {
  ETH: 20_000_000_000_000_000n, // 0.02 ETH
  SOL: 1_000_000_000n, // 1 SOL
};

const RANK: Record<Level, number> = { ok: 0, warn: 1, down: 2 };
export const worst = (levels: Level[]): Level => levels.reduce<Level>((a, b) => (RANK[b] > RANK[a] ? b : a), "ok");

export function keeperChecks(ops: OpsStatus, native: "ETH" | "SOL", decimals: number): Check[] {
  const active = ops.keepers.filter((k) => k.active);
  if (active.length === 0) return [{ level: "down", label: "Keeper", detail: "No whitelisted keeper — orders will not be filled." }];
  return active.map((k) => {
    const bal = Number(k.balance) / 10 ** decimals;
    const low = k.balance < KEEPER_MIN_BALANCE[native];
    return {
      level: low ? "warn" : "ok",
      label: `Keeper ${k.address.slice(0, 6)}…${k.address.slice(-4)}`,
      detail: `${bal.toFixed(4)} ${native}${low ? ` — below ${Number(KEEPER_MIN_BALANCE[native]) / 10 ** decimals} ${native}, top it up` : ""}`,
    };
  });
}

export function pendingCheck(ops: OpsStatus): Check {
  const scope = ops.pendingComplete ? "" : " (most recent requests)";
  if (ops.pendingCount === 0 || ops.oldestPendingAt === null) return { level: "ok", label: "Order queue", detail: `No orders waiting${scope}.` };
  const age = Math.max(0, ops.now - ops.oldestPendingAt);
  const level: Level = age > PENDING_DOWN_S ? "down" : age > PENDING_WARN_S ? "warn" : "ok";
  const what = `${ops.pendingCount} waiting${scope}, oldest ${age} s`;
  return {
    level,
    label: "Order queue",
    detail: level === "down" ? `${what} — the keeper is not filling orders.` : level === "warn" ? `${what} — the keeper is slow.` : what,
  };
}

export function marketChecks(m: MarketState): Check[] {
  const checks: Check[] = [];
  checks.push(
    m.price === null
      ? { level: "warn", label: `${m.market} oracle`, detail: `Stale or invalid${m.priceIssue ? ` (${m.priceIssue})` : ""} — orders on this market are cancelled.` }
      : { level: "ok", label: `${m.market} oracle`, detail: "Fresh" },
  );
  if (!m.enabled) checks.push({ level: "warn", label: `${m.market} market`, detail: "Disabled by the admin." });
  for (const [side, size, capacity] of [
    ["long", m.longSize, m.longCapacity],
    ["short", m.shortSize, m.shortCapacity],
  ] as const) {
    const cap = size + capacity;
    if (m.price !== null && cap > 0n && Number(size) / Number(cap) >= OI_WARN_UTILISATION) {
      checks.push({ level: "warn", label: `${m.market} ${side} OI`, detail: `${Math.round((Number(size) / Number(cap)) * 100)}% of the cap used.` });
    }
  }
  return checks;
}

export function chainChecks(ops: OpsStatus, markets: MarketState[], native: "ETH" | "SOL", decimals: number): Check[] {
  return [
    ...(ops.paused ? [{ level: "warn" as const, label: "Protocol", detail: "Paused — new positions are disabled; closing still works." }] : []),
    pendingCheck(ops),
    ...keeperChecks(ops, native, decimals),
    ...markets.flatMap(marketChecks),
  ];
}
