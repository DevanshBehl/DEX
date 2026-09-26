# Task: Execute Phase 6: Frontend integration (`celestial-perps/`, Sepolia + Solana devnet)

You are working in the monorepo at `/Users/devanshbehl/Documents/Code/DEx`. Connect the **Celestial Perps trading terminal** (Next.js, `celestial-perps/`) to the two live protocols:
- **Sepolia:** `PerpEngine` / `LiquidityPool` / `CLP` / MockUSDC (Phase 3)
- **Solana devnet:** the `celestial_perps` Anchor program (Phase 4)

The keeper (Phase 5, `celestial-keeper/`) fills orders on both chains. A trader must be able to do all of this in the browser, with either an EVM or a Solana wallet:
- get test USDC
- open a position
- watch live PnL
- close it
- see it in their history

An LP must be able to deposit and withdraw.

Only do Phase 6. **Out of scope:**
- any change to the contracts, the program or the keeper (`celestial-contracts/src`, `celestial-solana/programs`, `celestial-keeper/src`)
- Phase 7 (hardening, monitoring, audits) and Phase 8 (limit orders, pull oracles, mainnet)

If the UI can't work without an on-chain change, **stop and report**. Don't work around it.

Read these before you write any code:
1. `phases.md`, Phase 6 (the "Done when" criteria) and the Phase 3–5 summaries.
2. `docs/protocol-spec.md` and `docs/perp-math.md`. Every number the UI shows must use these exact formulas. The frontend maths must reproduce the `perp-math.md` vectors exactly (Ex 1–9, **and Ex 10 in both its EVM and Solana columns**).
3. **EVM:**
   - `celestial-contracts/src/PerpEngine.sol` and `src/pool/LiquidityPool.sol`, for the function signatures, views, events and custom errors
   - the ABIs in `celestial-perps/src/abis/`
   - `deployments/sepolia.json`
4. **Solana:**
   - `celestial-solana/README.md`: the account map, the **`remaining_accounts` convention**, the views read through `simulateTransaction`, the faucet, and the notes for the frontend
   - `celestial-solana/scripts/client.ts` and `celestial-keeper/src/solana/*`, which are working IDL-based clients
   - the IDL and types in `celestial-perps/src/idl/`
   - `deployments/solana-devnet.json`
5. `celestial-keeper/README.md`: how requests get filled, and the latency to show users (~2 s on Solana, ~1–2 blocks on Sepolia).
6. The current frontend:
   - `app/trade/page.tsx` still calls the **legacy `CelestialVault`**
   - `hooks/useWallet.ts` and `lib/wallet.ts` (EIP-6963 + Wallet Standard discovery)
   - `components/trade/*` (TradeForm, PositionsPanel, MarketInfo, WalletModal, TradeHeader)
   - `lib/*` (contracts, tokens, protocol, oracle, marketData)

If this prompt disagrees with the spec or the deployed code, **the deployed code and the spec win**. Report the disagreement. One disagreement is already known:
- `phases.md` says `@coral-xyz/anchor`, but the IDL is Anchor 1.x format.
- Use **`@anchor-lang/core` 1.1.2** (the same package as Phases 4 and 5; it has a browser build) with `BorshCoder`.
- Don't add `@coral-xyz/anchor`.

---

## Context: current state

- **Toolchain:** Node 24.
  - `celestial-perps` uses **npm** (`package-lock.json`); keep it on npm.
  - The other packages use pnpm. Foundry, solana-cli 3.1.10 and anchor-cli 1.1.2 are installed.
- **Frontend stack:** Next.js 15 (App Router), React 19, Tailwind 4, ethers 6, lightweight-charts. The trade page is `"use client"`.
- **Git:** Phase 5 is merged into `main`.
  - Check `git status` and `git log` first. If the working tree isn't clean, **stop and ask**.
  - Create branch `phase-6` from `main`.
  - **Don't commit or push**; the user commits.

