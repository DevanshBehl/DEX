# Task: Execute Phase 5: Keeper service (TypeScript, Sepolia + Solana devnet)

You are working in the monorepo at `/Users/devanshbehl/Documents/Code/DEx`. Build, test and run the **Celestial Perps keeper**: one Node/TypeScript process, `celestial-keeper/`, that drives both deployed chains. It has three jobs:
1. **Execute** pending order requests.
2. **Liquidate** under-margined positions.
3. **Update funding** hourly for every market.

The two protocols are already live:
- **EVM:** `PerpEngine` on Sepolia (Phase 3)
- **Solana:** the `celestial_perps` Anchor program on devnet (Phase 4)

Only do Phase 5. **Out of scope:** any frontend UI (Phase 6), and **any change to the contracts or the program**. Don't touch `celestial-contracts/src/`, `celestial-solana/programs/`, or the deployed addresses. If the keeper can't do its job without an on-chain change, **stop and report**. Don't work around it.

Read these before you write any code:
1. `phases.md`, Phase 5 (the "Done when" criteria) and the Phase 3 / Phase 4 summaries.
2. `docs/protocol-spec.md` and `docs/perp-math.md`: every formula and rounding rule. **The TypeScript liquidation maths must reproduce the `perp-math.md` vectors exactly** (Ex 1–9, including the Ex 7 boundary).
3. `celestial-contracts/src/PerpEngine.sol`: `executeRequests`, `liquidate`, `updateFunding`, `isLiquidatable`, `getRequest`, `nextRequestId`, `getPosition`, `getMarketIds`, and the events.
4. `celestial-solana/README.md`: the account map, the **`remaining_accounts` convention**, batching, event decoding and the `getProgramAccounts` filters (the "Notes for the keeper" section). `celestial-solana/programs/celestial-perps/src/**` is the reference implementation (read-only here). `celestial-solana/scripts/client.ts` is a working IDL-based client you can copy patterns from.
5. `deployments/sepolia.json` and `deployments/solana-devnet.json`: every address, the market order and the keeper.
6. The ABIs in `celestial-perps/src/abis/` and the IDL in `celestial-perps/src/idl/celestial_perps.json`. **Use these files; don't hand-write ABIs or IDLs.**

If this prompt disagrees with the spec or the deployed code, **the deployed code and the spec win**. Report the disagreement.

---

## Context: current state

- **Toolchain:** Node 24, pnpm 11 (no yarn), Foundry (`forge`, `anvil`, `cast`), solana-cli 3.1.10, anchor-cli 1.1.2.
- **Git:** Phase 4 is uncommitted on branch `phase-4`.
  - **Before starting, check `git status` and `git log`.** If Phase 4 isn't committed yet, **stop and ask the user to commit it**.
  - Then create `phase-5` from the branch that contains Phase 4.
  - **Don't commit or push**; the user commits.

### EVM (Sepolia, chain 11155111)
- **Contracts:**
  - PerpEngine `0x49765B9bEFed004A6462ad2025C240191e762b60`
  - LiquidityPool `0xB2DF5d7C1BCa2d82ECA1D591F0E58B335387b24b` (holds all USDC)
  - ChainlinkOracle `0xFF6a6Da437b16e5dd29D2eF8Aa38517911320cC0`
  - MockUSDC `0x88a77050162285276d6346a4Bc07C406572d6cD2`
- **Markets:** ETH-USD, BTC-USD (`bytes32` = keccak of the symbol; see `deployments/sepolia.json`). Oracle max age is 3960 s (Chainlink heartbeat 3600 s).
- **Keeper:** the deployer `0xA0c3A70806983a965e43961DE48658a9D41f2322` is the only whitelisted keeper.
  - Its key is `PRIVATE_KEY` in `celestial-contracts/.env`, and the RPC is `SEPOLIA_RPC_URL`.
  - **Never print, log, copy into another file, or commit it.** The keeper reads it from its own env (see "Secrets").
- **Execution fee:** the trader pays at least `minExecutionFee` = 0.0002 ETH per request. `executeRequests` pays every processed request's fee to the keeper.
- **There is no global list of pending requests on EVM.**
  - Ids are sequential: `nextRequestId` starts at 1.
  - `getRequest(id)` returns a status of `Pending`, `Executed` or `Cancelled`.
  - Use a cursor over ids. Don't rely on the per-account `getPendingRequestIds`.
- **Positions are keyed** `keccak(account, market, isLong)`, and there's no on-chain list of them.
  - Build the open set from `PositionIncreased`, and drop keys on `PositionClosed` / `PositionLiquidated`.
  - Rebuild it from the deploy block on start. Find the block from the Phase 3 broadcast file `celestial-contracts/broadcast/DeployPerps.s.sol/11155111/run-latest.json`, and record it in `deployments/sepolia.json`.
  - Then keep it current incrementally. **Page `eth_getLogs` in block ranges** that the RPC accepts.
