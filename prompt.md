# Task: Execute Phase 3 — EVM perps contracts (Solidity, Foundry, Sepolia)

You are working in the monorepo at `/Users/devanshbehl/Documents/Code/DEx`. Build, test, and deploy the **Ethereum side of Celestial Perps**: an oracle wrapper, a USDC liquidity pool with an LP token, and the perps engine. Traders trade against the pool at the Chainlink price, and a keeper executes their orders.

Only do Phase 3. **Out of scope:** the Solana program (Phase 4), the keeper service (Phase 5), and any frontend UI work (Phase 6). The only frontend change allowed is exporting ABIs and addresses (step 7).

Read these first:
1. `docs/protocol-spec.md`. This is the source of truth for every parameter. If this prompt and the spec disagree, **the spec wins**. Report any disagreement you find.
2. `phases.md`, Phase 3.
3. `deployments/sepolia.json`, which holds the MockUSDC and Chainlink addresses.

---

## Context: current state

- **Foundry project:** `celestial-contracts/`. It uses solc `0.8.24` with `via_ir = true`, optimizer on, and 200 runs.
- **Libraries** are copied into `lib/` as plain files, not git submodules. Don't run `forge install`. The ones available:
  - OpenZeppelin **5.6.1**: `Ownable2Step`, `Pausable`, `ReentrancyGuard`, `SafeERC20`, `ERC20`, `Math`, `SignedMath`
  - Chainlink: `AggregatorV3Interface` and `MockV3Aggregator` under `@chainlink/contracts/src/v0.8/...`
  - forge-std
- **Existing contracts:**
  - `src/MockUSDC.sol`: 6 decimals, deployed at `0x88a77050162285276d6346a4Bc07C406572d6cD2`. The deployer holds about 10M.
  - `src/legacy/CelestialVault.sol`: deprecated. **Don't touch it.**
  - the `src/test-nfts/*` contracts. **Don't touch them either.**
- **Chainlink on Sepolia**, 8 decimals, heartbeat 3600 s:
  - ETH-USD `0x694AA1769357215DE4FAC081bf1f309aDC325306`
  - BTC-USD `0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43`
- **Markets on EVM: BTC-USD and ETH-USD only.** SOL-USD is Solana-only and **must not be listed** on EVM.
- **Deployer:** `0xA0c3A70806983a965e43961DE48658a9D41f2322`. `celestial-contracts/.env` contains `SEPOLIA_RPC_URL`, `PRIVATE_KEY`, and `ETHERSCAN_API_KEY`.
  - **Never print, log, copy, or commit `.env` or the private key.** Load it only in a subshell: `( set -a; source ./.env; set +a; forge script ... )`.
  - Filter any output that might echo secrets.
  - The deployer had **about 0.033 Sepolia ETH** at the end of Phase 2. See step 6.
- **Git:** create branch `phase-3` from `main` before making changes. **Don't commit or push**; the user commits.

---

## Architecture

```
                 ┌──────────────────┐   latestRoundData
                 │ ChainlinkOracle  │◄──────────────── Chainlink feeds
                 └────────┬─────────┘
                          │ getPrice(market)
┌────────┐ requestIncrease/Decrease  ┌────────────┐  pool accounting calls  ┌───────────────┐
│ Trader │──────────────────────────►│ PerpEngine │────────────────────────►│ LiquidityPool │── holds ALL USDC
└────────┘   (+ ETH execution fee)   └─────▲──────┘   (onlyEngine)          └──────┬────────┘
                                           │ executeRequests / liquidate           │ mint/burn
                                     ┌─────┴──┐                              ┌──────▼──┐
                                     │ Keeper │                              │   CLP   │ LP token
                                     └────────┘                              └─────────┘
LPs ── addLiquidity / removeLiquidity ──► LiquidityPool
```

- **`LiquidityPool` holds every USDC**: LP liquidity, trader collateral, pending-request escrow, and protocol fees, each tracked in its own accounting bucket. `PerpEngine` holds no USDC. It holds only the ETH execution fees of pending requests.
- Files:
  - `src/oracle/ChainlinkOracle.sol`
  - `src/pool/CLP.sol`
  - `src/pool/LiquidityPool.sol`
  - `src/PerpEngine.sol`
  - `src/libraries/PerpMath.sol`
  - `src/interfaces/{IChainlinkOracle,ILiquidityPool,IPerpEngine}.sol`
