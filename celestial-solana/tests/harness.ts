/**
 * LiteSVM test harness for the `celestial_perps` program.
 *
 * LiteSVM (not a local validator) because the scenarios need clock control: request expiry,
 * the LP cooldown, the 24 h faucet and hours of funding accrual. The program under test is
 * built WITH the `mock-oracle` feature so prices can be set from the tests; the devnet build
 * has no such instruction (see `tests/idl.test.ts`).
 *
 * Instructions are encoded straight from the IDL (`BorshCoder` + the IDL's account order), so
 * the tests exercise exactly what a client would send.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BN, BorshCoder } from "@anchor-lang/core";
import {
  ACCOUNT_SIZE,
  AccountLayout,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  AuthorityType,
  MINT_SIZE,
  MintLayout,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  AccountMeta,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { Clock, FailedTransactionMetadata, LiteSVM, TransactionMetadata } from "litesvm";

const here = dirname(fileURLToPath(import.meta.url));
export const IDL = JSON.parse(readFileSync(join(here, "fixtures/idl-mock.json"), "utf8"));
export const PROGRAM_SO = join(here, "fixtures/celestial_perps-mock.so");
export const PROGRAM_ID = new PublicKey(IDL.address);

export const USDC_DECIMALS = 6;
export const USD = 1_000_000n; // 1 USDC in base units
export const PRICE = 100_000_000n; // $1 at 8 decimals
export const START_TS = 1_800_000_000; // fixed wall clock for deterministic tests
export const EXEC_FEE = 50_000n; // min_execution_fee_lamports

export type Market = { symbol: string; market: PublicKey; oracle: PublicKey };

const coder = new BorshCoder(IDL);

// ── PDAs ──
export const pda = (seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
export const configPda = () => pda([Buffer.from("config")]);
export const poolPda = () => pda([Buffer.from("pool")]);
export const vaultPda = () => pda([Buffer.from("vault")]);
export const clpMintPda = () => pda([Buffer.from("clp_mint")]);
export const mintAuthorityPda = () => pda([Buffer.from("mint_authority")]);
export const marketPda = (symbol: string) => pda([Buffer.from("market"), Buffer.from(symbol)]);
export const mockOraclePda = (symbol: string) => pda([Buffer.from("mock_oracle"), Buffer.from(symbol)]);
export const userStatePda = (owner: PublicKey) => pda([Buffer.from("user"), owner.toBuffer()]);
export const requestPda = (owner: PublicKey, nonce: bigint | number) =>
  pda([Buffer.from("request"), owner.toBuffer(), u64le(nonce)]);
export const positionPda = (owner: PublicKey, market: PublicKey, isLong: boolean) =>
  pda([Buffer.from("position"), owner.toBuffer(), market.toBuffer(), Buffer.from([isLong ? 1 : 0])]);

export function u64le(v: bigint | number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v));
  return b;
}

export class SendError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly logs: string[],
  ) {
    super(message);
  }
}

export class Ctx {
  svm: LiteSVM;
  admin = Keypair.generate();
  keeper = Keypair.generate();
  usdcMint = Keypair.generate();
  markets: Record<string, Market> = {};

  constructor() {
    this.svm = new LiteSVM();
    this.svm.addProgramFromFile(PROGRAM_ID, PROGRAM_SO);
    this.setTime(START_TS);
    this.svm.airdrop(this.admin.publicKey, 1_000n * 1_000_000_000n);
    this.svm.airdrop(this.keeper.publicKey, 100n * 1_000_000_000n);
  }

  // ── time ──
  get now(): number {
    return Number(this.svm.getClock().unixTimestamp);
  }

  setTime(ts: number) {
    const clock = this.svm.getClock();
    clock.unixTimestamp = BigInt(ts);
    this.svm.setClock(clock);
  }

  /** Move the clock forward and refresh every mock oracle so prices stay fresh. */
  warp(seconds: number) {
    this.setTime(this.now + seconds);
    this.svm.expireBlockhash();
    for (const symbol of Object.keys(this.markets)) this.setPrice(symbol, this.getPrice(symbol));
  }

  // ── instruction building ──
  ix(
    name: string,
    accounts: Record<string, PublicKey>,
    args: Record<string, unknown> = {},
    remaining: AccountMeta[] = [],
  ): TransactionInstruction {
    const def = IDL.instructions.find((i: any) => i.name === name);
    if (!def) throw new Error(`unknown instruction ${name}`);
    const keys: AccountMeta[] = def.accounts.map((a: any) => {
      const pubkey = accounts[a.name] ?? (a.address ? new PublicKey(a.address) : undefined);
      if (!pubkey) throw new Error(`${name}: missing account "${a.name}"`);
      return { pubkey, isSigner: !!a.signer, isWritable: !!a.writable };
    });
    return new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [...keys, ...remaining],
      data: coder.instruction.encode(name, bnArgs(args) as Record<string, unknown>),
    });
  }

  /** Default accounts shared by most instructions. */
  common(extra: Record<string, PublicKey> = {}): Record<string, PublicKey> {
    return {
      config: configPda(),
      pool: poolPda(),
      vault: vaultPda(),
      clp_mint: clpMintPda(),
      usdc_mint: this.usdcMint.publicKey,
      mint_authority: mintAuthorityPda(),
      token_program: TOKEN_2022_PROGRAM_ID,
      associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
      system_program: SystemProgram.programId,
      ...extra,
    };
  }

  /** Every market + oracle in `Config` order — the AUM `remaining_accounts` convention. */
  marketAccounts(opts: { writable?: string[]; skip?: string; swap?: boolean } = {}): AccountMeta[] {
    const config = this.getConfig();
    let entries = (config.markets as PublicKey[]).map((key) => {
      const m = Object.values(this.markets).find((x) => x.market.equals(key))!;
      return [
        { pubkey: m.market, isSigner: false, isWritable: !opts.writable || opts.writable.includes(m.symbol) },
        { pubkey: m.oracle, isSigner: false, isWritable: false },
      ] as AccountMeta[];
    });
    if (opts.skip) {
      const skipped = this.markets[opts.skip].market;
      entries = entries.filter((e) => !e[0].pubkey.equals(skipped));
    }
    if (opts.swap && entries.length > 1) [entries[0], entries[1]] = [entries[1], entries[0]];
    return entries.flat();
  }

  // ── sending ──
  send(ixs: TransactionInstruction[], signers: Keypair[]): TransactionMetadata {
    const tx = new Transaction();
    tx.recentBlockhash = this.svm.latestBlockhash();
    tx.feePayer = signers[0].publicKey;
    for (const ix of ixs) tx.add(ix);
    tx.sign(...signers);
    const res = this.svm.sendTransaction(tx);
    if (res instanceof FailedTransactionMetadata) {
      const logs = res.meta().logs();
      throw new SendError(`${res.err().toString()}\n${logs.join("\n")}`, errorCode(logs), logs);
    }
    this.svm.expireBlockhash();
    return res as TransactionMetadata;
  }

  /** Send expecting failure; returns the custom error code name (e.g. "NotKeeper"). */
  expectError(ixs: TransactionInstruction[], signers: Keypair[]): string {
    try {
      this.send(ixs, signers);
    } catch (e) {
      if (e instanceof SendError) return e.code ?? e.message;
      throw e;
    }
    throw new Error("expected the transaction to fail, but it succeeded");
  }

  // ── account reads ──
  account<T = any>(type: string, address: PublicKey): T {
    const info = this.svm.getAccount(address);
    if (!info) throw new Error(`account ${address.toBase58()} not found`);
    return coder.accounts.decode<T>(type, Buffer.from(info.data));
  }

  exists(address: PublicKey): boolean {
    const info = this.svm.getAccount(address);
    return !!info && info.data.length > 0;
  }

  getConfig = () => this.account("Config", configPda());
  getPool = () => this.account("Pool", poolPda());
  getMarket = (symbol: string) => this.account("Market", this.markets[symbol].market);
  getPosition = (owner: PublicKey, symbol: string, isLong: boolean) =>
    this.account("Position", positionPda(owner, this.markets[symbol].market, isLong));
  getRequest = (owner: PublicKey, nonce: bigint | number) => this.account("Request", requestPda(owner, nonce));

  tokenBalance(address: PublicKey): bigint {
    const info = this.svm.getAccount(address);
    if (!info) return 0n;
    return AccountLayout.decode(Buffer.from(info.data.slice(0, ACCOUNT_SIZE))).amount;
  }

  clpSupply(): bigint {
    const info = this.svm.getAccount(clpMintPda())!;
    return MintLayout.decode(Buffer.from(info.data.slice(0, MINT_SIZE))).supply;
  }

  lamports(address: PublicKey): bigint {
    return this.svm.getBalance(address) ?? 0n;
  }

  events(meta: TransactionMetadata): { name: string; data: any }[] {
    const out: { name: string; data: any }[] = [];
    for (const log of meta.logs()) {
      const m = log.match(/^Program data: (.+)$/);
      if (!m) continue;
      const decoded = coder.events.decode(m[1]);
      if (decoded) out.push({ name: decoded.name, data: decoded.data });
    }
    return out;
  }

  event<T = any>(meta: TransactionMetadata, name: string): T | undefined {
    return this.events(meta).find((e) => e.name === name)?.data as T | undefined;
  }

  // ── setup helpers ──
  createUser(usdc = 1_000_000n * USD): Keypair {
    const user = Keypair.generate();
    this.svm.airdrop(user.publicKey, 100n * 1_000_000_000n);
    const ata = this.usdcAta(user.publicKey);
    const ixs = [
      createAssociatedTokenAccountInstruction(
        user.publicKey,
        ata,
        user.publicKey,
        this.usdcMint.publicKey,
        TOKEN_2022_PROGRAM_ID,
      ),
    ];
    if (usdc > 0n) {
      ixs.push(
        createMintToInstruction(
          this.usdcMint.publicKey,
          ata,
          this.admin.publicKey,
          usdc,
          [],
          TOKEN_2022_PROGRAM_ID,
        ),
      );
    }
    this.send(ixs, usdc > 0n ? [user, this.admin] : [user]);
    return user;
  }

  usdcAta = (owner: PublicKey) =>
    getAssociatedTokenAddressSync(this.usdcMint.publicKey, owner, true, TOKEN_2022_PROGRAM_ID);
  clpAta = (owner: PublicKey) =>
    getAssociatedTokenAddressSync(clpMintPda(), owner, true, TOKEN_2022_PROGRAM_ID);

  /** Create the Token-2022 mock USDC mint with the admin as mint authority. */
  createUsdcMint() {
    const lamports = 5_000_000n; // comfortably rent-exempt for a 82-byte mint
    this.send(
      [
        SystemProgram.createAccount({
          fromPubkey: this.admin.publicKey,
          newAccountPubkey: this.usdcMint.publicKey,
          space: MINT_SIZE,
          lamports: Number(lamports),
          programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(
          this.usdcMint.publicKey,
          USDC_DECIMALS,
          this.admin.publicKey,
          null,
          TOKEN_2022_PROGRAM_ID,
        ),
      ],
      [this.admin, this.usdcMint],
    );
  }

  /** Hand the USDC mint authority to the program's `["mint_authority"]` PDA (faucet). */
  moveMintAuthorityToProgram() {
    this.send(
      [
        createSetAuthorityInstruction(
          this.usdcMint.publicKey,
          this.admin.publicKey,
          AuthorityType.MintTokens,
          mintAuthorityPda(),
          [],
          TOKEN_2022_PROGRAM_ID,
        ),
      ],
      [this.admin],
    );
  }

  initialize() {
    this.send([this.ix("initialize", this.common({ admin: this.admin.publicKey }))], [this.admin]);
  }

  addMarket(symbol: string, price: bigint, decimals = 8, maxAge = 120) {
    const oracle = mockOraclePda(symbol);
    this.send(
      [
        this.ix(
          "init_mock_oracle",
          { admin: this.admin.publicKey, config: configPda(), mock_oracle: oracle, system_program: SystemProgram.programId },
          { symbol, answer: price, decimals },
        ),
        this.ix(
          "add_market",
          { admin: this.admin.publicKey, config: configPda(), market: marketPda(symbol), oracle, system_program: SystemProgram.programId },
          { symbol, oracle_kind: { Mock: {} }, max_age: maxAge },
        ),
      ],
      [this.admin],
    );
    this.markets[symbol] = { symbol, market: marketPda(symbol), oracle };
  }

  setPrice(symbol: string, answer: bigint, timestamp = 0) {
    this.send(
      [
        this.ix(
          "set_mock_price",
          { admin: this.admin.publicKey, config: configPda(), mock_oracle: mockOraclePda(symbol) },
          { answer, timestamp: BigInt(timestamp) },
        ),
      ],
      [this.admin],
    );
  }

  getPrice(symbol: string): bigint {
    return BigInt(this.account("MockOracle", mockOraclePda(symbol)).answer.toString());
  }

  setKeeper(keeper: PublicKey, active = true) {
    this.send(
      [this.ix("set_keeper", { admin: this.admin.publicKey, config: configPda() }, { keeper, active })],
      [this.admin],
    );
  }

  setPaused(paused: boolean) {
    this.send([this.ix("set_paused", { admin: this.admin.publicKey, config: configPda() }, { paused })], [this.admin]);
  }

  // ── protocol actions ──
  addLiquidity(user: Keypair, amount: bigint, minClp = 0n) {
    return this.send(
      [
        this.ix(
          "add_liquidity",
          this.common({ user: user.publicKey, user_usdc: this.usdcAta(user.publicKey), user_clp: this.clpAta(user.publicKey), user_state: userStatePda(user.publicKey) }),
          { amount, min_clp: minClp },
          this.marketAccounts(),
        ),
      ],
      [user],
    );
  }

  removeLiquidity(user: Keypair, clpAmount: bigint, minUsdc = 0n) {
    return this.send(
      [
        this.ix(
          "remove_liquidity",
          this.common({ user: user.publicKey, user_usdc: this.usdcAta(user.publicKey), user_clp: this.clpAta(user.publicKey), user_state: userStatePda(user.publicKey) }),
          { clp_amount: clpAmount, min_usdc: minUsdc },
          this.marketAccounts(),
        ),
      ],
      [user],
    );
  }

  nextNonce(owner: PublicKey): bigint {
    const state = this.svm.getAccount(userStatePda(owner));
    if (!state || state.data.length === 0) return 0n;
    return big(this.account("UserState", userStatePda(owner)).request_nonce);
  }

  requestIncreaseIx(
    user: Keypair,
    symbol: string,
    isLong: boolean,
    collateralDelta: bigint,
    sizeDelta: bigint,
    acceptablePrice: bigint,
    executionFee = EXEC_FEE,
    nonce = this.nextNonce(user.publicKey),
  ) {
    const market = this.markets[symbol].market;
    return this.ix(
      "request_increase",
      this.common({
        owner: user.publicKey,
        owner_usdc: this.usdcAta(user.publicKey),
        market,
        position: positionPda(user.publicKey, market, isLong),
        user_state: userStatePda(user.publicKey),
        request: requestPda(user.publicKey, nonce),
      }),
      {
        nonce,
        is_long: isLong,
        collateral_delta: collateralDelta,
        size_delta: sizeDelta,
        acceptable_price: acceptablePrice,
        execution_fee: executionFee,
      },
    );
  }

  requestDecreaseIx(
    user: Keypair,
    symbol: string,
    isLong: boolean,
    collateralDelta: bigint,
    sizeDelta: bigint,
    acceptablePrice: bigint,
    executionFee = EXEC_FEE,
    nonce = this.nextNonce(user.publicKey),
  ) {
    const market = this.markets[symbol].market;
    return this.ix(
      "request_decrease",
      this.common({
        owner: user.publicKey,
        market,
        position: positionPda(user.publicKey, market, isLong),
        user_state: userStatePda(user.publicKey),
        request: requestPda(user.publicKey, nonce),
      }),
      {
        nonce,
        is_long: isLong,
        collateral_delta: collateralDelta,
        size_delta: sizeDelta,
        acceptable_price: acceptablePrice,
        execution_fee: executionFee,
      },
    );
  }

  executeIx(user: PublicKey, nonce: bigint | number, symbol: string, isLong: boolean, writable = [symbol]) {
    const market = this.markets[symbol].market;
    return this.ix(
      "execute_request",
      this.common({
        keeper: this.keeper.publicKey,
        request: requestPda(user, nonce),
        owner: user,
        owner_usdc: this.usdcAta(user),
        position: positionPda(user, market, isLong),
      }),
      {},
      this.marketAccounts({ writable }),
    );
  }

  /** request_increase + execute_request; returns the execution metadata. */
  openPosition(
    user: Keypair,
    symbol: string,
    isLong: boolean,
    collateral: bigint,
    size: bigint,
    acceptablePrice?: bigint,
  ): TransactionMetadata {
    const nonce = this.nextNonce(user.publicKey);
    const price = this.getPrice(symbol);
    const limit = acceptablePrice ?? (isLong ? (price * 12n) / 10n : (price * 8n) / 10n);
    this.send([this.requestIncreaseIx(user, symbol, isLong, collateral, size, limit, EXEC_FEE, nonce)], [user]);
    return this.send([this.executeIx(user.publicKey, nonce, symbol, isLong)], [this.keeper]);
  }

  /** request_decrease + execute_request. */
  closePosition(
    user: Keypair,
    symbol: string,
    isLong: boolean,
    collateralDelta: bigint,
    sizeDelta: bigint,
    acceptablePrice?: bigint,
  ): TransactionMetadata {
    const nonce = this.nextNonce(user.publicKey);
    const price = this.getPrice(symbol);
    const limit = acceptablePrice ?? (isLong ? (price * 8n) / 10n : (price * 12n) / 10n);
    this.send([this.requestDecreaseIx(user, symbol, isLong, collateralDelta, sizeDelta, limit, EXEC_FEE, nonce)], [user]);
    return this.send([this.executeIx(user.publicKey, nonce, symbol, isLong)], [this.keeper]);
  }

  liquidate(owner: PublicKey, symbol: string, isLong: boolean) {
    const market = this.markets[symbol].market;
    return this.send(
      [
        this.ix(
          "liquidate",
          this.common({
            keeper: this.keeper.publicKey,
            keeper_usdc: this.usdcAta(this.keeper.publicKey),
            position: positionPda(owner, market, isLong),
            owner,
          }),
          {},
          this.marketAccounts({ writable: [symbol] }),
        ),
      ],
      [this.keeper],
    );
  }

  updateFunding(symbol: string) {
    return this.send(
      [
        this.ix(
          "update_funding",
          { config: configPda(), pool: poolPda() },
          { market: this.markets[symbol].market },
          this.marketAccounts({ writable: [symbol] }),
        ),
      ],
      [this.keeper],
    );
  }

  /** Read a view instruction's return data (simulated through a normal send). */
  view(name: string, accounts: Record<string, PublicKey>, args: Record<string, unknown> = {}): Buffer {
    const meta = this.send([this.ix(name, accounts, args, this.marketAccounts())], [this.keeper]);
    return Buffer.from(meta.returnData().data());
  }

  aum(): bigint {
    return this.view("get_aum", { config: configPda(), pool: poolPda() }).readBigUInt64LE(0);
  }

  clpPrice(): bigint {
    return this.view("get_clp_price", { config: configPda(), pool: poolPda(), clp_mint: clpMintPda() }).readBigUInt64LE(0);
  }

  liquidationPrice(owner: PublicKey, symbol: string, isLong: boolean): bigint {
    const meta = this.send(
      [
        this.ix("get_liquidation_price", {
          config: configPda(),
          position: positionPda(owner, this.markets[symbol].market, isLong),
          market: this.markets[symbol].market,
        }),
      ],
      [this.keeper],
    );
    return Buffer.from(meta.returnData().data()).readBigUInt64LE(0);
  }

  marketInfo(symbol: string): any {
    const buf = this.view("get_market_info", { config: configPda(), pool: poolPda() }, { market: this.markets[symbol].market });
    return coder.types.decode("MarketInfo", buf);
  }

  cancelIx(owner: Keypair, nonce: bigint | number, signer: PublicKey = owner.publicKey) {
    return this.ix(
      "cancel_request",
      this.common({ owner: signer, owner_usdc: this.usdcAta(signer), request: requestPda(owner.publicKey, nonce) }),
    );
  }

  liquidateIx(owner: PublicKey, symbol: string, isLong: boolean, keeper: PublicKey = this.keeper.publicKey) {
    const market = this.markets[symbol].market;
    return this.ix(
      "liquidate",
      this.common({ keeper, keeper_usdc: this.usdcAta(keeper), position: positionPda(owner, market, isLong), owner }),
      {},
      this.marketAccounts({ writable: [symbol] }),
    );
  }

  /** `set_params` with only the given fields set (the rest are `None`). */
  setParamsIx(fields: Partial<Record<(typeof PARAM_KEYS)[number], bigint>>, remaining: AccountMeta[] = [], admin = this.admin.publicKey) {
    const params = Object.fromEntries(PARAM_KEYS.map((k) => [k, fields[k] ?? null]));
    return this.ix("set_params", { admin, config: configPda(), pool: poolPda() }, { params }, remaining);
  }

  setParams(fields: Partial<Record<(typeof PARAM_KEYS)[number], bigint>>, remaining: AccountMeta[] = []) {
    return this.send([this.setParamsIx(fields, remaining)], [this.admin]);
  }

  faucetIx(user: PublicKey) {
    return this.ix(
      "faucet",
      this.common({ user, user_state: userStatePda(user), user_usdc: this.usdcAta(user) }),
    );
  }

  withdrawFeesIx(to: PublicKey, admin = this.admin.publicKey) {
    return this.ix("withdraw_fees", this.common({ admin, to }));
  }

  /** `vault ≥ pool + fees + collateral + escrow` and `reserved ≤ pool` — checked after every test. */
  checkInvariants() {
    const pool = this.getPool();
    const vault = this.tokenBalance(vaultPda());
    const buckets = big(pool.pool_amount) + big(pool.fee_reserves) + big(pool.total_collateral) + big(pool.total_escrow);
    if (vault < buckets) throw new Error(`vault ${vault} < buckets ${buckets}`);
    const reserved = big(pool.reserved_amount);
    const poolAmount = big(pool.pool_amount);
    if (reserved > poolAmount) throw new Error(`reserved ${reserved} > poolAmount ${poolAmount}`);
  }
}

export const PARAM_KEYS = [
  "max_leverage",
  "maintenance_margin_bps",
  "position_fee_bps",
  "liquidation_fee_bps",
  "execution_spread_bps",
  "max_profit_multiplier",
  "oi_cap_bps",
  "funding_factor_per_hour",
  "max_funding_rate_per_hour",
  "request_expiry",
  "min_execution_fee_lamports",
  "min_collateral",
  "lp_mint_fee_bps",
  "protocol_fee_share_bps",
  "lp_cooldown",
] as const;

/** Name of the enum variant in a decoded Borsh enum (`{ SlippageExceeded: {} }` → "SlippageExceeded"). */
export const variant = (v: any): string => Object.keys(v)[0];

/** Run a scenario on a fresh protocol and assert the accounting invariants afterwards. */
export function scenario(fn: (ctx: Ctx, lp: Keypair) => void, opts: { liquidity?: bigint } = {}) {
  return () => {
    const { ctx, lp } = setup(opts);
    fn(ctx, lp);
    ctx.checkInvariants();
  };
}

/** Borsh integer layouts want BN, so convert every bigint in the argument tree. */
function bnArgs(value: unknown): unknown {
  if (typeof value === "bigint") return new BN(value.toString());
  if (Array.isArray(value)) return value.map(bnArgs);
  if (value && typeof value === "object" && value.constructor === Object) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, bnArgs(v)]));
  }
  return value;
}

