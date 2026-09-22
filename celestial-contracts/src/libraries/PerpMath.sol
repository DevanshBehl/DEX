// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title PerpMath
 * @notice Pure math for Celestial Perps. Mirrored 1:1 by the Solana program (Phase 4);
 *         worked vectors live in docs/perp-math.md and are asserted by test/PerpMath.t.sol.
 *
 * Units
 *   usd / size / collateral / fees / pnl ... 6 decimals  (1 USD = 1e6)
 *   price ................................... 8 decimals  (PRICE_PRECISION)
 *   tokens .................................. size * 1e20 / price  (18-decimal base-asset amount)
 *   funding rate / index .................... 1e18 fraction of size (FUNDING_PRECISION)
 *
 * Every rounding choice goes against the trader.
 */
library PerpMath {
    using Math for uint256;

    uint256 internal constant BPS = 10_000;
    uint256 internal constant PRICE_PRECISION = 1e8;
    uint256 internal constant FUNDING_PRECISION = 1e18;
    uint256 internal constant TOKEN_PRECISION = 1e20;
    uint256 internal constant CLP_SCALE = 1e12; // CLP has 18 decimals, USDC 6

    /// @notice Oracle price adjusted by the execution spread, against the trader.
    ///         Long increase / short decrease pay more; short increase / long decrease receive less.
    function executionPrice(uint256 price, bool isLong, bool isIncrease, uint256 spreadBps)
        internal
        pure
        returns (uint256)
    {
        if (isLong == isIncrease) return price.mulDiv(BPS + spreadBps, BPS, Math.Rounding.Ceil);
        return price.mulDiv(BPS - spreadBps, BPS, Math.Rounding.Floor);
    }

    /// @notice Base-asset tokens bought/sold for `size` USD at `price`.
    ///         Longs round down (higher entry), shorts round up (lower entry).
    function tokensFor(uint256 size, uint256 price, bool isLong) internal pure returns (uint256) {
        return size.mulDiv(TOKEN_PRECISION, price, isLong ? Math.Rounding.Floor : Math.Rounding.Ceil);
    }

    /// @notice Average entry price implied by a position's size and tokens.
    function entryPrice(uint256 size, uint256 tokens) internal pure returns (uint256) {
        if (tokens == 0) return 0;
        return size.mulDiv(TOKEN_PRECISION, tokens);
    }

    /// @notice Signed PnL. Equivalent to S*(P-E)/E (long) and S*(E-P)/E (short) with E = S*1e20/tokens.
    function pnl(bool isLong, uint256 size, uint256 tokens, uint256 price) internal pure returns (int256) {
        if (isLong) {
            uint256 value = tokens.mulDiv(price, TOKEN_PRECISION, Math.Rounding.Floor);
            return int256(value) - int256(size);
        }
        uint256 cost = tokens.mulDiv(price, TOKEN_PRECISION, Math.Rounding.Ceil);
        return int256(size) - int256(cost);
    }

    /// @notice Open/close fee on a size delta (rounded up).
    function positionFee(uint256 sizeDelta, uint256 feeBps) internal pure returns (uint256) {
        return sizeDelta.mulDiv(feeBps, BPS, Math.Rounding.Ceil);
    }

    /// @notice Hourly funding rate paid by the heavier side (1e18 fraction of size).
    function fundingRatePerHour(
        uint256 longOi,
        uint256 shortOi,
        uint256 aum,
        uint256 fundingFactorPerHour,
        uint256 maxRatePerHour
    ) internal pure returns (uint256) {
        if (aum == 0) return 0;
        uint256 skew = longOi > shortOi ? longOi - shortOi : shortOi - longOi;
        return Math.min(maxRatePerHour, fundingFactorPerHour.mulDiv(skew, aum));
    }

    /// @notice Cumulative funding index increment for `elapsed` seconds at `ratePerHour`.
    function fundingIndexDelta(uint256 ratePerHour, uint256 elapsed) internal pure returns (uint256) {
        return ratePerHour.mulDiv(elapsed, 1 hours);
    }

    /// @notice Funding owed by a position since its entry index (rounded up).
    function fundingOwed(uint256 size, uint256 cumulativeIndex, uint256 entryIndex) internal pure returns (uint256) {
        if (cumulativeIndex <= entryIndex) return 0;
        return size.mulDiv(cumulativeIndex - entryIndex, FUNDING_PRECISION, Math.Rounding.Ceil);
    }

    /// @notice Maintenance margin requirement (rounded up).
    function maintenanceMargin(uint256 size, uint256 mmBps) internal pure returns (uint256) {
        return size.mulDiv(mmBps, BPS, Math.Rounding.Ceil);
    }

    /// @notice Remaining margin R = C + PnL - F - closeFee.
    function remainingMargin(uint256 collateral, int256 pnl_, uint256 funding, uint256 closeFee)
        internal
        pure
        returns (int256)
    {
        return int256(collateral) + pnl_ - int256(funding) - int256(closeFee);
    }

    /// @notice Liquidatable when R < size * mm / BPS.
    function isLiquidatable(
        uint256 collateral,
        int256 pnl_,
        uint256 funding,
        uint256 closeFee,
        uint256 size,
        uint256 mmBps
    ) internal pure returns (bool) {
        return remainingMargin(collateral, pnl_, funding, closeFee) < int256(maintenanceMargin(size, mmBps));
    }

    /// @notice Price at which the position becomes liquidatable (ignores future funding).
    ///         need = mm + F + closeFee - C;  long: (S+need)*1e20/tokens,  short: (S-need)*1e20/tokens.
    ///         Equivalent to E*(S±need)/S. Returns 0 when no positive price exists.
    function liquidationPrice(
        bool isLong,
        uint256 size,
        uint256 tokens,
        uint256 collateral,
        uint256 funding,
        uint256 closeFee,
        uint256 mmBps
    ) internal pure returns (uint256) {
        if (size == 0 || tokens == 0) return 0;
        int256 need = int256(maintenanceMargin(size, mmBps)) + int256(funding) + int256(closeFee) - int256(collateral);
        int256 threshold = isLong ? int256(size) + need : int256(size) - need;
        if (threshold <= 0) return 0;
        return uint256(threshold).mulDiv(
            TOKEN_PRECISION, tokens, isLong ? Math.Rounding.Ceil : Math.Rounding.Floor
        );
    }

    /// @notice CLP minted for `amountAfterFee` USDC deposited into a pool worth `aum` with `supply` CLP.
    function clpToMint(uint256 amountAfterFee, uint256 aum, uint256 supply) internal pure returns (uint256) {
        if (supply == 0) return amountAfterFee * CLP_SCALE;
        return amountAfterFee.mulDiv(supply, aum);
    }

    /// @notice USDC redeemed for `clpAmount` CLP.
    function usdcForClp(uint256 clpAmount, uint256 aum, uint256 supply) internal pure returns (uint256) {
        return clpAmount.mulDiv(aum, supply);
    }
}