- **Contract size:** `forge build --sizes` must show every deployable contract under **24,576 bytes**. If `PerpEngine` is too big, move pure maths into `PerpMath` (internal functions) and views into a separate `PerpReader` contract. **Don't turn off the size check.**

---

## Units and precision (use these exactly)

| Quantity | Unit |
|---|---|
| USDC amounts, collateral, `sizeUsd`, fees, PnL | 6 decimals (1 USD = `1e6`) |
| Prices | 8 decimals (`PRICE_PRECISION = 1e8`). Normalise every feed to this |
| Basis points | `BPS = 10_000` |
| Funding rate and funding index | 1e18 fraction of size (`FUNDING_PRECISION = 1e18`) |
| Aggregate "open tokens" (for AUM) | `tokens = sizeUsd × 1e20 / price`, which is 18 decimals of the base asset |

**Rounding always goes against the trader:**
- round profit down
- round losses and fees up
- round LP mint amounts down, and LP redemption amounts down

Use `Math.mulDiv` with `Math.Rounding.Ceil` where rounding up.

---

## Parameters (defaults, all settable by the owner within bounds)

| Name | Default | Bound enforced in the setter |
|---|---|---|
| `maxLeverage` | 20 | `maxLeverage × maintenanceMarginBps < 10_000` |
| `maintenanceMarginBps` | 250 (2.5%) | same as above |
| `positionFeeBps` (charged on both open and close) | 6 | ≤ 100 |
| `liquidationFeeBps` | 50 (0.5%) | ≤ 200 |
| `executionSpreadBps` | 10 (0.1%) | ≤ 100 |
| `maxProfitMultiplier` | 9 (× collateral reserved) | 1–20 |
| `oiCapBps` (per side, per market, as a share of AUM) | 3_000 (30%) | ≤ 10_000 |
| `fundingFactorPerHour` | `3e14` (0.03%/h at skew = AUM) | ≤ `1e16` |
| `maxFundingRatePerHour` | `1e14` (0.01%/h) | ≤ `1e16` |
| `protocolFeeShareBps` | 1_000 (10% of fees to `feeReserves`, the rest to LPs) | ≤ 5_000 |
| `lpMintFeeBps` | 10 (0.1%, stays in the pool) | ≤ 100 |
| `lpCooldown` | 15 minutes | ≤ 1 day |
| `requestExpiry` | 60 s | 10 s – 1 h |
| `minExecutionFee` | 0.0002 ether | ≤ 0.01 ether |
| `minCollateral` | 10 USDC (`10e6`) | — |
| Oracle `maxAge` per feed | 3960 s (heartbeat + 10%) | 60 s – 1 day |

Emit a `ParamUpdated(bytes32 key, uint256 value)` event from every setter.

---

## Formulas: implement in `PerpMath.sol` as pure functions and unit test each one

Notation: `S` = size in USD, `C` = collateral, `E` = entry price, `P` = price, `F` = funding owed, `mm` = maintenanceMarginBps.

1. **Execution price** (spread against the trader; liquidations use the raw oracle price with no spread):
   - Increasing a long, or decreasing a short: `P × (BPS + spread) / BPS`, rounded up
   - Increasing a short, or decreasing a long: `P × (BPS − spread) / BPS`, rounded down
2. **PnL:**
   - long: `S × (P − E) / E`
   - short: `S × (E − P) / E`
   - The result is signed, rounded against the trader.
3. **Average entry price when a position increases:** keep the position's `tokens = Σ sizeDelta × 1e20 / execPrice`, and derive `E = S × 1e20 / tokens`. This keeps PnL exact.
4. **Position fee:** `sizeDelta × positionFeeBps / BPS`, rounded up
5. **Funding:**
   - `rate = min(maxFundingRatePerHour, fundingFactorPerHour × |longOI − shortOI| / AUM)`
   - Only the **heavier side** pays: `cumulativeFunding[market][heavySide] += rate × dt / 3600`
   - A position owes `F = S × (cumulativeFunding[side] − entryFunding) / 1e18`, rounded up
   - Settle `F` into the pool (it is LP revenue) on every update to the position
   - If AUM is 0, the rate is 0
6. **Remaining margin:** `R = C + PnL(P) − F − closeFee(S)`
   - The position is **liquidatable** when `R < S × mm / BPS`, using the raw oracle price