### EVM (Sepolia, chain 11155111)
- **Contracts** (all in `deployments/sepolia.json` and `lib/contracts.ts`):
  - PerpEngine `0x49765B9bEFed004A6462ad2025C240191e762b60`
  - LiquidityPool `0xB2DF5d7C1BCa2d82ECA1D591F0E58B335387b24b`
  - CLP `0x303C…55DA` (18 decimals)
  - ChainlinkOracle `0xFF6a…0cC0`
  - MockUSDC `0x88a7…6cD2` (6 decimals)
- **Markets:** ETH-USD and BTC-USD only (`bytes32` = keccak of the symbol). **SOL-USD is Solana-only**; the UI must say so on EVM, not fail.
- **Trader flow:**
  - **approve USDC to the LiquidityPool** (it holds all USDC), not to the engine
  - `requestIncrease(market, isLong, collateralDelta, sizeDelta, acceptablePrice)` with `value = minExecutionFee` (read it on chain; 0.0002 ETH today)
  - `requestDecrease(...)` works the same way
  - `cancelRequest(id)` is allowed after `requestExpiry` (60 s)
- **Views:**
  - Engine: `getPositionKey`, `getPosition`, `getPendingRequestIds(account)`, `getRequest(id)`, `getLiquidationPrice(key)`, `getPnl`, `getFundingOwed`, `getMarketInfo(market)`
  - LiquidityPool: `getAum`, `getClpPrice`, `availableLiquidity`
- **Faucet:** `MockUSDC.faucet()` (10,000 USDC per 24 h) and `nextClaimAt(user)`.
- **Reads** go through a **read-only JsonRpcProvider** (`NEXT_PUBLIC_SEPOLIA_RPC_URL`). **Writes** go through **the provider of the connected EIP-6963 wallet**, never through `window.ethereum` directly.
  - `hooks/useWallet.ts` currently keeps only the address and reads the balance through `window.ethereum`. Fix that: keep the chosen provider.
- **History:** the engine's events.
  - `account` is an indexed topic on `RequestCreated`/`Executed`/`Cancelled`, `PositionIncreased`/`Decreased`/`Closed`/`Liquidated`.
  - Page `eth_getLogs` from the deploy block **11757411** in ranges the RPC accepts, and cache by block in `localStorage`.
  - Public RPCs cap the range: adapt the way `celestial-keeper/src/evm/keeper.ts` `syncPositions` does.

### Solana (devnet)
- **Program** `EK1KpDGfUiZ4XkWixAaRFonDexZYSKnJm8oJz5s7HLTL`.
  - PDAs, markets and the market order are in `deployments/solana-devnet.json` and `lib/contracts.ts`.
  - **Read the market order from `Config` on chain**; don't hard-code it.
  - USDC and CLP are **Token-2022** mints (6 decimals each).
- **Trader flow:**
  - `request_increase(nonce, is_long, collateral_delta, size_delta, acceptable_price, execution_fee)`
    - `nonce` must equal `UserState.request_nonce` (0 for a new user)
    - the execution fee is ≥ `Config.min_execution_fee_lamports` (50,000)
    - when the position doesn't exist yet, the trader also prepays its rent (~0.00185 SOL), which is refunded on close
    - **show this in the order summary**
  - `request_decrease(...)` works the same way.
  - `cancel_request` is allowed after 60 s.
- **Instructions that need every market and its oracle** as `remaining_accounts` in `Config.markets` order: `add_liquidity`, `remove_liquidity`, `get_aum`, `get_clp_price` and `get_market_info`.
  - A missing or reordered entry fails with `InvalidMarketAccounts`.
- **Views:** `get_aum`, `get_clp_price`, `get_liquidation_price` and `get_market_info` return data through **`simulateTransaction`** (read `returnData`); see `celestial-solana/scripts/client.ts` `view()`.
- **Faucet:** `faucet()`, 10,000 USDC per 24 h. The cooldown is `UserState.last_faucet_at`, and it creates the ATA itself.
- **Signing:**
  - Use the Wallet Standard `solana:signTransaction` and **submit through the app's own devnet `Connection`** (`NEXT_PUBLIC_SOLANA_RPC_URL`). The wallet's selected cluster then doesn't matter.
  - Fall back to `solana:signAndSendTransaction` with `chain: "solana:devnet"` only when `signTransaction` isn't available.
  - The repo's own Celestial wallet (`celestial-react-wallet`) supports `solana:signTransaction`, `solana:signAndSendTransaction`, `standard:events` and `solana:devnet`.
