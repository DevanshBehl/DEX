# celestial-solana — Celestial Perps on Solana

One Anchor program, `celestial_perps` (program ID `EK1KpDGfUiZ4XkWixAaRFonDexZYSKnJm8oJz5s7HLTL`). It has the same economics as the EVM contracts in `../celestial-contracts`: a USDC pool with a CLP LP token, two-step orders executed by a keeper at the Chainlink price, skew-based funding, liquidations and a profit cap. It also contains the mock-USDC faucet. The parameters come from `../docs/protocol-spec.md` and the formulas from `../docs/perp-math.md`.

Toolchain: anchor-cli 1.1.2, solana-cli 3.1.10 (Agave), Rust 1.89 for the program (`rust-toolchain.toml`), Node 24, pnpm.

## Build and test

```bash
pnpm install
cargo test -p celestial-perps --lib   # maths + oracle decoding: every perp-math.md vector (Ex 1–10) + property sweeps
pnpm test                            # builds with `mock-oracle`, then runs the LiteSVM suite (tests/*.test.ts)
pnpm test:chainlink                  # devnet build + solana-test-validator with the Chainlink store & feeds cloned from devnet
pnpm check-oracle                    # decode the 3 devnet Chainlink feeds (price, decimals, age)
```

- **`mock-oracle` feature** (tests only): adds `init_mock_oracle` / `set_mock_price` and `OracleKind::Mock`. `pnpm build:test` builds with it and copies the `.so` + IDL to `tests/fixtures/`. The **devnet build is plain `anchor build`**: its IDL contains no mock instruction, and `OracleKind::Mock` fails with `UnsupportedOracleKind`.
- The LiteSVM tests control the clock (request expiry, LP cooldown, 24 h faucet, hours of funding). After every scenario they check `vault ≥ pool_amount + fee_reserves + total_collateral + total_escrow` and `reserved ≤ pool_amount`.

## Deploy and initialise (devnet)

```bash
anchor build                                       # NO mock-oracle
solana rent $(( $(stat -f%z target/deploy/celestial_perps.so) * 2 ))   # buffer estimate; need 1.5× in the wallet
anchor deploy --provider.cluster devnet

export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com ANCHOR_WALLET=~/.config/solana/devnet.json
pnpm init-devnet                     # initialize, 3 Chainlink markets (max_age 120), keeper, seed 5M USDC — idempotent
spl-token authorize 2LW8DzDa2KVxDxqUqZLALc6htcVSDwGK1JGz4VaaTn1Y mint <MINT_AUTHORITY_PDA>
spl-token display 2LW8DzDa2KVxDxqUqZLALc6htcVSDwGK1JGz4VaaTn1Y   # confirm the mint authority
pnpm init-devnet --smoke             # faucet + open/close a 100 USDC 5x SOL-USD long; writes ../deployments/solana-devnet.json
```

`target/deploy/celestial_perps-keypair.json` is the program's upgrade identity. **Back it up outside the repo.** It is gitignored and must never be committed.

## Accounts

| Account | Seeds | Notes |
|---|---|---|
| `Config` | `["config"]` | admin / pending_admin, 4 keeper slots, paused, USDC mint + token program, market list (≤ 8, AUM order), every engine parameter |
| `Pool` | `["pool"]` | pool_amount, reserved_amount, fee_reserves, total_collateral, total_escrow, LP params |
| Vault | `["vault"]` | Token-2022 USDC account owned by `Pool`; holds every bucket |
| CLP mint | `["clp_mint"]` | Token-2022, **6 decimals**, authority `Pool` |
| `Market` | `["market", symbol]` | oracle, oracle_kind, max_age, enabled, OI/tokens/collateral per side, funding indices |
| `Position` | `["position", owner, market, [is_long]]` | created on first execution (rent prepaid in the request), closed on full close/liquidation (rent → trader) |
| `Request` | `["request", owner, nonce_le_u64]` | pending order; holds the lamport execution fee; closed on execute/cancel (rent → owner) |
| `UserState` | `["user", owner]` | request_nonce, last_lp_add_at, last_faucet_at |
| Mint authority | `["mint_authority"]` | signs faucet mints once the mock-USDC authority is moved to it |

## Instructions

