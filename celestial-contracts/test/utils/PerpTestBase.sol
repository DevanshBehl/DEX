// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockV3Aggregator} from "@chainlink/contracts/src/v0.8/tests/MockV3Aggregator.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "../../src/MockUSDC.sol";
import {ChainlinkOracle} from "../../src/oracle/ChainlinkOracle.sol";
import {CLP} from "../../src/pool/CLP.sol";
import {LiquidityPool} from "../../src/pool/LiquidityPool.sol";
import {PerpEngine} from "../../src/PerpEngine.sol";

/// @notice Shared deployment + helpers for engine, pool and invariant tests.
abstract contract PerpTestBase is Test {
    bytes32 internal constant ETH = keccak256("ETH-USD");
    bytes32 internal constant BTC = keccak256("BTC-USD");
    bytes32 internal constant SOL = keccak256("SOL-USD");

    int256 internal constant ETH_PRICE = 3_000e8;
    int256 internal constant BTC_PRICE = 60_000e8;
    uint256 internal constant SEED = 5_000_000e6;
    uint256 internal constant EXEC_FEE = 0.0002 ether;

    MockUSDC internal usdc;
    MockV3Aggregator internal ethFeed;
    MockV3Aggregator internal btcFeed;
    ChainlinkOracle internal oracle;
    CLP internal clp;
    LiquidityPool internal pool;
    PerpEngine internal engine;

    address internal keeper = makeAddr("keeper");
    address internal lp = makeAddr("lp");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public virtual {
        vm.warp(1_000_000);

        usdc = new MockUSDC();
        ethFeed = new MockV3Aggregator(8, ETH_PRICE);
        btcFeed = new MockV3Aggregator(8, BTC_PRICE);

        oracle = new ChainlinkOracle();
        oracle.setFeed(ETH, address(ethFeed), 3960);
        oracle.setFeed(BTC, address(btcFeed), 3960);

        clp = new CLP();
        pool = new LiquidityPool(IERC20(address(usdc)), clp);
        clp.setPool(address(pool));
        engine = new PerpEngine(oracle, pool);
        pool.setEngine(address(engine));

        engine.listMarket(ETH);
        engine.listMarket(BTC);
        engine.setKeeper(keeper, true);

        _fund(lp, SEED);
        vm.prank(lp);
        pool.addLiquidity(SEED, 0);

        _fund(alice, 1_000_000e6);
        _fund(bob, 1_000_000e6);
    }

    // ── helpers ──

    function _fund(address who, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.deal(who, 10 ether);
        vm.prank(who);
        usdc.approve(address(pool), type(uint256).max);
    }

    function _setPrice(bytes32 market, int256 price) internal {
        (market == ETH ? ethFeed : btcFeed).updateAnswer(price);
    }

    function _refreshPrices() internal {
        ethFeed.updateAnswer(ethFeed.latestAnswer());
        btcFeed.updateAnswer(btcFeed.latestAnswer());
    }

    function _requestIncrease(address who, bytes32 market, bool isLong, uint256 coll, uint256 size)
        internal
        returns (uint256 id)
    {
        vm.prank(who);
        id = engine.requestIncrease{value: EXEC_FEE}(market, isLong, coll, size, isLong ? type(uint256).max : 0);
    }

    function _requestDecrease(address who, bytes32 market, bool isLong, uint256 coll, uint256 size)
        internal
        returns (uint256 id)
    {
        vm.prank(who);
        id = engine.requestDecrease{value: EXEC_FEE}(market, isLong, coll, size, isLong ? 0 : type(uint256).max);
    }

    function _execute(uint256 id) internal {
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(keeper);
        engine.executeRequests(ids);
    }

    function _open(address who, bytes32 market, bool isLong, uint256 coll, uint256 size) internal returns (bytes32) {
        _execute(_requestIncrease(who, market, isLong, coll, size));
        return engine.getPositionKey(who, market, isLong);
    }

    function _close(address who, bytes32 market, bool isLong) internal {
        PerpEngine.Position memory p = engine.getPosition(engine.getPositionKey(who, market, isLong));
        _execute(_requestDecrease(who, market, isLong, 0, p.size));
    }

    function _status(uint256 id) internal view returns (PerpEngine.RequestStatus) {
        return engine.getRequest(id).status;
    }

    /// @dev Pool accounting invariant used across suites.
    function _assertPoolSolvent() internal view {
        assertGe(
            usdc.balanceOf(address(pool)),
            pool.poolAmount() + pool.feeReserves() + pool.totalCollateral() + pool.totalEscrow(),
            "pool balance < buckets"
        );
        assertLe(pool.reservedAmount(), pool.poolAmount(), "reserved > poolAmount");
    }
}
