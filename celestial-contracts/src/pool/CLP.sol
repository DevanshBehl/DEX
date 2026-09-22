// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title CLP
 * @notice Celestial LP token — a claim on the LiquidityPool's AUM. 18 decimals.
 *         Only the pool can mint and burn; the pool is set once by the deployer.
 */
contract CLP is ERC20 {
    address public immutable deployer;
    address public pool;

    event PoolSet(address indexed pool);

    error OnlyPool();
    error OnlyDeployer();
    error PoolAlreadySet();
    error ZeroAddress();

    constructor() ERC20("Celestial LP", "CLP") {
        deployer = msg.sender;
    }

    function setPool(address pool_) external {
        if (msg.sender != deployer) revert OnlyDeployer();
        if (pool != address(0)) revert PoolAlreadySet();
        if (pool_ == address(0)) revert ZeroAddress();
        pool = pool_;
        emit PoolSet(pool_);
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != pool) revert OnlyPool();
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        if (msg.sender != pool) revert OnlyPool();
        _burn(from, amount);
    }
}
