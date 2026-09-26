// Anvil + the Phase 3 contracts (deployed from the forge artifacts in celestial-contracts/out,
// MockV3Aggregator prices) for the chain-layer tests. Nothing in celestial-contracts/src changes.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Contract, ContractFactory, JsonRpcProvider, NonceManager, Wallet, id as keccakId } from "ethers";

import { spawnQuiet, waitFor } from "../../../celestial-keeper/test/support/common.ts";
import { REPO_ROOT } from "../../../celestial-keeper/src/config.ts";

// Anvil's public development keys (never used on a real network).
export const ANVIL_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // admin / LP seed
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // keeper
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // trader
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // LP
];
export const ETH = keccakId("ETH-USD");
export const BTC = keccakId("BTC-USD");
const USD = 1_000_000n;
const OUT = join(REPO_ROOT, "celestial-contracts/out");
const artifact = (file: string) => JSON.parse(readFileSync(join(OUT, `${file}.sol`, `${file}.json`), "utf8"));

export type LocalEvm = {
  url: string;
  provider: JsonRpcProvider;
  admin: NonceManager;
  addresses: { engine: string; pool: string; clp: string; usdc: string; oracle: string };
  ethFeed: Contract;
  btcFeed: Contract;
  engine: Contract;
  stop: () => void;
  /** advance chain time (and mine); prices are refreshed so the oracle stays fresh */
  warp: (seconds: number) => Promise<void>;
};

export async function startLocalEvm(port: number): Promise<LocalEvm> {
  if (!existsSync(join(OUT, "PerpEngine.sol/PerpEngine.json"))) throw new Error("run `forge build` in celestial-contracts first");
  const anvil = spawnQuiet("anvil", ["--port", String(port), "--silent"]);
  const url = `http://127.0.0.1:${port}`;
  const provider = new JsonRpcProvider(url, undefined, { pollingInterval: 100 });
  await waitFor(() => provider.getBlockNumber().then(() => true), 20_000, "anvil");
  const admin = new NonceManager(new Wallet(ANVIL_KEYS[0], provider));

  const deploy = async (file: string, args: unknown[] = []) => {
    const a = artifact(file);
    const c = await new ContractFactory(a.abi, a.bytecode.object, admin).deploy(...args);
    await c.waitForDeployment();
    return c as Contract;
  };
  const usdc = await deploy("MockUSDC");
  const ethFeed = await deploy("MockV3Aggregator", [8, 3_000n * 10n ** 8n]);
  const btcFeed = await deploy("MockV3Aggregator", [8, 60_000n * 10n ** 8n]);
  const oracle = await deploy("ChainlinkOracle");
  await (await oracle.setFeed(ETH, await ethFeed.getAddress(), 3960)).wait();
  await (await oracle.setFeed(BTC, await btcFeed.getAddress(), 3960)).wait();
  const clp = await deploy("CLP");
  const pool = await deploy("LiquidityPool", [await usdc.getAddress(), await clp.getAddress()]);
  await (await clp.setPool(await pool.getAddress())).wait();
  const engine = await deploy("PerpEngine", [await oracle.getAddress(), await pool.getAddress()]);
  await (await pool.setEngine(await engine.getAddress())).wait();
  await (await engine.listMarket(ETH)).wait();
  await (await engine.listMarket(BTC)).wait();
  await (await engine.setKeeper(new Wallet(ANVIL_KEYS[1]).address, true)).wait();

  const adminAddr = await admin.getAddress();
  await (await usdc.mint(adminAddr, 5_000_000n * USD)).wait();
  await (await usdc.approve(await pool.getAddress(), 2n ** 256n - 1n)).wait();
  await (await pool.addLiquidity(5_000_000n * USD, 0)).wait();

  return {
    url,
    provider,
    admin,
    addresses: {
      engine: await engine.getAddress(),
      pool: await pool.getAddress(),
      clp: await clp.getAddress(),
      usdc: await usdc.getAddress(),
      oracle: await oracle.getAddress(),
    },
    ethFeed,
    btcFeed,
    engine,
    stop: () => {
      provider.destroy();
      anvil.kill("SIGINT");
    },
    warp: async (seconds: number) => {
      await provider.send("evm_increaseTime", [seconds]);
      await provider.send("evm_mine", []);
      await (await ethFeed.updateAnswer(await ethFeed.latestAnswer())).wait();
      await (await btcFeed.updateAnswer(await btcFeed.latestAnswer())).wait();
    },
  };
}
