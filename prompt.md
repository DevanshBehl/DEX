# Task: Execute Phase 0 and Phase 1 of the Celestial Perps plan

You are working in the monorepo at `/Users/devanshbehl/Documents/Code/DEx`. Carry out **Phase 0, then Phase 1** from `phases.md`, in that order. Do not start Phase 1 until every Phase 0 check passes. Do **not** start Phase 2 or later. The contracts, mock USDC, the Solana program, and the keeper are out of scope.

Read `phases.md` first, especially the "Shared protocol spec" section. This prompt adds the detail you need for Phases 0 and 1.

> **Revised 2026-09-22.** Pyth Hermes and Benchmarks now require a paid API key (they return 401), so this project uses **Chainlink** for on-chain prices and the **Coinbase Exchange public API** for the chart. Both are free and need no key. The endpoints below were checked with live requests.

---

## Context: current state of the code

- `celestial-perps/`: Next.js 15, React 19, Tailwind v4, TypeScript. Dependencies: `ethers` v6, `lightweight-charts` v5, `lucide-react`, `gsap`.
  - `app/page.tsx`: the landing page. **Do not restyle it.** It uses its own light "Mist Liquid Glass" theme. The only change allowed is the CTA link in Phase 1d.
  - `app/trade/page.tsx`: about 1,420 lines in a single file. It contains:
    - wallet connection: EIP-6963 for EVM and Wallet Standard for Solana, plus disconnect, copy address, and ETH balance. **This must keep working unchanged.**
    - Binance market data: `BINANCE_REST` and `BINANCE_WS`, the kline REST call and WebSocket inside `PriceChart`, the `@depth20@100ms` order book WebSocket, and the `ticker/24hr` REST call
    - order book UI: `BookRow`, `BookSkeleton`, `processDepth`, and the order book section
    - mock data: `STATS` (the funding value is hardcoded) and `POSITION` (a hardcoded positions row)
    - the trade form: side, market/limit, collateral (ETH), size, leverage (1–50), summary (liquidation price, fees and slippage are hardcoded), and `executeTrade`, which calls the old `CelestialVault` on Sepolia
    - dead UI: the `TIMEFRAMES` buttons change state, but the chart always shows 1m
  - `src/abis/CelestialVault.json`: the ABI for the old vault at `0x786f4037924772c79F39D49C302dC3D3eDd14b04` (Sepolia)
- `celestial-contracts/`: Foundry project (solc 0.8.24, `via_ir`), with `src/CelestialVault.sol`, `script/DeployVault.s.sol`, the `test-nfts/` contracts, and `TestNFTs.t.sol`
  - **Libraries in `lib/` are vendored as plain files tracked in the parent repo, not as working git submodules.** Check with `git ls-files celestial-contracts/lib | head` and follow the same pattern.
  - `.env` holds real secrets. **Never read, print, modify, or commit it.**
  - The file `celestial-contracts/RECIPIENT=0x11F27CD68B72a81A192E4ec2672870084607c3B1` is an empty stray file, left by a broken shell command.
- Git: branch `main`. **Create a branch `phase-0-1` before making any change. Do not commit, push, or open a PR unless the user asks.**

---

## Phase 0: Cleanup and groundwork

Do these steps in order.

1. **Branch.** Run `git checkout -b phase-0-1`.
2. **Stray file.** Confirm the file is empty (`wc -c`), then delete `celestial-contracts/RECIPIENT=0x11F27CD68B72a81A192E4ec2672870084607c3B1`.
3. **Archive the legacy vault.**
   - Move `src/CelestialVault.sol` to `src/legacy/CelestialVault.sol`, and update the import in `script/DeployVault.s.sol` to match.
   - Add a header comment to both files: `DEPRECATED — superseded by PerpEngine/LiquidityPool (see phases.md). Sepolia deployment 0x786f…4b04 is no longer maintained.`
   - **Keep `celestial-perps/src/abis/CelestialVault.json` and `executeTrade` as they are.** The frontend keeps using the old vault until Phase 6. Do not break it.
   - `forge build` must still succeed.
