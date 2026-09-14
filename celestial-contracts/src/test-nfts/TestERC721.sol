// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title TestERC721
 * @author Celestial Protocol — Devansh Behl
 * @notice TESTNET-ONLY ERC-721 fixture collection for building the Celestial
 *         wallet NFT features (see nft.md, Phase 0).
 *
 *         Metadata and SVG artwork are generated fully on-chain as base64
 *         data URIs, so no IPFS / hosting is required.
 *
 *         Each token has a `Kind` so the wallet can be tested against
 *         realistic edge cases:
 *           • Standard  — valid metadata + on-chain SVG image
 *           • Spam      — scam-style name/description (spam filter test)
 *           • BrokenImg — valid JSON but image URL that never resolves
 */
contract TestERC721 is ERC721, Ownable {
    using Strings for uint256;

    enum Kind {
        Standard,
        Spam,
        BrokenImg
    }

    uint256 public nextTokenId = 1;
    mapping(uint256 => Kind) public kindOf;

    constructor() ERC721("Celestial Test Collection", "CTEST") Ownable(msg.sender) {}

    // ═══════════════════════════════════════════════════════════
    //  MINTING
    // ═══════════════════════════════════════════════════════════

    function mint(address to, Kind kind) public onlyOwner returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        kindOf[tokenId] = kind;
        _safeMint(to, tokenId);
    }

    function mintBatch(address to, Kind kind, uint256 count) external onlyOwner {
        for (uint256 i = 0; i < count; i++) {
            mint(to, kind);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  METADATA
    // ═══════════════════════════════════════════════════════════

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        Kind kind = kindOf[tokenId];

        string memory name;
        string memory description;
        string memory image;

        if (kind == Kind.Spam) {
            name = string.concat("Claim 5 ETH Reward #", tokenId.toString());
            description = "Congratulations! Visit celestial-airdrop-claim.xyz to claim your reward now.";
            image = _svgDataUri(tokenId, "#ff0055", "CLAIM");
        } else if (kind == Kind.BrokenImg) {
            name = string.concat("Celestial Broken #", tokenId.toString());
            description = "Fixture with an image URL that never resolves (fallback test).";
            image = "https://invalid.celestial.test/missing-image.png";
        } else {
            name = string.concat("Celestial Orb #", tokenId.toString());
            description = "Celestial wallet test NFT (Sepolia). Not for sale, no value.";
            image = _svgDataUri(tokenId, _color(tokenId), string.concat("#", tokenId.toString()));
        }

        bytes memory json = abi.encodePacked(
            '{"name":"', name,
            '","description":"', description,
            '","image":"', image,
            '","attributes":[',
                '{"trait_type":"Kind","value":"', _kindName(kind), '"},',
                '{"trait_type":"Orbit","value":', (tokenId % 7 + 1).toString(), "},",
                '{"trait_type":"Color","value":"', _color(tokenId), '"}',
            "]}"
        );

        return string.concat("data:application/json;base64,", Base64.encode(json));
    }

    // ═══════════════════════════════════════════════════════════
    //  INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════

    function _svgDataUri(uint256 tokenId, string memory color, string memory label)
        internal
        pure
        returns (string memory)
    {
        bytes memory svg = abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">',
            '<rect width="400" height="400" fill="#050505"/>',
            '<circle cx="200" cy="200" r="', (90 + (tokenId % 5) * 12).toString(), '" fill="', color, '" opacity="0.85"/>',
            '<circle cx="200" cy="200" r="150" fill="none" stroke="', color, '" stroke-width="2" opacity="0.4"/>',
            '<text x="200" y="370" font-family="monospace" font-size="28" fill="#ffffff" text-anchor="middle">', label, "</text>",
            "</svg>"
        );
        return string.concat("data:image/svg+xml;base64,", Base64.encode(svg));
    }

    function _color(uint256 tokenId) internal pure returns (string memory) {
        string[6] memory palette = ["#00f0ff", "#bd00ff", "#00ff66", "#ffaa00", "#627eea", "#14f195"];
        return palette[tokenId % palette.length];
    }

    function _kindName(Kind kind) internal pure returns (string memory) {
        if (kind == Kind.Spam) return "Spam";
        if (kind == Kind.BrokenImg) return "BrokenImage";
        return "Standard";
    }
}