7. **Liquidation price** (a view function; ignores funding that hasn't accrued yet):
   - Let `need = S × mm / BPS + F + closeFee − C`
   - long: `E × (S + need) / S`
   - short: `E × (S − need) / S`
   - If the result is ≤ 0 for a short, return 0
8. **Profit cap:** a position's realised profit is capped at `position.reserved`. When the position opens, reserve `maxProfitMultiplier × collateral`, and adjust the reserve as collateral changes.
9. **Aggregate PnL per market** (feeds into AUM):
   - long: `longTokens × P / 1e20 − longSize`
   - short: `shortSize − shortTokens × P / 1e20`
10. **AUM:** `poolAmount − Σ_markets(aggregateTraderPnl)`, floored at 0
    - Positive trader PnL lowers AUM. Negative trader PnL raises it, capped at the collateral at risk. For v1, clamp **each market's net trader PnL to ≥ −(that market's total collateral)**.
11. **CLP pricing:**
    - on add: `mint = amountAfterFee × supply / AUM`, or `amountAfterFee` 1:1 when supply is 0
    - on remove: `out = clp × AUM / supply`

Also write **`docs/perp-math.md`**. It must list every formula above and **at least 10 worked numeric examples**: long and short, profit and loss, a funding accrual, a liquidation just above and just below the threshold, the liquidation price, the profit cap, and a CLP mint and redeem. The Foundry tests must assert these exact numbers. Phase 4 reuses the same vectors so both chains can be checked for identical results.

---

## Contract specs

### `ChainlinkOracle`
- Owner-managed mapping `bytes32 market → Feed { AggregatorV3Interface feed; uint32 maxAge; uint8 decimals }`, where `market = keccak256("BTC-USD")` and so on.
- `getPrice(bytes32 market) returns (uint256 price1e8)`. It reverts when:
  - the feed is unknown
  - `answer <= 0`
  - `updatedAt == 0`
  - `block.timestamp − updatedAt > maxAge`
  - `answeredInRound < roundId`
- Normalise the answer to 1e8.
- `collateralPrice() returns (uint256)`: returns `1e8` (USDC valued at $1), and is marked `// TODO(mainnet): USDC/USD feed`.

### `CLP`
- ERC20 "Celestial LP" / "CLP", 18 decimals.
- Only the pool can `mint` and `burn` it; the pool address is set once through the constructor or an init function.

### `LiquidityPool`
- **Accounting:**
  - `poolAmount`: LP-owned USDC
  - `reservedAmount`
  - `feeReserves`: the protocol's share of fees
  - `totalCollateral`: all open-position collateral
  - `totalEscrow`: collateral held for pending requests
- **LP functions:**
  - `addLiquidity(uint256 amount, uint256 minClp)`
  - `removeLiquidity(uint256 clpAmount, uint256 minUsdc)`
  - Removal is blocked during `lpCooldown` after the address's last add, and when `poolAmount − out < reservedAmount`.
  - `getAum()` and `getClpPrice()` are views; `getAum` reads prices through the engine or oracle.
- **Engine-only hooks**, named so it's obvious what each one changes:
  - `escrowIn(from, amount)`, `escrowToCollateral`, and `escrowRefund(to, amount)`
  - `collateralOut(to, amount)` and `collateralToPool(amount)`, for losses, fees and funding
  - `poolToTrader(to, amount)`, for profit (capped)
  - `reserve` and `unreserve`
  - `addFees(amount)`, which splits between `feeReserves` and `poolAmount`
- **Owner:** `withdrawFees(to)` sends out `feeReserves` only.
- **Invariant (enforce it in tests):** `usdc.balanceOf(pool) >= poolAmount + feeReserves + totalCollateral + totalEscrow` and `reservedAmount <= poolAmount`.

### `PerpEngine`
- **Markets:** `listMarket(bytes32 market)` by the owner. It checks that the oracle has a feed. Also `setMarketEnabled`.
- **Requests** (one struct, `kind = Increase | Decrease`):
  - `requestIncrease(bytes32 market, bool isLong, uint256 collateralDelta, uint256 sizeDelta, uint256 acceptablePrice) payable`
    - `msg.value` must be at least `minExecutionFee`
    - pulls `collateralDelta` USDC from the user into pool escrow
  - `requestDecrease(bytes32 market, bool isLong, uint256 collateralDelta, uint256 sizeDelta, uint256 acceptablePrice) payable`
    - `sizeDelta == position.size` means a full close
  - `cancelRequest(uint256 id)`: the owner of the request can call it once `block.timestamp ≥ createdAt + requestExpiry`. It refunds the escrow and the execution fee.
