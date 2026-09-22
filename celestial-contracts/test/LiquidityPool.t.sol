// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PerpTestBase} from "./utils/PerpTestBase.sol";
import {CLP} from "../src/pool/CLP.sol";
import {LiquidityPool} from "../src/pool/LiquidityPool.sol";

contract LiquidityPoolTest is PerpTestBase {
    function test_SeedMintsOneToOneMinusFee() public view {
        // Ex 10 in docs/perp-math.md
        assertEq(clp.balanceOf(lp), 4_995_000_000_000_000_000_000_000);
        assertEq(pool.poolAmount(), SEED);
        assertEq(pool.getAum(), SEED);
        assertEq(clp.name(), "Celestial LP");
        assertEq(clp.decimals(), 18);
    }

    function test_ClpPriceAboveOneAfterMintFee() public view {
        // 5M AUM / 4.995M CLP ≈ $1.001
        assertEq(pool.getClpPrice(), 100_100_100);
    }

    function test_AddLiquiditySecondDepositorProRata() public {
        uint256 minted;
        vm.prank(alice);
        minted = pool.addLiquidity(1000e6, 0);
        uint256 expected = uint256(999e6) * 4_995_000e18 / SEED;
        assertEq(minted, expected);
    }

    function test_AddLiquiditySlippage() public {
        vm.prank(alice);
        vm.expectRevert();
        pool.addLiquidity(1000e6, type(uint256).max);
    }

    function test_AddZeroReverts() public {
        vm.prank(alice);
        vm.expectRevert(LiquidityPool.ZeroAmount.selector);
        pool.addLiquidity(0, 0);
    }

    function test_RemoveLiquidityCooldown() public {
        vm.startPrank(alice);
        uint256 minted = pool.addLiquidity(1000e6, 0);
        vm.expectRevert(abi.encodeWithSelector(LiquidityPool.CooldownActive.selector, block.timestamp + 15 minutes));
        pool.removeLiquidity(minted, 0);

        vm.warp(block.timestamp + 15 minutes);
        _refreshPrices();
        uint256 balBefore = usdc.balanceOf(alice);
        uint256 out = pool.removeLiquidity(minted, 0);
        vm.stopPrank();

        assertEq(usdc.balanceOf(alice) - balBefore, out);
        assertLt(out, 1000e6); // mint fee retained by the pool
        assertGt(out, 998e6);
    }

    function test_RemoveLiquidityBlockedByReserve() public {
        // Open a large position so most liquidity is reserved.
        engine.setOiCapBps(10_000);
        _open(alice, ETH, true, 500_000e6, 1_000_000e6); // reserve ≈ 9 × 499,400 ≈ 4.49M

        vm.warp(block.timestamp + 15 minutes);
        _refreshPrices();
        uint256 all = clp.balanceOf(lp);
        vm.prank(lp);
        vm.expectRevert();
        pool.removeLiquidity(all, 0);
        _assertPoolSolvent();
    }

    function test_OnlyEngineHooks() public {
        vm.startPrank(alice);
        vm.expectRevert(LiquidityPool.OnlyEngine.selector);
        pool.escrowIn(alice, 1);
        vm.expectRevert(LiquidityPool.OnlyEngine.selector);
        pool.poolToTrader(alice, 1);
        vm.expectRevert(LiquidityPool.OnlyEngine.selector);
        pool.reserve(1);
        vm.expectRevert(LiquidityPool.OnlyEngine.selector);
        pool.collateralOut(alice, 1);
        vm.stopPrank();
    }

    function test_SetEngineOnce() public {
        vm.expectRevert(LiquidityPool.EngineAlreadySet.selector);
        pool.setEngine(address(1));
    }

    function test_ClpOnlyPoolAndSetPoolOnce() public {
        vm.expectRevert(CLP.OnlyPool.selector);
        clp.mint(alice, 1);
        vm.expectRevert(CLP.OnlyPool.selector);
        clp.burn(lp, 1);
        vm.expectRevert(CLP.PoolAlreadySet.selector);
        clp.setPool(address(1));

        CLP fresh = new CLP();
        vm.prank(alice);
        vm.expectRevert(CLP.OnlyDeployer.selector);
        fresh.setPool(address(1));
        vm.expectRevert(CLP.ZeroAddress.selector);
        fresh.setPool(address(0));
    }

    function test_FeesSplitAndWithdraw() public {
        bytes32 key = _open(alice, ETH, true, 1000e6, 10_000e6); // open fee $6
        key;
        // 10% protocol share
        assertEq(pool.feeReserves(), 600_000);
        address treasury = makeAddr("treasury");
        pool.withdrawFees(treasury);
        assertEq(usdc.balanceOf(treasury), 600_000);
        assertEq(pool.feeReserves(), 0);
        vm.expectRevert(LiquidityPool.ZeroAmount.selector);
        pool.withdrawFees(treasury);
    }

    function test_ParamSetters() public {
        pool.setLpMintFeeBps(20);
        assertEq(pool.lpMintFeeBps(), 20);
        pool.setProtocolFeeShareBps(0);
        pool.setLpCooldown(0);
        vm.expectRevert(abi.encodeWithSelector(LiquidityPool.InvalidParam.selector, bytes32("lpMintFeeBps"), 101));
        pool.setLpMintFeeBps(101);
        vm.expectRevert(abi.encodeWithSelector(LiquidityPool.InvalidParam.selector, bytes32("protocolFeeShareBps"), 5001));
        pool.setProtocolFeeShareBps(5001);
        vm.expectRevert(abi.encodeWithSelector(LiquidityPool.InvalidParam.selector, bytes32("lpCooldown"), 1 days + 1));
        pool.setLpCooldown(1 days + 1);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        pool.setLpMintFeeBps(1);
    }

    function test_AumReflectsTraderPnl() public {
        _open(alice, ETH, true, 1000e6, 10_000e6);
        uint256 aumBefore = pool.getAum();
        _setPrice(ETH, 3_300e8); // alice +~$996 unrealised
        assertLt(pool.getAum(), aumBefore);
        _setPrice(ETH, 2_700e8); // alice losing
        assertGt(pool.getAum(), aumBefore);
    }

    function test_AumTraderLossCappedAtCollateral() public {
        _open(alice, ETH, true, 1000e6, 10_000e6);
        uint256 pa = pool.poolAmount();
        _setPrice(ETH, 1e8); // price collapses — trader loss ≫ collateral
        assertEq(pool.getAum(), pa + 994e6 - 0); // loss credited only up to collateral (994e6 after fee)
    }

    function test_ConstructorZeroAddress() public {
        vm.expectRevert(LiquidityPool.ZeroAddress.selector);
        new LiquidityPool(IERC20(address(0)), clp);
    }
}
