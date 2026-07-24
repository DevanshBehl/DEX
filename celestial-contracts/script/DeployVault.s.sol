// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CelestialVault} from "../src/CelestialVault.sol";

/**
 * @title DeployVault
 * @notice Foundry deployment script for CelestialVault on Sepolia.
 *
 * Usage:
 *   forge script script/DeployVault.s.sol:DeployVault \
 *       --rpc-url $SEPOLIA_RPC_URL \
 *       --private-key $PRIVATE_KEY \
 *       --broadcast \
 *       --verify
 *
 * Required env vars:
 *   PRIVATE_KEY       — Deployer wallet private key (NEVER a mainnet wallet!)
 *   SEPOLIA_RPC_URL   — Alchemy / Infura RPC endpoint for Sepolia
 */
contract DeployVault is Script {
    // ── Chainlink Price Feeds on Sepolia ──
    // See: https://docs.chain.link/data-feeds/price-feeds/addresses?network=ethereum&page=1#sepolia-testnet
    address constant SEPOLIA_ETH_USD_FEED = 0x694AA1769357215DE4FAC081bf1f309aDC325306;
    address constant SEPOLIA_BTC_USD_FEED = 0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        CelestialVault vault = new CelestialVault(
            SEPOLIA_ETH_USD_FEED,
            SEPOLIA_BTC_USD_FEED
        );

        console.log("============================================");
        console.log("  CELESTIAL VAULT DEPLOYED SUCCESSFULLY");
        console.log("============================================");
        console.log("  Network:    Sepolia Testnet");
        console.log("  Vault:     ", address(vault));
        console.log("  ETH/USD:   ", SEPOLIA_ETH_USD_FEED);
        console.log("  BTC/USD:   ", SEPOLIA_BTC_USD_FEED);
        console.log("  Owner:     ", vm.addr(deployerPrivateKey));
        console.log("============================================");

        vm.stopBroadcast();
    }
}