- **Execution** (keeper only): `executeRequests(uint256[] ids)`
  - Each request runs through `try this.executeRequestInternal(id)`, an external function guarded by `msg.sender == address(this)`. A single failure must never revert the batch.
  - On failure: cancel the request, refund the escrow, and emit `RequestCancelled(id, reason)`.
  - The keeper gets the execution fee whether the request succeeds or fails.
- **Increase checks:**
  - market enabled
  - `acceptablePrice` respected: for a long, `execPrice ≤ acceptablePrice`; for a short, `≥`
  - `collateral ≥ minCollateral`
  - `size ≥ collateral` (at least 1x)
  - `size ≤ collateralAfterFees × maxLeverage`
  - OI cap per side: `sideOI + sizeDelta ≤ AUM × oiCapBps / BPS`
  - reserve capacity: `reservedAmount + newReserve ≤ poolAmount`
  - the position must not be liquidatable after the increase
- **Decrease:**
  - realise PnL in proportion to `sizeDelta / size`
  - settle funding and take the close fee
  - pay out `collateralDelta ± realised PnL − fees`; profit comes from the pool and is capped by the reserve
  - after a partial decrease, the position must satisfy the leverage and liquidation checks
  - a full close deletes the position and unreserves everything
- **Liquidation:** `liquidate(bytes32 positionKey)`, keeper only in v1
  - keeper fee = `min(S × liquidationFeeBps / BPS, C)`
  - the rest of the collateral goes to the pool, and the reserve is released
  - the trader receives nothing
- **Position key:** `keccak256(abi.encode(trader, market, isLong))`
- **Views:**
  - `getPosition(key)`
  - `getPositionKey(trader, market, isLong)`
  - `getPnl(key)`
  - `getLiquidationPrice(key)`
  - `getMarketInfo(market)`: returns OI long/short, capacity per side, funding rate per side, the cumulative indices, and the oracle price
  - `getRequest(id)`
  - `getPendingRequestIds(user)`
- **Admin:** `Ownable2Step`, `Pausable` (pausing blocks new requests and execution of increases; decreases, cancels and liquidations keep working), `setKeeper(address, bool)`, and the parameter setters.
- **Events for every state change:**
  - `RequestCreated`, `RequestExecuted`, `RequestCancelled`
  - `PositionIncreased`, `PositionDecreased`, `PositionClosed`, `PositionLiquidated`
  - `FundingUpdated`, `ParamUpdated`
  - Include the fields the frontend needs to rebuild history without extra calls.
- Use `nonReentrant` on every external function that changes state. Use `SafeERC20`. Follow checks-effects-interactions. Send ETH with `call` and check the result. Don't use `tx.origin`, `transfer()`, or unbounded loops over user-controlled arrays apart from the keeper batch.

---

## Steps (in order)

1. **Branch:** `git checkout -b phase-3`.
2. **Maths first.** Write `PerpMath.sol` and `docs/perp-math.md`, then `test/PerpMath.t.sol`, which asserts every worked example. Get this green before continuing.
3. **Oracle, CLP and pool**, each with unit tests: `test/ChainlinkOracle.t.sol` and `test/LiquidityPool.t.sol`. Use `MockV3Aggregator` for prices and `vm.warp` for time.
4. **Engine:** `test/PerpEngine.t.sol` must cover:
   - request → execute → open, for long and short
   - increase an existing position (average entry price)
   - partial and full decrease, with profit and with loss
   - the profit cap
   - funding accrual on the heavier side only, and settlement
   - liquidation just below the threshold succeeds and just above reverts `NotLiquidatable`
   - **regression:** opening at exactly `maxLeverage` is **not** liquidatable straight away
   - slippage (`acceptablePrice`) → cancelled and refunded
   - a stale oracle → cancelled and refunded
   - OI cap, reserve cap, and `minCollateral`
   - `cancelRequest` before and after expiry
   - a batch where one request fails and the others succeed
   - only keepers can execute and liquidate
   - pause behaviour
   - SOL-USD can't be listed without a feed, and requests for unlisted markets revert
   - execution fee paid to the keeper; the ETH refund on cancel
