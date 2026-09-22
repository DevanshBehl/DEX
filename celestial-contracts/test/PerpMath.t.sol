// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PerpMath} from "../src/libraries/PerpMath.sol";

/// @notice Asserts every worked example in docs/perp-math.md. The Solana program must match these numbers.
contract PerpMathTest is Test {
    uint256 constant SPREAD = 10;
    uint256 constant FEE = 6;
    uint256 constant MM = 250;

    // ── Ex 1 / 2: ETH long, $1,000 collateral, $10,000 size ──
    uint256 constant ETH_3000 = 300_000_000_000;
    uint256 constant S1 = 10_000e6;
    uint256 constant TOKENS1 = 3_330_003_330_003_330_003;

    function test_Ex1_LongOpen() public pure {
        uint256 exec = PerpMath.executionPrice(ETH_3000, true, true, SPREAD);
        assertEq(exec, 300_300_000_000);
        assertEq(PerpMath.tokensFor(S1, exec, true), TOKENS1);
        assertEq(PerpMath.positionFee(S1, FEE), 6_000_000);
        assertEq(PerpMath.entryPrice(S1, TOKENS1), 300_300_000_000);
    }

    function test_Ex2_LongCloseProfit() public pure {
        uint256 exec = PerpMath.executionPrice(330_000_000_000, true, false, SPREAD);
        assertEq(exec, 329_670_000_000);
        int256 p = PerpMath.pnl(true, S1, TOKENS1, exec);
        assertEq(p, 978_021_978);
        assertEq(int256(994_000_000) + p - int256(PerpMath.positionFee(S1, FEE)), 1_966_021_978);
    }

    // ── Ex 3 / 4: BTC short, $500 collateral, $2,500 size ──
    uint256 constant S3 = 2_500e6;
    uint256 constant TOKENS3 = 41_708_375_041_708_376;

    function test_Ex3_ShortLoss() public pure {
        uint256 openExec = PerpMath.executionPrice(6_000_000_000_000, false, true, SPREAD);
        assertEq(openExec, 5_994_000_000_000);
        assertEq(PerpMath.tokensFor(S3, openExec, false), TOKENS3);
        assertEq(PerpMath.positionFee(S3, FEE), 1_500_000);

        uint256 closeExec = PerpMath.executionPrice(6_300_000_000_000, false, false, SPREAD);
        assertEq(closeExec, 6_306_300_000_000);
        int256 p = PerpMath.pnl(false, S3, TOKENS3, closeExec);
        assertEq(p, -130_255_256);
        assertEq(int256(500e6) - 1_500_000 + p - 1_500_000, 366_744_744);
    }

    function test_Ex4_ShortProfit() public pure {
        uint256 closeExec = PerpMath.executionPrice(5_700_000_000_000, false, false, SPREAD);
        assertEq(closeExec, 5_705_700_000_000);
        int256 p = PerpMath.pnl(false, S3, TOKENS3, closeExec);
        assertEq(p, 120_245_245);
        assertEq(int256(500e6) - 1_500_000 + p - 1_500_000, 617_245_245);
    }

    // ── Ex 5: funding ──
    function test_Ex5_Funding() public pure {
        uint256 rate = PerpMath.fundingRatePerHour(2_000_000e6, 1_000_000e6, 5_000_000e6, 3e14, 1e14);
        assertEq(rate, 60_000_000_000_000);
        uint256 delta = PerpMath.fundingIndexDelta(rate, 8 hours);
        assertEq(delta, 480_000_000_000_000);
        assertEq(PerpMath.fundingOwed(10_000e6, delta, 0), 4_800_000);
    }

    function test_Ex5b_FundingCapped() public pure {
        assertEq(PerpMath.fundingRatePerHour(3_000_000e6, 0, 5_000_000e6, 3e14, 1e14), 1e14);
    }

    function test_FundingZeroWhenNoAum() public pure {
        assertEq(PerpMath.fundingRatePerHour(1e6, 0, 0, 3e14, 1e14), 0);
    }

    function test_FundingOwedZeroWhenIndexNotAdvanced() public pure {
        assertEq(PerpMath.fundingOwed(10_000e6, 5, 5), 0);
        assertEq(PerpMath.fundingOwed(10_000e6, 4, 5), 0);
    }

    // ── Ex 6 / 7: liquidation price & boundary ──
    uint256 constant C1 = 994_000_000;
    uint256 constant LIQ1 = 278_137_860_001;

    function test_Ex6_LiquidationPriceLong() public pure {
        uint256 closeFee = PerpMath.positionFee(S1, FEE);
        assertEq(PerpMath.maintenanceMargin(S1, MM), 250_000_000);
        assertEq(PerpMath.liquidationPrice(true, S1, TOKENS1, C1, 0, closeFee, MM), LIQ1);
    }

    function test_Ex7_LiquidationBoundary() public pure {
        uint256 closeFee = PerpMath.positionFee(S1, FEE);

        int256 below = PerpMath.pnl(true, S1, TOKENS1, LIQ1 - 1);
        assertEq(below, -738_000_001);
        assertEq(PerpMath.remainingMargin(C1, below, 0, closeFee), 249_999_999);
        assertTrue(PerpMath.isLiquidatable(C1, below, 0, closeFee, S1, MM));

        int256 at = PerpMath.pnl(true, S1, TOKENS1, LIQ1);
        assertEq(at, -738_000_000);
        assertEq(PerpMath.remainingMargin(C1, at, 0, closeFee), 250_000_000);
        assertFalse(PerpMath.isLiquidatable(C1, at, 0, closeFee, S1, MM));

        int256 above = PerpMath.pnl(true, S1, TOKENS1, LIQ1 + 1);
        assertFalse(PerpMath.isLiquidatable(C1, above, 0, closeFee, S1, MM));
    }

    function test_LiquidationPriceShortMatchesBoundary() public pure {
        uint256 closeFee = PerpMath.positionFee(S3, FEE);
        uint256 c = 500e6 - 1_500_000;
        uint256 liq = PerpMath.liquidationPrice(false, S3, TOKENS3, c, 0, closeFee, MM);
        assertGt(liq, 5_994_000_000_000);
        assertFalse(PerpMath.isLiquidatable(c, PerpMath.pnl(false, S3, TOKENS3, liq), 0, closeFee, S3, MM));
        assertTrue(PerpMath.isLiquidatable(c, PerpMath.pnl(false, S3, TOKENS3, liq + 1), 0, closeFee, S3, MM));
    }

    function test_LiquidationPriceZeroCases() public pure {
        assertEq(PerpMath.liquidationPrice(true, 0, 0, 1, 0, 0, MM), 0);
        // Long collateralised beyond its size: no positive price can liquidate it.
        assertEq(PerpMath.liquidationPrice(true, 100e6, 1e18, 1_000e6, 0, 0, MM), 0);
        // Short whose owed funding exceeds its size: liquidatable at any price.
        assertEq(PerpMath.liquidationPrice(false, 100e6, 1e18, 0, 200e6, 0, MM), 0);
    }

    // ── Ex 8: max leverage open is not instantly liquidatable (regression) ──
    function test_Ex8_MaxLeverageNotLiquidatable() public pure {
        uint256 size = 19_762_845_840;
        uint256 collAfter = 1000e6 - PerpMath.positionFee(size, FEE);
        assertEq(collAfter, 988_142_292);
        assertLe(size, collAfter * 20);
        assertGt(size + 1, 0);
        assertGt(size + 1, (1000e6 - PerpMath.positionFee(size + 1, FEE)) * 20); // largest valid size

        uint256 exec = PerpMath.executionPrice(ETH_3000, true, true, SPREAD);
        uint256 tokens = PerpMath.tokensFor(size, exec, true);
        int256 p = PerpMath.pnl(true, size, tokens, ETH_3000);
        assertEq(p, -19_743_103);
        uint256 closeFee = PerpMath.positionFee(size, FEE);
        assertEq(PerpMath.remainingMargin(collAfter, p, 0, closeFee), 956_541_481);
        assertEq(PerpMath.maintenanceMargin(size, MM), 494_071_146);
        assertFalse(PerpMath.isLiquidatable(collAfter, p, 0, closeFee, size, MM));
    }

    // ── Ex 9: profit cap ──
    function test_Ex9_ProfitCap() public pure {
        uint256 reserved = 9 * C1;
        assertEq(reserved, 8_946_000_000);
        uint256 exec = PerpMath.executionPrice(600_000_000_000, true, false, SPREAD);
        assertEq(exec, 599_400_000_000);
        int256 p = PerpMath.pnl(true, S1, TOKENS1, exec);
        assertEq(p, 9_960_039_960);
        assertEq(uint256(p) > reserved ? reserved : uint256(p), 8_946_000_000);
    }

    // ── Ex 10: CLP ──
    function test_Ex10_Clp() public pure {
        uint256 seed = 5_000_000e6;
        uint256 seedFee = PerpMath.positionFee(seed, 10);
        assertEq(seedFee, 5_000_000_000);
        uint256 seedMint = PerpMath.clpToMint(seed - seedFee, 0, 0);
        assertEq(seedMint, 4_995_000_000_000_000_000_000_000);

        uint256 aum = 5_100_000e6;
        uint256 dep = 1000e6;
        uint256 depFee = PerpMath.positionFee(dep, 10);
        assertEq(depFee, 1_000_000);
        uint256 minted = PerpMath.clpToMint(dep - depFee, aum, seedMint);
        assertEq(minted, 978_432_352_941_176_470_588);
        assertEq(PerpMath.usdcForClp(minted, aum + dep, seedMint + minted), 999_000_195);
    }

    // ── Properties ──
    function testFuzz_SpreadAlwaysAgainstTrader(uint256 price, uint256 spread) public pure {
        price = bound(price, 1, 1e20);
        spread = bound(spread, 0, 100);
        assertGe(PerpMath.executionPrice(price, true, true, spread), price);
        assertLe(PerpMath.executionPrice(price, true, false, spread), price);
        assertLe(PerpMath.executionPrice(price, false, true, spread), price);
        assertGe(PerpMath.executionPrice(price, false, false, spread), price);
    }

    function testFuzz_OpenCloseSamePriceNeverProfits(uint256 size, uint256 price, bool isLong) public pure {
        size = bound(size, 1e6, 1e15);
        price = bound(price, 1e6, 1e14);
        uint256 tokens = PerpMath.tokensFor(size, price, isLong);
        assertLe(PerpMath.pnl(isLong, size, tokens, price), 0);
    }

    function testFuzz_LiquidationPriceIsBoundary(uint256 collateral, uint256 lev, uint256 price) public pure {
        collateral = bound(collateral, 10e6, 1e12);
        lev = bound(lev, 2, 20);
        price = bound(price, 1e8, 1e13);
        uint256 size = collateral * lev;
        uint256 tokens = PerpMath.tokensFor(size, price, true);
        uint256 fee = PerpMath.positionFee(size, FEE);
        uint256 liq = PerpMath.liquidationPrice(true, size, tokens, collateral, 0, fee, MM);
        if (liq == 0) return;
        assertFalse(PerpMath.isLiquidatable(collateral, PerpMath.pnl(true, size, tokens, liq), 0, fee, size, MM));
        assertTrue(PerpMath.isLiquidatable(collateral, PerpMath.pnl(true, size, tokens, liq - 1), 0, fee, size, MM));
    }
}
