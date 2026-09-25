# Celestial Perps — Implementation Phases

Goal: a pool-based perpetual DEX (GMX / Jupiter Perps model) running on **Ethereum Sepolia** and **Solana devnet**. Traders trade against an LP pool at the Chainlink oracle price, use mock USDC as collateral, and orders are filled by a keeper.

> Status at the start of this plan (2026-09-22): the frontend shows Binance charts and order book with mocked positions. `CelestialVault.sol` (Sepolia `0x786f…4b04`) takes ETH collateral with no LP pool, has leverage/margin settings that cannot work together (anything ≥20x is liquidatable immediately), and has no tests. There is no Solana program yet.

---

## Shared protocol spec (both chains must match)

| Parameter | Value | Notes |
|---|---|---|
| Collateral | Mock USDC, 6 decimals | Valued at $1 through `collateralPrice()`; switch to a USDC/USD oracle on mainnet |
| Markets | Sepolia: BTC-USD, ETH-USD. Solana devnet: BTC-USD, ETH-USD, SOL-USD | Synthetic, so the pool only needs USDC. SOL-USD is **Solana-only** because Sepolia has no Chainlink SOL/USD feed (decided 2026-09-22) |
| Oracle | Chainlink Data Feeds (push model, free to read) | EVM: `AggregatorV3Interface` on Sepolia. Solana: Chainlink OCR2 store feeds on devnet. No price updates to fetch or pay for |
| Chart / UI price | Coinbase Exchange public API | Candles + live ticker, no API key. Display only; trades always fill at the on-chain oracle price |
| Max leverage | 20x | Must stay below 1 / maintenance margin |
| Maintenance margin | 2.5% of size | Liquidation once `collateral + pnl − fees < 2.5% × size` |
| Open / close fee | 0.06% of size each | 90% to the pool (LPs), 10% to protocol `feeReserves` (`protocolFeeShareBps` = 1000) |
| Liquidation fee | 0.5% of size, capped at the position's collateral | Paid to the liquidator (keeper). The rest of the collateral goes to the pool; the trader receives nothing |
| Max profit per position | 9 × collateral | This amount is **reserved** in the pool when a position opens, which keeps the pool solvent |
| OI cap per side, per market | 30% of pool AUM | Limits how much the LPs can lose |
| Funding | Skew-based, charged hourly | `rate = k × (longOI − shortOI) / poolAUM`, capped at ±0.01%/h. The larger side pays the pool |
| Max oracle age | Per feed: heartbeat + 10% | Sepolia ETH/BTC heartbeat is 3600 s, so max age is 3960 s. Solana devnet feeds update every few seconds, so max age is 120 s. Reject answers ≤ 0 |
| Execution spread | 0.1% against the trader | Longs fill at oracle × 1.001 and shorts at oracle × 0.999. Partly offsets the stale-price edge of a slow push oracle |
| Order flow | Two steps: request, then keeper executes | The keeper fills at the latest oracle price at execution time, subject to `acceptablePrice`. Full front-running protection needs a low-latency pull oracle, see Phase 8 |
| Order expiry | 60 s | After that the user can cancel and get the collateral back |
| Precision | USD values in 1e6 (USDC units), prices normalised to 1e8 | Round against the trader in every calculation |

**Why not Pyth:** since the Pyth Core upgrade (26 Aug 2026), Hermes and Benchmarks need a paid API key (plans from $500/month). Chainlink push feeds are free to read on both testnets and need no keeper-side price fetching.

**Chainlink feeds**

| Market | Sepolia (EVM, 8 decimals) | Solana devnet (OCR2 store `HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny`) |
|---|---|---|
| ETH-USD | `0x694AA1769357215DE4FAC081bf1f309aDC325306` (live, checked 2026-09-22) | `669U43LNHx7LsVj95uYksnhXUfWKDsdzVqev3V4Jpw3P` (account exists) |
| BTC-USD | `0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43` (live, checked 2026-09-22) | `6PxBx93S8x3tno1TsFZwT5VqP8drrRCbCXygEXYNkFJe` (active every few seconds) |
| SOL-USD | None, so **SOL-USD is disabled on EVM** | `99B2bTijsU6f1GCT73HmdR7HCFFjGMBcPZY6jZ96ynrR` (active every few seconds) |

> Before deploying, check addresses and decimals against docs.chain.link. For the Solana feeds, confirm freshness by decoding `latest_round_data` at the start of Phase 4.

