// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {MockV3Aggregator} from "@chainlink/contracts/src/v0.8/tests/MockV3Aggregator.sol";
import {MockUSDC} from "../../src/MockUSDC.sol";
import {CLP} from "../../src/pool/CLP.sol";
import {LiquidityPool} from "../../src/pool/LiquidityPool.sol";
import {PerpEngine} from "../../src/PerpEngine.sol";
import {PerpTestBase} from "../utils/PerpTestBase.sol";

/// @notice Random actions against the live system; ghost variables track what the protocol owes.
contract PerpHandler is Test {
    PerpEngine internal engine;
    LiquidityPool internal pool;
    MockUSDC internal usdc;
    CLP internal clp;
    MockV3Aggregator[2] internal feeds;
    bytes32[2] internal markets;
    address internal keeper;

    address[3] public actors;

    // Ghosts
    uint256 public ghostTraderIn; // USDC traders put into positions (escrow that was executed)
    uint256 public ghostTraderOut; // USDC traders took out of positions
    uint256 public ghostReserveBudget; // cumulative reserve increases = max profit ever promised
    uint256 public calls;
    uint256 public opened;
    uint256 public closed;
    uint256 public liquidated;

    constructor(
        PerpEngine engine_,
        LiquidityPool pool_,
        MockUSDC usdc_,
        CLP clp_,
        MockV3Aggregator ethFeed,
        MockV3Aggregator btcFeed,
        address keeper_
    ) {
        engine = engine_;
        pool = pool_;
        usdc = usdc_;
        clp = clp_;
        feeds = [ethFeed, btcFeed];
        markets = [keccak256("ETH-USD"), keccak256("BTC-USD")];
        keeper = keeper_;
        actors = [makeAddr("actor0"), makeAddr("actor1"), makeAddr("actor2")];
    }

    // ── LP ──

    function addLiquidity(uint256 actorSeed, uint256 amount) external {
        calls++;
        address a = actors[actorSeed % 3];
        amount = bound(amount, 1e6, 1_000_000e6);
        vm.prank(a);
        try pool.addLiquidity(amount, 0) {} catch {}
    }

    function removeLiquidity(uint256 actorSeed, uint256 pct) external {
        calls++;
        address a = actors[actorSeed % 3];
        uint256 bal = clp.balanceOf(a);
        if (bal == 0) return;
        uint256 amount = bal * bound(pct, 1, 100) / 100;
        vm.prank(a);
        try pool.removeLiquidity(amount, 0) {} catch {}
    }

    // ── Trading ──

    function openPosition(uint256 actorSeed, uint256 marketSeed, bool isLong, uint256 coll, uint256 lev) external {
        calls++;
        address a = actors[actorSeed % 3];
        bytes32 m = markets[marketSeed % 2];
        coll = bound(coll, 10e6, 20_000e6);
        lev = bound(lev, 5, 20);
        uint256 size = coll * lev * 99 / 100 + 1;

        uint256 reservedBefore = pool.reservedAmount();
        uint256 balBefore = usdc.balanceOf(a);
        vm.prank(a);
        uint256 id;
        try engine.requestIncrease{value: 0.0002 ether}(m, isLong, coll, size, isLong ? type(uint256).max : 0)
        returns (uint256 id_) {
            id = id_;
        } catch {
            return;
        }
        _execute(id);
        _trackReserve(reservedBefore);
        if (engine.getRequest(id).status == PerpEngine.RequestStatus.Executed) {
            opened++;
            ghostTraderIn += balBefore - usdc.balanceOf(a);
        }
    }

    function decreasePosition(uint256 actorSeed, uint256 marketSeed, bool isLong, uint256 pct, uint256 withdraw)
        external
    {
        calls++;
        address a = actors[actorSeed % 3];
        bytes32 m = markets[marketSeed % 2];
        PerpEngine.Position memory p = engine.getPosition(engine.getPositionKey(a, m, isLong));
        if (p.size == 0) return;
        pct = bound(pct, 1, 100);
        uint256 sizeDelta = pct == 100 ? p.size : p.size * pct / 100;
        withdraw = bound(withdraw, 0, p.collateral / 2);

        uint256 reservedBefore = pool.reservedAmount();
        uint256 balBefore = usdc.balanceOf(a);
        vm.prank(a);
        uint256 id = engine.requestDecrease{value: 0.0002 ether}(m, isLong, withdraw, sizeDelta, isLong ? 0 : type(uint256).max);
        _execute(id);
        _trackReserve(reservedBefore);
        ghostTraderOut += usdc.balanceOf(a) - balBefore;
        if (engine.getRequest(id).status == PerpEngine.RequestStatus.Executed) closed++;
    }

    /// Keeper sweep: liquidate every under-margined position, like the real keeper will.
    function liquidateAll() external {
        calls++;
        for (uint256 i; i < 3; ++i) {
            for (uint256 j; j < 4; ++j) {
                bytes32 key = engine.getPositionKey(actors[i], markets[j % 2], j < 2);
                if (!engine.isLiquidatable(key)) continue;
                vm.prank(keeper);
                engine.liquidate(key);
                liquidated++;
            }
        }
    }

    function cancelExpired(uint256 actorSeed) external {
        calls++;
        address a = actors[actorSeed % 3];
        uint256[] memory ids = engine.getPendingRequestIds(a);
        if (ids.length == 0) return;
        vm.warp(block.timestamp + 61);
        _refresh();
        vm.prank(a);
        engine.cancelRequest(ids[0]);
    }

    function leavePending(uint256 actorSeed, uint256 coll) external {
        calls++;
        address a = actors[actorSeed % 3];
        coll = bound(coll, 10e6, 10_000e6);
        vm.prank(a);
        try engine.requestIncrease{value: 0.0002 ether}(markets[0], true, coll, coll * 2, type(uint256).max) {} catch {}
    }

    // ── Environment ──

    function movePrice(uint256 marketSeed, uint256 bpsSeed, bool up) external {
        calls++;
        MockV3Aggregator f = feeds[marketSeed % 2];
        uint256 bps = bound(bpsSeed, 0, 1_500);
        int256 price = f.latestAnswer();
        int256 next = up ? price * int256(10_000 + bps) / 10_000 : price * int256(10_000 - bps) / 10_000;
        if (next < 100e8) next = 100e8;
        if (next > 1_000_000e8) next = 1_000_000e8;
        f.updateAnswer(next);
    }

    function warp(uint256 seconds_) external {
        calls++;
        vm.warp(block.timestamp + bound(seconds_, 1, 1 hours));
        _refresh();
        engine.updateFunding(markets[0]);
        engine.updateFunding(markets[1]);
    }

    // ── helpers ──

    function sumPositionCollateral() external view returns (uint256 total) {
        for (uint256 i; i < 3; ++i) {
            for (uint256 j; j < 2; ++j) {
                total += engine.getPosition(engine.getPositionKey(actors[i], markets[j], true)).collateral;
                total += engine.getPosition(engine.getPositionKey(actors[i], markets[j], false)).collateral;
            }
        }
    }

    function sumSideSize(uint256 marketIdx, bool isLong) external view returns (uint256 total) {
        for (uint256 i; i < 3; ++i) {
            total += engine.getPosition(engine.getPositionKey(actors[i], markets[marketIdx], isLong)).size;
        }
    }

    function _execute(uint256 id) internal {
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(keeper);
        engine.executeRequests(ids);
    }

    function _trackReserve(uint256 before) internal {
        uint256 afterR = pool.reservedAmount();
        if (afterR > before) ghostReserveBudget += afterR - before;
    }

    function _refresh() internal {
        feeds[0].updateAnswer(feeds[0].latestAnswer());
        feeds[1].updateAnswer(feeds[1].latestAnswer());
    }
}