4. **Chainlink oracle library.** It's already vendored at `lib/chainlink-brownie-contracts` with the `@chainlink/` remapping.
   - Prove it resolves: add `test/ChainlinkSmoke.t.sol`, which imports `AggregatorV3Interface` and `MockV3Aggregator` (`@chainlink/contracts/src/v0.8/tests/MockV3Aggregator.sol`) and checks the answer, decimals, `updatedAt`, and a new round.
   - Run `forge test --match-path test/ChainlinkSmoke.t.sol`.
5. **Solana toolchain check. Do not install anything.**
   - Run `solana --version`, `anchor --version`, `rustc --version`, and `avm --version`.
   - Report which tools are missing, with the official install commands. Installing tools and creating keypairs are the user's decisions, so **do not run installers** and **do not generate keypairs**.
6. **Env templates.**
   - Update `celestial-contracts/.env.example`: keep `SEPOLIA_RPC_URL`, `PRIVATE_KEY`, and `ETHERSCAN_API_KEY`, and add `CHAINLINK_ETH_USD_SEPOLIA` and `CHAINLINK_BTC_USD_SEPOLIA` with the addresses from `phases.md`, plus a note that Sepolia has no SOL/USD feed.
   - Create `celestial-perps/.env.example` with `NEXT_PUBLIC_MARKET_REST_URL=https://api.exchange.coinbase.com` and `NEXT_PUBLIC_MARKET_WS_URL=wss://ws-feed.exchange.coinbase.com`.
   - Make sure `celestial-perps/.gitignore` ignores `.env*.local` but not `.env.example`.
7. **Docs.**
   - Create `docs/protocol-spec.md` at the repo root. Copy the "Shared protocol spec" section of `phases.md` into it word for word, and add a short "Source of truth for both chains" preamble.
   - Replace the default Foundry `celestial-contracts/README.md` with project docs: what each contract is, that the legacy vault is deprecated, how to build and test, and the deploy command for `DeployVault`, noting it is legacy.

**Phase 0 check. All of these must pass before Phase 1:**
- `cd celestial-contracts && forge build && forge test` passes, including the NFT tests and the Chainlink smoke test
- `cd celestial-perps && npx tsc --noEmit` passes. The frontend was not touched, so this should not change.
- `git status` shows only the changes intended above, and `.env` is untouched

---

## Phase 1: Frontend, Coinbase + Chainlink instead of Binance, remove the order book

Work only in `celestial-perps/`. **Keep the existing dark trade-terminal look**: the colours, the `PANEL` style, and the green/red accents. The only layout change is the order book column becoming the Market Info panel.

### 1.0 Split `app/trade/page.tsx` before changing behaviour

Move code out without changing what it does, so the diff for the behaviour changes stays readable. Suggested layout:
```
celestial-perps/
  lib/marketData.ts        Coinbase products, candles (REST), ticker (WebSocket), timeframe mapping
  lib/oracle.ts            Chainlink Sepolia feed addresses + read-only latestRoundData via a public RPC
  lib/protocol.ts          protocol constants mirrored from docs/protocol-spec.md
  lib/format.ts            fmtPrice, fmtUsd, etc.
  lib/wallet.ts            wallet types (Eip1193Provider, Eip6963ProviderDetail, StandardWallet, …)
  hooks/useLivePrice.ts    Coinbase ticker subscription
  hooks/useOraclePrice.ts  Chainlink oracle polling
  hooks/useWalletDiscovery.ts   (optional: EIP-6963 + Wallet Standard discovery effect)
  components/trade/PriceChart.tsx
  components/trade/MarketInfo.tsx
  components/trade/TradeForm.tsx
  components/trade/PositionsPanel.tsx
  components/trade/WalletModal.tsx, AccountMenu.tsx, Stat.tsx, SummaryRow.tsx …
  app/trade/page.tsx       composition + shared state only
```
Use the existing `@/` alias (check `tsconfig.json`). After the split, run `npx tsc --noEmit` and **confirm the page still behaves the same** before continuing.

### 1a. Market data: Coinbase (chart and index price) and Chainlink (oracle price)

**Coinbase Exchange public API.** It needs no key, CORS is `*`, and it works in the US. Product IDs match our market IDs: `BTC-USD`, `ETH-USD`, `SOL-USD`.
- **Candles:** `GET ${REST}/products/<id>/candles?granularity=<seconds>`
  - Returns up to about 350 rows of `[time, low, high, open, close, volume]`, **newest first**. Reverse them before `setData`.
  - Supported granularities are 60, 300, 900, 3600, 21600, and 86400. **There is no 14400 (4H)**, so build 4H bars from 1H candles, aligned to UTC 4-hour boundaries.
  - Timeframe mapping: `1m→60`, `5m→300`, `15m→900`, `1H→3600`, `4H→3600 aggregated ×4`, `1D→86400`.