- **Gas balance:** check the keeper's Sepolia ETH at the start. If it's **below 0.01 ETH, stop** and tell the user how much to get.

### Solana (devnet)
- **Program:** `EK1KpDGfUiZ4XkWixAaRFonDexZYSKnJm8oJz5s7HLTL`.
  - PDAs, markets and the market order (**SOL-USD, BTC-USD, ETH-USD**) are in `deployments/solana-devnet.json`.
  - USDC and CLP are **Token-2022** mints.
- **Keeper:** the deployer `6DoRfsEtFC2LFEEvSEuYjeNo7vJHnFrx8EzffksVy5ED` (keypair at `~/.config/solana/devnet.json`, about 16 SOL) is the only keeper.
  - It already has a USDC ATA, which `liquidate` needs as `keeper_usdc`.
  - **Never read, print or copy the keypair file.** Pass its **path** only.
- **Execution fee:** at least `min_execution_fee_lamports` = 50,000, held in the `Request` account and paid to the keeper on execute or cancel.
- **Pending requests:** `getProgramAccounts` with a `memcmp` on the `Request` discriminator (from the IDL). Positions work the same way with the `Position` discriminator.
- **`execute_request`, `liquidate` and `update_funding` need every market and its oracle** as `remaining_accounts`, in `Config.markets` order, with the **affected market writable**.
  - A missing or reordered market fails with `InvalidMarketAccounts`.
  - **Read the order from `Config` on chain at start-up**; don't hard-code it.
- **Business failures during `execute_request` cancel the request and the instruction still succeeds.** The keeper is paid either way, and a `RequestCancelled { reason }` event is emitted. Only account-validation problems return an error.
- **The public devnet RPC rate-limits heavily** (HTTP 429, and "Blockhash not found" in preflight were both seen in Phase 4).
  - Support `SOLANA_RPC_URL`, so a free dedicated devnet endpoint can be plugged in.
  - Make one `getProgramAccounts` call per tick. Use exponential backoff on 429.
  - **Only auto-retry errors that happen before the transaction is accepted**; see `celestial-solana/scripts/client.ts`.
  - **Never blindly re-send** a transaction that may have landed. Re-read the state first.
- The on-chain IDL upload failed in Phase 4, which is harmless. **Load the IDL from `celestial-perps/src/idl/celestial_perps.json`**, not with `Program.fetchIdl`.

---

## Design

### Layout (`celestial-keeper/`)

A pnpm package with **no nested git repository**.

```
celestial-keeper/
  package.json        scripts: keeper, keeper:evm, keeper:solana, test, test:local, typecheck
  tsconfig.json
  .env.example        every variable, documented, no values
  .gitignore          node_modules, .env, *.log, any keypair JSON
  README.md
  src/
    index.ts          start the loops for the chains enabled in config; graceful SIGINT/SIGTERM
    config.ts         env parsing + validation (fail fast, never echo secrets)
    log.ts            JSON lines logger (level, ts, chain, job, msg, fields) — no secret ever logged
    math.ts           TS port of PerpMath (bigint) — pnl, fees, funding owed, isLiquidatable, liquidationPrice
    retry.ts          backoff + "retry only if safe" helpers
    health.ts         balance checks + alert hook (log level=alert; optional webhook URL)
    evm/              client (ethers v6), requests scanner, positions index, executor, liquidator, funding
    solana/           client (web3.js 1.x + BorshCoder from the IDL), scanner, executor, liquidator, funding
  test/
    math.test.ts      perp-math.md vectors (Ex 1–9) + boundary checks
    local-evm.test.ts     Anvil + locally deployed contracts with MockV3Aggregator
    local-solana.test.ts  solana-test-validator + the mock-oracle build of celestial_perps
```

- **Dependencies:** `ethers` v6, `@solana/web3.js` 1.x, `@solana/spl-token`, `@anchor-lang/core` (BorshCoder only), `dotenv`, `tsx`, `typescript`.
- **Justify any other dependency** in the report. Don't add a logging framework or a job queue.

### Jobs (one set per chain, each an independent loop; a failure in one never stops the others)

**1. Executor (poll every 1–2 s)**
- **EVM:**
  - Scan ids from the cursor to `nextRequestId − 1` and collect the `Pending` ones.
  - Call `executeRequests(ids)` in batches, capped by a configurable gas and batch size.
  - Advance the cursor past ids that are no longer pending.
  - Estimate gas first. A failing estimate is a bug or an account problem (a failed request is cancelled inside the call, not reverted), so log it and don't spend gas.
- **Solana:**
  - Fetch pending `Request` accounts, **oldest first** (by `created_at`).
  - Pack several `execute_request` instructions into one transaction. Set a compute-unit limit (each takes about 45k CU) and stay under the size limit.
  - Put the full market list in every instruction, with the request's own market writable.
