/**
 * Initialise `celestial_perps` on devnet, then (with `--smoke`) run the open/close smoke test.
 * Idempotent: every step checks on-chain state first and is skipped when already done.
 *
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/devnet.json \
 *   pnpm init-devnet [--smoke]
 *
 * The wallet is loaded by Anchor from the ANCHOR_WALLET path; this script never reads it.
 * Moving the USDC mint authority to the program is done with the spl-token CLI (see README);
 * this script only checks it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { AnchorProvider } from "@anchor-lang/core";
import { TOKEN_2022_PROGRAM_ID, getAccount, getMint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

import { PerpsClient, big } from "./client.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEPLOYMENTS = join(root, "../deployments/solana-devnet.json");
const USD = 1_000_000n;
const SEED = 5_000_000n * USD;
const MAX_AGE = 120;
const EXEC_FEE = 50_000n;

const deployments = JSON.parse(readFileSync(DEPLOYMENTS, "utf8"));
const USDC_MINT = new PublicKey(deployments.tokens.MockUSDC.mint);
const FEEDS: Record<string, string> = {
  "SOL-USD": deployments.oracles.chainlink["SOL-USD"],
  "BTC-USD": deployments.oracles.chainlink["BTC-USD"],
  "ETH-USD": deployments.oracles.chainlink["ETH-USD"],
};

const log = (step: string, msg: string) => console.log(`${step.padEnd(14)} ${msg}`);

async function main() {
  const provider = AnchorProvider.env();
  if (!provider.connection.rpcEndpoint.includes("devnet")) throw new Error("refusing to run against a non-devnet RPC");
  const client = PerpsClient.fromIdlFile(provider, join(root, "target/idl/celestial_perps.json"));
  if (client.idl.instructions.some((i: any) => /mock/i.test(i.name))) throw new Error("IDL has mock-oracle instructions — rebuild without the feature");
  const me = client.wallet;
  const signatures: Record<string, string> = {};
  const sys = new PublicKey("11111111111111111111111111111111");

  // 1. initialize
  if (await client.exists(client.config())) {
    log("initialize", "skip (config exists)");
  } else {
    signatures.initialize = await client.send([
      client.ix("initialize", {
        admin: me,
        config: client.config(),
        pool: client.pool(),
        vault: client.vault(),
        clp_mint: client.clpMint(),
        usdc_mint: USDC_MINT,
        token_program: TOKEN_2022_PROGRAM_ID,
        system_program: sys,
      }),
    ]);
    log("initialize", signatures.initialize);
  }

  // 2. markets (Config order: SOL, BTC, ETH)
  for (const [symbol, feed] of Object.entries(FEEDS)) {
    const key = `add_market ${symbol}`;
    if (await client.exists(client.market(symbol))) {
      log("add_market", `skip ${symbol}`);
      continue;
    }
    signatures[key] = await client.send([
      client.ix(
        "add_market",
        { admin: me, config: client.config(), market: client.market(symbol), oracle: new PublicKey(feed), system_program: sys },
        { symbol, oracle_kind: { Chainlink: {} }, max_age: MAX_AGE },
      ),
    ]);
    log("add_market", `${symbol} ${signatures[key]}`);
  }

  // 3. keeper
  const config = await client.fetch("Config", client.config());
  if ((config.keepers as PublicKey[]).some((k) => k.equals(me))) {
    log("set_keeper", "skip (deployer is a keeper)");
  } else {
    signatures.set_keeper = await client.send([client.ix("set_keeper", { admin: me, config: client.config() }, { keeper: me, active: true })]);
    log("set_keeper", signatures.set_keeper);
  }

  // 4. mint authority (moved with the spl-token CLI; only checked here)
  const mint = await getMint(provider.connection, USDC_MINT, "confirmed", TOKEN_2022_PROGRAM_ID);
  const authorityMoved = !!mint.mintAuthority?.equals(client.mintAuthority());
  log("mint authority", authorityMoved ? `program PDA ${client.mintAuthority().toBase58()} ✓` : `still ${mint.mintAuthority?.toBase58()} — run: spl-token authorize ${USDC_MINT.toBase58()} mint ${client.mintAuthority().toBase58()}`);

  // 5. seed the pool
  const common = await client.common();
  const myUsdc = client.ata(USDC_MINT, me);
  const clpSupply = (await getMint(provider.connection, client.clpMint(), "confirmed", TOKEN_2022_PROGRAM_ID)).supply;
  if (clpSupply > 0n) {
    log("add_liquidity", `skip (CLP supply ${clpSupply})`);
  } else {
    signatures.add_liquidity = await client.send([
      client.ix(
        "add_liquidity",
        { ...common, user: me, user_usdc: myUsdc, user_clp: client.ata(client.clpMint(), me), user_state: client.userState(me) },
        { amount: SEED, min_clp: 0n },
        await client.marketAccounts(),
      ),
    ]);
    log("add_liquidity", `${SEED / USD} USDC ${signatures.add_liquidity}`);
  }
  log("aum", `${(await client.aum()) / USD} USDC`);

  const smoke: Record<string, string> = {};
  if (process.argv.includes("--smoke")) {
    if (!authorityMoved) throw new Error("move the mint authority before the smoke test (faucet)");

    // faucet
    const state = (await client.exists(client.userState(me))) ? await client.fetch("UserState", client.userState(me)) : null;
    const lastFaucet = state ? Number(big(state.last_faucet_at)) : 0;
    if (lastFaucet && Date.now() / 1000 < lastFaucet + 86_400) {
      log("faucet", "skip (24 h cooldown active)");
    } else {
      const before = (await getAccount(provider.connection, myUsdc, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
      smoke.faucet = await client.send([client.ix("faucet", { ...common, user: me, user_state: client.userState(me), user_usdc: myUsdc })]);
      const after = (await getAccount(provider.connection, myUsdc, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
      if (after - before !== 10_000n * USD) throw new Error(`faucet minted ${after - before}`);
      log("faucet", `+10,000 USDC ${smoke.faucet}`);
    }

    const sol = client.market("SOL-USD");
    const position = client.position(me, sol, true);
    if (await client.exists(position)) throw new Error("deployer already has a SOL-USD long; close it first");
    const price = big((await client.marketInfo("SOL-USD")).price);
    log("oracle", `SOL-USD ${Number(price) / 1e8}`);

    const request = async (kind: string, collateral: bigint, size: bigint, acceptable: bigint) => {
      const nonce = (await client.exists(client.userState(me))) ? big((await client.fetch("UserState", client.userState(me))).request_nonce) : 0n;
      const sig = await client.send([
        client.ix(
          kind,
          { ...common, owner: me, owner_usdc: myUsdc, market: sol, position, user_state: client.userState(me), request: client.request(me, nonce) },
          { nonce, is_long: true, collateral_delta: collateral, size_delta: size, acceptable_price: acceptable, execution_fee: EXEC_FEE },
        ),
      ]);
      return { nonce, sig };
    };
    const execute = async (nonce: bigint) => {
      const sig = await client.send(
        [
          client.ix(
            "execute_request",
            { ...common, keeper: me, request: client.request(me, nonce), owner: me, owner_usdc: myUsdc, position },
            {},
            await client.marketAccounts([sol]),
          ),
        ],
        [],
        400_000,
      );
      return { sig, events: await client.events(sig) };
    };

    const usdcBefore = (await getAccount(provider.connection, myUsdc, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
    const inc = await request("request_increase", 100n * USD, 500n * USD, (price * 101n) / 100n);
    smoke.request_increase = inc.sig;
    log("request_inc", `SOL-USD long 100 USDC × 5 ${inc.sig}`);
    const ex1 = await execute(inc.nonce);
    smoke.execute_increase = ex1.sig;
    const opened = ex1.events.find((e) => e.name === "PositionIncreased");
    if (!opened) throw new Error(`increase not executed: ${JSON.stringify(ex1.events.map((e) => [e.name, e.data.reason]))}`);
    log("execute", `opened at ${Number(big(opened.data.execution_price)) / 1e8} ${ex1.sig}`);

    const p = await client.fetch("Position", position);
    log("position", `size=${big(p.size)} collateral=${big(p.collateral)} tokens=${big(p.tokens)} reserved=${big(p.reserved)}`);

    const dec = await request("request_decrease", 0n, big(p.size), (price * 99n) / 100n);
    smoke.request_decrease = dec.sig;
    log("request_dec", `full close ${dec.sig}`);
    const ex2 = await execute(dec.nonce);
    smoke.execute_decrease = ex2.sig;
    const closed = ex2.events.find((e) => e.name === "PositionDecreased");
    if (!closed || !ex2.events.some((e) => e.name === "PositionClosed")) {
      throw new Error(`close not executed: ${JSON.stringify(ex2.events.map((e) => [e.name, e.data.reason]))}`);
    }
    const usdcAfter = (await getAccount(provider.connection, myUsdc, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
    const cost = usdcBefore - usdcAfter;
    log("execute", `closed at ${Number(big(closed.data.execution_price)) / 1e8}, pnl ${big(closed.data.realised_pnl)} ${ex2.sig}`);
    log("result", `100 USDC in, ${Number(100n * USD - cost) / 1e6} USDC back (fees + spread + price move ${Number(cost) / 1e6})`);
    if (await client.exists(position)) throw new Error("position account still exists");
    log("position", "closed ✓ (account gone)");
    if (cost <= 0n || cost > 5n * USD) throw new Error(`unexpected round-trip cost ${cost}`);
  }

  // Record everything in deployments/solana-devnet.json.
  const markets = Object.fromEntries(
    Object.entries(FEEDS).map(([symbol, feed]) => [symbol, { market: client.market(symbol).toBase58(), oracle: feed, oracleKind: "Chainlink", maxAge: MAX_AGE }]),
  );
  const pool = await client.fetch("Pool", client.pool());
  const prev = deployments.perps ?? {};
  deployments.tokens.MockUSDC.mintAuthority = mint.mintAuthority?.toBase58() ?? null;
  deployments.tokens.MockUSDC.mintAuthorityNote = authorityMoved
    ? "Program PDA [\"mint_authority\"] of celestial_perps (faucet: 10,000 USDC / 24 h)"
    : deployments.tokens.MockUSDC.mintAuthorityNote;
  deployments.perps = {
    ...prev,
    programId: client.programId.toBase58(),
    upgradeAuthority: me.toBase58(),
    admin: me.toBase58(),
    keeper: me.toBase58(),
    pdas: {
      config: client.config().toBase58(),
      pool: client.pool().toBase58(),
      vault: client.vault().toBase58(),
      clpMint: client.clpMint().toBase58(),
      mintAuthority: client.mintAuthority().toBase58(),
    },
    markets,
    marketOrder: ["SOL-USD", "BTC-USD", "ETH-USD"],
    seed: { amountUsdc: String(SEED / USD), poolAmount: big(pool.pool_amount).toString() },
    clpDecimals: 6,
    signatures: { ...(prev.signatures ?? {}), ...signatures },
    smokeTest: Object.keys(smoke).length ? { date: new Date().toISOString().slice(0, 10), ...smoke } : prev.smokeTest,
    explorer: `https://explorer.solana.com/address/${client.programId.toBase58()}?cluster=devnet`,
  };
  writeFileSync(DEPLOYMENTS, JSON.stringify(deployments, null, 2) + "\n");
  log("deployments", "deployments/solana-devnet.json updated");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
