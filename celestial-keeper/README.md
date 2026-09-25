# celestial-keeper — Celestial Perps keeper (Sepolia + Solana devnet)

A single Node/TypeScript process that runs both deployed protocols:

- `PerpEngine` on Sepolia (`../celestial-contracts`)
- `celestial_perps` on Solana devnet (`../celestial-solana`)

It does three jobs per chain:

1. **Execute** pending order requests.
2. **Liquidate** under-margined positions.
3. **Update funding** hourly.

Prices come from Chainlink push feeds that anyone can read, so the keeper never fetches or pays for price updates.

## Setup

```bash
pnpm install
cp .env.example .env      # then fill it in (gitignored)
```

| Variable | Notes |
|---|---|
| `SEPOLIA_RPC_URL` | Must support `eth_getLogs` (Alchemy, Infura, …). May contain an API key, which is never logged |
| `EVM_KEEPER_PRIVATE_KEY` | Key of a whitelisted `PerpEngine` keeper (`isKeeper`). Only the derived address is logged. Startup fails if it doesn't match `EVM_EXPECTED_KEEPER` (defaults to `deployments/sepolia.json`) |
| `SOLANA_RPC_URL` | Defaults to the public devnet RPC, which rate-limits (HTTP 429). A free dedicated devnet endpoint is recommended |
| `SOLANA_KEEPER_KEYPAIR_PATH` | **Path** to a keypair in `Config.keepers`. The file is read only by the keeper process |
| `ENABLE_EVM` / `ENABLE_SOLANA` | Run one chain or both |
| `*_INTERVAL_MS`, `ALERT_WEBHOOK_URL`, `LOG_LEVEL`, … | See `.env.example` |

Addresses, the market ids and the PerpEngine deploy block come from `../deployments/*.json`. The ABIs come from `../celestial-perps/src/abis/` and the IDL from `../celestial-perps/src/idl/`.

## Run

```bash
pnpm keeper          # both chains
pnpm keeper:evm      # Sepolia only
pnpm keeper:solana   # Solana devnet only
```

Stop it with Ctrl-C (SIGINT) or SIGTERM. The loops stop, and transactions already in flight get up to 10 s to settle.

## Jobs

| Job | Interval | EVM | Solana |
|---|---|---|---|
| Executor | 1.5 s | Walks request ids from a cursor to `nextRequestId` with `getRequest` (there is no global pending list), then sends one `executeRequests(ids)` per batch (≤ 10). The batch is gas-estimated first. If the estimate fails, ids are estimated one at a time and the failing ones are backed off | One `getProgramAccounts` per tick for `Request` accounts, oldest first. Up to 4 `execute_request` instructions per transaction, each carrying every market and oracle in `Config.markets` order with its own market writable. If the batch fails preflight, it is retried one request at a time |
| Liquidator | 5 s | Keeps a position index built from `PositionIncreased`, `PositionClosed` and `PositionLiquidated` logs. It is rebuilt from the deploy block at start, with the block range halved when the RPC limits it. Each key is re-read with `getPosition`, checked off-chain with `src/math.ts`, confirmed with `isLiquidatable` (`eth_call`), then `liquidate`d | `getProgramAccounts` for `Position` accounts, plus one `getMultipleAccounts` call for every market, oracle and the clock sysvar. Checked off-chain, confirmed by simulating `liquidate`, then sent |
| Funding | 1 h ±5% | `updateFunding(market)` for each market with open interest | `update_funding(market)` for each market with open interest |
| Health | 5 min | ETH balance (alert below 0.02) and `isKeeper` | SOL balance (alert below 1) and `Config.keepers` |

- A request that fails a business rule (slippage, stale price, OI cap, reserve cap, leverage…) is **cancelled by the contract or program**. The trader is refunded, the keeper is still paid, and the transaction succeeds, so the keeper logs `request cancelled` with the reason.
- The off-chain liquidation maths (`src/math.ts`) is a bigint port of `PerpMath.sol`, and `test/math.test.ts` asserts every `docs/perp-math.md` vector exactly.
- Markets whose oracle is stale are skipped by the liquidator, with a warning at most once a minute.

## Safety

- **A request never executes twice.**
  - EVM: `executeRequests` skips ids that are no longer pending.
  - Solana: the request account is closed on execute/cancel, so a duplicate fails validation.
  - Ids also stay in an in-flight set until the outcome is confirmed.