- **Both chains:**
  - Decode the `RequestExecuted` / `RequestCancelled` events from each result and log one line per request (id, owner, market, result, cancel reason).
  - **Never execute the same request twice in flight.** Keep an in-flight set, and clear an entry only once the result is confirmed.

**2. Liquidator (every 5 s)**
- Load the open positions: the EVM index from the events, and `getProgramAccounts` for Solana `Position`s.
- Load the current oracle price per market:
  - EVM: `ChainlinkOracle.getPrice`
  - Solana: decode the Chainlink account (the layout is in `celestial-solana/programs/celestial-perps/src/oracle.rs` and `celestial-solana/scripts/check-oracle.ts`)
- Load the funding indices.
- Evaluate `isLiquidatable` **off-chain** with `math.ts`, which must match the on-chain rounding exactly.
- **Before sending, confirm on-chain:**
  - EVM: `engine.isLiquidatable(key)` via `eth_call`
  - Solana: simulate the `liquidate` transaction
- Then send `liquidate`, one per position.
- A `NotLiquidatable` revert or simulation failure (the price moved) is **not** an error: log it at info level.
- **Skip markets whose oracle is stale.** The contract would reject them anyway. Log a warning, rate-limited.

**3. Funding updater (hourly per market, with jitter)**
- Call `updateFunding(market)` on EVM and `update_funding(market)` on Solana (all markets and oracles, the target market writable).
- Skip a market with no open interest: the index can't move, and the next trade updates the timestamp anyway.
- Log the `FundingUpdated` values.

**Health**
- On start and every 5 minutes, check:
  - the keeper's native balance: **alert below 0.02 Sepolia ETH or below 1 SOL**
  - that the keeper is still whitelisted (EVM `isKeeper`, Solana `Config.keepers`)
- An alert is a log line with `level: "alert"`, plus an optional POST to `ALERT_WEBHOOK_URL` (a generic JSON body; test it with a local HTTP server, never a real service).
- If the keeper isn't whitelisted, that chain's loops stop with a clear error.

**Reliability**
- Exponential backoff with jitter on RPC errors.
- **Retry a send only when it's safe:**
  - EVM: re-check the nonce and the request status before re-sending. Use one `NonceManager`, and don't allow two transactions with the same nonce in flight.
  - Solana: re-check that the `Request` account still exists before re-sending.
- The process must survive an RPC outage without crashing, and resume by itself.

### Secrets
- `celestial-keeper/.env` (gitignored) holds:
  - `SEPOLIA_RPC_URL`
  - `EVM_KEEPER_PRIVATE_KEY`
  - `SOLANA_RPC_URL`
  - `SOLANA_KEEPER_KEYPAIR_PATH` (a **path**)
  - `ENABLE_EVM` / `ENABLE_SOLANA`
  - the intervals
  - `ALERT_WEBHOOK_URL`
- **The user fills in the EVM key themselves.** Tell them to copy the value from `celestial-contracts/.env`. Don't copy it yourself, don't `cat` either file, and don't print any env var that holds a secret.
  - To check that the key is present, only test whether it's non-empty and that its derived address equals the expected keeper address. Log the address, never the key.
- For the Solana key, load the file only inside the keeper at runtime (`Keypair.fromSecretKey` on the parsed file). **Never log it or send it anywhere.** In your own shell work, only ever pass the path.

---

## Steps (in order)

1. **Preflight (stop conditions):**
   - `git status` must be clean for Phase 4; see Git above.
   - Sepolia keeper ETH must be ≥ 0.01 and devnet SOL ≥ 1. Otherwise **stop** and state the amount needed.
   - Both deployments must answer:
     - EVM: `PerpEngine.nextRequestId()`, `getMarketIds()`, and `isKeeper(keeper)` is true.
     - Solana: `Config` decodes, `keepers` contains the deployer, and there are 3 markets.
   - Record the PerpEngine deploy block.
2. **Scaffold** `celestial-keeper/` (pnpm, TypeScript strict, ESM, Node 24). `pnpm typecheck` must pass.
3. **Maths first:**
   - Write `src/math.ts` and `test/math.test.ts`. Every Ex 1–9 number in `docs/perp-math.md` must match exactly.
   - Add a property check: at the `liquidationPrice` the position is not liquidatable, and 1 unit beyond it is.
   - **All must pass before step 4.**
