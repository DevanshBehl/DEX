// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {PerpTestBase} from "./utils/PerpTestBase.sol";
import {PerpEngine} from "../src/PerpEngine.sol";
import {PerpMath} from "../src/libraries/PerpMath.sol";

contract PerpEngineTest is PerpTestBase {
    // Ex 1 (docs/perp-math.md): $1,000 collateral, $10,000 ETH long at $3,000
    uint256 constant C = 1000e6;
    uint256 constant S = 10_000e6;

    // ═══════════════════════════════════════════════════════════
    //  OPEN
    // ═══════════════════════════════════════════════════════════

    function test_OpenLong_Ex1() public {
        uint256 keeperBefore = keeper.balance;
        uint256 id = _requestIncrease(alice, ETH, true, C, S);

        assertEq(uint256(_status(id)), uint256(PerpEngine.RequestStatus.Pending));
        assertEq(engine.getPendingRequestIds(alice).length, 1);
        assertEq(pool.totalEscrow(), C);

        _execute(id);
        bytes32 key = engine.getPositionKey(alice, ETH, true);
        PerpEngine.Position memory p = engine.getPosition(key);

        assertEq(uint256(_status(id)), uint256(PerpEngine.RequestStatus.Executed));
        assertEq(engine.getPendingRequestIds(alice).length, 0);
        assertEq(p.size, S);
        assertEq(p.collateral, 994_000_000);
        assertEq(p.tokens, 3_330_003_330_003_330_003);
        assertEq(p.reserved, 9 * 994_000_000);
        assertEq(PerpMath.entryPrice(p.size, p.tokens), 300_300_000_000);
        assertEq(pool.totalEscrow(), 0);
        assertEq(pool.totalCollateral(), 994_000_000);
        assertEq(pool.reservedAmount(), 9 * 994_000_000);
        assertEq(keeper.balance - keeperBefore, EXEC_FEE);
        assertEq(engine.getLiquidationPrice(key), 278_137_860_001); // Ex 6
        _assertPoolSolvent();
    }

    function test_OpenShort() public {
        bytes32 key = _open(bob, BTC, false, 500e6, 2_500e6);
        PerpEngine.Position memory p = engine.getPosition(key);
        assertEq(p.tokens, 41_708_375_041_708_376); // Ex 3
        assertEq(p.collateral, 500e6 - 1_500_000);
        PerpEngine.MarketInfo memory info = engine.getMarketInfo(BTC);
        assertEq(info.shortSize, 2_500e6);
        assertEq(info.longSize, 0);
    }

    function test_IncreaseAveragesEntry() public {
        bytes32 key = _open(alice, ETH, true, C, S);
        _setPrice(ETH, 3_300e8);
        _execute(_requestIncrease(alice, ETH, true, C, S));

        PerpEngine.Position memory p = engine.getPosition(key);
        uint256 t2 = PerpMath.tokensFor(S, PerpMath.executionPrice(3_300e8, true, true, 10), true);
        assertEq(p.size, 2 * S);
        assertEq(p.tokens, 3_330_003_330_003_330_003 + t2);
        uint256 entry = PerpMath.entryPrice(p.size, p.tokens);
        assertGt(entry, 3_003e8);
        assertLt(entry, 3_303_3e7);
        _assertPoolSolvent();
    }

    // ═══════════════════════════════════════════════════════════
    //  CLOSE / DECREASE
    // ═══════════════════════════════════════════════════════════

    function test_FullCloseProfit_Ex2() public {
        uint256 start = usdc.balanceOf(alice);
        bytes32 key = _open(alice, ETH, true, C, S);
        _setPrice(ETH, 3_300e8);
        _close(alice, ETH, true);

        assertEq(usdc.balanceOf(alice), start - C + 1_966_021_978);
        assertEq(engine.getPosition(key).size, 0);
        assertEq(pool.reservedAmount(), 0);
        assertEq(pool.totalCollateral(), 0);
        _assertPoolSolvent();
    }

    function test_FullCloseLoss_Ex3() public {
        uint256 start = usdc.balanceOf(bob);
        _open(bob, BTC, false, 500e6, 2_500e6);
        _setPrice(BTC, 63_000e8);
        _close(bob, BTC, false);
        assertEq(usdc.balanceOf(bob), start - 500e6 + 366_744_744);
        _assertPoolSolvent();
    }

    function test_FullCloseShortProfit_Ex4() public {
        uint256 start = usdc.balanceOf(bob);
        _open(bob, BTC, false, 500e6, 2_500e6);
        _setPrice(BTC, 57_000e8);
        _close(bob, BTC, false);
        assertEq(usdc.balanceOf(bob), start - 500e6 + 617_245_245);
    }

    function test_ProfitCap_Ex9() public {
        uint256 start = usdc.balanceOf(alice);
        _open(alice, ETH, true, C, S);
        _setPrice(ETH, 6_000e8);
        _close(alice, ETH, true);
        // collateral 994 − close fee 6 + profit capped at 9 × 994
        assertEq(usdc.balanceOf(alice), start - C + 994_000_000 - 6_000_000 + 8_946_000_000);
        _assertPoolSolvent();
    }

    function test_PartialDecrease() public {
        uint256 start = usdc.balanceOf(alice);
        bytes32 key = _open(alice, ETH, true, C, S);
        _execute(_requestDecrease(alice, ETH, true, 100e6, S / 2));

        PerpEngine.Position memory p = engine.getPosition(key);
        assertEq(p.size, S / 2);
        // tokens realised = floor(tokens / 2); spread loss on half ≈ $9.99, close fee $3
        int256 pnlHalf = PerpMath.pnl(true, S / 2, uint256(3_330_003_330_003_330_003) / 2, PerpMath.executionPrice(3_000e8, true, false, 10));
        uint256 expectedColl = 994_000_000 - uint256(-pnlHalf) - 3_000_000 - 100e6;
        assertEq(p.collateral, expectedColl);
        assertEq(usdc.balanceOf(alice), start - C + 100e6);
        assertLe(p.reserved, 9 * p.collateral);
        _assertPoolSolvent();
    }

    function test_PartialDecreaseCannotBreachLeverage() public {
        _open(alice, ETH, true, C, S);
        // Withdraw almost all collateral while keeping half the size → leverage too high → cancelled.
        uint256 id = _requestDecrease(alice, ETH, true, 900e6, S / 2);
        _execute(id);
        assertEq(uint256(_status(id)), uint256(PerpEngine.RequestStatus.Cancelled));
    }

    function test_DecreaseNonexistentCancelled() public {
        uint256 id = _requestDecrease(alice, ETH, true, 0, S);
        _execute(id);
        assertEq(uint256(_status(id)), uint256(PerpEngine.RequestStatus.Cancelled));
    }

    function test_DecreaseTooLargeCancelled() public {
        _open(alice, ETH, true, C, S);
        uint256 id = _requestDecrease(alice, ETH, true, 0, S + 1);
        _execute(id);
        assertEq(uint256(_status(id)), uint256(PerpEngine.RequestStatus.Cancelled));
    }

    function test_CloseUnderwaterPositionCancelled() public {
        _open(alice, ETH, true, C, S);
        _setPrice(ETH, 2_500e8); // loss ≈ $1,675 > collateral
        uint256 id = _requestDecrease(alice, ETH, true, 0, S);
        _execute(id);
        assertEq(uint256(_status(id)), uint256(PerpEngine.RequestStatus.Cancelled));
    }

    // ═══════════════════════════════════════════════════════════
    //  LIQUIDATION
    // ═══════════════════════════════════════════════════════════

    function test_LiquidationBoundary_Ex7() public {
        bytes32 key = _open(alice, ETH, true, C, S);

        _setPrice(ETH, 278_137_860_001);
        assertFalse(engine.isLiquidatable(key));
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(PerpEngine.NotLiquidatable.selector, key));
        engine.liquidate(key);

        _setPrice(ETH, 278_137_860_000);
        assertTrue(engine.isLiquidatable(key));
        uint256 keeperBefore = usdc.balanceOf(keeper);
        uint256 poolBefore = pool.poolAmount();
        vm.prank(keeper);
        engine.liquidate(key);

        uint256 keeperFee = S * 50 / 10_000; // $50 < collateral
        assertEq(usdc.balanceOf(keeper) - keeperBefore, keeperFee);
        assertEq(pool.poolAmount() - poolBefore, 994_000_000 - keeperFee);
        assertEq(engine.getPosition(key).size, 0);
        assertEq(pool.reservedAmount(), 0);
        assertEq(pool.totalCollateral(), 0);
        _assertPoolSolvent();
    }

    function test_MaxLeverageOpenNotLiquidatable_Ex8() public {
        bytes32 key = _open(alice, ETH, true, C, 19_762_845_840);
        PerpEngine.Position memory p = engine.getPosition(key);
        assertEq(p.size, 19_762_845_840);
        assertEq(p.collateral, 988_142_292);
        assertFalse(engine.isLiquidatable(key));
    }

    function test_OverMaxLeverageCancelled() public {
        uint256 id = _requestIncrease(alice, ETH, true, C, 19_762_845_841);
        _execute(id);
        assertEq(uint256(_status(id)), uint256(PerpEngine.RequestStatus.Cancelled));
    }

    function test_LiquidateNonexistentReverts() public {
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(PerpEngine.PositionNotFound.selector, bytes32(0)));
        engine.liquidate(bytes32(0));
    }

    function test_LiquidationFeeCappedAtCollateral() public {
        // The cap only binds when 2% of size exceeds collateral, i.e. above 50x.
        engine.setMarginParams(60, 150);
        engine.setLiquidationFeeBps(200);
        bytes32 key = _open(alice, ETH, true, 100e6, 5_700e6); // ~59x
        uint256 coll = engine.getPosition(key).collateral; // 100 − 3.42 fee = 96.58
        assertEq(coll, 96_580_000);
        _setPrice(ETH, 1e8);
        uint256 before = usdc.balanceOf(keeper);
        vm.prank(keeper);
        engine.liquidate(key);
        assertEq(usdc.balanceOf(keeper) - before, coll); // 2% of size = $114 > collateral → capped
    }

    // ═══════════════════════════════════════════════════════════
    //  FUNDING
    // ═══════════════════════════════════════════════════════════

    function test_FundingHeavierSideOnly() public {
        bytes32 key = _open(alice, ETH, true, 20_000e6, 200_000e6);
        _open(bob, ETH, false, 10_000e6, 50_000e6);

        vm.warp(block.timestamp + 8 hours);
        _refreshPrices();
        engine.updateFunding(ETH);

        PerpEngine.MarketInfo memory info = engine.getMarketInfo(ETH);
        assertGt(info.cumFundingLong, 0);
        assertEq(info.cumFundingShort, 0);
        assertGt(info.fundingRateLongPerHour, 0);
        assertEq(info.fundingRateShortPerHour, 0);

        uint256 owed = engine.getFundingOwed(key);
        assertEq(owed, PerpMath.fundingOwed(200_000e6, info.cumFundingLong, 0));
        assertGt(owed, 0);
        assertEq(engine.getFundingOwed(engine.getPositionKey(bob, ETH, false)), 0);

        // Funding is settled into the pool on the next update.
        uint256 poolBefore = pool.poolAmount();
        _execute(_requestIncrease(alice, ETH, true, 100e6, 0));
        assertEq(pool.poolAmount() - poolBefore, owed);
        assertEq(engine.getFundingOwed(key), 0);
        _assertPoolSolvent();
    }

    function test_FundingNoAccrualWhenBalanced() public {
        _open(alice, ETH, true, 1_000e6, 10_000e6);
        _open(bob, ETH, false, 1_000e6, 10_000e6);
        vm.warp(block.timestamp + 1 days);
        _refreshPrices();
        engine.updateFunding(ETH);
        PerpEngine.MarketInfo memory info = engine.getMarketInfo(ETH);
        assertEq(info.cumFundingLong, 0);
        assertEq(info.cumFundingShort, 0);
    }

    function test_UpdateFundingUnlistedReverts() public {
        vm.expectRevert(abi.encodeWithSelector(PerpEngine.MarketNotListed.selector, SOL));
        engine.updateFunding(SOL);
    }

    // ═══════════════════════════════════════════════════════════
    //  CANCELLATIONS & CAPS
    // ═══════════════════════════════════════════════════════════

    function test_SlippageCancelsAndRefunds() public {
        uint256 start = usdc.balanceOf(alice);
        uint256 keeperBefore = keeper.balance;
        vm.prank(alice);
        uint256 id = engine.requestIncrease{value: EXEC_FEE}(ETH, true, C, S, 3_000e8); // exec = 3,003
        _execute(id);

        assertEq(uint256(_status(id)), uint256(PerpEngine.RequestStatus.Cancelled));
        assertEq(usdc.balanceOf(alice), start);
        assertEq(pool.totalEscrow(), 0);
        assertEq(keeper.balance - keeperBefore, EXEC_FEE); // keeper still paid
    }

    function test_ShortSlippageCancels() public {
        vm.prank(alice);
        uint256 id = engine.requestIncrease{value: EXEC_FEE}(ETH, false, C, S, 3_000e8); // exec = 2,997
        _execute(id);
        assertEq(uint256(_status(id)), uint256(PerpEngine.RequestStatus.Cancelled));
    }

    function test_StaleOracleCancels() public {
        uint256 id = _requestIncrease(alice, ETH, true, C, S);
        vm.warp(block.timestamp + 3961);
        _execute(id);
        assertEq(uint256(_status(id)), uint256(PerpEngine.RequestStatus.Cancelled));
        assertEq(pool.totalEscrow(), 0);
    }

    function test_OiCapCancels() public {
        // cap = 30% of $5M = $1.5M
        uint256 id = _requestIncrease(alice, ETH, true, 100_000e6, 1_600_000e6);
        _execute(id);
        assertEq(uint256(_status(id)), uint256(PerpEngine.RequestStatus.Cancelled));
    }

    function test_ReserveCapCancels() public {
        engine.setOiCapBps(10_000);
        // reserve = 9 × ~599k ≈ $5.39M > $5M pool
        uint256 id = _requestIncrease(alice, ETH, true, 600_000e6, 1_000_000e6);
        _execute(id);
        assertEq(uint256(_status(id)), uint256(PerpEngine.RequestStatus.Cancelled));
        _assertPoolSolvent();
    }

    function test_MinCollateralCancels() public {
        uint256 id = _requestIncrease(alice, ETH, true, 5e6, 20e6);
        _execute(id);
        assertEq(uint256(_status(id)), uint256(PerpEngine.RequestStatus.Cancelled));
    }

    function test_LeverageBelowOneCancels() public {
        uint256 id = _requestIncrease(alice, ETH, true, 1000e6, 500e6);
        _execute(id);
        assertEq(uint256(_status(id)), uint256(PerpEngine.RequestStatus.Cancelled));
    }

    function test_CancelRequestExpiry() public {
        uint256 start = usdc.balanceOf(alice);
        uint256 ethStart = alice.balance;
        uint256 id = _requestIncrease(alice, ETH, true, C, S);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PerpEngine.RequestNotExpired.selector, id, block.timestamp + 60));
        engine.cancelRequest(id);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PerpEngine.NotRequestOwner.selector, id));
        engine.cancelRequest(id);

        vm.warp(block.timestamp + 60);
        vm.prank(alice);
        engine.cancelRequest(id);

        assertEq(uint256(_status(id)), uint256(PerpEngine.RequestStatus.Cancelled));
        assertEq(usdc.balanceOf(alice), start);
        assertEq(alice.balance, ethStart);
        assertEq(engine.getPendingRequestIds(alice).length, 0);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PerpEngine.RequestNotPending.selector, id));
        engine.cancelRequest(id);
    }

    function test_BatchOneFailureDoesNotRevert() public {
        uint256 good1 = _requestIncrease(alice, ETH, true, C, S);
        vm.prank(bob);
        uint256 bad = engine.requestIncrease{value: EXEC_FEE}(ETH, true, C, S, 1); // impossible slippage
        uint256 good2 = _requestIncrease(bob, BTC, false, 500e6, 2_500e6);

        uint256[] memory ids = new uint256[](4);
        ids[0] = good1;
        ids[1] = bad;
        ids[2] = good2;
        ids[3] = good1; // already executed → skipped
        uint256 keeperBefore = keeper.balance;
        vm.prank(keeper);
        engine.executeRequests(ids);

        assertEq(uint256(_status(good1)), uint256(PerpEngine.RequestStatus.Executed));
        assertEq(uint256(_status(bad)), uint256(PerpEngine.RequestStatus.Cancelled));
        assertEq(uint256(_status(good2)), uint256(PerpEngine.RequestStatus.Executed));
        assertEq(keeper.balance - keeperBefore, 3 * EXEC_FEE);
        _assertPoolSolvent();
    }

    // ═══════════════════════════════════════════════════════════
    //  ACCESS, PAUSE, MARKETS, FEES
    // ═══════════════════════════════════════════════════════════

    function test_OnlyKeeper() public {
        uint256 id = _requestIncrease(alice, ETH, true, C, S);
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(alice);
        vm.expectRevert(PerpEngine.NotKeeper.selector);
        engine.executeRequests(ids);
        vm.prank(alice);
        vm.expectRevert(PerpEngine.NotKeeper.selector);
        engine.liquidate(bytes32(0));
    }

    function test_ExecuteInternalOnlySelf() public {
        vm.expectRevert(PerpEngine.OnlySelf.selector);
        engine.executeRequestInternal(1);
    }

    function test_PauseBlocksIncreasesOnly() public {
        bytes32 key = _open(alice, ETH, true, C, S);
        uint256 pendingIncrease = _requestIncrease(bob, ETH, true, C, S);

        engine.pause();
        vm.prank(alice);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        engine.requestIncrease{value: EXEC_FEE}(ETH, true, C, S, type(uint256).max);

        _execute(pendingIncrease);
        assertEq(uint256(_status(pendingIncrease)), uint256(PerpEngine.RequestStatus.Cancelled));

        // Decreases and liquidations still work while paused.
        _close(alice, ETH, true);
        assertEq(engine.getPosition(key).size, 0);

        engine.unpause();
        _open(alice, ETH, true, C, S);
    }

    function test_SolCannotBeListedAndUnlistedRequestsRevert() public {
        vm.expectRevert(abi.encodeWithSelector(PerpEngine.NoOracleFeed.selector, SOL));
        engine.listMarket(SOL);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PerpEngine.MarketNotListed.selector, SOL));
        engine.requestIncrease{value: EXEC_FEE}(SOL, true, C, S, type(uint256).max);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PerpEngine.MarketNotListed.selector, SOL));
        engine.requestDecrease{value: EXEC_FEE}(SOL, true, 0, S, 0);

        vm.expectRevert(abi.encodeWithSelector(PerpEngine.MarketAlreadyListed.selector, ETH));
        engine.listMarket(ETH);
        assertEq(engine.getMarketIds().length, 2);
    }

    function test_DisabledMarket() public {
        uint256 pending = _requestIncrease(alice, ETH, true, C, S);
        engine.setMarketEnabled(ETH, false);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PerpEngine.MarketDisabled.selector, ETH));
        engine.requestIncrease{value: EXEC_FEE}(ETH, true, C, S, type(uint256).max);

        _execute(pending);
        assertEq(uint256(_status(pending)), uint256(PerpEngine.RequestStatus.Cancelled));

        vm.expectRevert(abi.encodeWithSelector(PerpEngine.MarketNotListed.selector, SOL));
        engine.setMarketEnabled(SOL, true);
    }

    function test_ExecutionFeeAndEmptyRequest() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PerpEngine.InsufficientExecutionFee.selector, EXEC_FEE - 1, EXEC_FEE));
        engine.requestIncrease{value: EXEC_FEE - 1}(ETH, true, C, S, type(uint256).max);

        vm.prank(alice);
        vm.expectRevert(PerpEngine.EmptyRequest.selector);
        engine.requestIncrease{value: EXEC_FEE}(ETH, true, 0, 0, type(uint256).max);

        vm.prank(alice);
        vm.expectRevert(PerpEngine.EmptyRequest.selector);
        engine.requestDecrease{value: EXEC_FEE}(ETH, true, 0, 0, 0);
    }

    function test_KeeperEthTransferFailure() public {
        // A keeper contract that rejects ETH makes the batch revert (and nothing is lost).
        RejectEth rejecter = new RejectEth();
        engine.setKeeper(address(rejecter), true);
        uint256 id = _requestIncrease(alice, ETH, true, C, S);
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(address(rejecter));
        vm.expectRevert(PerpEngine.EthTransferFailed.selector);
        engine.executeRequests(ids);
        assertEq(uint256(_status(id)), uint256(PerpEngine.RequestStatus.Pending));
    }

    function test_Views() public {
        bytes32 key = _open(alice, ETH, true, C, S);
        assertEq(engine.getPnl(key), PerpMath.pnl(true, S, 3_330_003_330_003_330_003, 3_000e8));
        assertEq(engine.getPnl(bytes32(0)), 0);
        assertFalse(engine.isLiquidatable(bytes32(0)));

        PerpEngine.MarketInfo memory info = engine.getMarketInfo(ETH);
        assertTrue(info.enabled);
        assertEq(info.price, 3_000e8);
        assertEq(info.longSize, S);
        uint256 cap = pool.getAum() * 3_000 / 10_000;
        assertEq(info.longCapacity, cap - S);
        assertEq(info.shortCapacity, cap);

        vm.expectRevert(abi.encodeWithSelector(PerpEngine.MarketNotListed.selector, SOL));
        engine.getMarketInfo(SOL);

        uint256 id = _requestIncrease(alice, BTC, false, C, S);
        PerpEngine.Request memory r = engine.getRequest(id);
        assertEq(r.account, alice);
        assertEq(r.market, BTC);
        assertFalse(r.isLong);
        assertEq(r.executionFee, EXEC_FEE);
    }

    function test_ParamSetters() public {
        engine.setMarginParams(10, 500);
        assertEq(engine.maxLeverage(), 10);
        vm.expectRevert(abi.encodeWithSelector(PerpEngine.InvalidParam.selector, bytes32("maxLeverage*mmBps"), 10_000));
        engine.setMarginParams(20, 500);
        vm.expectRevert();
        engine.setMarginParams(0, 250);

        engine.setPositionFeeBps(10);
        engine.setExecutionSpreadBps(0);
        engine.setMaxProfitMultiplier(5);
        engine.setFundingParams(1e14, 5e13);
        engine.setRequestExpiry(120);
        engine.setMinExecutionFee(0);
        engine.setMinCollateral(1e6);
        assertEq(engine.positionFeeBps(), 10);
        assertEq(engine.maxProfitMultiplier(), 5);
        assertEq(engine.fundingFactorPerHour(), 1e14);

        vm.expectRevert(abi.encodeWithSelector(PerpEngine.InvalidParam.selector, bytes32("positionFeeBps"), 101));
        engine.setPositionFeeBps(101);
        vm.expectRevert(abi.encodeWithSelector(PerpEngine.InvalidParam.selector, bytes32("maxProfitMultiplier"), 0));
        engine.setMaxProfitMultiplier(0);
        vm.expectRevert(abi.encodeWithSelector(PerpEngine.InvalidParam.selector, bytes32("requestExpiry"), 5));
        engine.setRequestExpiry(5);
        vm.expectRevert(abi.encodeWithSelector(PerpEngine.InvalidParam.selector, bytes32("oiCapBps"), 10_001));
        engine.setOiCapBps(10_001);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        engine.setKeeper(alice, true);
        vm.expectRevert(PerpEngine.ZeroAddress.selector);
        engine.setKeeper(address(0), true);
    }
}

contract RejectEth {
    receive() external payable {
        revert("no eth");
    }
}