contract PerpInvariantsTest is StdInvariant, PerpTestBase {
    PerpHandler internal handler;

    function setUp() public override {
        super.setUp();
        engine.setMinExecutionFee(0.0002 ether);
        handler = new PerpHandler(engine, pool, usdc, clp, ethFeed, btcFeed, keeper);
        for (uint256 i; i < 3; ++i) _fund(handler.actors(i), 10_000_000e6);
        targetContract(address(handler));
    }

    /// Pool always holds at least every bucket it owes, and reserves never exceed LP liquidity.
    function invariant_PoolSolvent() public view {
        _assertPoolSolvent();
    }

    /// Collateral bucket equals the sum of open positions' collateral.
    function invariant_CollateralAccounting() public view {
        assertEq(pool.totalCollateral(), handler.sumPositionCollateral());
    }

    /// Market open interest equals the sum of position sizes per side.
    function invariant_OpenInterestAccounting() public view {
        (,,, uint256 ethLong, uint256 ethShort,,,,,,) = engine.markets(ETH);
        (,,, uint256 btcLong, uint256 btcShort,,,,,,) = engine.markets(BTC);
        assertEq(ethLong, handler.sumSideSize(0, true));
        assertEq(ethShort, handler.sumSideSize(0, false));
        assertEq(btcLong, handler.sumSideSize(1, true));
        assertEq(btcShort, handler.sumSideSize(1, false));
    }

    /// Escrow bucket equals the sum of pending increase requests.
    function invariant_EscrowAccounting() public view {
        uint256 total;
        for (uint256 i; i < 3; ++i) {
            uint256[] memory ids = engine.getPendingRequestIds(handler.actors(i));
            for (uint256 j; j < ids.length; ++j) {
                PerpEngine.Request memory r = engine.getRequest(ids[j]);
                if (r.kind == PerpEngine.RequestKind.Increase) total += r.collateralDelta;
            }
        }
        assertEq(pool.totalEscrow(), total);
    }

    /// CLP outstanding implies the pool is worth something.
    function invariant_ClpBacked() public view {
        if (clp.totalSupply() > 0) assertGt(pool.getAum(), 0);
    }

    /// Traders can never extract more than they put in plus the profit the pool reserved for them.
    function invariant_TradersBoundedByReserves() public view {
        assertLe(handler.ghostTraderOut(), handler.ghostTraderIn() + handler.ghostReserveBudget());
    }

    function invariant_callSummary() public view {
        console.log("calls", handler.calls());
        console.log("opened", handler.opened());
        console.log("closed", handler.closed());
        console.log("liquidated", handler.liquidated());
    }
}
