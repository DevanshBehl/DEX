/**
 * Minimal RPC client for `celestial_perps`, shared by `init-devnet.ts` and the Chainlink
 * validator test. Instructions are encoded straight from the IDL (same as the LiteSVM tests),
 * signed by an `AnchorProvider` — the wallet is loaded by Anchor from `ANCHOR_WALLET` (a path);
 * this code never reads key material.
 */
import { readFileSync } from "node:fs";

import { AnchorProvider, BN, BorshCoder } from "@anchor-lang/core";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  AccountMeta,
  ComputeBudgetProgram,
  PublicKey,
  Signer,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

export const CHAINLINK_STORE = new PublicKey("HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny");

export class PerpsClient {
  readonly coder: BorshCoder;
  readonly programId: PublicKey;

  constructor(
    readonly provider: AnchorProvider,
    readonly idl: any,
  ) {
    this.coder = new BorshCoder(idl);
    this.programId = new PublicKey(idl.address);
  }

  static fromIdlFile(provider: AnchorProvider, path: string) {
    return new PerpsClient(provider, JSON.parse(readFileSync(path, "utf8")));
  }

  get connection() {
    return this.provider.connection;
  }

  get wallet() {
    return this.provider.wallet.publicKey;
  }

  // ── PDAs (seeds as in programs/celestial-perps/src/constants.rs) ──
  pda = (...seeds: (Buffer | Uint8Array | string)[]) =>
    PublicKey.findProgramAddressSync(
      seeds.map((s) => (typeof s === "string" ? Buffer.from(s) : s)),
      this.programId,
    )[0];
  config = () => this.pda("config");
  pool = () => this.pda("pool");
  vault = () => this.pda("vault");
  clpMint = () => this.pda("clp_mint");
  mintAuthority = () => this.pda("mint_authority");
  market = (symbol: string) => this.pda("market", symbol);
  userState = (owner: PublicKey) => this.pda("user", owner.toBuffer());
  request = (owner: PublicKey, nonce: bigint) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(nonce);
    return this.pda("request", owner.toBuffer(), b);
  };
  position = (owner: PublicKey, market: PublicKey, isLong: boolean) =>
    this.pda("position", owner.toBuffer(), market.toBuffer(), Buffer.from([isLong ? 1 : 0]));

  ata = (mint: PublicKey, owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID);

  // ── encoding ──
  ix(name: string, accounts: Record<string, PublicKey>, args: Record<string, unknown> = {}, remaining: AccountMeta[] = []) {
    const def = this.idl.instructions.find((i: any) => i.name === name);
    if (!def) throw new Error(`unknown instruction ${name}`);
    const keys: AccountMeta[] = def.accounts.map((a: any) => {
      const pubkey = accounts[a.name] ?? (a.address ? new PublicKey(a.address) : undefined);
      if (!pubkey) throw new Error(`${name}: missing account "${a.name}"`);
      return { pubkey, isSigner: !!a.signer, isWritable: !!a.writable };
    });
    return new TransactionInstruction({
      programId: this.programId,
      keys: [...keys, ...remaining],
      data: this.coder.instruction.encode(name, toBn(args) as Record<string, unknown>),
    });
  }

  /** Accounts most instructions share, filled from on-chain `Config`. */
  async common(extra: Record<string, PublicKey> = {}) {
    const config = await this.fetch("Config", this.config());
    return {
      config: this.config(),
      pool: this.pool(),
      vault: this.vault(),
      clp_mint: this.clpMint(),
      usdc_mint: config.usdc_mint as PublicKey,
      token_program: config.token_program as PublicKey,
      mint_authority: this.mintAuthority(),
      associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
      system_program: SystemProgram.programId,
      ...extra,
    } as Record<string, PublicKey>;
  }

  /**
   * The AUM `remaining_accounts`: every market then its oracle, in `Config.markets` order.
   * `writable` lists the markets the instruction mutates (execute/liquidate/update_funding).
   */
  async marketAccounts(writable: PublicKey[] = []): Promise<AccountMeta[]> {
    const config = await this.fetch("Config", this.config());
    const out: AccountMeta[] = [];
    for (const key of config.markets as PublicKey[]) {
      const m = await this.fetch("Market", key);
      out.push({ pubkey: key, isSigner: false, isWritable: writable.some((w) => w.equals(key)) });
      out.push({ pubkey: m.oracle, isSigner: false, isWritable: false });
    }
    return out;
  }

  // ── sending / reading ──
  /**
   * Retries only failures that happen before the transaction is accepted (stale blockhash in
   * preflight, RPC rate limit), so a retry can never double-execute.
   */
  async send(ixs: TransactionInstruction[], signers: Signer[] = [], computeUnits?: number): Promise<string> {
    for (let attempt = 1; ; attempt++) {
      const tx = new Transaction();
      if (computeUnits) tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
      tx.add(...ixs);
      try {
        return await this.provider.sendAndConfirm(tx, signers, { commitment: "confirmed" });
      } catch (e) {
        const msg = String((e as Error).message ?? e);
        const transient = /Blockhash not found|429|Too Many Requests/.test(msg) && !/custom program error/.test(msg);
        if (!transient || attempt >= 5) throw e;
        await new Promise((r) => setTimeout(r, 2_000 * attempt));
      }
    }
  }

  /** Simulate a view instruction and return its return data. */
  async view(name: string, accounts: Record<string, PublicKey>, args: Record<string, unknown> = {}, remaining: AccountMeta[] = []) {
    const tx = new Transaction().add(this.ix(name, accounts, args, remaining));
    tx.feePayer = this.wallet;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    const sim = await this.connection.simulateTransaction(tx);
    if (sim.value.err) throw new Error(`${name} failed: ${JSON.stringify(sim.value.err)}\n${sim.value.logs?.join("\n")}`);
    const data = sim.value.returnData?.data?.[0];
    if (!data) throw new Error(`${name}: no return data`);
    return Buffer.from(data, "base64");
  }

  async aum(): Promise<bigint> {
    const buf = await this.view("get_aum", { config: this.config(), pool: this.pool() }, {}, await this.marketAccounts());
    return buf.readBigUInt64LE(0);
  }

  async marketInfo(symbol: string): Promise<any> {
    const buf = await this.view(
      "get_market_info",
      { config: this.config(), pool: this.pool() },
      { market: this.market(symbol) },
      await this.marketAccounts(),
    );
    return this.coder.types.decode("MarketInfo", buf);
  }

  async fetch(type: string, address: PublicKey): Promise<any> {
    const info = await this.connection.getAccountInfo(address, "confirmed");
    if (!info) throw new Error(`${type} ${address.toBase58()} not found`);
    return this.coder.accounts.decode(type, info.data);
  }

  async exists(address: PublicKey): Promise<boolean> {
    const info = await this.connection.getAccountInfo(address, "confirmed");
    return !!info && info.data.length > 0;
  }

  /** Decode every Anchor event in a confirmed transaction's logs. */
  async events(signature: string): Promise<{ name: string; data: any }[]> {
    const tx = await this.connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const out: { name: string; data: any }[] = [];
    for (const log of tx?.meta?.logMessages ?? []) {
      const m = log.match(/^Program data: (.+)$/);
      if (!m) continue;
      const e = this.coder.events.decode(m[1]);
      if (e) out.push({ name: e.name, data: e.data });
    }
    return out;
  }
}

function toBn(value: unknown): unknown {
  if (typeof value === "bigint") return new BN(value.toString());
  if (Array.isArray(value)) return value.map(toBn);
  if (value && typeof value === "object" && value.constructor === Object) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toBn(v)]));
  }
  return value;
}

export const big = (v: any): bigint => BigInt(v.toString());
