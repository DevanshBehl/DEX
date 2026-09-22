// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IChainlinkOracle {
    /// @notice Latest price for `market`, normalised to 8 decimals. Reverts if unknown, stale or invalid.
    function getPrice(bytes32 market) external view returns (uint256);

    /// @notice Whether a feed is configured for `market`.
    function hasFeed(bytes32 market) external view returns (bool);

    /// @notice USD price of the collateral asset (8 decimals).
    function collateralPrice() external pure returns (uint256);
}