**Repo layout when done**
```
celestial-contracts/   EVM (Foundry): MockUSDC, ChainlinkOracle, LiquidityPool, CLP token, PerpEngine
celestial-solana/      Anchor workspace: celestial_perps program + tests
celestial-keeper/      TypeScript keeper for both chains: execute orders, liquidate, funding
celestial-perps/       Next.js frontend
deployments/           Deployed addresses per network (sepolia.json, solana-devnet.json) + token metadata
```

---

## Phase 0 — Cleanup & groundwork ✅ (2026-09-22)

- [x] Delete the stray empty file `celestial-contracts/RECIPIENT=0x11F27CD6…`
- [x] Move `CelestialVault.sol` to `src/legacy/`. It is replaced by the new contracts. Add a note that the Sepolia deployment is deprecated.
- [x] Replace the default Foundry `celestial-contracts/README.md` with project docs (contracts, addresses, how to deploy).
- [x] Confirm the vendored Chainlink library (`@chainlink/`) resolves `AggregatorV3Interface` and `MockV3Aggregator`, using a smoke test
- [x] Install the Solana toolchain: `solana-cli` 3.1.10, `anchor-cli` 1.1.2 (avm), Rust 1.98 are all present.
- [ ] Create a devnet deployer keypair **used only for devnet** (you run this at the start of Phase 2)
- [x] Update `.env.example` for each package: RPC URLs, Chainlink feed addresses, market-data URLs, deployer keys (never commit real keys).
- [x] Copy the shared spec above into `docs/protocol-spec.md`. Both chains are implemented against that file.

**Done when:** the repo builds, the old vault is archived, and both toolchains are installed.

---

## Phase 1 — Frontend: Coinbase + Chainlink instead of Binance, remove the order book ✅ (2026-09-22)

Files: `celestial-perps/app/trade/page.tsx` (split it into `components/` and `lib/` while doing this)

### 1a. Chart & live price → Coinbase Exchange public API (no key)
- [x] Add `lib/marketData.ts` with product IDs (`BTC-USD`, `ETH-USD`, `SOL-USD`) and helpers
- [x] Historical candles: `GET https://api.exchange.coinbase.com/products/<id>/candles?granularity=<s>`. It returns up to 300–350 rows of `[time, low, high, open, close, volume]`, **newest first**.
- [x] **Wire up the timeframe buttons.** 1m/5m/15m/1H/1D map to granularity 60/300/900/3600/86400. Coinbase has no 4H, so **build 4H from 1H candles** on the client.
- [x] Live price: WebSocket `wss://ws-feed.exchange.coinbase.com`, subscribe to `{"type":"subscribe","product_ids":[id],"channels":["ticker"]}`. Update the live candle from ticks.
- [x] 24h change from the ticker's `open_24h`, or from `GET /products/<id>/stats` before the first tick arrives. **Remove "24h volume"**: it's Coinbase's volume, not ours. Replace it with pool OI later.
- [x] Remove `BINANCE_REST`, `BINANCE_WS`, and the `@depth` / `@kline` / `ticker` code.

### 1b. Replace the order book with a Market Info panel
- [x] Delete `BookRow`, `BookSkeleton`, `processDepth`, and the depth WebSocket effect
- [x] Add a `MarketInfo` panel in the same column:
  - **Oracle price** (Chainlink on Sepolia, read through a public RPC) and its age. This is the price trades fill at. Show the gap from the Coinbase index price.
  - Until Phase 6, placeholders for: pool liquidity available, long/short OI with a skew bar, remaining capacity per side, and funding for longs and shorts per hour
  - Max leverage, and the open/close fee

### 1c. Cleanup
- [x] Remove the mock `STATS` and `POSITION` constants (render empty states instead)
- [x] Remove the "Size" input. Size = collateral × leverage and is shown in the summary.
- [x] Hide the "Limit" order type (out of scope, see Phase 8)

**Done when:** the chart, price and timeframes come from Coinbase, the oracle price comes from Chainlink, there are no requests to binance.com, and the order book is gone.

---

## Phase 2 — Mock USDC on both chains ✅ (2026-09-22; Solana faucet done in Phase 4, 2026-09-25)

Addresses are recorded in `deployments/sepolia.json`, `deployments/solana-devnet.json`, and `celestial-perps/lib/tokens.ts`.

