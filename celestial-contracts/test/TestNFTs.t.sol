// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {TestERC721} from "../src/test-nfts/TestERC721.sol";
import {TestERC1155} from "../src/test-nfts/TestERC1155.sol";

contract TestNFTsTest is Test {
    TestERC721 erc721;
    TestERC1155 erc1155;
    address recipient = makeAddr("celestial-wallet");

    function setUp() public {
        erc721 = new TestERC721();
        erc1155 = new TestERC1155();
    }

    function test_ERC721_MintKindsAndOwnership() public {
        erc721.mintBatch(recipient, TestERC721.Kind.Standard, 5);
        erc721.mint(recipient, TestERC721.Kind.Spam);
        erc721.mint(recipient, TestERC721.Kind.BrokenImg);

        assertEq(erc721.balanceOf(recipient), 7);
        assertEq(erc721.ownerOf(1), recipient);
        assertEq(uint256(erc721.kindOf(6)), uint256(TestERC721.Kind.Spam));
        assertEq(uint256(erc721.kindOf(7)), uint256(TestERC721.Kind.BrokenImg));
    }

    function test_ERC721_TokenURIIsBase64Json() public {
        erc721.mint(recipient, TestERC721.Kind.Standard);
        string memory uri = erc721.tokenURI(1);
        assertTrue(_startsWith(uri, "data:application/json;base64,"));

        string memory json = string(Base64.decode(_after(uri, 29)));
        assertTrue(_contains(json, '"name":"Celestial Orb #1"'));
        assertTrue(_contains(json, '"image":"data:image/svg+xml;base64,'));
    }

    function test_ERC721_BrokenImageFixture() public {
        erc721.mint(recipient, TestERC721.Kind.BrokenImg);
        string memory json = string(Base64.decode(_after(erc721.tokenURI(1), 29)));
        assertTrue(_contains(json, "https://invalid.celestial.test/missing-image.png"));
    }

    function test_ERC721_OnlyOwnerCanMint() public {
        vm.prank(recipient);
        vm.expectRevert();
        erc721.mint(recipient, TestERC721.Kind.Standard);
    }

    function test_ERC721_TransferWorks() public {
        erc721.mint(recipient, TestERC721.Kind.Standard);
        address other = makeAddr("other");
        vm.prank(recipient);
        erc721.safeTransferFrom(recipient, other, 1);
        assertEq(erc721.ownerOf(1), other);
    }

    function test_ERC1155_MintQuantitiesAndUri() public {
        erc1155.mint(recipient, 1, 10);
        erc1155.mint(recipient, 2, 1);

        assertEq(erc1155.balanceOf(recipient, 1), 10);
        assertEq(erc1155.balanceOf(recipient, 2), 1);

        string memory json = string(Base64.decode(_after(erc1155.uri(2), 29)));
        assertTrue(_contains(json, '"name":"Celestial Relic"'));
    }

    function test_ERC1155_PartialTransfer() public {
        erc1155.mint(recipient, 1, 10);
        address other = makeAddr("other");
        vm.prank(recipient);
        erc1155.safeTransferFrom(recipient, other, 1, 3, "");
        assertEq(erc1155.balanceOf(recipient, 1), 7);
        assertEq(erc1155.balanceOf(other, 1), 3);
    }

    function test_ERC1155_RejectsUnknownId() public {
        vm.expectRevert("TestERC1155: unknown id");
        erc1155.mint(recipient, 3, 1);
    }

    // ── string helpers ──

    function _after(string memory s, uint256 start) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory out = new bytes(b.length - start);
        for (uint256 i = 0; i < out.length; i++) out[i] = b[start + i];
        return string(out);
    }

    function _startsWith(string memory s, string memory prefix) internal pure returns (bool) {
        bytes memory b = bytes(s);
        bytes memory p = bytes(prefix);
        if (p.length > b.length) return false;
        for (uint256 i = 0; i < p.length; i++) if (b[i] != p[i]) return false;
        return true;
    }

    function _contains(string memory s, string memory needle) internal pure returns (bool) {
        bytes memory b = bytes(s);
        bytes memory n = bytes(needle);
        if (n.length > b.length) return false;
        for (uint256 i = 0; i <= b.length - n.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (b[i + j] != n[j]) { ok = false; break; }
            }
            if (ok) return true;
        }
        return false;
    }
}
