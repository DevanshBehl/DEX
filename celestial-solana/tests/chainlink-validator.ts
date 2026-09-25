/**
 * Integration test against the REAL Chainlink accounts: starts `solana-test-validator` with the
 * Chainlink OCR2 store program and the SOL/BTC/ETH feed accounts cloned from devnet, loads the
 * devnet build of `celestial_perps` (no `mock-oracle`), then:
 *   - lists the 3 markets with `OracleKind::Chainlink` (add_market reads each feed)
 *   - checks `OracleKind::Mock` is rejected by this build
 *   - reads every price through `get_market_info` and compares it with a local decode
 *   - seeds the pool and opens + closes a SOL-USD long at the Chainlink price
 *
 * The cloned feeds are a snapshot, so everything must finish within `max_age` (120 s) of the
 * clone. Run with `pnpm test:chainlink` (builds the devnet program first).
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { AnchorProvider, Wallet } from "@anchor-lang/core";
import {
  MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAccount,
} from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";

import { decodeFeed, toPrice8 } from "../scripts/check-oracle.ts";
import { CHAINLINK_STORE, PerpsClient, big } from "../scripts/client.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const IDL_PATH = join(root, "target/idl/celestial_perps.json");
const SO_PATH = join(root, "target/deploy/celestial_perps.so");
const LEDGER = join(root, "test-ledger");
const RPC_PORT = 18899;
const RPC = `http://127.0.0.1:${RPC_PORT}`;

const FEEDS: Record<string, PublicKey> = {
  "SOL-USD": new PublicKey("99B2bTijsU6f1GCT73HmdR7HCFFjGMBcPZY6jZ96ynrR"),
  "BTC-USD": new PublicKey("6PxBx93S8x3tno1TsFZwT5VqP8drrRCbCXygEXYNkFJe"),
  "ETH-USD": new PublicKey("669U43LNHx7LsVj95uYksnhXUfWKDsdzVqev3V4Jpw3P"),
};
const USD = 1_000_000n;
const EXEC_FEE = 50_000n;

async function main() {
  const idl = await import(IDL_PATH, { with: { type: "json" } }).then((m) => m.default);
  const names: string[] = idl.instructions.map((i: any) => i.name);
  assert.ok(!names.some((n) => /mock/i.test(n)), "devnet IDL must not contain mock-oracle instructions");

  mkdirSync(LEDGER, { recursive: true });
  const programId = new PublicKey(idl.address);
  const validator = spawn(
    "solana-test-validator",
    [
      "--reset",
      "--quiet",
      "--ledger", LEDGER,
      "--rpc-port", String(RPC_PORT),
      "--faucet-port", "19900",
      "--gossip-port", "18000",
      "--dynamic-port-range", "18002-18040",
      "--url", "https://api.devnet.solana.com",
      "--clone-upgradeable-program", CHAINLINK_STORE.toBase58(),
      ...Object.values(FEEDS).flatMap((f) => ["--clone", f.toBase58()]),
      "--bpf-program", programId.toBase58(), SO_PATH,
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  const stop = () => validator.kill("SIGINT");
  process.on("exit", stop);

  try {
    const connection = new Connection(RPC, "confirmed");
    await waitForValidator(connection);
    console.log("validator up with cloned Chainlink store + feeds");

    const payer = Keypair.generate(); // throwaway local key
    await confirmAirdrop(connection, payer.publicKey, 100);
    const provider = new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" });
    const client = new PerpsClient(provider, idl);

    // The cloned store program and feeds.
    const store = await connection.getAccountInfo(CHAINLINK_STORE);
    assert.ok(store?.executable, "Chainlink store program cloned");
    const decoded: Record<string, bigint> = {};
    for (const [symbol, feed] of Object.entries(FEEDS)) {
      const info = await connection.getAccountInfo(feed);
      assert.ok(info && info.owner.equals(CHAINLINK_STORE), `${symbol} feed cloned and owned by the store`);
      const round = decodeFeed(info.data);
      const now = (await connection.getBlockTime(await connection.getSlot()))!;
      console.log(`${symbol}: answer=${round.answer} decimals=${round.decimals} age=${now - round.timestamp}s`);
      decoded[symbol] = toPrice8(round.answer, round.decimals);
    }

    // Local Token-2022 mock USDC.
    const usdc = Keypair.generate();
    const payerUsdc = client.ata(usdc.publicKey, payer.publicKey);
    await client.send(
      [
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: usdc.publicKey,
          space: MINT_SIZE,
          lamports: await connection.getMinimumBalanceForRentExemption(MINT_SIZE),
          programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(usdc.publicKey, 6, payer.publicKey, null, TOKEN_2022_PROGRAM_ID),
        createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, payerUsdc, payer.publicKey, usdc.publicKey, TOKEN_2022_PROGRAM_ID),
        createMintToInstruction(usdc.publicKey, payerUsdc, payer.publicKey, 10_000_000n * USD, [], TOKEN_2022_PROGRAM_ID),
      ],
      [usdc],
    );

    await client.send([
      client.ix("initialize", {
        admin: payer.publicKey,
        config: client.config(),
        pool: client.pool(),
        vault: client.vault(),
        clp_mint: client.clpMint(),
        usdc_mint: usdc.publicKey,
        token_program: TOKEN_2022_PROGRAM_ID,
        system_program: SystemProgram.programId,
      }),
    ]);

    // A mock oracle kind is not supported by the devnet build.
    await assert.rejects(
      client.send([
        client.ix(
          "add_market",
          { admin: payer.publicKey, config: client.config(), market: client.market("MOCK"), oracle: FEEDS["SOL-USD"], system_program: SystemProgram.programId },
          { symbol: "MOCK", oracle_kind: { Mock: {} }, max_age: 120 },
        ),
      ]),
      /UnsupportedOracleKind|0x178f/,
    );

    for (const [symbol, feed] of Object.entries(FEEDS)) {
      await client.send([
        client.ix(
          "add_market",
          { admin: payer.publicKey, config: client.config(), market: client.market(symbol), oracle: feed, system_program: SystemProgram.programId },
          { symbol, oracle_kind: { Chainlink: {} }, max_age: 120 },
        ),
      ]);
      const m = await client.fetch("Market", client.market(symbol));
      assert.equal(m.oracle.toBase58(), feed.toBase58());
      assert.equal("Chainlink" in m.oracle_kind, true);
    }
    console.log("add_market (Chainlink) ok for SOL-USD, BTC-USD, ETH-USD");

    for (const symbol of Object.keys(FEEDS)) {
      const info = await client.marketInfo(symbol);
      assert.equal(big(info.price), decoded[symbol], `${symbol} on-chain price matches the decode`);
      console.log(`get_market_info ${symbol}: price=${big(info.price)} (8 dp) enabled=${info.enabled}`);
    }

    // Seed, then open + close a SOL-USD long at the real Chainlink price.
    await client.send([client.ix("set_keeper", { admin: payer.publicKey, config: client.config() }, { keeper: payer.publicKey, active: true })]);
    const common = await client.common();
    await client.send([
      client.ix(
        "add_liquidity",
        { ...common, user: payer.publicKey, user_usdc: payerUsdc, user_clp: client.ata(client.clpMint(), payer.publicKey), user_state: client.userState(payer.publicKey) },
        { amount: 1_000_000n * USD, min_clp: 0n },
        await client.marketAccounts(),
      ),
    ]);
    assert.equal(await client.aum(), 1_000_000n * USD);

    const sol = client.market("SOL-USD");
    const position = client.position(payer.publicKey, sol, true);
    const trade = async (kind: "request_increase" | "request_decrease", collateral: bigint, size: bigint, acceptable: bigint) => {
      const nonce = big((await client.fetch("UserState", client.userState(payer.publicKey))).request_nonce);
      await client.send([
        client.ix(
          kind,
          { ...common, owner: payer.publicKey, owner_usdc: payerUsdc, market: sol, position, user_state: client.userState(payer.publicKey), request: client.request(payer.publicKey, nonce) },
          { nonce, is_long: true, collateral_delta: collateral, size_delta: size, acceptable_price: acceptable, execution_fee: EXEC_FEE },
        ),
      ]);
      const sig = await client.send([
        client.ix(
          "execute_request",
          { ...common, keeper: payer.publicKey, request: client.request(payer.publicKey, nonce), owner: payer.publicKey, owner_usdc: payerUsdc, position },
          {},
          await client.marketAccounts([sol]),
        ),
      ]);
      return client.events(sig);
    };

    const opened = await trade("request_increase", 100n * USD, 500n * USD, decoded["SOL-USD"] * 2n);
    const inc = opened.find((e) => e.name === "PositionIncreased");
    assert.ok(inc, `opened: ${JSON.stringify(opened.map((e) => e.name))}`);
    assert.equal(big(inc.data.execution_price), (decoded["SOL-USD"] * 10_010n + 9_999n) / 10_000n);
    console.log(`opened SOL-USD long at ${big(inc.data.execution_price)} (oracle ${decoded["SOL-USD"]} + 0.1%)`);

    const closed = await trade("request_decrease", 0n, 500n * USD, 1n);
    assert.ok(closed.some((e) => e.name === "PositionClosed"), `closed: ${JSON.stringify(closed.map((e) => e.name))}`);
    assert.equal(await client.exists(position), false);
    const vault = await getAccount(connection, client.vault(), "confirmed", TOKEN_2022_PROGRAM_ID);
    const pool = await client.fetch("Pool", client.pool());
    assert.ok(vault.amount >= big(pool.pool_amount) + big(pool.fee_reserves) + big(pool.total_collateral) + big(pool.total_escrow));
    console.log("closed; position account gone; vault covers every bucket");
    console.log("\nCHAINLINK INTEGRATION: PASS");
  } finally {
    stop();
  }
}

async function waitForValidator(connection: Connection) {
  for (let i = 0; i < 120; i++) {
    try {
      await connection.getSlot();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("validator did not start");
}

async function confirmAirdrop(connection: Connection, to: PublicKey, sol: number) {
  const sig = await connection.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
  const bh = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
}

// Exit explicitly: web3.js keeps retrying its websocket after the validator stops.
main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