export function big(v: any): bigint {
  return BigInt(v.toString());
}

function errorCode(logs: string[]): string | null {
  for (const log of logs) {
    const named = log.match(/Error Code: (\w+)\./);
    if (named) return named[1];
    const custom = log.match(/custom program error: 0x([0-9a-f]+)/i);
    if (custom) {
      const code = parseInt(custom[1], 16);
      const err = IDL.errors?.find((e: any) => e.code === code);
      if (err) return err.name;
    }
  }
  return null;
}

/** A fully set up protocol: mint, program, 3 markets, keeper, and a seeded pool. */
export function setup(opts: { liquidity?: bigint } = {}): { ctx: Ctx; lp: Keypair } {
  const ctx = new Ctx();
  ctx.createUsdcMint();
  ctx.initialize();
  ctx.addMarket("SOL-USD", 11_600_000_000n); // $116
  ctx.addMarket("BTC-USD", 6_000_000_000_000n); // $60,000
  ctx.addMarket("ETH-USD", 300_000_000_000n); // $3,000
  ctx.setKeeper(ctx.keeper.publicKey);
  // The keeper needs a USDC account for liquidation fees.
  const keeperAta = ctx.usdcAta(ctx.keeper.publicKey);
  ctx.send(
    [
      createAssociatedTokenAccountInstruction(
        ctx.keeper.publicKey,
        keeperAta,
        ctx.keeper.publicKey,
        ctx.usdcMint.publicKey,
        TOKEN_2022_PROGRAM_ID,
      ),
    ],
    [ctx.keeper],
  );
  const lp = ctx.createUser(10_000_000n * USD);
  const liquidity = opts.liquidity ?? 5_000_000n * USD;
  if (liquidity > 0n) ctx.addLiquidity(lp, liquidity);
  return { ctx, lp };
}

export { Clock, FailedTransactionMetadata, LiteSVM, TransactionMetadata, TOKEN_2022_PROGRAM_ID };
