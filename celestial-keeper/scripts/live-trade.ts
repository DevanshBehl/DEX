/**
 * Live smoke test for a running keeper: from a SEPARATE test wallet, open a position and fully
 * close it, and measure request → fill latency (chain time). The keeper must be running.
 *
 *   Solana:  TRADER_KEYPAIR_PATH=<path> node --import tsx scripts/live-trade.ts solana [open|close]
 *   EVM:     TRADER_PRIVATE_KEY=<test key> SEPOLIA_RPC_URL=… node --import tsx scripts/live-trade.ts evm [open|close]
 *
 * Without a mode it opens and then fully closes; `open` / `close` do one half only.
 *
 * Prints one JSON line per step (signatures / hashes, latency). The trader key is a throwaway
 * test key; it is never printed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import anchor, { BorshCoder } from "@anchor-lang/core";
import { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { Contract, JsonRpcProvider, Wallet, formatEther, id as keccakId } from "ethers";

import { REPO_ROOT } from "../src/config.ts";

const { BN } = anchor as unknown as { BN: new (v: string) => unknown };
const out = (o: Record<string, unknown>) => console.log(JSON.stringify(o, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const USD = 1_000_000n;
const mode = process.argv[3] ?? "both";
const doOpen = mode !== "close";
const doClose = mode !== "open";

async function solana() {
  const rpc = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  const connection = new Connection(rpc, "confirmed");
  const trader = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.TRADER_KEYPAIR_PATH!, "utf8"))));
  const idl = JSON.parse(readFileSync(join(REPO_ROOT, "celestial-perps/src/idl/celestial_perps.json"), "utf8"));
  const coder = new BorshCoder(idl);
  const programId = new PublicKey(idl.address);
  const pda = (...s: (Buffer | string)[]) => PublicKey.findProgramAddressSync(s.map((x) => (typeof x === "string" ? Buffer.from(x) : x)), programId)[0];
  const d = JSON.parse(readFileSync(join(REPO_ROOT, "deployments/solana-devnet.json"), "utf8"));
  const usdc = new PublicKey(d.tokens.MockUSDC.mint);
  const market = new PublicKey(d.perps.markets["SOL-USD"].market);
  const ata = getAssociatedTokenAddressSync(usdc, trader.publicKey, true, TOKEN_2022_PROGRAM_ID);
  const position = pda("position", trader.publicKey.toBuffer(), market.toBuffer(), Buffer.from([1]));
  const toBn = (a: Record<string, unknown>) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, typeof v === "bigint" ? new BN(v.toString()) : v]));
  const ix = (name: string, accounts: Record<string, PublicKey>, args: Record<string, unknown> = {}) => {
    const def = idl.instructions.find((i: any) => i.name === name);
    return new TransactionInstruction({
      programId,
      keys: def.accounts.map((a: any) => ({ pubkey: accounts[a.name] ?? new PublicKey(a.address), isSigner: !!a.signer, isWritable: !!a.writable })),
      data: coder.instruction.encode(name, toBn(args)),
    });
  };
  const common = {
    config: pda("config"),
    pool: pda("pool"),
    vault: pda("vault"),
    usdc_mint: usdc,
    token_program: TOKEN_2022_PROGRAM_ID,
    associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
    system_program: SystemProgram.programId,
    mint_authority: pda("mint_authority"),
    user_state: pda("user", trader.publicKey.toBuffer()),
  };
  const send = (ixs: TransactionInstruction[]) => sendAndConfirmTransaction(connection, new Transaction().add(...ixs), [trader], { commitment: "confirmed" });
  const userState = async () => {
    const i = await connection.getAccountInfo(common.user_state);
    return i ? coder.accounts.decode("UserState", i.data) : null;
  };

  let state = await userState();
  if (doOpen && (!state || Date.now() / 1000 > Number(state.last_faucet_at.toString()) + 86_400)) {
    const sig = await send([ix("faucet", { ...common, user: trader.publicKey, user_usdc: ata })]);
    out({ chain: "solana", step: "faucet", tx: sig });
    state = await userState();
  }

  const trade = async (kind: "request_increase" | "request_decrease", collateral: bigint, size: bigint, acceptable: bigint) => {
    const nonce = BigInt(((await userState())?.request_nonce ?? 0).toString());
    const request = pda("request", trader.publicKey.toBuffer(), Buffer.from(new BigUint64Array([nonce]).buffer));
    const sig = await send([
      ix(kind, { ...common, owner: trader.publicKey, owner_usdc: ata, market, position, request }, {
        nonce,
        is_long: true,
        collateral_delta: collateral,
        size_delta: size,
        acceptable_price: acceptable,
        execution_fee: 50_000n,
      }),
    ]);
    const reqTx = await connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const t0 = Date.now();
    while (await connection.getAccountInfo(request, "confirmed")) {
      if (Date.now() - t0 > 60_000) throw new Error("not filled within 60 s — is the keeper running?");
      await sleep(1_000);
    }
    const wall = Date.now() - t0;
    // Find the keeper's fill: the latest signature on the (now closed) request account.
    const [fill] = await connection.getSignaturesForAddress(request, { limit: 1 }, "confirmed");
    const fillTx = await connection.getTransaction(fill.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const events = (fillTx?.meta?.logMessages ?? []).flatMap((l) => {
      const m = l.match(/^Program data: (.+)$/);
      const e = m && coder.events.decode(m[1]);
      return e ? [e.name] : [];
    });
    out({
      chain: "solana",
      step: kind,
      request_tx: sig,
      fill_tx: fill.signature,
      events,
      slots: fillTx && reqTx ? fillTx.slot - reqTx.slot : undefined,
      latency_chain_s: fillTx?.blockTime && reqTx?.blockTime ? fillTx.blockTime - reqTx.blockTime : undefined,
      latency_observed_ms: wall,
    });
  };

  if (doOpen) await trade("request_increase", 100n * USD, 500n * USD, 2n ** 62n);
  const p = coder.accounts.decode("Position", (await connection.getAccountInfo(position))!.data);
  out({ chain: "solana", step: "position", size: p.size.toString(), collateral: p.collateral.toString() });
  if (!doClose) return;
  await trade("request_decrease", 0n, BigInt(p.size.toString()), 1n);
  out({ chain: "solana", step: "closed", position_exists: !!(await connection.getAccountInfo(position)) });
}

async function evm() {
  const d = JSON.parse(readFileSync(join(REPO_ROOT, "deployments/sepolia.json"), "utf8"));
  const provider = new JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
  const trader = new Wallet(process.env.TRADER_PRIVATE_KEY!, provider);
  const abi = (n: string) => JSON.parse(readFileSync(join(REPO_ROOT, "celestial-perps/src/abis", `${n}.json`), "utf8"));
  const engine = new Contract(d.contracts.PerpEngine.address, abi("PerpEngine"), trader);
  const usdc = new Contract(d.contracts.MockUSDC.address, abi("MockUSDC"), trader);
  const ETH = keccakId("ETH-USD");
  out({ chain: "evm", step: "trader", address: trader.address, eth: formatEther(await provider.getBalance(trader.address)) });

  if ((await usdc.balanceOf(trader.address)) < 100n * USD) {
    const tx = await usdc.faucet();
    await tx.wait();
    out({ chain: "evm", step: "faucet", tx: tx.hash });
  }
  const pool = d.contracts.LiquidityPool.address;
  if ((await usdc.allowance(trader.address, pool)) < 100n * USD) {
    const tx = await usdc.approve(pool, 2n ** 256n - 1n);
    await tx.wait();
    out({ chain: "evm", step: "approve", tx: tx.hash });
  }

  const fee: bigint = await engine.minExecutionFee();
  const trade = async (kind: "requestIncrease" | "requestDecrease", collateral: bigint, size: bigint, acceptable: bigint) => {
    const tx = await engine[kind](ETH, true, collateral, size, acceptable, { value: fee });
    const rc = await tx.wait();
    const id = rc.logs.map((l: any) => engine.interface.parseLog(l)).find((e: any) => e?.name === "RequestCreated").args.id as bigint;
    const reqBlock = await provider.getBlock(rc.blockNumber);
    const t0 = Date.now();
    while (Number((await engine.getRequest(id)).status) === 1) {
      if (Date.now() - t0 > 180_000) throw new Error("not filled within 180 s — is the keeper running?");
      await sleep(1_000);
    }
    const wall = Date.now() - t0;
    const topic = engine.interface.getEvent(Number((await engine.getRequest(id)).status) === 2 ? "RequestExecuted" : "RequestCancelled")!.topicHash;
    const idTopic = "0x" + id.toString(16).padStart(64, "0");
    const [log] = await provider.getLogs({ address: engine.target as string, topics: [topic, idTopic], fromBlock: rc.blockNumber });
    const fillBlock = log ? await provider.getBlock(log.blockNumber) : null;
    out({
      chain: "evm",
      step: kind,
      id,
      request_tx: tx.hash,
      fill_tx: log?.transactionHash,
      status: Number((await engine.getRequest(id)).status) === 2 ? "executed" : "cancelled",
      blocks: log ? log.blockNumber - rc.blockNumber : undefined,
      latency_chain_s: fillBlock && reqBlock ? fillBlock.timestamp - reqBlock.timestamp : undefined,
      latency_observed_ms: wall,
    });
  };

  if (doOpen) await trade("requestIncrease", 100n * USD, 500n * USD, 2n ** 255n);
  const key = await engine.getPositionKey(trader.address, ETH, true);
  const p = await engine.getPosition(key);
  out({ chain: "evm", step: "position", key, size: p.size, collateral: p.collateral });
  if (!doClose) return;
  await trade("requestDecrease", 0n, p.size, 0n);
  out({ chain: "evm", step: "closed", size_after: (await engine.getPosition(key)).size });
}

const which = process.argv[2];
(which === "evm" ? evm() : which === "solana" ? solana() : Promise.reject(new Error("usage: live-trade.ts evm|solana"))).then(
  () => process.exit(0),
  (e) => {
    console.error(String(e?.message ?? e).replace(/https?:\/\/[^\s"')]+/g, "<url>"));
    process.exit(1);
  },
);