4. **EVM client and jobs**, run against **Anvil** first:
   - Start `anvil`, deploy the Phase 3 contracts with a `MockV3Aggregator` per market (reuse or mirror the Foundry test setup; don't change `celestial-contracts/src`).
   - Point the keeper at it.
   - `test/local-evm.test.ts` covers:
     - a request is executed within 5 s
     - a batch with one slippage failure → that request is cancelled, the others fill, and the keeper receives every fee
     - a price drop past the liquidation price → liquidated within 10 s, and the keeper receives the USDC fee
     - funding runs on schedule (use a short test interval)
     - RPC down then back up → the keeper resumes without crashing and executes nothing twice
5. **Solana client and jobs**, run against a **local validator** first:
   - Load `celestial-solana`'s **mock-oracle** build (`pnpm build:test` there produces `tests/fixtures/celestial_perps-mock.so` and `idl-mock.json`) with `--bpf-program`.
   - Initialise local accounts the way `celestial-solana/tests/harness.ts` does, and control prices with `set_mock_price`.
   - `test/local-solana.test.ts` covers the same five scenarios as EVM, plus:
     - several requests are executed in **one** transaction
     - a request whose market is stale is cancelled with `StalePrice` and the keeper is still paid
   - The keeper's Solana code must work with **both** IDLs (mock and devnet); it never calls the mock instructions itself.
6. **Live run on Sepolia and devnet:**
   - Start `pnpm keeper` with both chains enabled.
   - From a **separate test wallet**, create one `requestIncrease` on each chain and then the matching full close:
     - EVM: a fresh key funded from the deployer. Use cast with the deployer key loaded only in a subshell from `celestial-contracts/.env`, as in Phase 3.
     - Solana: a fresh keypair file under the scratchpad, funded with `solana transfer`; then `faucet`.
   - **Measure the time from request to fill** from the keeper's logs and the block/slot timestamps. It must be **≤ 5 s on Solana**, and ≤ 5 s after the request's block on Sepolia; the ~12 s block time is not the keeper's latency.
   - Record every signature and hash.
   - **Don't try to force a liquidation on the live networks.** Real Chainlink prices can't be pushed. Liquidation is proven by the local tests. On live, only show that the liquidator loop scans and finds nothing (or liquidates something that is genuinely underwater).
   - Let `updateFunding` / `update_funding` run at least once on each chain with open interest present, or explain why it had nothing to do.
7. **Docs and records:**
   - `celestial-keeper/README.md`: setup, env, how to run it, what each job does, the logs, the alerts, and troubleshooting (429s, stale oracle, not whitelisted).
   - Update `deployments/*.json` with the keeper address and, for Sepolia, the PerpEngine deploy block.
   - Tick off Phase 5 in `phases.md`, and list any deviations.
   - Add a short "Running the keeper" pointer to the root `README.md`.

---

## Checks: everything must pass before you report done

1. `pnpm typecheck` and `pnpm test` in `celestial-keeper` (maths vectors exact).
2. `pnpm test:local`: the Anvil and local-validator scenarios above all pass.
3. The live run: one full open/close on **each** chain filled by the keeper, with measured latencies and the tx hashes/signatures listed.
4. The keeper stays up for at least 10 minutes on live networks with no crash and no unhandled rejection, and the log shows the executor, liquidator, funding and health loops for both chains.
5. `cd celestial-perps && npx tsc --noEmit` still passes (nothing there should change).
6. `git status` shows only intended files: no `.env`, keys or keypair files, `node_modules`, logs or nested `.git`.

If something outside this scope blocks you, **stop and report**. Examples: not enough gas on either chain, the keeper not whitelisted, an RPC that can't serve `eth_getLogs`/`getProgramAccounts`, or a stale Chainlink feed on Sepolia (older than 3960 s) that makes every execution cancel. Don't guess on money maths, and don't change on-chain code.

---

## Rules

- **No on-chain changes:** no contract or program edits, redeploys or parameter changes. Don't touch the admin keys beyond what the live test needs: funding a test wallet and the faucet.
- **Keys:** never print, log, copy, commit or read key material in your own tool calls. The EVM key goes into `celestial-keeper/.env` **by the user**. The Solana key is always referenced by **path**.
- **Minimal dependencies**, each justified.
- The keeper must be **idempotent and safe**: it must never execute a request twice, never liquidate a healthy position, and never spend gas on a transaction it already knows will fail.
- Don't commit or push. Leave everything on `phase-5`.

## Final report

1. A checklist per step, each item marked done, skipped or blocked, with reasons
2. Preflight: keeper balances on both chains, whitelist status, and the PerpEngine deploy block
3. Test summaries: maths, local EVM, local Solana
4. The live run: request/fill hashes and signatures, measured latency per chain, the funding transactions, and 10 minutes of log excerpts (JSON lines)
5. The dependencies added, and why
6. Deviations from `phases.md` Phase 5, and anything the contracts or program would need to change for a better keeper (report only, don't implement). Examples: a global pending-request list on EVM, or a position registry.
7. Notes for Phase 6: how the frontend can show "pending keeper" → filled/cancelled using the same events, and the typical latency to show users