### EVM — `celestial-contracts/src/MockUSDC.sol`
- [x] ERC20 "Mock USD Coin" / "USDC", `decimals() = 6`
- [x] `mint(to, amount)` restricted to `onlyOwner`, used to seed the pool
- [x] `faucet()`: 10,000 USDC per address every 24 h, plus a `nextClaimAt(user)` view for the UI
- [x] `test/MockUSDC.t.sol`: decimals, owner mint, non-owner mint reverts, faucet cooldown (8 tests including a fuzz test)
- [x] `script/DeployMockUSDC.s.sol`: deploy, then mint 10M to the deployer (refuses to run on chains other than Sepolia)
- [x] **Deployed and verified on Sepolia:** `0x88a77050162285276d6346a4Bc07C406572d6cD2`. Owner and deployer is `0xA0c3…2322`, which holds 10M. A live `faucet()` test call succeeded.

### Solana — Token-2022 mint
- [x] Mint `2LW8DzDa2KVxDxqUqZLALc6htcVSDwGK1JGz4VaaTn1Y`, created with the Token-2022 program (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`, `spl-token create-token --program-2022 --decimals 6 --enable-metadata`). It has 6 decimals and no freeze authority.
- [x] On-chain metadata: "Mock USD Coin" / "USDC". The URI points to `deployments/mock-usdc-metadata.json` on GitHub `main` (it only resolves after a push).
- [x] Minted 10M to the deployer `6DoRfsEtFC2LFEEvSEuYjeNo7vJHnFrx8EzffksVy5ED` (`~/.config/solana/devnet.json`)
- [x] **Faucet (done in Phase 4).** The `faucet` instruction lives in the Anchor program. The mint authority moved to its `["mint_authority"]` PDA `xAsm3yj7Y1XbBi4DKXPA2UHuLX3GyEgWpVBdR7HkPUB` (2026-09-25), and a live devnet `faucet()` call minted 10,000 USDC.
- [x] Recorded the mint in `deployments/solana-devnet.json` and in the frontend config

> The Anchor program must use the `token_interface` / `InterfaceAccount` types from `anchor-spl`. It must not use the classic `Token` program types, because the mint is Token-2022.

---

## Phase 3 — EVM contracts (Solidity, Foundry) ✅ (2026-09-22)

**Deployed and verified on Sepolia:** PerpEngine `0x49765B9bEFed004A6462ad2025C240191e762b60`, LiquidityPool `0xB2DF5d7C1BCa2d82ECA1D591F0E58B335387b24b`, CLP `0x303C049BF526bD40d82E2Bd405af34bB095A55DA`, ChainlinkOracle `0xFF6a6Da437b16e5dd29D2eF8Aa38517911320cC0`. The pool is seeded with 5M USDC, and an on-chain open/close smoke test passed (see `deployments/sepolia.json`). 107 tests (unit, fuzz, 6 invariants); line coverage 98–100% on the new contracts.

Deviations from the original plan: CLP is deployed separately and bound with `setPool`, not deployed by the pool. `PerpMath` holds all maths, and no `PerpReader` split was needed (the engine is 19.9 KB).

All files go in `celestial-contracts/src/`.

### 3a. `oracle/ChainlinkOracle.sol`
- [x] Maps `bytes32 marketId → (AggregatorV3Interface feed, uint32 maxAge)`
- [x] `getPrice(marketId)`: reads `latestRoundData`, rejects `answer ≤ 0`, rejects `updatedAt` older than `maxAge`, rejects `answeredInRound < roundId`, and normalises to 1e8 from `decimals()`
- [x] `collateralPrice()` returns `1e8` ($1). Leave a hook for USDC/USD on mainnet.
- [x] **SOL-USD on Sepolia: decided to disable it.** Chainlink has no SOL/USD feed on Sepolia, so the EVM engine lists only BTC-USD and ETH-USD. SOL-USD trades on Solana only.

### 3b. `pool/CLP.sol` + `pool/LiquidityPool.sol`
- [x] `CLP`: ERC20 LP token. Only the pool can mint and burn it.
- [x] `addLiquidity(amount)`: CLP minted = `amount × clpSupply / AUM` (1:1 for the first deposit), minus a 0.1% fee
- [x] `removeLiquidity(clpAmount)`: burns CLP and returns the matching USDC. Blocked if the withdrawal would take the pool below its **reserved** amount.
- [x] `AUM = poolAmount − Σ net trader unrealised PnL` per market, floored at 0, with each market's trader losses capped at its collateral. Reserves are **not** subtracted again, because that would count the same risk twice. Computing it needs prices, so it goes through the oracle. See `docs/perp-math.md`.
- [x] Accounting: `poolAmount`, `reservedAmount`, `feeReserves`, plus long and short OI per market
- [x] Only `PerpEngine` can call `payOut`, `receiveLoss`, `reserve`, and `unreserve`
- [x] 15-minute cooldown on removing liquidity after adding (stops LPs from sandwiching trades)

### 3c. `PerpEngine.sol`
- [x] Market config per market: feed ID, max leverage, OI caps, funding factor, enabled flag
- [x] **Order requests** (user pays USDC and an execution fee in ETH to cover keeper gas):
  - `requestIncrease(market, isLong, collateral, sizeUsd, acceptablePrice)`
  - `requestDecrease(positionKey, sizeDelta, collateralDelta, acceptablePrice)`
  - `cancelRequest(id)` after 60 s
- [x] **Keeper execution:** `executeRequests(ids[], priceUpdateData[])`
  - Only whitelisted keepers can call it
  - Uses `oracle.getPrice(market)` at execution time, plus the 0.1% execution spread against the trader
  - Checks slippage (`acceptablePrice`), leverage ≤ 20x, OI cap, and pool reserve capacity
  - If a check fails, cancels the request and refunds the user; the call must never revert as a whole
- [x] **Position** (key = `keccak(trader, market, isLong)`): size, collateral, avg entry price, entry funding index, reserved amount, last updated
- [x] Increase and decrease: weighted average entry price, fees to the pool, realised PnL on a decrease, reserve/unreserve `9 × collateral` in the pool
- [x] **Funding:** a cumulative funding index per market and side, updated on every interaction and by the keeper's `updateFunding(market)`
- [x] **Liquidation:** `liquidate(positionKey, priceUpdateData)` is keeper-only in v1
  - Liquidate when `collateral + pnl − fundingOwed − closeFee < 2.5% × size`
  - The liquidation fee goes to the keeper and the remaining collateral goes to the pool
- [x] Views: `getPosition`, `getLiquidationPrice`, `getPnl`, `getMarketInfo` (OI, funding, capacity), used by the frontend
- [x] Events for every state change. The frontend builds its history from them.
- [x] Admin: `Ownable2Step`, pause per market and globally, parameter setters with bounds (for example, maintenance margin × max leverage < 1)
- [x] Use `SafeERC20` and `ReentrancyGuard` everywhere. Update state before external calls (checks-effects-interactions).

### 3d. Tests (`celestial-contracts/test/`), using `MockV3Aggregator` from Chainlink
- [x] Unit tests: add/remove liquidity, opening a position long or short, increasing/decreasing it, closing with profit or loss, fee accounting, funding accrual, liquidation at the boundary
- [x] Regression test: opening at max leverage can **not** be liquidated immediately
- [x] Slippage, stale price, non-positive answer, OI cap, reserve cap, expired request cancellation
- [x] **Invariant tests**:
  - `usdc.balanceOf(pool) ≥ poolAmount + feeReserves + total trader collateral`
  - `reservedAmount ≤ poolAmount`
  - the total paid out never exceeds what came in
- [x] Fuzz tests: random price paths and random opens and closes, checking that nothing breaks solvency
- [x] Target at least 90% line coverage (`forge coverage`)

### 3e. Deploy to Sepolia
- [x] `script/DeployPerps.s.sol`: deploys ChainlinkOracle, CLP, LiquidityPool, and PerpEngine; links them; configures the two EVM markets (BTC-USD, ETH-USD); whitelists the keeper; seeds the pool with 5M USDC
- [x] Verify the contracts on Etherscan. Write the addresses to `deployments/sepolia.json`, which the frontend reads.
- [x] Export the ABIs to `celestial-perps/src/abis/`

**Done when:** all tests and invariants pass, the contracts are deployed and verified, and one manual cast-script flow works: request, execute, close.

---

## Phase 4 — Solana Anchor program (`celestial-solana/`) ✅ (2026-09-25)

**Deployed on devnet:** program `EK1KpDGfUiZ4XkWixAaRFonDexZYSKnJm8oJz5s7HLTL`, with markets SOL-USD, BTC-USD and ETH-USD on the Chainlink OCR2 feeds (max age 120 s) and the pool seeded with 5M USDC. The USDC mint authority is the program's faucet PDA. A live faucet and open/close smoke test passed (see `deployments/solana-devnet.json`). Tests: 20 Rust maths/oracle tests (every `perp-math.md` vector), 48 LiteSVM scenarios, and an integration test against the Chainlink store and feeds cloned from devnet.

Deviations from the plan:
- The Chainlink feed is decoded by hand (`src/oracle.rs`, no `chainlink_solana` crate).
- `FaucetState` is folded into `UserState`.
- Collateral escrow sits in the pool vault (tracked as `total_escrow`), not in a separate PDA token account.
- CLP has 6 decimals on Solana.
- A failed execution check cancels the request instead of reverting the transaction.
- The LiteSVM suite replaces `anchor test`/bankrun.

See `celestial-solana/README.md`.

`anchor init celestial-solana`, program name `celestial_perps`. Dependencies: `anchor-lang`, `anchor-spl` (`token_interface`), `chainlink_solana` (check the current crate version and read API at the start of this phase).

### 4a. Accounts (PDAs)
| Account | Seeds | Holds |
|---|---|---|
| `Config` | `["config"]` | admin, keeper list, paused flag, global parameters |
| `Pool` | `["pool"]` | USDC vault (a token account owned by the PDA), CLP mint, poolAmount, reserved, feeReserves |
| `Market` | `["market", symbol]` | Chainlink feed account, max age, OI long/short, funding indices, caps, enabled flag |
| `Position` | `["position", owner, market, side]` | size, collateral, entry price, funding index, reserved amount |
| `Request` | `["request", owner, nonce]` | pending increase/decrease, acceptable price, created_at, escrowed collateral |
| `FaucetState` | `["faucet", user]` | last claim timestamp |

### 4b. Instructions
- [x] `initialize`, `add_market`, `set_params`, `set_keeper`, `pause`
- [x] `faucet`: mints 10k mock USDC with the PDA mint authority, once every 24 h per user
- [x] `add_liquidity`, `remove_liquidity`: mint and burn CLP, with the same AUM maths and cooldown as the EVM version
- [x] `request_increase`, `request_decrease`, `cancel_request`: collateral goes into escrow in a PDA token account
- [x] `execute_request` (keeper only): reads the market's Chainlink feed account (check that its address equals `Market.feed` and its owner is the OCR2 store program), checks `latest_round_data` timestamp ≤ max age, applies the execution spread
- [x] `liquidate` (keeper only), `update_funding`
- [x] Use checked maths everywhere (`checked_mul` / `checked_div`, u128 for intermediate values), with custom `#[error_code]` errors and `emit!` events that mirror the EVM events

### 4c. Tests (`tests/` in TypeScript, plus Rust unit tests for the maths)
- [x] Put the maths in a pure `math.rs` module and unit test it: PnL, fees, funding, liquidation price. Compare the results with the EVM tests using the same numbers.
- [x] Integration tests with `anchor test` on a local validator using a mock price account. Use `solana-bankrun` or the local validator with the Chainlink store program and feed accounts cloned from devnet (`--clone`).
- [x] Same scenarios as Phase 3d, including the max-leverage regression test

### 4d. Deploy to devnet
- [x] `anchor deploy --provider.cluster devnet`, run the init script (markets, keeper, seed 5M USDC into the pool), and move the mint authority to the faucet PDA
- [x] Write the program ID and PDAs to `deployments/solana-devnet.json`, and copy the IDL to `celestial-perps/src/idl/`

**Done when:** tests pass, the program is on devnet, and a full script flow works: request, execute, close.

---

## Phase 5 — Keeper service (`celestial-keeper/`)

A Node/TypeScript service. One process drives both chains.

- [ ] **Order executor:** watches `Request` events and accounts, and calls `executeRequests` (EVM) or `execute_request` (Solana). Chainlink feeds are push-based, so there are no price updates to fetch.  Poll every 1–2 s.
- [ ] **Liquidator:** loads all open positions every 5 s, calculates liquidation off-chain, and calls `liquidate` for positions below maintenance
- [ ] **Funding updater:** calls `updateFunding` hourly for every market
- [ ] Retries with backoff, alerts on low keeper gas balance, logs in JSON
- [ ] `.env` with keeper keys for both chains (devnet only). Start it with `npm run keeper`.

**Done when:** a user request is filled within 5 s and underwater positions are liquidated automatically.

---

## Phase 6 — Frontend integration (`celestial-perps/`)

### 6a. Chain layer
- [ ] `lib/chains/evm.ts` and `lib/chains/solana.ts` behind **one interface**: `getMarketInfo`, `getPositions`, `requestIncrease`, `requestDecrease`, `cancel`, `addLiquidity`, `removeLiquidity`, `faucet`, `getUsdcBalance`, `getHistory`
- [ ] Choose the chain from the connected wallet. EVM uses ethers with the **provider of the connected EIP-6963 wallet**, not `window.ethereum`. Solana uses `@solana/web3.js`, `@coral-xyz/anchor`, and the Wallet Standard `signTransaction`.
- [ ] **Network guard:** if the wallet isn't on Sepolia, call `wallet_switchEthereumChain` and block transactions until it is. On Solana, always use a devnet RPC connection.
- [ ] React to `accountsChanged` and `chainChanged`

### 6b. Trade flow
- [ ] USDC collateral input with the balance and % buttons, the ERC20 `approve` step on EVM, and a leverage slider from 1 to 20x
- [ ] Order summary computed from the protocol maths: size, entry (oracle price ± slippage), **liquidation price**, open fee, execution fee, funding
- [ ] Order states: submitted → pending keeper → filled or cancelled, with an explorer link for each chain
- [ ] Decode contract errors (`interface.parseError` on EVM, Anchor error codes on Solana) into readable messages

### 6c. Positions & history
- [ ] Positions table read from the chain: live mark price and PnL (oracle price, with the Coinbase ticker as an in-between estimate), liquidation price, collateral, funding paid
- [ ] Close and partial-close buttons, plus add/remove collateral
- [ ] Pending requests with a Cancel button once they're older than 60 s
- [ ] Order history built from events and program logs

### 6d. New pages & panels
- [ ] Connect the `MarketInfo` panel (from Phase 1) to `getMarketInfo`
- [ ] `/earn` (liquidity page): pool AUM, CLP price, your share, APR based on fees, add/remove liquidity
- [ ] A "Get test USDC" faucet button in the header when on a testnet
- [ ] Link the landing page CTA to `/trade`, and add a link to `/earn`

**Done when:** a fresh wallet on either chain can get USDC from the faucet, open a position, see live PnL, close it, and see it in history. An LP can deposit and withdraw.

---

## Phase 7 — Hardening & testnet launch

- [ ] Cross-chain consistency test: run the same scenario (prices, sizes, time) on both chains and compare PnL, fees, and funding to 1 unit of precision
- [ ] Longer invariant and fuzz runs on EVM, and property tests on the Solana maths
- [ ] Internal security review: access control, rounding direction, reentrancy, oracle manipulation, account validation (owner/signer/PDA checks, mint and token-program checks), front-running
- [ ] Run Slither on EVM, and use `cargo clippy` plus the Anchor account-constraint checklist on Solana
- [ ] Monitoring dashboard: pool AUM, OI, keeper health, failed executions
- [ ] Docs: user guide, LP guide, protocol spec, deployment runbook
- [ ] Public testnet with a small group of testers, then fix what they find

---

## Phase 8 — Later / mainnet only (out of scope for devnet)

- Limit, stop-loss, and take-profit orders (the keeper triggers them)
- A low-latency pull oracle (Pyth with a paid plan, or Chainlink Data Streams) with `publishTime ≥ request time` checks, for real front-running protection
- Real USDC plus a USDC/USD oracle with depeg handling
- Permissionless liquidations
- External audit on both chains, a timelock plus multisig for admin, and a bug bounty
- Deciding whether each chain keeps its own pool or liquidity is shared across chains

---

## Phase dependencies

```
Phase 0 ─┬─► Phase 1 (frontend: Coinbase + Chainlink, no order book) ┐
         ├─► Phase 2 (mock USDC) ─┬─► Phase 3 (EVM contracts) ──┐    │
         │                        └─► Phase 4 (Anchor program) ─┼─► Phase 5 (keeper) ─► Phase 6 (integration) ─► Phase 7
```
Phase 1 can run in parallel with Phases 2–4. Phases 3 and 4 are independent of each other, but both follow `docs/protocol-spec.md`.
