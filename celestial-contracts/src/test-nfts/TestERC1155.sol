// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title TestERC1155
 * @author Celestial Protocol — Devansh Behl
 * @notice TESTNET-ONLY ERC-1155 fixture for building the Celestial wallet NFT
 *         features (see nft.md, Phase 0). Exercises multi-quantity display
 *         and quantity-aware transfers.
 *
 *         Token ids:
 *           • 1 — "Celestial Pass"  (fungible-ish, minted in quantity)
 *           • 2 — "Celestial Relic" (single copy)
 *
 *         Metadata is generated on-chain as base64 data URIs.
 */
contract TestERC1155 is ERC1155, Ownable {
    using Strings for uint256;

    uint256 public constant PASS = 1;
    uint256 public constant RELIC = 2;

    // Exposed for indexers/explorers that read collection name & symbol
    string public constant name = "Celestial Test Editions";
    string public constant symbol = "CTED";

    constructor() ERC1155("") Ownable(msg.sender) {}

    function mint(address to, uint256 id, uint256 amount) external onlyOwner {
        require(id == PASS || id == RELIC, "TestERC1155: unknown id");
        _mint(to, id, amount, "");
    }

    function uri(uint256 id) public pure override returns (string memory) {
        require(id == PASS || id == RELIC, "TestERC1155: unknown id");

        (string memory title, string memory color, string memory rarity) = id == PASS
            ? ("Celestial Pass", "#00f0ff", "Common")
            : ("Celestial Relic", "#bd00ff", "Legendary");

        bytes memory svg = abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">',
            '<rect width="400" height="400" fill="#050505"/>',
            '<rect x="70" y="70" width="260" height="260" rx="36" fill="none" stroke="', color, '" stroke-width="10"/>',
            '<text x="200" y="215" font-family="monospace" font-size="34" fill="', color, '" text-anchor="middle">', rarity, "</text>",
            "</svg>"
        );

        bytes memory json = abi.encodePacked(
            '{"name":"', title,
            '","description":"Celestial wallet ERC-1155 test edition (Sepolia). No value.",',
            '"image":"data:image/svg+xml;base64,', Base64.encode(svg),
            '","attributes":[{"trait_type":"Rarity","value":"', rarity, '"},',
            '{"trait_type":"Edition Id","value":', id.toString(), "}]}"
        );

        return string.concat("data:application/json;base64,", Base64.encode(json));
    }
}
