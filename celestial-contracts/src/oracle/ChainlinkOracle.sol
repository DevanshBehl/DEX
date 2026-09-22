// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {IChainlinkOracle} from "../interfaces/IChainlinkOracle.sol";

/**
 * @title ChainlinkOracle
 * @notice Price source for Celestial Perps. Wraps Chainlink push feeds, rejects stale or
 *         invalid rounds and normalises every answer to 8 decimals.
 *         Markets are keyed by keccak256 of their symbol, e.g. keccak256("ETH-USD").
 */
contract ChainlinkOracle is IChainlinkOracle, Ownable2Step {
    uint256 public constant PRICE_DECIMALS = 8;
    uint32 public constant MIN_MAX_AGE = 60;
    uint32 public constant MAX_MAX_AGE = 1 days;

    struct Feed {
        AggregatorV3Interface feed;
        uint32 maxAge;
        uint8 decimals;
    }

    mapping(bytes32 => Feed) public feeds;

    event FeedSet(bytes32 indexed market, address feed, uint32 maxAge, uint8 decimals);
    event FeedRemoved(bytes32 indexed market);

    error UnknownFeed(bytes32 market);
    error InvalidFeed();
    error InvalidMaxAge(uint32 maxAge);
    error InvalidAnswer(int256 answer);
    error IncompleteRound();
    error StalePrice(uint256 updatedAt, uint256 maxAge);

    constructor() Ownable(msg.sender) {}

    // ═══════════════════════════════════════════════════════════
    //  ADMIN
    // ═══════════════════════════════════════════════════════════

    function setFeed(bytes32 market, address feed, uint32 maxAge) external onlyOwner {
        if (feed == address(0)) revert InvalidFeed();
        if (maxAge < MIN_MAX_AGE || maxAge > MAX_MAX_AGE) revert InvalidMaxAge(maxAge);
        uint8 dec = AggregatorV3Interface(feed).decimals();
        if (dec > 18) revert InvalidFeed();
        feeds[market] = Feed(AggregatorV3Interface(feed), maxAge, dec);
        emit FeedSet(market, feed, maxAge, dec);
    }

    function removeFeed(bytes32 market) external onlyOwner {
        delete feeds[market];
        emit FeedRemoved(market);
    }

    // ═══════════════════════════════════════════════════════════
    //  VIEWS
    // ═══════════════════════════════════════════════════════════

    function hasFeed(bytes32 market) external view returns (bool) {
        return address(feeds[market].feed) != address(0);
    }

    function getPrice(bytes32 market) external view returns (uint256) {
        Feed memory f = feeds[market];
        if (address(f.feed) == address(0)) revert UnknownFeed(market);

        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = f.feed.latestRoundData();
        if (answer <= 0) revert InvalidAnswer(answer);
        if (updatedAt == 0 || answeredInRound < roundId) revert IncompleteRound();
        if (updatedAt > block.timestamp || block.timestamp - updatedAt > f.maxAge) {
            revert StalePrice(updatedAt, f.maxAge);
        }

        uint256 price = uint256(answer);
        if (f.decimals > PRICE_DECIMALS) return price / 10 ** (f.decimals - PRICE_DECIMALS);
        return price * 10 ** (PRICE_DECIMALS - f.decimals);
    }

    /// @notice USDC is valued at exactly $1.
    // TODO(mainnet): USDC/USD feed
    function collateralPrice() external pure returns (uint256) {
        return 10 ** PRICE_DECIMALS;
    }
}