- **Pending requests:** `getProgramAccounts` with a `memcmp` on the `Request` discriminator plus `memcmp` owner at offset 8.
- **Positions:** the PDA `["position", owner, market, [is_long]]` for each market and side; use one `getMultipleAccountsInfo`.
- **History:** `getSignaturesForAddress(owner)` (the owner is an account in `execute_request` and `liquidate`, so fills are included). Then `getTransaction` for the program's transactions, decoding events with `BorshCoder(idl).events`.
- **The public devnet RPC lags and rate-limits** (see the Phase 5 findings):
  - read with `minContextSlot` = the last slot the app saw confirmed
  - back off on 429
  - confirm by polling `getSignatureStatuses` with backoff; don't rely on websockets
  - document `NEXT_PUBLIC_SOLANA_RPC_URL`, and recommend a dedicated endpoint

---

## Design

### 6a. Chain layer (`lib/chains/`)

- **One interface**, `lib/chains/types.ts`, implemented by `lib/chains/evm.ts` and `lib/chains/solana.ts`.
  - The UI imports only the interface and a `getChain(wallet)` factory.
  - Suggested shape (adapt it, but keep one interface):

  ```ts
  interface PerpsChain {
    id: "sepolia" | "solana-devnet";
    markets: MarketId[];                       // EVM: ETH, BTC · Solana: from Config
    getMarketInfo(m): Promise<MarketInfo>;     // oracle price+age, OI, capacity, funding, max leverage, fees
    getPool(): Promise<PoolInfo>;              // AUM, CLP price, available liquidity, CLP supply/decimals
    getUsdcBalance(owner), getClpBalance(owner), getNativeBalance(owner)
    getPositions(owner): Promise<Position[]>;  // size, collateral, entry, mark, pnl, liq price, funding owed, reserved
    getPendingRequests(owner): Promise<PendingRequest[]>;
    getHistory(owner, opts): Promise<HistoryItem[]>;
    faucetStatus(owner): Promise<{ canClaim: boolean; nextClaimAt?: number }>;
    // writes: return a handle the UI can track (submitted → pending keeper → filled | cancelled)
    requestIncrease(p), requestDecrease(p), cancel(requestId), addLiquidity(amount, minClp),
    removeLiquidity(clp, minUsdc), faucet(), approveIfNeeded(amount)   // approve: EVM only, no-op on Solana
    trackRequest(handle): AsyncIterable<OrderState> | subscribe(cb)    // poll until filled/cancelled (+ reason)
  }
  ```

- **Maths:**
  - Port `celestial-keeper/src/math.ts` to `lib/perpMath.ts`: bigint, same rounding, plus the CLP functions.
  - `lib/perpMath.test.ts` asserts every `perp-math.md` vector (Ex 1–10, both CLP columns).
  - It must run with `node --test lib/perpMath.test.ts` on Node 24 (built-in type stripping) or with an added `tsx` dev dependency.
- **Money is bigint** in the chain layer. Convert to `number` only for display (`lib/format.ts`). Never do money maths in floats.
- **Choose the chain from the connected wallet:** an EVM wallet → Sepolia, a Solana wallet → devnet. Read-only market data (oracle price, OI) shows even without a wallet, for the chain of the selected market; SOL-USD always uses Solana.
- **Network guard (EVM):**
  - If `eth_chainId` isn't `0xaa36a7`, call `wallet_switchEthereumChain` (then `wallet_addEthereumChain` if unknown).
  - **Block every write** until the chain is right, and show a clear banner.
  - React to `chainChanged` and `accountsChanged` on the **selected** EIP-1193 provider.
