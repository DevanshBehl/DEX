/** Oracle decoding, config validation (no secret ever echoed), logging and backoff. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PublicKey } from "@solana/web3.js";

import { ConfigError, loadConfig } from "../src/config.ts";
import { createLogger, errMsg } from "../src/log.ts";
import { backoffMs } from "../src/retry.ts";
import { CHAINLINK_STORE, decodeChainlink, normalise, readOraclePrice } from "../src/solana/oracle.ts";

// Real devnet SOL-USD feed account captured 2026-09-22 (same bytes as oracle.rs's test).
const SOL_FEED_HEX =
  "60b3454280814975020164145186b600d9d4618adba9970d944053b279b5bcc6c00ff4a1c709f169d8bf00000000000000000000000000000000000000000000000000000000000000003e0000fd2331a613ab309a2557e84fa6a5e20d80d2788780320c689be8d0bbc2534f4c202f20555344000000000000000000000000000000000000000000000008000000006e8b640201010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002723f21d00000000ea69b26a000000007f11bebb02000000000000000000000000000000000000000000000000000000";

describe("solana oracle", () => {
  const data = Buffer.from(SOL_FEED_HEX, "hex");
  it("decodes the real devnet Chainlink account", () => {
    const r = decodeChainlink(data);
    assert.equal(r.decimals, 8);
    assert.equal(r.answer, 11_739_730_303n);
    assert.equal(r.timestamp, 1_790_077_418n);
  });

  it("applies the program's validity rules", () => {
    const r = decodeChainlink(data);
    assert.equal(normalise(r, r.timestamp + 120n, 120n).price, 11_739_730_303n);
    assert.equal(normalise(r, r.timestamp + 121n, 120n).price, null);
    assert.equal(normalise({ ...r, answer: 0n }, r.timestamp, 120n).price, null);
    assert.equal(normalise({ ...r, timestamp: 0n }, 10n, 120n).price, null);
    assert.equal(normalise({ ...r, timestamp: r.timestamp + 61n }, r.timestamp, 120n).price, null);
    assert.equal(normalise({ answer: 3_000_000_000n, timestamp: 1n, decimals: 6 }, 1n, 120n).price, 300_000_000_000n);
  });

  it("rejects an oracle owned by anyone else", () => {
    const info = { data, owner: PublicKey.default, lamports: 1, executable: false };
    assert.match(readOraclePrice(info, PublicKey.default.equals(CHAINLINK_STORE) ? CHAINLINK_STORE : new PublicKey("11111111111111111111111111111112"), 1_790_077_420n, 120n).issue!, /unexpected oracle owner/);
  });
});

describe("config", () => {
  const SECRET = "ab".repeat(32);
  it("never echoes a secret in its errors", () => {
    const cases: Record<string, string | undefined>[] = [
      { ENABLE_SOLANA: "false", EVM_KEEPER_PRIVATE_KEY: SECRET },
      { ENABLE_SOLANA: "false", SEPOLIA_RPC_URL: "https://rpc.example/v2/SECRETKEY", EVM_KEEPER_PRIVATE_KEY: "0xnothex" + SECRET },
      { ENABLE_EVM: "false", SOLANA_KEEPER_KEYPAIR_PATH: "/definitely/missing/keypair.json" },
    ];
    for (const env of cases) {
      assert.throws(
        () => loadConfig(env),
        (e: unknown) => e instanceof ConfigError && !e.message.includes(SECRET) && !e.message.includes("SECRETKEY"),
      );
    }
  });

  it("loads the Sepolia deployment with defaults", () => {
    const c = loadConfig({ ENABLE_SOLANA: "false", SEPOLIA_RPC_URL: "http://127.0.0.1:1", EVM_KEEPER_PRIVATE_KEY: SECRET });
    assert.equal(c.evm!.engine, "0x49765B9bEFed004A6462ad2025C240191e762b60");
    assert.ok(c.evm!.startBlock > 0, "deploy block recorded in deployments/sepolia.json");
    assert.equal(c.intervals.executorMs, 1_500);
    assert.equal(c.intervals.fundingMs, 3_600_000);
  });
});

describe("logging and backoff", () => {
  it("writes JSON lines, stringifies bigints, redacts secret-looking fields and URLs", () => {
    const lines: string[] = [];
    const log = createLogger({ sink: (l) => lines.push(l), bindings: { chain: "evm" } });
    log.info("hello", { amount: 10n ** 30n, privateKey: "0xdead", nested: { secret: "x" } });
    const o = JSON.parse(lines[0]);
    assert.equal(o.chain, "evm");
    assert.equal(o.amount, "1000000000000000000000000000000");
    assert.equal(o.privateKey, "[redacted]");
    assert.equal(o.nested.secret, "[redacted]");
    assert.equal(errMsg(new Error("failed https://eth-sepolia.g.alchemy.com/v2/KEY123 oops")), "failed <url> oops");
  });

  it("backs off exponentially within bounds", () => {
    for (let a = 1; a <= 10; a++) {
      const d = backoffMs(a, 500, 30_000);
      assert.ok(d >= 0.75 * Math.min(30_000, 500 * 2 ** (a - 1)) && d <= 1.25 * Math.min(30_000, 500 * 2 ** (a - 1)));
    }
  });
});
