// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title CelestialVault
 * @author Celestial Protocol — Devansh Behl
 * @notice Decentralized clearinghouse for Celestial Perps.
 *         Holds user collateral (ETH), reads live Chainlink prices,
 *         and manages synthetic perpetual positions.
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │  CELESTIAL VAULT — On-Chain Clearinghouse                   │
 * │                                                              │
 * │  • Deposit / Withdraw ETH collateral                        │
 * │  • Open Long / Short synthetic positions                    │
 * │  • Up to 50× leverage with Chainlink oracle prices          │
 * │  • Automated liquidation when margin < maintenance          │
 * │  • ReentrancyGuard + Ownable security                       │
 * └──────────────────────────────────────────────────────────────┘
 */
contract CelestialVault is Ownable, ReentrancyGuard {
    // ═══════════════════════════════════════════════════════════
    //  TYPES
    // ═══════════════════════════════════════════════════════════

    enum Side {
        Long,
        Short
    }

    struct Position {
        uint256 id;
        address trader;
        string market;           // e.g. "ETH-USD", "BTC-USD"
        Side side;
        uint256 sizeUsd;         // notional size in USD (18 decimals)
        uint256 collateralEth;   // collateral locked (in wei)
        uint256 entryPrice;      // oracle price at open (8 decimals, Chainlink standard)
        uint256 leverage;        // 1–50
        uint256 openedAt;        // block.timestamp
        bool isOpen;
    }

    // ═══════════════════════════════════════════════════════════
    //  STATE
    // ═══════════════════════════════════════════════════════════

    /// @notice Chainlink price feed for ETH/USD on Sepolia
    AggregatorV3Interface public immutable ethUsdPriceFeed;

    /// @notice Chainlink price feed for BTC/USD on Sepolia
    AggregatorV3Interface public immutable btcUsdPriceFeed;

    /// @notice Free (unencumbered) collateral per user
    mapping(address => uint256) public freeCollateral;

    /// @notice All positions ever opened
    mapping(uint256 => Position) public positions;

    /// @notice Position IDs owned by each trader
    mapping(address => uint256[]) public traderPositions;

    /// @notice Global position counter
    uint256 public nextPositionId;

    /// @notice Maximum allowed leverage (default 50×)
    uint256 public maxLeverage = 50;

    /// @notice Maintenance margin ratio in basis points (500 = 5 %)
    uint256 public maintenanceMarginBps = 500;

    /// @notice Liquidation reward in basis points (100 = 1 %)
    uint256 public liquidationRewardBps = 100;

    /// @notice Protocol fee in basis points (10 = 0.1 %)
    uint256 public protocolFeeBps = 10;

    /// @notice Accumulated protocol fees (in wei)
    uint256 public accumulatedFees;

    /// @notice Maximum oracle price staleness (default 1 hour)
    uint256 public maxPriceStaleness = 3600;

    // ═══════════════════════════════════════════════════════════
    //  EVENTS
    // ═══════════════════════════════════════════════════════════

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event PositionOpened(
        uint256 indexed positionId,
        address indexed trader,
        string market,
        Side side,
        uint256 sizeUsd,
        uint256 collateralEth,
        uint256 entryPrice,
        uint256 leverage
    );
    event PositionClosed(
        uint256 indexed positionId,
        address indexed trader,
        uint256 exitPrice,
        int256 pnlUsd
    );
    event PositionLiquidated(
        uint256 indexed positionId,
        address indexed liquidator,
        uint256 reward
    );
    event FeesCollected(address indexed owner, uint256 amount);

    // ═══════════════════════════════════════════════════════════
    //  ERRORS
    // ═══════════════════════════════════════════════════════════

    error ZeroAmount();
    error InsufficientCollateral();
    error InvalidLeverage();
    error UnsupportedMarket();
    error PositionNotOpen();
    error NotPositionOwner();
    error NotLiquidatable();
    error StalePrice();

    // ═══════════════════════════════════════════════════════════
    //  CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════

    /**
     * @param _ethUsdFeed  Chainlink ETH / USD price feed address
     * @param _btcUsdFeed  Chainlink BTC / USD price feed address
     */
    constructor(
        address _ethUsdFeed,
        address _btcUsdFeed
    ) Ownable(msg.sender) {
        ethUsdPriceFeed = AggregatorV3Interface(_ethUsdFeed);
        btcUsdPriceFeed = AggregatorV3Interface(_btcUsdFeed);
    }

    // ═══════════════════════════════════════════════════════════
    //  COLLATERAL — Deposit & Withdraw
    // ═══════════════════════════════════════════════════════════

    /**
     * @notice Deposit ETH as collateral.
     */
    function deposit() external payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        freeCollateral[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    /**
     * @notice Withdraw free (un-locked) ETH collateral.
     * @param amount  Wei to withdraw
     */
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (freeCollateral[msg.sender] < amount) revert InsufficientCollateral();

        freeCollateral[msg.sender] -= amount;

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "ETH transfer failed");

        emit Withdrawn(msg.sender, amount);
    }

    // ═══════════════════════════════════════════════════════════
    //  POSITIONS — Open
    // ═══════════════════════════════════════════════════════════

    /**
     * @notice Open a synthetic perpetual position.
     * @param market        Market identifier ("ETH-USD" or "BTC-USD")
     * @param side          Long (0) or Short (1)
     * @param collateralEth Collateral to lock from free balance (wei)
     * @param leverage      Leverage multiplier (1–50)
     */
    function openPosition(
        string calldata market,
        Side side,
        uint256 collateralEth,
        uint256 leverage
    ) external nonReentrant returns (uint256 positionId) {
        // ── Validation ──
        if (collateralEth == 0) revert ZeroAmount();
        if (leverage == 0 || leverage > maxLeverage) revert InvalidLeverage();
        if (freeCollateral[msg.sender] < collateralEth) revert InsufficientCollateral();

        // ── Fetch oracle price ──
        uint256 currentPrice = _getPrice(market);

        // ── Calculate notional size (USD, 18 decimals) ──
        //    collateralEth (wei) × ethPrice (8 dec) × leverage / 1e8
        uint256 ethPrice = _getPrice("ETH-USD");
        uint256 collateralUsd = (collateralEth * ethPrice) / 1e8; // 18 dec
        uint256 sizeUsd = collateralUsd * leverage;

        // ── Deduct protocol fee from collateral ──
        uint256 fee = (collateralEth * protocolFeeBps) / 10_000;
        accumulatedFees += fee;
        uint256 netCollateral = collateralEth - fee;

        // ── Lock collateral ──
        freeCollateral[msg.sender] -= collateralEth;

        // ── Store position ──
        positionId = nextPositionId++;
        positions[positionId] = Position({
            id: positionId,
            trader: msg.sender,
            market: market,
            side: side,
            sizeUsd: sizeUsd,
            collateralEth: netCollateral,
            entryPrice: currentPrice,
            leverage: leverage,
            openedAt: block.timestamp,
            isOpen: true
        });
        traderPositions[msg.sender].push(positionId);

        emit PositionOpened(
            positionId,
            msg.sender,
            market,
            side,
            sizeUsd,
            netCollateral,
            currentPrice,
            leverage
        );
    }

    // ═══════════════════════════════════════════════════════════
    //  POSITIONS — Close
    // ═══════════════════════════════════════════════════════════

    /**
     * @notice Close your own position and realise PnL.
     * @param positionId  ID of the position to close
     */
    function closePosition(uint256 positionId) external nonReentrant {
        Position storage pos = positions[positionId];
        if (!pos.isOpen) revert PositionNotOpen();
        if (pos.trader != msg.sender) revert NotPositionOwner();

        uint256 exitPrice = _getPrice(pos.market);
        int256 pnlUsd = _computePnl(pos, exitPrice);

        pos.isOpen = false;

        // ── Settle: return collateral ± PnL (clamped to zero) ──
        uint256 payout = _settlePayout(pos.collateralEth, pnlUsd, exitPrice);
        if (payout > 0) {
            freeCollateral[msg.sender] += payout;
        }

        emit PositionClosed(positionId, msg.sender, exitPrice, pnlUsd);
    }

    // ═══════════════════════════════════════════════════════════
    //  LIQUIDATION
    // ═══════════════════════════════════════════════════════════

    /**
     * @notice Liquidate an under-margined position. Anyone can call.
     *         The liquidator receives a reward (1 % of collateral).
     * @param positionId  ID of the position to liquidate
     */
    function liquidate(uint256 positionId) external nonReentrant {
        Position storage pos = positions[positionId];
        if (!pos.isOpen) revert PositionNotOpen();

        uint256 currentPrice = _getPrice(pos.market);

        if (!_isLiquidatable(pos, currentPrice)) revert NotLiquidatable();

        pos.isOpen = false;

        // ── Liquidation reward ──
        uint256 reward = (pos.collateralEth * liquidationRewardBps) / 10_000;
        uint256 remaining = pos.collateralEth - reward;

        // Reward goes to liquidator's free collateral
        freeCollateral[msg.sender] += reward;

        // Remaining collateral goes back to protocol fees
        accumulatedFees += remaining;

        emit PositionLiquidated(positionId, msg.sender, reward);
    }

    // ═══════════════════════════════════════════════════════════
    //  VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════

    /**
     * @notice Get the current Chainlink price for a supported market.
     * @param market  "ETH-USD" or "BTC-USD"
     * @return price  The latest price (8 decimals)
     */
    function getPrice(string calldata market) external view returns (uint256) {
        return _getPrice(market);
    }

    /**
     * @notice Get all position IDs for a trader.
     */
    function getTraderPositions(address trader) external view returns (uint256[] memory) {
        return traderPositions[trader];
    }

    /**
     * @notice Compute unrealised PnL for an open position.
     * @param positionId  Position to check
     * @return pnlUsd  Signed PnL in USD (18 decimals)
     */
    function getUnrealisedPnl(uint256 positionId) external view returns (int256) {
        Position storage pos = positions[positionId];
        if (!pos.isOpen) revert PositionNotOpen();
        uint256 currentPrice = _getPrice(pos.market);
        return _computePnl(pos, currentPrice);
    }

    /**
     * @notice Check whether a position is liquidatable at the current price.
     */
    function isLiquidatable(uint256 positionId) external view returns (bool) {
        Position storage pos = positions[positionId];
        if (!pos.isOpen) return false;
        uint256 currentPrice = _getPrice(pos.market);
        return _isLiquidatable(pos, currentPrice);
    }

    /**
     * @notice Returns position details as a tuple for easy off-chain consumption.
     */
    function getPositionDetails(uint256 positionId)
        external
        view
        returns (
            address trader,
            string memory market,
            Side side,
            uint256 sizeUsd,
            uint256 collateralEth,
            uint256 entryPrice,
            uint256 leverage,
            uint256 openedAt,
            bool isOpen
        )
    {
        Position storage p = positions[positionId];
        return (
            p.trader,
            p.market,
            p.side,
            p.sizeUsd,
            p.collateralEth,
            p.entryPrice,
            p.leverage,
            p.openedAt,
            p.isOpen
        );
    }

    // ═══════════════════════════════════════════════════════════
    //  ADMIN
    // ═══════════════════════════════════════════════════════════

    /**
     * @notice Collect accumulated protocol fees.
     */
    function collectFees() external onlyOwner nonReentrant {
        uint256 amount = accumulatedFees;
        if (amount == 0) revert ZeroAmount();
        accumulatedFees = 0;

        (bool ok, ) = payable(owner()).call{value: amount}("");
        require(ok, "Fee transfer failed");

        emit FeesCollected(owner(), amount);
    }

    /**
     * @notice Update the maximum allowed leverage.
     */
    function setMaxLeverage(uint256 _maxLeverage) external onlyOwner {
        require(_maxLeverage >= 1 && _maxLeverage <= 100, "Invalid leverage range");
        maxLeverage = _maxLeverage;
    }

    /**
     * @notice Update the maintenance margin ratio (in basis points).
     */
    function setMaintenanceMarginBps(uint256 _bps) external onlyOwner {
        require(_bps >= 100 && _bps <= 5000, "Invalid margin bps");
        maintenanceMarginBps = _bps;
    }

    /**
     * @notice Update maximum oracle staleness (in seconds).
     */
    function setMaxPriceStaleness(uint256 _seconds) external onlyOwner {
        maxPriceStaleness = _seconds;
    }

    // ═══════════════════════════════════════════════════════════
    //  INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════

    /**
     * @dev Read the latest price from the Chainlink aggregator for a market.
     *      Reverts on stale data or unsupported market.
     */
    function _getPrice(string memory market) internal view returns (uint256) {
        AggregatorV3Interface feed;

        if (_strEq(market, "ETH-USD")) {
            feed = ethUsdPriceFeed;
        } else if (_strEq(market, "BTC-USD")) {
            feed = btcUsdPriceFeed;
        } else {
            revert UnsupportedMarket();
        }

        (
            /* uint80 roundId */,
            int256 answer,
            /* uint256 startedAt */,
            uint256 updatedAt,
            /* uint80 answeredInRound */
        ) = feed.latestRoundData();

        if (block.timestamp - updatedAt > maxPriceStaleness) revert StalePrice();
        require(answer > 0, "Invalid oracle price");

        return uint256(answer); // 8 decimals
    }

    /**
     * @dev Compute PnL in USD (18 decimals) for a position.
     *
     *   Long  PnL = sizeUsd × (exitPrice − entryPrice) / entryPrice
     *   Short PnL = sizeUsd × (entryPrice − exitPrice) / entryPrice
     */
    function _computePnl(
        Position storage pos,
        uint256 exitPrice
    ) internal view returns (int256) {
        int256 priceDelta;

        if (pos.side == Side.Long) {
            priceDelta = int256(exitPrice) - int256(pos.entryPrice);
        } else {
            priceDelta = int256(pos.entryPrice) - int256(exitPrice);
        }

        // sizeUsd × priceDelta / entryPrice
        return (int256(pos.sizeUsd) * priceDelta) / int256(pos.entryPrice);
    }

    /**
     * @dev Determine if a position is under the maintenance margin.
     *      marginRatio = (collateralValue + unrealisedPnl) / notionalSize
     *      Liquidatable when marginRatio < maintenanceMarginBps / 10_000
     */
    function _isLiquidatable(
        Position storage pos,
        uint256 currentPrice
    ) internal view returns (bool) {
        int256 pnlUsd = _computePnl(pos, currentPrice);

        // Convert collateral to USD (18 dec)
        uint256 ethPrice = _getEthPrice();
        uint256 collateralUsd = (pos.collateralEth * ethPrice) / 1e8;

        // Effective margin = collateral value + PnL
        int256 effectiveMargin = int256(collateralUsd) + pnlUsd;

        // Maintenance margin = sizeUsd × maintenanceMarginBps / 10_000
        int256 requiredMargin = int256((pos.sizeUsd * maintenanceMarginBps) / 10_000);

        return effectiveMargin < requiredMargin;
    }

    /**
     * @dev Settle the payout when closing a position.
     *      Payout = collateral ± (PnL converted to ETH), floored at 0.
     */
    function _settlePayout(
        uint256 collateralEth,
        int256 pnlUsd,
        uint256 /* exitPrice — unused, kept for future extensions */
    ) internal view returns (uint256) {
        uint256 ethPrice = _getEthPrice();

        // Convert PnL from USD to ETH:  pnlEth = pnlUsd × 1e8 / ethPrice
        int256 pnlEth = (pnlUsd * int256(1e8)) / int256(ethPrice);

        int256 payout = int256(collateralEth) + pnlEth;

        // Floor at zero — trader can't owe more than their collateral
        if (payout < 0) return 0;

        // Cap at contract balance to prevent insolvency
        uint256 maxPayout = address(this).balance;
        uint256 result = uint256(payout);
        return result > maxPayout ? maxPayout : result;
    }

    /**
     * @dev Convenience: read ETH/USD price directly.
     */
    function _getEthPrice() internal view returns (uint256) {
        return _getPrice("ETH-USD");
    }

    /**
     * @dev Gas-efficient string comparison via keccak256.
     */
    function _strEq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(abi.encodePacked(a)) == keccak256(abi.encodePacked(b));
    }

    // ═══════════════════════════════════════════════════════════
    //  RECEIVE
    // ═══════════════════════════════════════════════════════════

    /// @notice Allow the contract to receive ETH directly (treated as deposit).
    receive() external payable {
        freeCollateral[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }
}
