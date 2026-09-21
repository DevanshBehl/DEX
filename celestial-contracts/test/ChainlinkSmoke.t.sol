// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {MockV3Aggregator} from "@chainlink/contracts/src/v0.8/tests/MockV3Aggregator.sol";

/// @notice Proves the vendored Chainlink interfaces + MockV3Aggregator resolve and behave
///         as the Phase 3 oracle wrapper will expect (8-decimal USD feeds).
contract ChainlinkSmokeTest is Test {
    MockV3Aggregator internal feed;

    function setUp() public {
        vm.warp(1_000_000);
        feed = new MockV3Aggregator(8, 3_000e8); // ETH/USD @ $3,000
    }

    function test_ReturnsLatestAnswer() public view {
        AggregatorV3Interface agg = AggregatorV3Interface(address(feed));
        (uint80 roundId, int256 answer,, uint256 updatedAt,) = agg.latestRoundData();
        assertEq(agg.decimals(), 8);
        assertEq(answer, 3_000e8);
        assertEq(updatedAt, block.timestamp);
        assertEq(roundId, 1);
    }

    function test_NewRoundUpdatesAnswerAndTimestamp() public {
        vm.warp(block.timestamp + 3_600);
        feed.updateAnswer(3_150e8);
        (uint80 roundId, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        assertEq(answer, 3_150e8);
        assertEq(updatedAt, block.timestamp);
        assertEq(roundId, 2);
    }
}
