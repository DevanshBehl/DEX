// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {CLP} from "./CLP.sol";
import {ILiquidityPool} from "../interfaces/ILiquidityPool.sol";
import {IPerpEngine} from "../interfaces/IPerpEngine.sol";
import {PerpMath} from "../libraries/PerpMath.sol";

/**
 * @title LiquidityPool
 * @notice Holds ALL USDC of Celestial Perps and is the counterparty to every trader.
 *
 *   Buckets (sum ≤ USDC balance):
 *     poolAmount ....... LP-owned liquidity (AUM before trader PnL)
 *     feeReserves ...... protocol share of fees (owner-withdrawable)
 *     totalCollateral .. collateral of open positions
 *     totalEscrow ...... collateral of pending increase requests
 *   reservedAmount ≤ poolAmount is locked to cover traders' max profit.
 *
 *   LPs deposit USDC for CLP; the engine moves USDC between buckets via onlyEngine hooks.
 */
contract LiquidityPool is ILiquidityPool, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_LP_MINT_FEE_BPS = 100;
    uint256 public constant MAX_PROTOCOL_FEE_SHARE_BPS = 5_000;
    uint256 public constant MAX_LP_COOLDOWN = 1 days;

    IERC20 public immutable usdc;
    CLP public immutable clp;
    address public engine;

    // ── Buckets ──
    uint256 public poolAmount;
    uint256 public reservedAmount;
    uint256 public feeReserves;
    uint256 public totalCollateral;
    uint256 public totalEscrow;

    // ── Params ──
    uint256 public lpMintFeeBps = 10;
    uint256 public protocolFeeShareBps = 1_000;
    uint256 public lpCooldown = 15 minutes;

    mapping(address => uint256) public lastAddedAt;

    event EngineSet(address indexed engine);
    event LiquidityAdded(address indexed account, uint256 amount, uint256 fee, uint256 clpMinted, uint256 aum);
    event LiquidityRemoved(address indexed account, uint256 clpBurned, uint256 amountOut, uint256 aum);
    event FeesAdded(uint256 amount, uint256 toProtocol, uint256 toPool);
    event FeesWithdrawn(address indexed to, uint256 amount);
    event ParamUpdated(bytes32 indexed key, uint256 value);

    error OnlyEngine();
    error EngineAlreadySet();
    error ZeroAddress();
    error ZeroAmount();
    error InvalidParam(bytes32 key, uint256 value);
    error Slippage(uint256 actual, uint256 min);
    error CooldownActive(uint256 availableAt);
    error InsufficientUnreservedLiquidity(uint256 requested, uint256 available);
    error InsufficientPoolAmount(uint256 requested, uint256 available);
    error ReserveExceedsPool(uint256 reserved, uint256 poolAmount);
    error ZeroAum();

    modifier onlyEngine() {
        if (msg.sender != engine) revert OnlyEngine();
        _;
    }

    constructor(IERC20 usdc_, CLP clp_) Ownable(msg.sender) {
        if (address(usdc_) == address(0) || address(clp_) == address(0)) revert ZeroAddress();
        usdc = usdc_;
        clp = clp_;
    }

    // ═══════════════════════════════════════════════════════════
    //  LP
    // ═══════════════════════════════════════════════════════════

    /// @notice Deposit USDC, receive CLP at the current AUM. A mint fee stays in the pool.
    function addLiquidity(uint256 amount, uint256 minClp) external nonReentrant returns (uint256 minted) {
        if (amount == 0) revert ZeroAmount();
        uint256 aum = getAum();
        uint256 supply = clp.totalSupply();
        if (supply != 0 && aum == 0) revert ZeroAum();

        uint256 fee = PerpMath.positionFee(amount, lpMintFeeBps);
        minted = PerpMath.clpToMint(amount - fee, aum, supply);
        if (minted == 0 || minted < minClp) revert Slippage(minted, minClp);

        poolAmount += amount;
        lastAddedAt[msg.sender] = block.timestamp;

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        clp.mint(msg.sender, minted);
        emit LiquidityAdded(msg.sender, amount, fee, minted, aum);
    }

    /// @notice Burn CLP for USDC at the current AUM. Cannot dip into reserved liquidity.
    function removeLiquidity(uint256 clpAmount, uint256 minUsdc) external nonReentrant returns (uint256 amountOut) {
        if (clpAmount == 0) revert ZeroAmount();
        uint256 availableAt = lastAddedAt[msg.sender] + lpCooldown;
        if (block.timestamp < availableAt) revert CooldownActive(availableAt);

        uint256 aum = getAum();
        amountOut = PerpMath.usdcForClp(clpAmount, aum, clp.totalSupply());
        if (amountOut == 0 || amountOut < minUsdc) revert Slippage(amountOut, minUsdc);

        uint256 available = poolAmount - reservedAmount;
        if (amountOut > available) revert InsufficientUnreservedLiquidity(amountOut, available);

        poolAmount -= amountOut;
        clp.burn(msg.sender, clpAmount);
        usdc.safeTransfer(msg.sender, amountOut);
        emit LiquidityRemoved(msg.sender, clpAmount, amountOut, aum);
    }

    // ═══════════════════════════════════════════════════════════
    //  VIEWS
    // ═══════════════════════════════════════════════════════════

    /// @notice AUM = poolAmount − net trader PnL, floored at 0. See docs/perp-math.md §10.
    function getAum() public view returns (uint256) {
        if (engine == address(0)) return poolAmount;
        int256 aum = int256(poolAmount) - IPerpEngine(engine).getNetTraderPnl();
        return aum > 0 ? uint256(aum) : 0;
    }

    /// @notice USD value of 1 CLP (1e18) in 8 decimals; $1 before the first deposit.
    function getClpPrice() external view returns (uint256) {
        uint256 supply = clp.totalSupply();
        if (supply == 0) return PerpMath.PRICE_PRECISION;
        return Math.mulDiv(getAum(), 1e20, supply);
    }

    /// @notice Liquidity LPs could withdraw right now.
    function availableLiquidity() external view returns (uint256) {
        return poolAmount - reservedAmount;
    }

    // ═══════════════════════════════════════════════════════════
    //  ENGINE HOOKS
    // ═══════════════════════════════════════════════════════════

    function escrowIn(address from, uint256 amount) external onlyEngine {
        if (amount == 0) return;
        totalEscrow += amount;
        usdc.safeTransferFrom(from, address(this), amount);
    }

    function escrowRefund(address to, uint256 amount) external onlyEngine {
        if (amount == 0) return;
        totalEscrow -= amount;
        usdc.safeTransfer(to, amount);
    }

    function escrowToCollateral(uint256 amount) external onlyEngine {
        totalEscrow -= amount;
        totalCollateral += amount;
    }

    function collateralOut(address to, uint256 amount) external onlyEngine {
        if (amount == 0) return;
        totalCollateral -= amount;
        usdc.safeTransfer(to, amount);
    }

    function collateralToPool(uint256 amount) external onlyEngine {
        totalCollateral -= amount;
        poolAmount += amount;
    }

    function collateralToFees(uint256 amount) external onlyEngine {
        if (amount == 0) return;
        totalCollateral -= amount;
        uint256 toProtocol = Math.mulDiv(amount, protocolFeeShareBps, PerpMath.BPS);
        feeReserves += toProtocol;
        poolAmount += amount - toProtocol;
        emit FeesAdded(amount, toProtocol, amount - toProtocol);
    }

    function poolToTrader(address to, uint256 amount) external onlyEngine {
        if (amount == 0) return;
        if (amount > poolAmount) revert InsufficientPoolAmount(amount, poolAmount);
        poolAmount -= amount;
        if (reservedAmount > poolAmount) revert ReserveExceedsPool(reservedAmount, poolAmount);
        usdc.safeTransfer(to, amount);
    }

    function reserve(uint256 amount) external onlyEngine {
        reservedAmount += amount;
        if (reservedAmount > poolAmount) revert ReserveExceedsPool(reservedAmount, poolAmount);
    }

    function unreserve(uint256 amount) external onlyEngine {
        reservedAmount -= amount;
    }

    // ═══════════════════════════════════════════════════════════
    //  ADMIN
    // ═══════════════════════════════════════════════════════════

    function setEngine(address engine_) external onlyOwner {
        if (engine != address(0)) revert EngineAlreadySet();
        if (engine_ == address(0)) revert ZeroAddress();
        engine = engine_;
        emit EngineSet(engine_);
    }

    function withdrawFees(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = feeReserves;
        if (amount == 0) revert ZeroAmount();
        feeReserves = 0;
        usdc.safeTransfer(to, amount);
        emit FeesWithdrawn(to, amount);
    }

    function setLpMintFeeBps(uint256 v) external onlyOwner {
        if (v > MAX_LP_MINT_FEE_BPS) revert InvalidParam("lpMintFeeBps", v);
        lpMintFeeBps = v;
        emit ParamUpdated("lpMintFeeBps", v);
    }

    function setProtocolFeeShareBps(uint256 v) external onlyOwner {
        if (v > MAX_PROTOCOL_FEE_SHARE_BPS) revert InvalidParam("protocolFeeShareBps", v);
        protocolFeeShareBps = v;
        emit ParamUpdated("protocolFeeShareBps", v);
    }

    function setLpCooldown(uint256 v) external onlyOwner {
        if (v > MAX_LP_COOLDOWN) revert InvalidParam("lpCooldown", v);
        lpCooldown = v;
        emit ParamUpdated("lpCooldown", v);
    }
}