- **Nothing is paid for that would fail.** EVM sends are gas-estimated first, and Solana sends have preflight enabled.
- **Only safe failures are retried.**
  - Reads are retried with exponential backoff.
  - Sends are retried only when the error happens before the transaction is accepted (429, blockhash not found).
  - Anything with an unknown outcome is re-read on the next tick instead of being blindly re-sent.
  - EVM uses one `NonceManager`, which is re-synced after any send failure or confirmation timeout.
- **Lagging RPC nodes** (seen on the public devnet RPC):
  - Solana reads use `minContextSlot` = the last slot the keeper confirmed.
  - Accounts the keeper just settled are ignored for 2 minutes.
  - `AccountNotInitialized` on a request means "already settled", not an error.
- **Independent loops.** A failing tick backs off (1 s → 60 s) without affecting the other loops or chain. If `init` fails at startup (RPC down), it is retried with backoff. A keeper that is not whitelisted stops that chain's loops with an alert.

## Logs and alerts

One JSON object per line on stdout: `ts`, `level`, `chain`, `job`, `msg` and fields. Useful messages:

| msg | Meaning |
|---|---|
| `request seen` (Solana) | First sighting; `age_s` shows how far behind the RPC's view is |
| `execute sent` / `request executed` / `request cancelled` | Per request: `latency_s` (request → fill, chain time), `reason` for cancels |
| `liquidation sent` / `position liquidated` | With `keeper_fee` |
| `funding updated` | Rates and cumulative indices |
| `health` | Balance and whitelist status every 5 minutes |
| `loop tick failed` / `loop recovered` | RPC trouble and recovery |

Alerts are lines with `"level":"alert"` (low balance, not whitelisted, fatal init). Each alert key fires at most once every 15 minutes. If `ALERT_WEBHOOK_URL` is set, alerts are also POSTed there as JSON: `{ source, alert, message, chain, … }`.

Secrets are never logged:
- the EVM key is never passed to the logger
- URLs are stripped from error messages (they can embed RPC API keys)
- fields named like `privateKey`, `secret` or `keypair` are redacted

## Tests

```bash
pnpm typecheck
pnpm test          # maths vectors (perp-math.md Ex 1–9) + oracle decoding, config, logging
pnpm test:local    # needs `forge build` in celestial-contracts and `pnpm build:test` in celestial-solana
```

`test:local` runs the keeper in-process against:

- **Anvil**, with the Phase 3 contracts deployed from the forge artifacts and `MockV3Aggregator` prices
- **`solana-test-validator`**, with the `mock-oracle` build of `celestial_perps` (the keeper uses the devnet IDL)

Scenarios:

| Scenario | EVM | Solana |
|---|---|---|
| Fill within 5 s | ✓ | ✓ |
| Batch where one request hits slippage and cancels, the others fill, and every fee goes to the keeper | ✓ | ✓ (all three in one transaction) |
| Stale oracle → `StalePrice` cancel, keeper still paid | — | ✓ |
| Liquidation within 10 s of crossing the liquidation price; healthy positions untouched | ✓ | ✓ |
| Funding accrues on the heavier side only | ✓ | ✓ |
| RPC outage through a proxy switched off, then recovery with exactly-once execution | ✓ | ✓ |

To run one live open/close from a separate test wallet against a running keeper:

```bash
TRADER_KEYPAIR_PATH=<test keypair> node --import tsx scripts/live-trade.ts solana
TRADER_PRIVATE_KEY=<test key> SEPOLIA_RPC_URL=… node --import tsx scripts/live-trade.ts evm
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `loop tick failed … 429` (Solana) | The public devnet RPC is rate-limiting. Set `SOLANA_RPC_URL` to a dedicated endpoint, or raise `EXECUTOR_INTERVAL_MS` |
| `eth_getLogs range reduced` | The RPC caps the block range; the keeper halves it automatically. Set `EVM_LOG_RANGE` lower to avoid the retries |
| `oracle stale or invalid; skipping market` | The Chainlink feed is older than the market's max age: 3960 s on Sepolia, 120 s on Solana devnet. The contracts would reject it too, so requests on that market are cancelled with `StalePrice` |
| `is not a whitelisted PerpEngine keeper` / `not in Config.keepers` | Wrong key, or the keeper was removed. Use `setKeeper` / `set_keeper` from the admin |
| `execute would revert; not sending` (EVM) | A problem with the request itself; the id is backed off (5 s → 5 min). Check the request with `getRequest(id)` |
| `bigint: Failed to load bindings` on stderr | A harmless notice from a Solana dependency (the pure-JS fallback is used) |