- **Wire up the timeframe buttons.** `PriceChart` takes `marketId` and `timeframe`, refetches when either changes, then calls `setData` and `fitContent`. Ignore responses from superseded requests using the existing `cancelled` flag pattern.
- **Live ticker:** `new WebSocket("wss://ws-feed.exchange.coinbase.com")`. On open, send `{"type":"subscribe","product_ids":[id],"channels":["ticker"]}`.
  - Messages have `type: "ticker"`, `price`, `open_24h`, `time` (ISO string), `best_bid`, and `best_ask`. Ignore the `subscriptions` message.
  - Add a `useLivePrice(marketId)` hook that returns `{ price, open24h, time, status: "connecting" | "live" | "stale" | "error" }`. Mark it stale when there has been no tick for 15 s.
  - Close the socket on unmount or market change. Reconnect with backoff (1, 2, 4 … 30 s), and never keep two sockets open for the same hook.
- **Live candle from ticks.** `bucketStart = floor(tickTime / bucketSeconds) × bucketSeconds`. For 4H, use 14400. For the same bucket, update high, low and close. Otherwise add a bar with `open = previous close`. Never send a bar older than the last one to `series.update()`, because lightweight-charts throws.

**Chainlink oracle price (Sepolia, read-only).** This is the price trades fill at.
- `lib/oracle.ts`:
  - ETH-USD `0x694AA1769357215DE4FAC081bf1f309aDC325306` and BTC-USD `0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43`, 8 decimals
  - SOL-USD has **no Sepolia feed**, so it's `null`
- Read it with `ethers.JsonRpcProvider` pointed at a public Sepolia RPC. Use `NEXT_PUBLIC_SEPOLIA_RPC_URL`, defaulting to `https://ethereum-sepolia-rpc.publicnode.com`, and add it to `.env.example`.
- Call `latestRoundData()`. Poll every 30 s.
- `useOraclePrice(marketId)` returns `{ price, updatedAt, status }`. Mark it stale if `now − updatedAt > 3960 s`, which is the heartbeat plus 10%.

**Header stats.**
- **Price**: the live Coinbase price. Keep the existing up/down colour logic.
- **24h change**: `(price − open_24h) / open_24h` from the ticker. Before the first tick, seed it from `GET ${REST}/products/<id>/stats` (`open` and `last`).
- **Remove "24h Volume"**, because it would be Coinbase's volume, not ours. Replace it with **"Oracle"**: the Chainlink price, or `—` for SOL.
- **Funding**: `—` until Phase 6. Remove `STATS`.
- **Live/Sync indicator**: driven by `useLivePrice().status`.

**Remove Binance completely.** Delete `BINANCE_REST`, `BINANCE_WS`, the kline/depth/ticker code, `DepthLevel`, and the Binance `symbol` values. When you're done, `grep -ri binance celestial-perps --include=*.ts --include=*.tsx` must return nothing. Ignore `node_modules` and `.next`.

### 1b. Replace the order book with `MarketInfo`

- Delete `BookRow`, `BookSkeleton`, `processDepth`, the depth WebSocket effect, the bids/asks state, and the spread strip.
- Add a `components/trade/MarketInfo.tsx` panel in the same grid column, with the same classes (`order-3 … lg:col-span-2`). It gets its data through a typed prop:
  ```ts
  type MarketInfoData = {
    oraclePrice: number | null; oracleUpdatedAt: number | null; indexPrice: number | null;
    poolLiquidityUsd: number | null;
    longOiUsd: number | null; shortOiUsd: number | null;
    longCapacityUsd: number | null; shortCapacityUsd: number | null;
    fundingLongPerHour: number | null; fundingShortPerHour: number | null;
    maxLeverage: number; openFeeBps: number;
  };
  ```