| Group | Instructions |
|---|---|
| Admin | `initialize`, `add_market(symbol, oracle_kind, max_age)`, `set_market_enabled`, `set_keeper(pubkey, active)`, `set_paused`, `set_params(ParamsUpdate)` (EVM bounds), `transfer_admin` / `accept_admin`, `withdraw_fees` |
| Faucet | `faucet` — 10,000 USDC to the caller's ATA (created if needed), once per 24 h |
| LP | `add_liquidity(amount, min_clp)`, `remove_liquidity(clp_amount, min_usdc)` — 15 min cooldown, cannot touch reserved liquidity |
| Trader | `request_increase(nonce, is_long, collateral_delta, size_delta, acceptable_price, execution_fee)`, `request_decrease(...)`, `cancel_request` (owner, after 60 s) |
| Keeper | `execute_request`, `liquidate`, `update_funding(market)` (permissionless) |
| Views | `get_aum`, `get_clp_price`, `get_liquidation_price`, `get_market_info(market)` — call with `simulateTransaction`, read the return data |

### `remaining_accounts` convention (AUM)

Every instruction that needs AUM takes **all markets and their oracles** as remaining accounts, in `Config.markets` order: `[market_0, oracle_0, market_1, oracle_1, …]`. The program checks the count, order, PDA, owner and oracle key and owner. A missing, extra or reordered entry fails with `InvalidMarketAccounts` / `OracleMismatch`. The market an instruction mutates must be passed **writable** (`execute_request`, `liquidate`, `update_funding`, and `set_params` for funding changes). This applies to `add_liquidity`, `remove_liquidity`, `execute_request`, `liquidate`, `update_funding`, `set_params` (funding only), `get_aum`, `get_clp_price` and `get_market_info`.

Current devnet order: **SOL-USD, BTC-USD, ETH-USD**.

## Differences from `PerpEngine.sol`

| EVM | Solana | Reason |
|---|---|---|
| `executeRequests(ids[])` with `try/catch` | one `execute_request` per request; batch several in one transaction | Solana has no try/catch. The engine runs on in-memory copies. A failed business check (slippage, stale price, OI/reserve cap, leverage, min collateral, liquidatable, paused, disabled, overflow) commits nothing, refunds the escrow, pays the keeper and emits `RequestCancelled { reason }`, and the instruction **succeeds**. Only account-validation errors fail |
| `RequestCancelled(bytes reason)` | `reason: CancelReason` enum | Mirrors the EVM custom errors (`MathError` for an EVM panic) |
| Execution fee in ETH | Lamports, held in the `Request` account | Native gas token |
| Positions in a mapping | `Position` PDA, rent prepaid by the trader in `request_increase`, refunded on close/liquidation | Solana rent |
| `marketIds` loop for AUM | all markets passed as `remaining_accounts`, validated | No storage iteration |
| CLP 18 decimals | CLP 6 decimals | `u64` token amounts (see `docs/perp-math.md` Ex 10) |
| `getClpPrice = aum × 1e20 / supply` | `aum × 1e8 / supply` | 6-decimal CLP; still an 8-decimal price per 1 CLP |
| Oracle `answeredInRound` check | not available | The OCR2 transmissions layout has no `answeredInRound`. Answer > 0, timestamp ≠ 0, age ≤ `max_age` and a future skew ≤ 60 s are checked |
| `Ownable2Step` | `transfer_admin` / `accept_admin` | same semantics |
| `PositionDecreased.key` | `position: Pubkey` | PDA address instead of `keccak` key |
| — | `MarketListed`, `KeeperUpdated`, `FeesWithdrawn`, `FaucetClaimed` events | Same names as the EVM admin events; the faucet is new |

**Oracle decoding.** `src/oracle.rs` decodes the OCR2 `Transmissions` account by hand (no extra crate):

- decimals at byte 138, `live_length` at 148 and `live_cursor` at 152
- 48-byte rounds starting at byte 200
- the latest round is at `(cursor + length − 1) % length`

The decoder is unit-tested against a real captured devnet account and cross-checked in `pnpm test:chainlink`.

## Notes for the keeper (Phase 5) and frontend (Phase 6)

- **Pending requests:** `getProgramAccounts(programId, { filters: [{ memcmp: { offset: 0, bytes: <Request discriminator b58> } }] })`. The discriminator is in the IDL (`accounts[].discriminator`). Add `{ memcmp: { offset: 8, bytes: owner } }` for one user. `created_at` (i64) is at offset 8 + 32×3 + 1 + 1 + 8×5 = 146.
- **Positions:** same pattern with the `Position` discriminator, plus `memcmp` on `market` (offset 40) for a market.
- **Batching:** put several `execute_request` instructions in one transaction, each with the full market list and its own market writable, and raise the compute limit (~45k CU per execute).
- **Events:** `Program data: <base64>` log lines; decode them with `BorshCoder(idl).events.decode`. Names and fields follow the EVM events in snake_case.
- **Faucet:** `faucet` with accounts `user, config, user_state, usdc_mint, mint_authority, user_usdc (ATA, created if missing), token_program (Token-2022), associated_token_program, system_program`.
