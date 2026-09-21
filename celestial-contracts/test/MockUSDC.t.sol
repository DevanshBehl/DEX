// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract MockUSDCTest is Test {
    MockUSDC internal usdc;

    address internal owner = address(this);
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        vm.warp(1_000_000);
        usdc = new MockUSDC();
    }

    function test_Metadata() public view {
        assertEq(usdc.name(), "Mock USD Coin");
        assertEq(usdc.symbol(), "USDC");
        assertEq(usdc.decimals(), 6);
        assertEq(usdc.owner(), owner);
    }

    function test_OwnerCanMint() public {
        usdc.mint(alice, 10_000_000e6);
        assertEq(usdc.balanceOf(alice), 10_000_000e6);
        assertEq(usdc.totalSupply(), 10_000_000e6);
    }

    function test_NonOwnerCannotMint() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        usdc.mint(alice, 1e6);
    }

    function test_FaucetMintsFixedAmount() public {
        vm.prank(alice);
        usdc.faucet();
        assertEq(usdc.balanceOf(alice), usdc.FAUCET_AMOUNT());
        assertEq(usdc.lastClaim(alice), block.timestamp);
    }

    function test_FaucetCooldownBlocksSecondClaim() public {
        vm.startPrank(alice);
        usdc.faucet();

        uint256 availableAt = block.timestamp + usdc.FAUCET_COOLDOWN();
        vm.warp(availableAt - 1);
        vm.expectRevert(abi.encodeWithSelector(MockUSDC.FaucetCooldown.selector, availableAt));
        usdc.faucet();
        assertEq(usdc.nextClaimAt(alice), availableAt);

        vm.warp(availableAt);
        usdc.faucet();
        vm.stopPrank();

        assertEq(usdc.balanceOf(alice), 2 * usdc.FAUCET_AMOUNT());
        assertEq(usdc.nextClaimAt(alice), availableAt + usdc.FAUCET_COOLDOWN());
    }

    function test_FaucetCooldownIsPerAddress() public {
        vm.prank(alice);
        usdc.faucet();
        vm.prank(bob);
        usdc.faucet();
        assertEq(usdc.balanceOf(alice), usdc.FAUCET_AMOUNT());
        assertEq(usdc.balanceOf(bob), usdc.FAUCET_AMOUNT());
    }

    function test_NextClaimAtZeroForNewUser() public view {
        assertEq(usdc.nextClaimAt(alice), 0);
    }

    function testFuzz_OwnerMint(address to, uint128 amount) public {
        vm.assume(to != address(0));
        usdc.mint(to, amount);
        assertEq(usdc.balanceOf(to), amount);
    }
}
