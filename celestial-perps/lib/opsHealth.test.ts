import assert from "node:assert/strict";
import { test } from "node:test";

import type { MarketState, OpsStatus } from "./chains/types";
import { chainChecks, keeperChecks, marketChecks, pendingCheck, worst } from "./opsHealth";

const ops = (o: Partial<OpsStatus> = {}): OpsStatus => ({
  now: 1_000,
  paused: false,
  pendingCount: 0,
  oldestPendingAt: null,
  pendingComplete: true,
  keepers: [{ address: "0xA0c3A70806983a965e43961DE48658a9D41f2322", balance: 68_000_000_000_000_000n, active: true }],
  ...o,
});

const market = (o: Partial<MarketState> = {}): MarketState => ({
  market: "ETH-USD",
  enabled: true,
  price: 300_000_000_000n,
  priceUpdatedAt: 990,
  longSize: 10_000_000_000n,
  shortSize: 0n,
  longCapacity: 1_490_000_000_000n,
  shortCapacity: 1_500_000_000_000n,
  fundingRateLongPerHour: 1n,
  fundingRateShortPerHour: 0n,
  cumFundingLong: 0n,
  cumFundingShort: 0n,
  ...o,
});

test("a healthy chain is all ok", () => {
  assert.equal(worst(chainChecks(ops(), [market()], "ETH", 18).map((c) => c.level)), "ok");
});

test("order queue: ok under 15 s, slow after 15 s, down after 60 s", () => {
  assert.equal(pendingCheck(ops({ pendingCount: 1, oldestPendingAt: 990 })).level, "ok");
  assert.equal(pendingCheck(ops({ pendingCount: 1, oldestPendingAt: 980 })).level, "warn");
  const down = pendingCheck(ops({ pendingCount: 2, oldestPendingAt: 900 }));
  assert.equal(down.level, "down");
  assert.match(down.detail, /2 waiting, oldest 100 s — the keeper is not filling orders/);
  assert.match(pendingCheck(ops({ pendingComplete: false })).detail, /most recent requests/);
});

test("keepers: none active is down; a low balance is a warning", () => {
  assert.equal(keeperChecks(ops({ keepers: [] }), "ETH", 18)[0].level, "down");
  assert.equal(keeperChecks(ops({ keepers: [{ address: "k", balance: 10n ** 18n, active: false }] }), "ETH", 18)[0].level, "down");
  const low = keeperChecks(ops({ keepers: [{ address: "6DoRfsEtFC2LFEEvSEuYjeNo7vJHnFrx8EzffksVy5ED", balance: 500_000_000n, active: true }] }), "SOL", 9)[0];
  assert.equal(low.level, "warn");
  assert.match(low.detail, /0\.5000 SOL — below 1 SOL/);
});

test("markets: stale oracle, disabled market and a nearly full OI side are warnings", () => {
  const stale = marketChecks(market({ price: null, priceIssue: "StalePrice" }));
  assert.deepEqual(stale.map((c) => c.level), ["warn"]);
  assert.match(stale[0].detail, /StalePrice/);
  assert.ok(marketChecks(market({ enabled: false })).some((c) => c.label === "ETH-USD market" && c.level === "warn"));
  const full = marketChecks(market({ longSize: 950n, longCapacity: 50n }));
  assert.ok(full.some((c) => c.label === "ETH-USD long OI" && c.detail === "95% of the cap used."));
});

test("paused protocol is a warning, and the worst level wins", () => {
  const checks = chainChecks(ops({ paused: true, pendingCount: 1, oldestPendingAt: 0 }), [market()], "ETH", 18);
  assert.equal(checks[0].label, "Protocol");
  assert.equal(worst(checks.map((c) => c.level)), "down");
});