- **Network guard (Solana):** always use the devnet `Connection`. React to Wallet Standard `standard:events` `change` (account switched or disconnected).
- **Errors:** decode revert reasons and program errors into readable messages.
  - EVM: `engine.interface.parseError`, `pool.interface.parseError`, and the ERC20 errors (for example `InsufficientExecutionFee`, `RequestNotExpired`, `CooldownActive`, `InsufficientUnreservedLiquidity`, `Slippage`, allowance and balance).
  - Solana: Anchor error codes from the IDL `errors` array (for example `Paused`, `MarketDisabled`, `InsufficientExecutionFee`, `FaucetCooldown`, `CooldownActive`).
  - Map user rejection to "Rejected in wallet". **Never show a raw stack trace** to the user.

### 6b. Trade flow (`components/trade/TradeForm.tsx`, `app/trade/page.tsx`)

- **Remove the legacy vault path completely:** `LEGACY_VAULT_*` in `lib/protocol.ts`, the `CelestialVault` import and call in `app/trade/page.tsx`, and the ETH-collateral maths in `TradeForm`.
  - Delete `src/abis/CelestialVault.json` only if nothing else imports it.
- **Inputs:**
  - USDC collateral, with the wallet's USDC balance and 25/50/75/100% buttons
  - a leverage slider, 1–20x (read `maxLeverage` from chain)
  - a slippage setting (default 0.5%)
  - **Size = collateral × leverage**; there's no separate size input (Phase 1 decision)
- **EVM approve step:**
  - Show "Approve USDC" when the allowance to the **LiquidityPool** is less than the collateral. After approval, the button becomes "Open Long/Short".
  - Also offer "Approve max". Default to the exact amount.
- **Order summary**, computed with `lib/perpMath.ts` from the live oracle price:
  - size
  - estimated entry (oracle ± 0.1% spread)
  - acceptable price (entry ± slippage)
  - **liquidation price** (formula 7 with collateral after the open fee)
  - open fee (0.06% of size)
  - execution fee (ETH, or SOL plus the one-time position rent on Solana)
  - current funding for the side, per hour
  - the remaining OI capacity for the side
