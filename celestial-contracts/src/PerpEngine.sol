// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IChainlinkOracle} from "./interfaces/IChainlinkOracle.sol";
import {ILiquidityPool} from "./interfaces/ILiquidityPool.sol";
import {IPerpEngine} from "./interfaces/IPerpEngine.sol";
import {PerpMath} from "./libraries/PerpMath.sol";

/**
 * @title PerpEngine
 * @notice Celestial Perps trading engine (pool-counterparty model, GMX/Jupiter style).
 *
 *   Flow: trader requests (USDC escrowed in the pool + ETH execution fee) → keeper executes
 *   at the Chainlink price ± execution spread → position held against the LiquidityPool.
 *   Funding is skew-based and paid by the heavier side to LPs. Profit per position is capped
 *   by a reserve locked in the pool, which keeps the pool solvent.
 *
 *   All math lives in PerpMath (see docs/perp-math.md). Rounding is always against the trader.
 */
contract PerpEngine is IPerpEngine, Ownable2Step, Pausable, ReentrancyGuard {
    using EnumerableSet for EnumerableSet.UintSet;

    // ═══════════════════════════════════════════════════════════
    //  TYPES
    // ═══════════════════════════════════════════════════════════

    enum RequestKind {
        Increase,
        Decrease
    }

    enum RequestStatus {
        None,
        Pending,
        Executed,
        Cancelled
    }

    struct Request {
        address account;
        bytes32 market;
        bool isLong;
        RequestKind kind;
        RequestStatus status;
        uint64 createdAt;
        uint256 collateralDelta; // increase: escrowed USDC in; decrease: USDC to withdraw
        uint256 sizeDelta;
        uint256 acceptablePrice;
        uint256 executionFee;
    }

    struct Position {
        address account;
        bytes32 market;
        bool isLong;
        uint256 size;
        uint256 collateral;
        uint256 tokens;
        uint256 reserved;
        uint256 entryFundingIndex;
        uint64 lastUpdated;
    }

    struct Market {
        bool listed;
        bool enabled;
        uint64 lastFundingTime;
        uint256 longSize;
        uint256 shortSize;
        uint256 longTokens;
        uint256 shortTokens;
        uint256 longCollateral;
        uint256 shortCollateral;
        uint256 cumFundingLong;
        uint256 cumFundingShort;
    }

    struct MarketInfo {
        bool enabled;
        uint256 price;
        uint256 longSize;
        uint256 shortSize;
        uint256 longCapacity;
        uint256 shortCapacity;
        uint256 fundingRateLongPerHour;
        uint256 fundingRateShortPerHour;
        uint256 cumFundingLong;
        uint256 cumFundingShort;
    }

    // ═══════════════════════════════════════════════════════════
    //  CONSTANTS & STATE
    // ═══════════════════════════════════════════════════════════

    uint256 private constant BPS = PerpMath.BPS;

    IChainlinkOracle public immutable oracle;
    ILiquidityPool public immutable pool;

    // ── Params (see docs/protocol-spec.md) ──
    uint256 public maxLeverage = 20;
    uint256 public maintenanceMarginBps = 250;
    uint256 public positionFeeBps = 6;
    uint256 public liquidationFeeBps = 50;
    uint256 public executionSpreadBps = 10;
    uint256 public maxProfitMultiplier = 9;
    uint256 public oiCapBps = 3_000;
    uint256 public fundingFactorPerHour = 3e14;
    uint256 public maxFundingRatePerHour = 1e14;
    uint256 public requestExpiry = 60;
    uint256 public minExecutionFee = 0.0002 ether;
    uint256 public minCollateral = 10e6;

    mapping(address => bool) public isKeeper;

    bytes32[] public marketIds;
    mapping(bytes32 => Market) public markets;

    mapping(bytes32 => Position) internal _positions;

    uint256 public nextRequestId = 1;
    mapping(uint256 => Request) internal _requests;
    mapping(address => EnumerableSet.UintSet) internal _pendingRequests;

    // ═══════════════════════════════════════════════════════════
    //  EVENTS
    // ═══════════════════════════════════════════════════════════

    event KeeperUpdated(address indexed keeper, bool active);
    event MarketListed(bytes32 indexed market);
    event MarketEnabled(bytes32 indexed market, bool enabled);
    event ParamUpdated(bytes32 indexed key, uint256 value);

    event RequestCreated(
        uint256 indexed id,
        address indexed account,
        bytes32 indexed market,
        bool isLong,
        RequestKind kind,
        uint256 collateralDelta,
        uint256 sizeDelta,
        uint256 acceptablePrice,
        uint256 executionFee
    );
    event RequestExecuted(uint256 indexed id, address indexed account, address indexed keeper);
    event RequestCancelled(uint256 indexed id, address indexed account, address indexed by, bytes reason);

    event PositionIncreased(
        bytes32 indexed key,
        address indexed account,
        bytes32 indexed market,
        bool isLong,
        uint256 sizeDelta,
        uint256 collateralDelta,
        uint256 executionPrice,
        uint256 fee,
        uint256 fundingPaid,
        uint256 size,
        uint256 collateral,
        uint256 entryPrice
    );
    event PositionDecreased(
        bytes32 indexed key,
        address indexed account,
        bytes32 indexed market,
        bool isLong,
        uint256 sizeDelta,
        uint256 collateralOut,
        uint256 executionPrice,
        int256 realisedPnl,
        uint256 fee,
        uint256 fundingPaid,
        uint256 size,
        uint256 collateral
    );
    event PositionClosed(bytes32 indexed key, address indexed account, bytes32 indexed market, bool isLong);
    event PositionLiquidated(
        bytes32 indexed key,
        address indexed account,
        bytes32 indexed market,
        bool isLong,
        uint256 size,
        uint256 collateral,
        uint256 price,
        address keeper,
        uint256 keeperFee
    );
    event FundingUpdated(bytes32 indexed market, uint256 rateLongPerHour, uint256 rateShortPerHour, uint256 cumLong, uint256 cumShort);

    // ═══════════════════════════════════════════════════════════
    //  ERRORS
    // ═══════════════════════════════════════════════════════════

    error NotKeeper();
    error OnlySelf();
    error ZeroAddress();
    error InvalidParam(bytes32 key, uint256 value);
    error MarketNotListed(bytes32 market);
    error MarketAlreadyListed(bytes32 market);
    error MarketDisabled(bytes32 market);
    error NoOracleFeed(bytes32 market);
    error InsufficientExecutionFee(uint256 sent, uint256 min);
    error EmptyRequest();
    error RequestNotPending(uint256 id);
    error NotRequestOwner(uint256 id);
    error RequestNotExpired(uint256 id, uint256 cancellableAt);
    error SlippageExceeded(uint256 executionPrice, uint256 acceptablePrice);
    error PositionNotFound(bytes32 key);
    error SizeTooLarge(uint256 sizeDelta, uint256 size);
    error CollateralTooLow(uint256 collateral, uint256 min);
    error LeverageTooLow(uint256 size, uint256 collateral);
    error LeverageTooHigh(uint256 size, uint256 maxSize);
    error OpenInterestCap(uint256 sideSize, uint256 cap);
    error PositionLiquidatable(bytes32 key);
    error NotLiquidatable(bytes32 key);
    error InsufficientCollateral(uint256 required, uint256 available);
    error EthTransferFailed();

    modifier onlyKeeper() {
        if (!isKeeper[msg.sender]) revert NotKeeper();
        _;
    }

    constructor(IChainlinkOracle oracle_, ILiquidityPool pool_) Ownable(msg.sender) {
        if (address(oracle_) == address(0) || address(pool_) == address(0)) revert ZeroAddress();
        oracle = oracle_;
        pool = pool_;
    }

    // ═══════════════════════════════════════════════════════════
    //  TRADER — REQUESTS
    // ═══════════════════════════════════════════════════════════

    /// @notice Request to open/increase a position. Escrows `collateralDelta` USDC in the pool
    ///         (approve the POOL, not the engine) and holds `msg.value` as the keeper's fee.
    function requestIncrease(
        bytes32 market,
        bool isLong,
        uint256 collateralDelta,
        uint256 sizeDelta,
        uint256 acceptablePrice
    ) external payable nonReentrant whenNotPaused returns (uint256 id) {
        Market storage m = markets[market];
        if (!m.listed) revert MarketNotListed(market);
        if (!m.enabled) revert MarketDisabled(market);
        if (collateralDelta == 0 && sizeDelta == 0) revert EmptyRequest();

        id = _createRequest(market, isLong, RequestKind.Increase, collateralDelta, sizeDelta, acceptablePrice);
        pool.escrowIn(msg.sender, collateralDelta);
    }

    /// @notice Request to decrease/close a position. `sizeDelta == size` closes it fully and
    ///         returns all remaining collateral; otherwise `collateralDelta` USDC is withdrawn.
    function requestDecrease(
        bytes32 market,
        bool isLong,
        uint256 collateralDelta,
        uint256 sizeDelta,
        uint256 acceptablePrice
    ) external payable nonReentrant returns (uint256 id) {
        if (!markets[market].listed) revert MarketNotListed(market);
        if (collateralDelta == 0 && sizeDelta == 0) revert EmptyRequest();
        id = _createRequest(market, isLong, RequestKind.Decrease, collateralDelta, sizeDelta, acceptablePrice);
    }

    /// @notice Cancel your own pending request after `requestExpiry`. Refunds escrow and fee.
    function cancelRequest(uint256 id) external nonReentrant {
        Request storage r = _requests[id];
        if (r.status != RequestStatus.Pending) revert RequestNotPending(id);
        if (r.account != msg.sender) revert NotRequestOwner(id);
        uint256 cancellableAt = r.createdAt + requestExpiry;
        if (block.timestamp < cancellableAt) revert RequestNotExpired(id, cancellableAt);

        _cancel(id, "", r.account);
        _sendEth(r.account, r.executionFee);
    }

    // ═══════════════════════════════════════════════════════════
    //  KEEPER
    // ═══════════════════════════════════════════════════════════

    /// @notice Execute pending requests. A failing request is cancelled and refunded; it never
    ///         reverts the batch. The keeper earns every processed request's execution fee.
    function executeRequests(uint256[] calldata ids) external nonReentrant onlyKeeper {
        uint256 feeTotal;
        for (uint256 i; i < ids.length; ++i) {
            uint256 id = ids[i];
            Request storage r = _requests[id];
            if (r.status != RequestStatus.Pending) continue;
            feeTotal += r.executionFee;

            try this.executeRequestInternal(id) {
                emit RequestExecuted(id, r.account, msg.sender);
            } catch (bytes memory reason) {
                _cancel(id, reason, msg.sender);
            }
        }
        _sendEth(msg.sender, feeTotal);
    }

    /// @dev Self-call target so each request executes (and can revert) in isolation.
    function executeRequestInternal(uint256 id) external {
        if (msg.sender != address(this)) revert OnlySelf();
        Request storage r = _requests[id];
        r.status = RequestStatus.Executed;
        _pendingRequests[r.account].remove(id);

        if (r.kind == RequestKind.Increase) {
            _requireNotPaused();
            _increase(r);
        } else {
            _decrease(r);
        }
    }

    /// @notice Liquidate an under-margined position at the raw oracle price.
    function liquidate(bytes32 key) external nonReentrant onlyKeeper {
        Position memory p = _positions[key];
        if (p.size == 0) revert PositionNotFound(key);

        _updateFunding(p.market);
        uint256 price = oracle.getPrice(p.market);
        uint256 funding = _fundingOwed(p);
        int256 pnl_ = PerpMath.pnl(p.isLong, p.size, p.tokens, price);
        if (!PerpMath.isLiquidatable(
            p.collateral, pnl_, funding, PerpMath.positionFee(p.size, positionFeeBps), p.size, maintenanceMarginBps
        )) revert NotLiquidatable(key);

        _removeFromMarket(p);
        delete _positions[key];

        uint256 keeperFee = Math.min(Math.mulDiv(p.size, liquidationFeeBps, BPS), p.collateral);
        pool.unreserve(p.reserved);
        pool.collateralToPool(p.collateral - keeperFee);
        pool.collateralOut(msg.sender, keeperFee);

        emit PositionLiquidated(key, p.account, p.market, p.isLong, p.size, p.collateral, price, msg.sender, keeperFee);
    }

    /// @notice Accrue funding for a market (keeper calls hourly; also runs on every trade).
    function updateFunding(bytes32 market) external nonReentrant {
        if (!markets[market].listed) revert MarketNotListed(market);
        _updateFunding(market);
    }

    // ═══════════════════════════════════════════════════════════
    //  INTERNAL — EXECUTION
    // ═══════════════════════════════════════════════════════════

    function _increase(Request storage r) internal {
        Market storage m = markets[r.market];
        if (!m.enabled) revert MarketDisabled(r.market);

        _updateFunding(r.market);
        uint256 aum = pool.getAum();
        uint256 exec = PerpMath.executionPrice(oracle.getPrice(r.market), r.isLong, true, executionSpreadBps);
        if (r.isLong ? exec > r.acceptablePrice : exec < r.acceptablePrice) {
            revert SlippageExceeded(exec, r.acceptablePrice);
        }

        bytes32 key = getPositionKey(r.account, r.market, r.isLong);
        Position memory p = _positions[key];
        if (p.size == 0) {
            p.account = r.account;
            p.market = r.market;
            p.isLong = r.isLong;
        } else {
            _removeFromMarket(p);
        }

        // Settle funding accrued on the existing position.
        uint256 funding = _fundingOwed(p);
        if (funding >= p.collateral + r.collateralDelta) {
            revert InsufficientCollateral(funding, p.collateral + r.collateralDelta);
        }

        // Move escrow into collateral, then charge funding and the open fee.
        pool.escrowToCollateral(r.collateralDelta);
        p.collateral += r.collateralDelta;
        if (funding > 0) {
            p.collateral -= funding;
            pool.collateralToPool(funding);
        }
        uint256 fee = PerpMath.positionFee(r.sizeDelta, positionFeeBps);
        if (fee >= p.collateral) revert InsufficientCollateral(fee, p.collateral);
        p.collateral -= fee;
        pool.collateralToFees(fee);

        p.size += r.sizeDelta;
        p.tokens += PerpMath.tokensFor(r.sizeDelta, exec, r.isLong);
        p.entryFundingIndex = r.isLong ? m.cumFundingLong : m.cumFundingShort;
        p.lastUpdated = uint64(block.timestamp);

        // Open-interest cap on the side after this increase.
        uint256 sideSize = (r.isLong ? m.longSize : m.shortSize) + p.size;
        uint256 cap = Math.mulDiv(aum, oiCapBps, BPS);
        if (sideSize > cap) revert OpenInterestCap(sideSize, cap);

        _validatePosition(key, p);
        _setReserve(p, maxProfitMultiplier * p.collateral);

        _positions[key] = p;
        _addToMarket(p);

        emit PositionIncreased(
            key, p.account, p.market, p.isLong, r.sizeDelta, r.collateralDelta, exec, fee, funding,
            p.size, p.collateral, PerpMath.entryPrice(p.size, p.tokens)
        );
    }

    function _decrease(Request storage r) internal {
        bytes32 key = getPositionKey(r.account, r.market, r.isLong);
        Position memory p = _positions[key];
        if (p.size == 0) revert PositionNotFound(key);
        if (r.sizeDelta > p.size) revert SizeTooLarge(r.sizeDelta, p.size);

        _updateFunding(r.market);
        uint256 exec = PerpMath.executionPrice(oracle.getPrice(r.market), r.isLong, false, executionSpreadBps);
        if (r.isLong ? exec < r.acceptablePrice : exec > r.acceptablePrice) {
            revert SlippageExceeded(exec, r.acceptablePrice);
        }

        _removeFromMarket(p);
        bool isFull = r.sizeDelta == p.size;

        // Realise PnL on the closed portion.
        uint256 tokensOut = isFull ? p.tokens : Math.mulDiv(p.tokens, r.sizeDelta, p.size);
        int256 pnl_ = PerpMath.pnl(p.isLong, r.sizeDelta, tokensOut, exec);
        uint256 funding = _fundingOwed(p);
        uint256 fee = PerpMath.positionFee(r.sizeDelta, positionFeeBps);

        uint256 profit;
        uint256 loss;
        if (pnl_ > 0) profit = Math.min(uint256(pnl_), p.reserved);
        else loss = uint256(-pnl_);
        int256 realised = pnl_ > 0 ? int256(profit) : pnl_; // profit capped by the reserve

        uint256 charges = loss + funding + fee;
        if (charges > p.collateral) revert PositionLiquidatable(key);
        p.collateral -= charges;

        uint256 collateralOut = isFull ? p.collateral : r.collateralDelta;
        if (collateralOut > p.collateral) revert InsufficientCollateral(collateralOut, p.collateral);
        p.collateral -= collateralOut;

        p.size -= r.sizeDelta;
        p.tokens -= tokensOut;
        p.entryFundingIndex = p.isLong ? markets[p.market].cumFundingLong : markets[p.market].cumFundingShort;
        p.lastUpdated = uint64(block.timestamp);

        // Settle buckets: losses + funding → pool, fee → fees, profit ← pool, collateral → trader.
        if (loss + funding > 0) pool.collateralToPool(loss + funding);
        pool.collateralToFees(fee);

        uint256 oldReserve = p.reserved;
        pool.unreserve(oldReserve);
        p.reserved = 0;
        pool.poolToTrader(p.account, profit);
        pool.collateralOut(p.account, collateralOut);

        if (isFull) {
            delete _positions[key];
            emit PositionDecreased(
                key, p.account, p.market, p.isLong, r.sizeDelta, collateralOut, exec, realised, fee, funding, 0, 0
            );
            emit PositionClosed(key, p.account, p.market, p.isLong);
            return;
        }

        _validatePosition(key, p);
        // Never re-reserve more than was released minus profit paid, so a partial close can't fail on capacity.
        uint256 newReserve = Math.min(maxProfitMultiplier * p.collateral, oldReserve - profit);
        pool.reserve(newReserve);
        p.reserved = newReserve;

        _positions[key] = p;
        _addToMarket(p);

        emit PositionDecreased(
            key, p.account, p.market, p.isLong, r.sizeDelta, collateralOut, exec, realised, fee, funding,
            p.size, p.collateral
        );
    }

    /// @dev Checks a (non-empty) position after an update: min collateral, 1x ≤ leverage ≤ max,
    ///      and not liquidatable at the raw oracle price.
    function _validatePosition(bytes32 key, Position memory p) internal view {
        if (p.collateral < minCollateral) revert CollateralTooLow(p.collateral, minCollateral);
        if (p.size < p.collateral) revert LeverageTooLow(p.size, p.collateral);
        uint256 maxSize = p.collateral * maxLeverage;
        if (p.size > maxSize) revert LeverageTooHigh(p.size, maxSize);

        int256 pnl_ = PerpMath.pnl(p.isLong, p.size, p.tokens, oracle.getPrice(p.market));
        if (PerpMath.isLiquidatable(
            p.collateral, pnl_, 0, PerpMath.positionFee(p.size, positionFeeBps), p.size, maintenanceMarginBps
        )) revert PositionLiquidatable(key);
    }

    function _setReserve(Position memory p, uint256 target) internal {
        if (target > p.reserved) pool.reserve(target - p.reserved);
        else if (target < p.reserved) pool.unreserve(p.reserved - target);
        p.reserved = target;
    }

    function _updateFunding(bytes32 market) internal {
        Market storage m = markets[market];
        uint256 last = m.lastFundingTime;
        if (last == block.timestamp) return;
        m.lastFundingTime = uint64(block.timestamp);
        if (last == 0) return;

        (uint256 rateLong, uint256 rateShort) = _currentFundingRates(m, pool.getAum());
        uint256 elapsed = block.timestamp - last;
        if (rateLong > 0) m.cumFundingLong += PerpMath.fundingIndexDelta(rateLong, elapsed);
        if (rateShort > 0) m.cumFundingShort += PerpMath.fundingIndexDelta(rateShort, elapsed);
        emit FundingUpdated(market, rateLong, rateShort, m.cumFundingLong, m.cumFundingShort);
    }

    function _currentFundingRates(Market storage m, uint256 aum)
        internal
        view
        returns (uint256 rateLong, uint256 rateShort)
    {
        uint256 rate = PerpMath.fundingRatePerHour(
            m.longSize, m.shortSize, aum, fundingFactorPerHour, maxFundingRatePerHour
        );
        if (m.longSize > m.shortSize) rateLong = rate;
        else if (m.shortSize > m.longSize) rateShort = rate;
    }

    function _fundingOwed(Position memory p) internal view returns (uint256) {
        if (p.size == 0) return 0;
        Market storage m = markets[p.market];
        return PerpMath.fundingOwed(p.size, p.isLong ? m.cumFundingLong : m.cumFundingShort, p.entryFundingIndex);
    }

    function _addToMarket(Position memory p) internal {
        Market storage m = markets[p.market];
        if (p.isLong) {
            m.longSize += p.size;
            m.longTokens += p.tokens;
            m.longCollateral += p.collateral;
        } else {
            m.shortSize += p.size;
            m.shortTokens += p.tokens;
            m.shortCollateral += p.collateral;
        }
    }

    function _removeFromMarket(Position memory p) internal {
        Market storage m = markets[p.market];
        if (p.isLong) {
            m.longSize -= p.size;
            m.longTokens -= p.tokens;
            m.longCollateral -= p.collateral;
        } else {
            m.shortSize -= p.size;
            m.shortTokens -= p.tokens;
            m.shortCollateral -= p.collateral;
        }
    }

    function _createRequest(
        bytes32 market,
        bool isLong,
        RequestKind kind,
        uint256 collateralDelta,
        uint256 sizeDelta,
        uint256 acceptablePrice
    ) internal returns (uint256 id) {
        if (msg.value < minExecutionFee) revert InsufficientExecutionFee(msg.value, minExecutionFee);
        id = nextRequestId++;
        _requests[id] = Request({
            account: msg.sender,
            market: market,
            isLong: isLong,
            kind: kind,
            status: RequestStatus.Pending,
            createdAt: uint64(block.timestamp),
            collateralDelta: collateralDelta,
            sizeDelta: sizeDelta,
            acceptablePrice: acceptablePrice,
            executionFee: msg.value
        });
        _pendingRequests[msg.sender].add(id);
        emit RequestCreated(id, msg.sender, market, isLong, kind, collateralDelta, sizeDelta, acceptablePrice, msg.value);
    }

    function _cancel(uint256 id, bytes memory reason, address by) internal {
        Request storage r = _requests[id];
        r.status = RequestStatus.Cancelled;
        _pendingRequests[r.account].remove(id);
        if (r.kind == RequestKind.Increase) pool.escrowRefund(r.account, r.collateralDelta);
        emit RequestCancelled(id, r.account, by, reason);
    }

    function _sendEth(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }

    // ═══════════════════════════════════════════════════════════
    //  VIEWS
    // ═══════════════════════════════════════════════════════════

    function getPositionKey(address account, bytes32 market, bool isLong) public pure returns (bytes32) {
        return keccak256(abi.encode(account, market, isLong));
    }

    function getPosition(bytes32 key) external view returns (Position memory) {
        return _positions[key];
    }

    function getRequest(uint256 id) external view returns (Request memory) {
        return _requests[id];
    }

    function getPendingRequestIds(address account) external view returns (uint256[] memory) {
        return _pendingRequests[account].values();
    }

    function getMarketIds() external view returns (bytes32[] memory) {
        return marketIds;
    }

    /// @notice Unrealised PnL at the raw oracle price, before funding and fees.
    function getPnl(bytes32 key) external view returns (int256) {
        Position memory p = _positions[key];
        if (p.size == 0) return 0;
        return PerpMath.pnl(p.isLong, p.size, p.tokens, oracle.getPrice(p.market));
    }

    /// @notice Funding owed by a position up to the last funding update.
    function getFundingOwed(bytes32 key) external view returns (uint256) {
        return _fundingOwed(_positions[key]);
    }

    function getLiquidationPrice(bytes32 key) external view returns (uint256) {
        Position memory p = _positions[key];
        return PerpMath.liquidationPrice(
            p.isLong, p.size, p.tokens, p.collateral, _fundingOwed(p),
            PerpMath.positionFee(p.size, positionFeeBps), maintenanceMarginBps
        );
    }

    function isLiquidatable(bytes32 key) external view returns (bool) {
        Position memory p = _positions[key];
        if (p.size == 0) return false;
        int256 pnl_ = PerpMath.pnl(p.isLong, p.size, p.tokens, oracle.getPrice(p.market));
        return PerpMath.isLiquidatable(
            p.collateral, pnl_, _fundingOwed(p), PerpMath.positionFee(p.size, positionFeeBps), p.size,
            maintenanceMarginBps
        );
    }

    function getMarketInfo(bytes32 market) external view returns (MarketInfo memory info) {
        Market storage m = markets[market];
        if (!m.listed) revert MarketNotListed(market);
        uint256 aum = pool.getAum();
        uint256 cap = Math.mulDiv(aum, oiCapBps, BPS);
        (uint256 rateLong, uint256 rateShort) = _currentFundingRates(m, aum);
        info = MarketInfo({
            enabled: m.enabled,
            price: oracle.getPrice(market),
            longSize: m.longSize,
            shortSize: m.shortSize,
            longCapacity: cap > m.longSize ? cap - m.longSize : 0,
            shortCapacity: cap > m.shortSize ? cap - m.shortSize : 0,
            fundingRateLongPerHour: rateLong,
            fundingRateShortPerHour: rateShort,
            cumFundingLong: m.cumFundingLong,
            cumFundingShort: m.cumFundingShort
        });
    }

    /// @inheritdoc IPerpEngine
    function getNetTraderPnl() public view returns (int256 net) {
        for (uint256 i; i < marketIds.length; ++i) {
            Market storage m = markets[marketIds[i]];
            if (m.longSize == 0 && m.shortSize == 0) continue;
            uint256 price = oracle.getPrice(marketIds[i]);
            int256 marketPnl = PerpMath.pnl(true, m.longSize, m.longTokens, price)
                + PerpMath.pnl(false, m.shortSize, m.shortTokens, price);
            int256 floor_ = -int256(m.longCollateral + m.shortCollateral);
            net += marketPnl < floor_ ? floor_ : marketPnl;
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  ADMIN
    // ═══════════════════════════════════════════════════════════

    function listMarket(bytes32 market) external onlyOwner {
        if (markets[market].listed) revert MarketAlreadyListed(market);
        if (!oracle.hasFeed(market)) revert NoOracleFeed(market);
        markets[market].listed = true;
        markets[market].enabled = true;
        markets[market].lastFundingTime = uint64(block.timestamp);
        marketIds.push(market);
        emit MarketListed(market);
        emit MarketEnabled(market, true);
    }

    function setMarketEnabled(bytes32 market, bool enabled) external onlyOwner {
        if (!markets[market].listed) revert MarketNotListed(market);
        markets[market].enabled = enabled;
        emit MarketEnabled(market, enabled);
    }

    function setKeeper(address keeper, bool active) external onlyOwner {
        if (keeper == address(0)) revert ZeroAddress();
        isKeeper[keeper] = active;
        emit KeeperUpdated(keeper, active);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setMarginParams(uint256 maxLeverage_, uint256 maintenanceMarginBps_) external onlyOwner {
        if (maxLeverage_ == 0 || maxLeverage_ * maintenanceMarginBps_ >= BPS || maintenanceMarginBps_ == 0) {
            revert InvalidParam("maxLeverage*mmBps", maxLeverage_ * maintenanceMarginBps_);
        }
        maxLeverage = maxLeverage_;
        maintenanceMarginBps = maintenanceMarginBps_;
        emit ParamUpdated("maxLeverage", maxLeverage_);
        emit ParamUpdated("maintenanceMarginBps", maintenanceMarginBps_);
    }

    function setPositionFeeBps(uint256 v) external onlyOwner {
        _setBounded("positionFeeBps", v, 0, 100);
        positionFeeBps = v;
    }

    function setLiquidationFeeBps(uint256 v) external onlyOwner {
        _setBounded("liquidationFeeBps", v, 0, 200);
        liquidationFeeBps = v;
    }

    function setExecutionSpreadBps(uint256 v) external onlyOwner {
        _setBounded("executionSpreadBps", v, 0, 100);
        executionSpreadBps = v;
    }

    function setMaxProfitMultiplier(uint256 v) external onlyOwner {
        _setBounded("maxProfitMultiplier", v, 1, 20);
        maxProfitMultiplier = v;
    }

    function setOiCapBps(uint256 v) external onlyOwner {
        _setBounded("oiCapBps", v, 0, BPS);
        oiCapBps = v;
    }

    function setFundingParams(uint256 factorPerHour, uint256 maxRatePerHour) external onlyOwner {
        _setBounded("fundingFactorPerHour", factorPerHour, 0, 1e16);
        _setBounded("maxFundingRatePerHour", maxRatePerHour, 0, 1e16);
        // Settle accrued funding at the old rates first.
        for (uint256 i; i < marketIds.length; ++i) _updateFunding(marketIds[i]);
        fundingFactorPerHour = factorPerHour;
        maxFundingRatePerHour = maxRatePerHour;
    }

    function setRequestExpiry(uint256 v) external onlyOwner {
        _setBounded("requestExpiry", v, 10, 1 hours);
        requestExpiry = v;
    }

    function setMinExecutionFee(uint256 v) external onlyOwner {
        _setBounded("minExecutionFee", v, 0, 0.01 ether);
        minExecutionFee = v;
    }

    function setMinCollateral(uint256 v) external onlyOwner {
        _setBounded("minCollateral", v, 1e6, 10_000e6);
        minCollateral = v;
    }

    function _setBounded(bytes32 key, uint256 v, uint256 min, uint256 max) internal {
        if (v < min || v > max) revert InvalidParam(key, v);
        emit ParamUpdated(key, v);
    }
}
