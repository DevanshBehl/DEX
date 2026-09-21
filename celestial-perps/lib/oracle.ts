// Chainlink oracle reads on Sepolia (read-only, via a public RPC — no wallet needed).
// This is the price the vault fills at; Coinbase is only the chart/index price.

import { ethers } from "ethers";
import type { MarketId } from "@/lib/marketData";

export const SEPOLIA_CHAIN_ID = 11155111;
export const SEPOLIA_RPC_URL =
  process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";

// 8-decimal USD feeds. Sepolia has no Chainlink SOL/USD feed.
export const CHAINLINK_FEEDS: Record<MarketId, string | null> = {
  "ETH-USD": "0x694AA1769357215DE4FAC081bf1f309aDC325306",
  "BTC-USD": "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43",
  "SOL-USD": null,
};
const FEED_DECIMALS = 8;

// Heartbeat on these feeds is 3600 s; treat anything older than heartbeat + 10% as stale.
export const ORACLE_MAX_AGE_S = 3960;

const AGGREGATOR_ABI = [
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
];

let provider: ethers.JsonRpcProvider | null = null;
const getProvider = () =>
  (provider ??= new ethers.JsonRpcProvider(SEPOLIA_RPC_URL, SEPOLIA_CHAIN_ID, { staticNetwork: true }));

export type OracleRound = { price: number; updatedAt: number };

export async function readOracle(market: MarketId): Promise<OracleRound | null> {
  const feed = CHAINLINK_FEEDS[market];
  if (!feed) return null;
  const agg = new ethers.Contract(feed, AGGREGATOR_ABI, getProvider());
  const [, answer, , updatedAt] = (await agg.latestRoundData()) as [bigint, bigint, bigint, bigint, bigint];
  if (answer <= 0n) throw new Error("Invalid oracle answer");
  return { price: Number(answer) / 10 ** FEED_DECIMALS, updatedAt: Number(updatedAt) };
}
