// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {TestERC721} from "../src/test-nfts/TestERC721.sol";
import {TestERC1155} from "../src/test-nfts/TestERC1155.sol";

/**
 * @title MintTestNFTs
 * @notice Deploys the NFT fixture contracts on Sepolia and mints a full test
 *         set to the Celestial wallet address (nft.md — Phase 0).
 *
 * Mints to RECIPIENT:
 *   ERC-721  "Celestial Test Collection"
 *     • 5× Standard   (valid on-chain SVG metadata)
 *     • 1× Spam       (scam-style name — spam filter test)
 *     • 1× BrokenImg  (unresolvable image — fallback test)
 *   ERC-1155 "Celestial Test Editions"
 *     • id 1 "Celestial Pass"  × 10
 *     • id 2 "Celestial Relic" × 1
 *
 * Usage:
 *   forge script script/MintTestNFTs.s.sol:MintTestNFTs \
 *       --rpc-url $SEPOLIA_RPC_URL \
 *       --broadcast \
 *       --verify
 *
 * Required env vars:
 *   PRIVATE_KEY       — Deployer/fixture wallet key (TESTNET ONLY — never your Celestial vault key)
 *   RECIPIENT         — Your Celestial wallet EVM address that should receive the NFTs
 *   SEPOLIA_RPC_URL   — Alchemy / Infura RPC endpoint for Sepolia
 *
 * Optional:
 *   ERC721_ADDRESS / ERC1155_ADDRESS — reuse already-deployed fixtures and only mint
 */
contract MintTestNFTs is Script {
    uint256 constant SEPOLIA_CHAIN_ID = 11155111;

    function run() external {
        require(block.chainid == SEPOLIA_CHAIN_ID || block.chainid == 31337, "MintTestNFTs: Sepolia or local only");

        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address recipient = vm.envAddress("RECIPIENT");
        address existing721 = vm.envOr("ERC721_ADDRESS", address(0));
        address existing1155 = vm.envOr("ERC1155_ADDRESS", address(0));

        vm.startBroadcast(deployerPrivateKey);

        TestERC721 erc721 = existing721 == address(0) ? new TestERC721() : TestERC721(existing721);
        TestERC1155 erc1155 = existing1155 == address(0) ? new TestERC1155() : TestERC1155(existing1155);

        erc721.mintBatch(recipient, TestERC721.Kind.Standard, 5);
        erc721.mint(recipient, TestERC721.Kind.Spam);
        erc721.mint(recipient, TestERC721.Kind.BrokenImg);

        erc1155.mint(recipient, erc1155.PASS(), 10);
        erc1155.mint(recipient, erc1155.RELIC(), 1);

        vm.stopBroadcast();

        console.log("============================================");
        console.log("  CELESTIAL TEST NFTs MINTED");
        console.log("============================================");
        console.log("  Recipient:  ", recipient);
        console.log("  ERC-721:    ", address(erc721));
        console.log("  ERC-1155:   ", address(erc1155));
        console.log("  721 minted:  7 (5 standard, 1 spam, 1 broken image)");
        console.log("  1155 minted: id 1 x10, id 2 x1");
        console.log("============================================");
    }
}
