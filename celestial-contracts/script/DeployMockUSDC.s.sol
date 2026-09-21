// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

/**
 * @title DeployMockUSDC
 * @notice Deploys MockUSDC on Sepolia and mints 10M to the deployer (pool seed + tester top-ups).
 *
 * Usage:
 *   forge script script/DeployMockUSDC.s.sol:DeployMockUSDC \
 *       --rpc-url $SEPOLIA_RPC_URL --private-key $PRIVATE_KEY --broadcast --verify
 */
contract DeployMockUSDC is Script {
    uint256 constant INITIAL_MINT = 10_000_000e6; // 10M USDC

    function run() external returns (MockUSDC usdc) {
        require(block.chainid == 11155111, "Sepolia only: MockUSDC is a testnet token");

        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);
        usdc = new MockUSDC();
        usdc.mint(deployer, INITIAL_MINT);
        vm.stopBroadcast();

        console.log("============================================");
        console.log("  MOCK USDC DEPLOYED (Sepolia)");
        console.log("============================================");
        console.log("  MockUSDC:  ", address(usdc));
        console.log("  Owner:     ", deployer);
        console.log("  Minted:    ", INITIAL_MINT / 1e6, "USDC");
        console.log("============================================");
    }
}