- **Pre-flight checks before sending** (show inline errors; don't send):
  - min collateral (10 USDC)
  - leverage ≤ max
  - size ≤ capacity
  - enough USDC and enough native gas
  - market enabled, protocol not paused, oracle fresh
- **Order states:** `submitted` (tx hash / signature) → `pending keeper` (request id / PDA; show elapsed seconds) → `filled` (execution price, fee) or `cancelled` (the decoded reason: slippage, stale price, OI cap…).
  - Link each transaction to the right explorer: `sepolia.etherscan.io/tx/…` or `explorer.solana.com/tx/…?cluster=devnet`.
- Show the expected wait: "usually ~2 s" on Solana, "1–2 blocks (~12–24 s)" on Sepolia.

### 6c. Positions and history (`components/trade/PositionsPanel.tsx`)

- **Positions table** (read from chain, refreshed every ~5 s and after any fill):
  - market, side, size, collateral, entry price, mark price, **unrealised PnL** (net of the close fee and funding owed), liquidation price, funding paid or owed, leverage
  - **Mark price** is the oracle price. The Coinbase ticker may be shown as a live estimate between oracle updates, **clearly labelled**. PnL at the oracle price is the number that matters.
- **Actions:**
  - **Close** (full `requestDecrease` of the whole size)
  - **Partial close** (% of size)
  - **Add collateral** (`requestIncrease` with `sizeDelta = 0`)
  - **Remove collateral** (`requestDecrease` with `sizeDelta = 0`, `collateralDelta = x`; block anything that would breach max leverage or the liquidation check, using the maths)
- **Pending requests list:** type, market, side, amounts, age, and a **Cancel** button that is enabled only once `now ≥ createdAt + requestExpiry`.
- **Order history** from events:
  - requests created, executed and cancelled (with reason)
  - position increased or decreased (execution price, realised PnL, fee, funding)
  - closed, liquidated
  - Newest first, with explorer links. Paginate or cap it; don't fetch the whole chain on every render.

### 6d. Pages and panels

- **`MarketInfo` panel:** connect the Phase 1 placeholders to `getMarketInfo` / `getPool`:
  - pool liquidity available
  - long and short OI with the skew bar
  - capacity per side
  - funding per hour for longs and shorts
  - oracle price and its age, plus the gap to the Coinbase index
  - max leverage and the fees
- **`/earn` (new):** add and remove liquidity.
  - Show pool AUM, CLP price, the user's CLP balance, share and USD value, and available (unreserved) liquidity.
  - Show a fee-based APR estimate: `FeesAdded.to_pool` over the last 7 days ÷ AUM × 52. Label it as an estimate.
  - Add: the amount, the 0.1% mint fee, and the CLP expected with `minClp` slippage protection.
  - Remove: the CLP amount, the USDC expected with `minUsdc`, **the 15-minute cooldown countdown**, and a clear message when reserved liquidity blocks the withdrawal.
  - It works on both chains. **CLP has 18 decimals on EVM and 6 on Solana.**
- **Faucet:** a "Get test USDC" button in the header when a testnet wallet is connected. It shows the cooldown (next claim time) and works on both chains.
- **Navigation:**
  - the landing page CTA links to `/trade` (already done; keep it)
  - add a link to `/earn` in the landing header and the trade header

### UI rules

- Keep the existing visual style: dark terminal UI, Tailwind 4, lucide icons, and the existing `components/trade/ui.tsx` primitives. **Don't redesign** anything; this phase is about wiring.
- Every async read shows loading and error states, and nothing blanks the whole page when one RPC fails.
- Poll gently:
  - positions / market info every 5 s
  - pending orders every 1.5 s **only while one is pending**
  - no polling when the tab is hidden (`document.visibilityState`)
- No new heavy dependencies. Allowed: `@solana/web3.js` 1.x, `@solana/spl-token`, `@anchor-lang/core` 1.1.2 (browser build; `BorshCoder` only). **Justify every other dependency** in the report.
  - `@solana/web3.js` needs `Buffer` in the browser: import it from `buffer` where it's used, or polyfill it once in a client-only module. Don't rely on Node globals.
- **Env:** document `NEXT_PUBLIC_SEPOLIA_RPC_URL` and `NEXT_PUBLIC_SOLANA_RPC_URL` in `celestial-perps/.env.example`.
  - They're public values. **Never put a key that must stay secret into a `NEXT_PUBLIC_*` variable**; say this in the example file.

---

## Steps (in order)

1. **Preflight:** clean `git status` on `main`, then branch `phase-6`.
   - Check that the protocols respond: `nextRequestId`, `getMarketInfo` for ETH on EVM, and `Config` plus 3 markets on Solana. Check that the keeper is running, or ask the user to start it with `cd celestial-keeper && pnpm keeper`.
   - Without a keeper, orders stay pending. Stop and ask rather than faking fills.
2. **Maths:** write `lib/perpMath.ts` and its tests. Every vector must match **before step 3**.
3. **Chain layer:** `lib/chains/{types,evm,solana}.ts`, plus the wallet-provider plumbing in `hooks/useWallet.ts` (keep the selected EIP-1193 provider and the Wallet Standard wallet object, plus the event listeners).
4. **Chain-layer integration tests without a browser** (`celestial-perps/test/`):
   - Drive `lib/chains/*` with test signers against the **local** environments from Phase 5:
     - **Anvil** with the Phase 3 contracts
     - **`solana-test-validator`** with the mock-oracle build
   - Run the **keeper in-process** to fill orders; reuse or import `celestial-keeper/test/support/*` and `startKeeper`.
   - Cover, on **each** chain:
     - faucet (Solana through the program; on Anvil through `MockUSDC.faucet`)
     - approve (EVM)
     - open → filled
     - `getPositions` shows it with the exact Ex 1 numbers
     - partial close, add collateral, remove collateral
     - full close
     - `getHistory` lists every step
     - cancel after expiry
     - slippage → cancelled with the reason decoded
     - add and remove liquidity (cooldown respected)
   - Add a script such as `npm run test:chain`. Signers are test keys only, and a small signer adapter replaces the browser wallet.
5. **UI:** trade form, order tracker, positions, history, MarketInfo, `/earn`, faucet button, network guard, error mapping. Remove the legacy vault code.
6. **Build checks:** `npx tsc --noEmit` and `npm run build` must both pass, with no new lint errors (`npm run lint` if it's configured).
7. **Browser verification on live Sepolia and devnet, with the keeper running:**
   - Use the browser automation you have (Claude in Chrome, if available) or give the user an exact manual checklist and ask for the results. **Don't claim a flow works without having seen it work.**
   - For **each** chain, with a **fresh** test wallet (MetaMask or Celestial on EVM; Phantom or Celestial on Solana):
     - connect
     - network guard (EVM: start on another chain)
     - faucet
     - approve (EVM)
     - open a 100 USDC 5x long
     - see "pending keeper" then "filled"
     - see the position with live PnL
     - partially close, then fully close
     - see the history
     - on `/earn`, add liquidity and see the cooldown
     - trigger one error on purpose (for example a second faucet claim) and see the readable message
   - Record the transaction hashes and signatures, and take screenshots or a GIF of the main flow.
   - Don't use the deployer or keeper keys as the test wallet.
8. **Docs:**
   - Update `celestial-perps/README.md` (or create a section): env vars, chain support, how the chain layer works, and how to run the tests.
   - Tick off Phase 6 in `phases.md` and list the deviations.
   - Update `lib/protocol.ts` comments: no more "until Phase 6".

---

## Checks: everything must pass before you report done

1. `lib/perpMath.test.ts`: every `perp-math.md` vector (Ex 1–10) matches exactly.
2. `npm run test:chain`: every scenario passes on both local chains, with the keeper filling orders.
3. `npx tsc --noEmit` and `npm run build` pass in `celestial-perps`. `celestial-keeper` and `celestial-solana` tests are unaffected (don't change them; run `pnpm test` in `celestial-keeper` to confirm).
4. **Live**, on each chain, a fresh wallet completes: faucet → open → filled → live PnL → close → history. An LP deposits and sees their share. All of this is shown with transaction hashes and signatures plus screenshots or a GIF, or with the user's confirmed checklist.
5. There are no references to `CelestialVault` or `LEGACY_VAULT` left in `app/`, `components/`, `hooks/` or `lib/`.
6. `git status` shows only intended files: no `.env.local`, keys, `.next/`, `node_modules`, test ledgers or logs.

If something outside this scope blocks you, **stop and report**. Examples:
- a wallet that can't sign what's needed
- an RPC that can't serve logs or program accounts at all
- the keeper not running
- a contract or program behaviour the UI can't express

Don't guess on money maths, and don't change on-chain code.

---

## Rules

- **No on-chain changes:** no contract, program or keeper edits, and no redeploys.
- **Keys:** the browser never sees a private key. It signs only through the connected wallet. Test keys for `test:chain` are local, throwaway ones (Anvil's dev keys, generated Solana keypairs). **Never** use or print the deployer or keeper keys.
- **Money maths is bigint**, with the same rounding as `perp-math.md`. Floats are for display only.
- **Minimal dependencies**, each justified.
- **Keep the existing design;** wire it up, don't restyle it.
- Don't commit or push. Leave everything on `phase-6`.

## Final report

1. A checklist per step, each item marked done, skipped or blocked, with reasons
2. Test summaries: maths vectors, `test:chain` per chain, `tsc` / `build`
3. The live verification on each chain: wallet used, transaction hashes and signatures per step, fill latency seen in the UI, and screenshots or a GIF (or the user-confirmed checklist)
4. The dependencies added, and why
5. Deviations from `phases.md` Phase 6 and from this prompt, and any on-chain improvement the UI would benefit from (report only). Examples: an EVM request id returned in a friendlier way, or an event carrying the realised PnL after funding.
6. Notes for Phase 7 (hardening): RPC limits seen, error cases not yet handled, and performance (bundle size of the Solana libraries, polling load)
