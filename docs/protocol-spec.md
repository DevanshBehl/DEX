# Celestial Perps — Protocol Spec

> **Source of truth for both chains.** The EVM contracts (`celestial-contracts/`) and the Solana program (`celestial-solana/`) must implement exactly these parameters and rules. Change a value here first, then in both implementations. The frontend mirrors the constants in `celestial-perps/lib/protocol.ts`.

## Parameters

Exact formulas, rounding rules and cross-chain test vectors are in [`perp-math.md`](perp-math.md).


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
