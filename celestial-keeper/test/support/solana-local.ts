/**
 * Local Solana protocol for the keeper tests: `solana-test-validator` with the `mock-oracle`
 * build of celestial_perps (from `celestial-solana`, `pnpm build:test`), a local Token-2022 USDC,
 * 3 markets on admin-set mock prices, a seeded pool and funded users. Setup instructions are
 * encoded from the mock IDL; the keeper under test uses the devnet IDL.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import anchor, { BorshCoder } from "@anchor-lang/core";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MINT_SIZE,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  type AccountMeta,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

import { KEEPER_ROOT, REPO_ROOT } from "../../src/config.ts";
import { spawnQuiet, waitFor } from "./common.ts";

export const MOCK_IDL_PATH = join(REPO_ROOT, "celestial-solana/tests/fixtures/idl-mock.json");
export const MOCK_SO_PATH = join(REPO_ROOT, "celestial-solana/tests/fixtures/celestial_perps-mock.so");
export const DEVNET_IDL_PATH = join(REPO_ROOT, "celestial-perps/src/idl/celestial_perps.json");
export const LEDGER = join(KEEPER_ROOT, "test-ledger");
export const USD = 1_000_000n;
export const EXEC_FEE = 50_000n;
export const MARKETS: [string, bigint][] = [
  ["SOL-USD", 11_600_000_000n],
  ["BTC-USD", 6_000_000_000_000n],
  ["ETH-USD", 300_000_000_000n],
];

// `BN` is only reachable through the CommonJS default export when loaded as ESM.
const { BN } = anchor as unknown as { BN: new (v: string) => unknown };

const toBn = (v: unknown): unknown =>
  typeof v === "bigint"
    ? new BN(v.toString())
    : v && typeof v === "object" && (v as object).constructor === Object
      ? Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, toBn(x)]))
      : v;

export class LocalSolana {
  readonly connection: Connection;
  readonly idl: any;
  readonly coder: BorshCoder;
  readonly programId: PublicKey;
  readonly admin = Keypair.generate();
  readonly keeper = Keypair.generate();
  readonly usdc = Keypair.generate();
  keeperKeypairPath = join(LEDGER, "keeper-test-keypair.json");
  private validator?: ReturnType<typeof spawnQuiet>;

  constructor(readonly rpcPort: number) {
    this.connection = new Connection(`http://127.0.0.1:${rpcPort}`, "confirmed");
    this.idl = JSON.parse(readFileSync(MOCK_IDL_PATH, "utf8"));
    this.coder = new BorshCoder(this.idl);
    this.programId = new PublicKey(this.idl.address);
  }

  get rpcUrl() {
    return `http://127.0.0.1:${this.rpcPort}`;
  }

  // ── PDAs ──
  pda = (...seeds: (Buffer | string)[]) =>
    PublicKey.findProgramAddressSync(seeds.map((s) => (typeof s === "string" ? Buffer.from(s) : s)), this.programId)[0];
  market = (s: string) => this.pda("market", s);
  mockOracle = (s: string) => this.pda("mock_oracle", s);
  userState = (o: PublicKey) => this.pda("user", o.toBuffer());
  request = (o: PublicKey, nonce: bigint) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(nonce);
    return this.pda("request", o.toBuffer(), b);
  };
  position = (o: PublicKey, symbol: string, isLong: boolean) =>
    this.pda("position", o.toBuffer(), this.market(symbol).toBuffer(), Buffer.from([isLong ? 1 : 0]));
  ata = (owner: PublicKey) => getAssociatedTokenAddressSync(this.usdc.publicKey, owner, true, TOKEN_2022_PROGRAM_ID);

  common(extra: Record<string, PublicKey> = {}) {
    return {
      config: this.pda("config"),
      pool: this.pda("pool"),
      vault: this.pda("vault"),
      clp_mint: this.pda("clp_mint"),
      usdc_mint: this.usdc.publicKey,
      token_program: TOKEN_2022_PROGRAM_ID,
      associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
      system_program: SystemProgram.programId,
      ...extra,
    } as Record<string, PublicKey>;
  }

  marketAccounts(): AccountMeta[] {
    return MARKETS.flatMap(([s]) => [
      { pubkey: this.market(s), isSigner: false, isWritable: false },
      { pubkey: this.mockOracle(s), isSigner: false, isWritable: false },
    ]);
  }

  ix(name: string, accounts: Record<string, PublicKey>, args: Record<string, unknown> = {}, remaining: AccountMeta[] = []) {
    const def = this.idl.instructions.find((i: any) => i.name === name);
    const keys: AccountMeta[] = def.accounts.map((a: any) => {
      const pubkey = accounts[a.name] ?? (a.address ? new PublicKey(a.address) : undefined);
      if (!pubkey) throw new Error(`${name}: missing ${a.name}`);
      return { pubkey, isSigner: !!a.signer, isWritable: !!a.writable };
    });
    return new TransactionInstruction({ programId: this.programId, keys: [...keys, ...remaining], data: this.coder.instruction.encode(name, toBn(args) as any) });
  }

  send(ixs: TransactionInstruction[], signers: Keypair[]) {
    return sendAndConfirmTransaction(this.connection, new Transaction().add(...ixs), signers, { commitment: "confirmed" });
  }

  async fetch(type: string, address: PublicKey) {
    const info = await this.connection.getAccountInfo(address, "confirmed");
    return info && info.data.length > 0 ? this.coder.accounts.decode(type, info.data) : null;
  }

  async usdcBalance(owner: PublicKey) {
    const b = await this.connection.getTokenAccountBalance(this.ata(owner), "confirmed").catch(() => null);
    return BigInt(b?.value.amount ?? "0");
  }

  async airdrop(to: PublicKey, sol = 100) {
    const sig = await this.connection.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
    await this.connection.confirmTransaction({ signature: sig, ...(await this.connection.getLatestBlockhash()) }, "confirmed");
  }

  // ── lifecycle ──
  async start() {
    mkdirSync(LEDGER, { recursive: true });
    this.validator = spawnQuiet("solana-test-validator", [
      "--reset",
      "--quiet",
      "--ledger", LEDGER,
      "--rpc-port", String(this.rpcPort),
      "--faucet-port", "19910",
      "--gossip-port", "18010",
      "--dynamic-port-range", "18050-18090",
      "--bpf-program", this.programId.toBase58(), MOCK_SO_PATH,
    ]);
    await waitFor(() => this.connection.getSlot().then(() => true), 60_000, "solana-test-validator");
    // Test-only keeper key, written where the keeper config expects a PATH (gitignored dir).
    writeFileSync(this.keeperKeypairPath, JSON.stringify([...this.keeper.secretKey]));
  }

  stop() {
    this.validator?.kill("SIGINT");
  }

  /** Mint, program init, 3 mock markets, keeper, 5M seed. */
  async setup() {
    await this.airdrop(this.admin.publicKey, 1_000);
    await this.airdrop(this.keeper.publicKey, 100);
    const adminAta = this.ata(this.admin.publicKey);
    await this.send(
      [
        SystemProgram.createAccount({
          fromPubkey: this.admin.publicKey,
          newAccountPubkey: this.usdc.publicKey,
          space: MINT_SIZE,
          lamports: await this.connection.getMinimumBalanceForRentExemption(MINT_SIZE),
          programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(this.usdc.publicKey, 6, this.admin.publicKey, null, TOKEN_2022_PROGRAM_ID),
        createAssociatedTokenAccountIdempotentInstruction(this.admin.publicKey, adminAta, this.admin.publicKey, this.usdc.publicKey, TOKEN_2022_PROGRAM_ID),
        createMintToInstruction(this.usdc.publicKey, adminAta, this.admin.publicKey, 10_000_000n * USD, [], TOKEN_2022_PROGRAM_ID),
      ],
      [this.admin, this.usdc],
    );
    await this.send([this.ix("initialize", this.common({ admin: this.admin.publicKey }))], [this.admin]);
    for (const [symbol, price] of MARKETS) {
      await this.send(
        [
          this.ix("init_mock_oracle", { admin: this.admin.publicKey, config: this.pda("config"), mock_oracle: this.mockOracle(symbol), system_program: SystemProgram.programId }, { symbol, answer: price, decimals: 8 }),
          this.ix(
            "add_market",
            { admin: this.admin.publicKey, config: this.pda("config"), market: this.market(symbol), oracle: this.mockOracle(symbol), system_program: SystemProgram.programId },
            { symbol, oracle_kind: { Mock: {} }, max_age: 120 },
          ),
        ],
        [this.admin],
      );
    }
    await this.send([this.ix("set_keeper", { admin: this.admin.publicKey, config: this.pda("config") }, { keeper: this.keeper.publicKey, active: true })], [this.admin]);
    await this.send(
      [
        this.ix(
          "add_liquidity",
          this.common({ user: this.admin.publicKey, user_usdc: adminAta, user_clp: getAssociatedTokenAddressSync(this.pda("clp_mint"), this.admin.publicKey, true, TOKEN_2022_PROGRAM_ID), user_state: this.userState(this.admin.publicKey) }),
          { amount: 5_000_000n * USD, min_clp: 0n },
          this.marketAccounts(),
        ),
      ],
      [this.admin],
    );
  }

  async createUser(usdc = 1_000_000n * USD) {
    const u = Keypair.generate();
    await this.airdrop(u.publicKey, 10);
    await this.send(
      [
        createAssociatedTokenAccountIdempotentInstruction(u.publicKey, this.ata(u.publicKey), u.publicKey, this.usdc.publicKey, TOKEN_2022_PROGRAM_ID),
        createMintToInstruction(this.usdc.publicKey, this.ata(u.publicKey), this.admin.publicKey, usdc, [], TOKEN_2022_PROGRAM_ID),
      ],
      [u, this.admin],
    );
    return u;
  }

  setPriceIx(symbol: string, answer: bigint, timestamp = 0n) {
    return this.ix("set_mock_price", { admin: this.admin.publicKey, config: this.pda("config"), mock_oracle: this.mockOracle(symbol) }, { answer, timestamp });
  }

  async setPrice(symbol: string, answer: bigint, timestamp = 0n) {
    await this.send([this.setPriceIx(symbol, answer, timestamp)], [this.admin]);
  }

  async refreshPrices() {
    const ixs = [];
    for (const [symbol] of MARKETS) {
      const m = await this.fetch("MockOracle", this.mockOracle(symbol));
      ixs.push(this.setPriceIx(symbol, BigInt(m.answer.toString())));
    }
    await this.send(ixs, [this.admin]);
  }

  async nextNonce(owner: PublicKey): Promise<bigint> {
    const s = await this.fetch("UserState", this.userState(owner));
    return s ? BigInt(s.request_nonce.toString()) : 0n;
  }

  /** request_increase instruction for `user` at `nonce`. */
  requestIncreaseIx(user: PublicKey, nonce: bigint, symbol: string, isLong: boolean, coll: bigint, size: bigint, acceptable?: bigint) {
    return this.ix(
      "request_increase",
      this.common({
        owner: user,
        owner_usdc: this.ata(user),
        market: this.market(symbol),
        position: this.position(user, symbol, isLong),
        user_state: this.userState(user),
        request: this.request(user, nonce),
      }),
      { nonce, is_long: isLong, collateral_delta: coll, size_delta: size, acceptable_price: acceptable ?? (isLong ? 2n ** 63n : 1n), execution_fee: EXEC_FEE },
    );
  }
}
