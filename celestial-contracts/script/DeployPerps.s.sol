// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ChainlinkOracle} from "../src/oracle/ChainlinkOracle.sol";
import {CLP} from "../src/pool/CLP.sol";
import {LiquidityPool} from "../src/pool/LiquidityPool.sol";
import {PerpEngine} from "../src/PerpEngine.sol";

/**
 * @title DeployPerps
 * @notice Deploys the Celestial Perps EVM stack on Sepolia and seeds the pool.
 *         Markets: BTC-USD, ETH-USD. SOL-USD is Solana-only (no Chainlink feed on Sepolia).
 *
 * Usage:
 *   forge script script/DeployPerps.s.sol:DeployPerps \
 *       --rpc-url $SEPOLIA_RPC_URL --private-key $PRIVATE_KEY --broadcast --verify
 *
 * Optional env: KEEPER_ADDRESS (defaults to the deployer), SEED_USDC (defaults to 5,000,000e6).
 */
contract DeployPerps is Script {
    address constant MOCK_USDC = 0x88a77050162285276d6346a4Bc07C406572d6cD2;
    address constant ETH_USD_FEED = 0x694AA1769357215DE4FAC081bf1f309aDC325306;
    address constant BTC_USD_FEED = 0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43;
    uint32 constant MAX_AGE = 3960; // heartbeat 3600 s + 10%

    function run()
        external
        returns (ChainlinkOracle oracle, CLP clp, LiquidityPool pool, PerpEngine engine)
    {
        require(block.chainid == 11155111, "Sepolia only");

        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address keeper = vm.envOr("KEEPER_ADDRESS", deployer);
        uint256 seed = vm.envOr("SEED_USDC", uint256(5_000_000e6));

        bytes32 eth = keccak256("ETH-USD");
        bytes32 btc = keccak256("BTC-USD");

        vm.startBroadcast(pk);

        oracle = new ChainlinkOracle();
        oracle.setFeed(eth, ETH_USD_FEED, MAX_AGE);
        oracle.setFeed(btc, BTC_USD_FEED, MAX_AGE);

        clp = new CLP();
        pool = new LiquidityPool(IERC20(MOCK_USDC), clp);
        clp.setPool(address(pool));

        engine = new PerpEngine(oracle, pool);
        pool.setEngine(address(engine));

        engine.listMarket(btc);
        engine.listMarket(eth);
        engine.setKeeper(keeper, true);

        IERC20(MOCK_USDC).approve(address(pool), seed);
        pool.addLiquidity(seed, 0);

        vm.stopBroadcast();

        console.log("============================================");
        console.log("  CELESTIAL PERPS DEPLOYED (Sepolia)");
        console.log("============================================");
        console.log("  ChainlinkOracle:", address(oracle));
        console.log("  CLP:            ", address(clp));
        console.log("  LiquidityPool:  ", address(pool));
        console.log("  PerpEngine:     ", address(engine));
        console.log("  Keeper:         ", keeper);
        console.log("  Seed (USDC):    ", seed / 1e6);
        console.log("  AUM:            ", pool.getAum() / 1e6);
        console.log("============================================");
    }
}
