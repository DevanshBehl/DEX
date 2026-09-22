// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MockV3Aggregator} from "@chainlink/contracts/src/v0.8/tests/MockV3Aggregator.sol";
import {ChainlinkOracle} from "../src/oracle/ChainlinkOracle.sol";

contract ChainlinkOracleTest is Test {
    bytes32 constant ETH = keccak256("ETH-USD");
    ChainlinkOracle oracle;
    MockV3Aggregator feed;

    function setUp() public {
        vm.warp(1_000_000);
        oracle = new ChainlinkOracle();
        feed = new MockV3Aggregator(8, 3_000e8);
        oracle.setFeed(ETH, address(feed), 3960);
    }

    function test_ReturnsPrice() public view {
        assertEq(oracle.getPrice(ETH), 3_000e8);
        assertTrue(oracle.hasFeed(ETH));
        assertEq(oracle.collateralPrice(), 1e8);
    }

    function test_NormalisesDecimals() public {
        bytes32 m18 = keccak256("X18");
        bytes32 m6 = keccak256("X6");
        oracle.setFeed(m18, address(new MockV3Aggregator(18, 3_000e18)), 3960);
        oracle.setFeed(m6, address(new MockV3Aggregator(6, 3_000e6)), 3960);
        assertEq(oracle.getPrice(m18), 3_000e8);
        assertEq(oracle.getPrice(m6), 3_000e8);
    }

    function test_RevertsUnknownFeed() public {
        bytes32 sol = keccak256("SOL-USD");
        assertFalse(oracle.hasFeed(sol));
        vm.expectRevert(abi.encodeWithSelector(ChainlinkOracle.UnknownFeed.selector, sol));
        oracle.getPrice(sol);
    }

    function test_RevertsStale() public {
        vm.warp(block.timestamp + 3961);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkOracle.StalePrice.selector, 1_000_000, 3960));
        oracle.getPrice(ETH);
    }

    function test_AcceptsAtMaxAge() public {
        vm.warp(block.timestamp + 3960);
        assertEq(oracle.getPrice(ETH), 3_000e8);
    }

    function test_RevertsNonPositive() public {
        feed.updateAnswer(0);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkOracle.InvalidAnswer.selector, int256(0)));
        oracle.getPrice(ETH);
        feed.updateAnswer(-1);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkOracle.InvalidAnswer.selector, int256(-1)));
        oracle.getPrice(ETH);
    }

    function test_RevertsIncompleteRound() public {
        feed.updateRoundData(5, 3_000e8, 0, block.timestamp);
        vm.expectRevert(ChainlinkOracle.IncompleteRound.selector);
        oracle.getPrice(ETH);
    }

    function test_RevertsFutureTimestamp() public {
        feed.updateRoundData(6, 3_000e8, block.timestamp + 10, block.timestamp);
        vm.expectRevert();
        oracle.getPrice(ETH);
    }

    function test_SetFeedValidation() public {
        vm.expectRevert(ChainlinkOracle.InvalidFeed.selector);
        oracle.setFeed(ETH, address(0), 3960);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkOracle.InvalidMaxAge.selector, uint32(59)));
        oracle.setFeed(ETH, address(feed), 59);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkOracle.InvalidMaxAge.selector, uint32(1 days + 1)));
        oracle.setFeed(ETH, address(feed), 1 days + 1);
        MockV3Aggregator tooManyDecimals = new MockV3Aggregator(19, 1);
        vm.expectRevert(ChainlinkOracle.InvalidFeed.selector);
        oracle.setFeed(ETH, address(tooManyDecimals), 3960);
    }

    function test_OnlyOwner() public {
        address eve = makeAddr("eve");
        vm.prank(eve);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, eve));
        oracle.setFeed(ETH, address(feed), 3960);
        vm.prank(eve);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, eve));
        oracle.removeFeed(ETH);
    }

    function test_RemoveFeed() public {
        oracle.removeFeed(ETH);
        assertFalse(oracle.hasFeed(ETH));
    }
}
