// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockUSDC
 * @notice TESTNET ONLY — 6-decimal stand-in for USDC, the collateral asset of Celestial Perps.
 *         Valued at $1 by the protocol (see docs/protocol-spec.md → collateralPrice()).
 *
 *  • Owner can mint any amount (seed the LP pool, top up testers)
 *  • Anyone can claim FAUCET_AMOUNT once per FAUCET_COOLDOWN
 */
contract MockUSDC is ERC20, Ownable {
    uint256 public constant FAUCET_AMOUNT = 10_000e6; // 10,000 USDC
    uint256 public constant FAUCET_COOLDOWN = 1 days;

    /// @notice Last faucet claim timestamp per address
    mapping(address => uint256) public lastClaim;

    event FaucetClaimed(address indexed user, uint256 amount);

    error FaucetCooldown(uint256 availableAt);

    constructor() ERC20("Mock USD Coin", "USDC") Ownable(msg.sender) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Owner mint, e.g. to seed the liquidity pool.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Claim test USDC. One claim per address per FAUCET_COOLDOWN.
    function faucet() external {
        uint256 last = lastClaim[msg.sender];
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) {
            revert FaucetCooldown(last + FAUCET_COOLDOWN);
        }
        lastClaim[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice Timestamp at which `user` can next call faucet() (0 = now).
    function nextClaimAt(address user) external view returns (uint256) {
        uint256 last = lastClaim[user];
        if (last == 0 || block.timestamp >= last + FAUCET_COOLDOWN) return 0;
        return last + FAUCET_COOLDOWN;
    }
}
