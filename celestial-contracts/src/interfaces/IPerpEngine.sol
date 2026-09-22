// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPerpEngine {
    /// @notice Net unrealised PnL of all traders across listed markets (6 decimals), each market
    ///         floored at minus its total collateral. Positive = traders are winning (lowers AUM).
    function getNetTraderPnl() external view returns (int256);
}