5. **Invariants and fuzzing:** `test/invariant/PerpInvariants.t.sol` with a handler that randomly:
   - adds or removes liquidity
   - requests and executes increases and decreases
   - moves prices ±15% within `maxAge`
   - warps time
   - liquidates
   Assert the pool invariants above, plus:
   - CLP supply > 0 ⇒ AUM > 0
   - no user gets back more USDC than deposited + capped profit
   - `totalCollateral` equals the sum of position collaterals (track this in the handler)
   Run with `runs = 256, depth = 100` at minimum, and add a `[profile.ci]` in `foundry.toml` with more runs.
6. **Deploy to Sepolia:**
   - Write `script/DeployPerps.s.sol`. It must:
     - require `chainid == 11155111`
     - deploy the oracle (ETH and BTC feeds, `maxAge` 3960), CLP, LiquidityPool (MockUSDC from `deployments/sepolia.json`), and PerpEngine, and link them
     - list BTC-USD and ETH-USD, and **not** SOL-USD
     - `setKeeper(KEEPER_ADDRESS)`; the env var defaults to the deployer
     - approve the pool and `addLiquidity(5_000_000e6)` from the deployer
   - **Dry-run first (no `--broadcast`).** Read the estimated ETH cost and compare it with the deployer's balance (`cast balance`).
   - **If balance < 1.5 × estimate, STOP** and tell the user how much Sepolia ETH to add. Don't try to cut gas by changing the code.
   - Otherwise run with `--broadcast --verify`, and confirm every contract is verified.
   - **Smoke test on-chain with `cast`:**
     - read `getAum()`; it should be about 5M
     - from the deployer: approve, then `requestIncrease` for ETH-USD long, 100 USDC collateral, 5x, and a generous `acceptablePrice`
     - `executeRequests([id])` as keeper
     - check `getPosition`
     - `requestDecrease` for a full close, execute it, and check the USDC came back minus fees
     - Record the tx hashes.
7. **Record and export:**
   - Update `deployments/sepolia.json` with every new address, the keeper, the seed amount, the verification links, and the smoke-test tx hashes.
   - Export ABIs (the `abi` array only, from `out/`) to `celestial-perps/src/abis/{PerpEngine,LiquidityPool,CLP,ChainlinkOracle,MockUSDC}.json`.
   - Add addresses to `celestial-perps/lib/contracts.ts`, next to `lib/tokens.ts`.
   - **Don't change any frontend UI or behaviour.**
   - Check that `npx tsc --noEmit` still passes in `celestial-perps`.
8. **Docs:**
   - Update `celestial-contracts/README.md` (contracts table, deploy command, parameters).
   - In `phases.md`, tick off the Phase 3 items and write the addresses in.
   - Update `docs/protocol-spec.md` **only** if you had to settle an ambiguity, and list each change in the report.

---

## Checks: everything must pass before you report done

1. `forge build --sizes`: no errors, and every contract under 24,576 bytes
2. `forge test`: everything passes, including the old MockUSDC, NFT and Chainlink smoke tests
3. `forge test --match-path 'test/invariant/*'` passes, and `forge coverage --ir-minimum` shows **≥ 90% line coverage** on `src/PerpEngine.sol`, `src/pool/*`, `src/oracle/*`, and `src/libraries/*`
4. Every contract is deployed and verified on Sepolia, and the on-chain smoke test passed (list the tx hashes)
5. `cd celestial-perps && npx tsc --noEmit` passes
6. `git status` shows only the intended changes, and `.env` is untouched and unprinted

If something outside this scope blocks you, stop and report it. Examples: the RPC is down, verification fails repeatedly, there isn't enough ETH, or a spec formula contradicts itself. **Don't guess on money maths**; ask.

---

## Rules

- Match the existing style: NatSpec headers like `MockUSDC.sol`, custom errors instead of revert strings, and events for every state change.
- Add no new libraries. The vendored OpenZeppelin, Chainlink and forge-std are enough.
- Don't change `MockUSDC`, the legacy vault, the NFT contracts, or already-deployed addresses.
- Don't commit or push. Leave the changes on `phase-3` for the user.

## Final report

1. A checklist per step, with each item marked done, skipped or blocked, and reasons for anything not done
2. The contract addresses with Etherscan links, and the smoke-test tx hashes
3. `forge build --sizes` output for the new contracts, the test summary, and coverage per file
4. Any spec ambiguities you settled, and how you settled them
5. Gas used for deployment and the deployer's remaining ETH
6. Anything the keeper (Phase 5) or frontend (Phase 6) needs to know: event names and fields, request lifecycle, and which views to poll
