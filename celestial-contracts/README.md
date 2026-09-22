# Celestial Contracts

Solidity contracts for Celestial Perps and the Celestial wallet test fixtures, built with [Foundry](https://book.getfoundry.sh/).

The perps protocol is being rebuilt as a pool-based perpetual DEX (see [`../phases.md`](../phases.md) and [`../docs/protocol-spec.md`](../docs/protocol-spec.md)).

## Contracts

| Path | Status | What it is |
|---|---|---|
| `src/legacy/CelestialVault.sol` | **Deprecated** | First perps prototype: ETH collateral, Chainlink prices, no LP pool. Deployed on Sepolia at `0x786f4037924772c79F39D49C302dC3D3eDd14b04`, no longer maintained. Superseded by the Phase 3 contracts. |
| `src/PerpEngine.sol` | Active | Trading engine: two-step requests (trader → keeper), positions, skew-based funding, liquidation, and the profit cap. Sepolia: `0x49765B9bEFed004A6462ad2025C240191e762b60` |
| `src/pool/LiquidityPool.sol` | Active | Holds **all** USDC (LP liquidity, collateral, escrow, fees) and is the counterparty to traders. **Approve this contract for USDC.** Sepolia: `0xB2DF5d7C1BCa2d82ECA1D591F0E58B335387b24b` |
| `src/pool/CLP.sol` | Active | LP token (18 decimals), minted and burned by the pool. Sepolia: `0x303C049BF526bD40d82E2Bd405af34bB095A55DA` |
| `src/oracle/ChainlinkOracle.sol` | Active | Chainlink wrapper (stale, incomplete and non-positive checks; normalised to 8 decimals). Sepolia: `0xFF6a6Da437b16e5dd29D2eF8Aa38517911320cC0` |
| `src/libraries/PerpMath.sol` | Active | All maths (PnL, fees, funding, liquidation, CLP). Must match the Solana program; test vectors are in [`../docs/perp-math.md`](../docs/perp-math.md) |
| `src/MockUSDC.sol` | Active (testnet only) | 6-decimal mock USDC, the collateral for the perps. Owner mint plus a public `faucet()` giving 10k every 24 h. Sepolia: `0x88a77050162285276d6346a4Bc07C406572d6cD2` (verified) |
| `src/test-nfts/TestERC721.sol` | Active | ERC-721 fixture collection for testing the wallet's NFT view (standard, spam and broken-image tokens) |
| `src/test-nfts/TestERC1155.sol` | Active | ERC-1155 fixture editions for the same tests |

Markets on Sepolia: **BTC-USD, ETH-USD** (SOL-USD is Solana-only). The pool was seeded with 5M mock USDC.

### Request lifecycle

1. The trader approves USDC to the **LiquidityPool**, then calls `PerpEngine.requestIncrease` or `requestDecrease` with `msg.value ≥ minExecutionFee` (0.0002 ETH).
2. The keeper calls `executeRequests(ids)`. Each request fills at the Chainlink price ± 0.1% spread, or is cancelled and its escrow refunded (slippage, stale oracle, caps, leverage). The keeper earns the execution fee either way.
3. After `requestExpiry` (60 s), the trader can `cancelRequest(id)` to get the escrow and fee back.
4. The keeper calls `liquidate(key)` on under-margined positions and `updateFunding(market)` hourly.

### Parameters (defaults)

| | |
|---|---|
| Max leverage / maintenance margin | 20x / 2.5% |
| Position fee (open and close) | 0.06% of size (90% to LPs, 10% protocol) |
| Execution spread | 0.1% |
| Liquidation fee | 0.5% of size (capped at collateral) |
| Profit cap (reserve) | 9 × collateral |
| OI cap per side | 30% of AUM |
| Funding | `min(0.01%/h, 0.03%/h × skew / AUM)`, heavier side pays LPs |
| LP mint fee / cooldown | 0.1% / 15 min |
| Min collateral / request expiry / min execution fee | 10 USDC / 60 s / 0.0002 ETH |

## Dependencies

Vendored in `lib/` as plain files (not git submodules):

| Library | Remapping |
|---|---|
| forge-std | `forge-std/` |
| OpenZeppelin Contracts | `@openzeppelin/contracts/` |
| Chainlink (brownie contracts) | `@chainlink/`: `AggregatorV3Interface` and `MockV3Aggregator`, the price oracle for the perps engine |

To add a library, copy its sources into `lib/<name>` without a `.git` directory and add a remapping in `foundry.toml`.

## Setup

```shell
cp .env.example .env   # fill in SEPOLIA_RPC_URL, PRIVATE_KEY, ETHERSCAN_API_KEY
```

Never commit `.env`, and only use a wallet that holds testnet funds.

## Build & test

```shell
forge build
forge test                                   # unit + fuzz + invariant tests
forge test --match-path 'test/invariant/*'   # invariants only
FOUNDRY_PROFILE=ci forge test                # longer fuzz/invariant runs
forge coverage --ir-minimum --no-match-path 'test/invariant/*'
forge fmt
```

## Deploy

Deployed addresses are recorded in [`../deployments/sepolia.json`](../deployments/sepolia.json).

Perps stack (Sepolia; deploys the oracle, CLP, pool and engine, lists BTC/ETH, sets the keeper, seeds 5M USDC). Optional env: `KEEPER_ADDRESS`, `SEED_USDC`:

```shell
forge script script/DeployPerps.s.sol:DeployPerps \
  --rpc-url $SEPOLIA_RPC_URL --private-key $PRIVATE_KEY --broadcast --verify
```

MockUSDC (Sepolia, mints 10M to the deployer):

```shell
forge script script/DeployMockUSDC.s.sol:DeployMockUSDC \
  --rpc-url $SEPOLIA_RPC_URL --private-key $PRIVATE_KEY --broadcast --verify
```

NFT fixtures (Sepolia):

```shell
forge script script/MintTestNFTs.s.sol:MintTestNFTs \
  --rpc-url $SEPOLIA_RPC_URL --private-key $PRIVATE_KEY --broadcast
```

Legacy vault (**deprecated**, kept only for reference):

```shell
forge script script/DeployVault.s.sol:DeployVault \
  --rpc-url $SEPOLIA_RPC_URL --private-key $PRIVATE_KEY --broadcast --verify
```
