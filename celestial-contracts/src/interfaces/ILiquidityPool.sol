// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Engine-facing surface of the LiquidityPool. All USDC lives in the pool; the engine
///         moves it between accounting buckets (escrow, collateral, pool, fees) and out to users.
interface ILiquidityPool {
    function poolAmount() external view returns (uint256);
    function reservedAmount() external view returns (uint256);
    function getAum() external view returns (uint256);

    function escrowIn(address from, uint256 amount) external;
    function escrowRefund(address to, uint256 amount) external;
    function escrowToCollateral(uint256 amount) external;

    function collateralOut(address to, uint256 amount) external;
    function collateralToPool(uint256 amount) external;
    function collateralToFees(uint256 amount) external;

    function poolToTrader(address to, uint256 amount) external;

    function reserve(uint256 amount) external;
    function unreserve(uint256 amount) external;
}