- Only `oraclePrice`, `oracleUpdatedAt`, and `indexPrice` are live in Phase 1. Every pool, OI, and funding field is `null` and shows `—`, with a small muted "Available after pool launch" note. Take `maxLeverage = 20` and `openFeeBps = 6` from a constants file (`lib/protocol.ts`) that mirrors `docs/protocol-spec.md`.
- Put the oracle price in large, prominent type where the spread strip used to be, with "Chainlink · updated Xm ago" underneath and the gap from the Coinbase index price (`index − oracle`, in % terms). For SOL-USD, show "No Sepolia oracle".
- Show a long/short OI skew bar, rendered as a neutral 50/50 placeholder while the values are null.

### 1c. Trade form and mock cleanup

- **Remove the `POSITION` constant.** The positions tab shows an empty state ("No open positions"), styled like the existing "No order history yet" state. Keep the table header markup so Phase 6 can fill it in.
- **Remove the "Size" input** and the `size` state. Add a read-only "Position size" row to the order summary: `collateral × ETH price × leverage`. Until Phase 2 moves collateral to USDC, the ETH price comes from the ETH-USD Chainlink oracle, which is what the old vault uses. Always read ETH-USD for this, or show `—` if it isn't available.
- **Hide the Limit order type.** Remove the market/limit toggle and the `limitPrice` state. Market is the only order type.
- **Leverage**: the slider range becomes 1–20. The presets become `[2, 5, 10, 15, 20]`. The default stays at 10. The tick labels become `1x · 10x · 20x`. `levPct` uses `/ (20 - 1)`.
- **Summary rows**: replace the hardcoded values.
  - Entry price = oracle price (Chainlink), because that is what the contract fills at
  - Liquidation price = `—` with the tooltip/title "Calculated on-chain after launch"
  - Fees = `size × 0.06%`, calculated
  - Remove the Slippage row
- **SOL-USD guard.** The old vault rejects SOL-USD, so while SOL-USD is selected, disable the Execute button with the label "SOL-USD trading opens with the new engine". The chart and Market Info still work for SOL. This prevents the known failure where the deposit succeeds, the open reverts, and the ETH is stuck in the vault.
- **Leave everything else in `executeTrade` unchanged.** The two-step old-vault flow and the provider handling are replaced in Phase 6. Keeping the old flow while the maximum is 20x is fine, because the old contract allows up to 50x.

### 1d. Landing CTA

- In `app/page.tsx`, find the primary "Launch App" or "Trade" style CTA(s). Most are `href="#"` today, around lines 305, 731, and 750.
- Point only the main trading CTA at `/trade` using `next/link`, and leave the other anchors alone.
- Change nothing else on the landing page.

---

## Phase 1 check: all must pass

1. `cd celestial-perps && npx tsc --noEmit` shows no errors.
2. `npm run build` succeeds. If `next lint` is set up, it has no new errors.
3. The `grep -ri binance` check above returns nothing.
4. **Runtime check.** Start `npm run dev` in the background and open `/trade`. Use the browser tools if they're available; otherwise use `curl` and the dev-server logs. Confirm that:
   - candles load for BTC, ETH, and SOL, and each of the 6 timeframes shows correctly spaced bars
   - the live price ticks and the last candle updates
   - the Market Info panel shows the oracle price and confidence, and the other fields show `—`
   - the Network tab or logs show no requests to `binance.com`
   - wallet connect and disconnect still work for EVM and Solana, and the ETH balance still shows
   - the SOL-USD Execute button is disabled with the message above
   - stop the dev server when you're done
5. `forge build && forge test` in `celestial-contracts` still passes.

If a check fails, fix it and run the check again. If something outside this scope blocks you, for example Coinbase or the Sepolia RPC returning a different response shape, stop and report it. Don't guess.

---

## Rules

- Match the existing code style: Tailwind arbitrary values, `lucide-react` icons, and small comment headers like the ones already in `page.tsx`.
- Add **no** new npm dependencies. Native `EventSource` and `fetch` are enough. If you think one is needed, stop and ask.
- Don't change `CelestialVault` logic, the deployed addresses, `.env`, or the NFT contracts.
- Don't commit. Leave the changes on the `phase-0-1` branch for review.

## Final report

When both phases are done, reply with:
1. A checklist for each phase, with every item marked done, skipped, or blocked, and a reason for anything not done
2. The files created, moved, deleted, and modified (`git status --short`)
3. The output of every check command, summarised as pass or fail, with the error text for any failure
4. Solana toolchain status and the install commands the user still needs to run
5. Anything you found that affects Phase 2 or later
