# Celestial Contracts

Solidity contracts for Celestial Perps and the Celestial wallet test fixtures, built with [Foundry](https://book.getfoundry.sh/).

The perps protocol is being rebuilt as a pool-based perpetual DEX (see [`../phases.md`](../phases.md) and [`../docs/protocol-spec.md`](../docs/protocol-spec.md)).

## Contracts

| Path | Status | What it is |
|---|---|---|
| `src/legacy/CelestialVault.sol` | **Deprecated** | First perps prototype: ETH collateral, Chainlink prices, no LP pool. Deployed on Sepolia at `0x786f4037924772c79F39D49C302dC3D3eDd14b04`, no longer maintained. Superseded by the Phase 3 contracts. |
| `src/MockUSDC.sol` | Active (testnet only) | 6-decimal mock USDC, the collateral for the perps. Owner mint plus a public `faucet()` giving 10k every 24 h. Sepolia: `0x88a77050162285276d6346a4Bc07C406572d6cD2` (verified) |
| `src/test-nfts/TestERC721.sol` | Active | ERC-721 fixture collection for testing the wallet's NFT view (standard, spam and broken-image tokens) |
| `src/test-nfts/TestERC1155.sol` | Active | ERC-1155 fixture editions for the same tests |

Planned (Phase 3): `oracle/ChainlinkOracle`, `pool/LiquidityPool`, `pool/CLP`, `PerpEngine`.

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
forge test          # MockUSDC, NFT fixtures, Chainlink oracle smoke test
forge fmt
```

## Deploy

Deployed addresses are recorded in [`../deployments/sepolia.json`](../deployments/sepolia.json).

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
