import { ethers } from 'ethers';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { CONFIG } from '../config/networks';

export async function fetchETHBalance(address: string, isTestnet: boolean = false, retries = 2): Promise<string> {
  try {
    const rpcUrl = isTestnet ? CONFIG.ALCHEMY_SEPOLIA_URL : CONFIG.ALCHEMY_ETH_URL;
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const balanceWei = await provider.getBalance(address);
    const balanceEth = ethers.formatEther(balanceWei);
    return parseFloat(balanceEth).toFixed(4).replace(/\.?0+$/, '');
  } catch (error) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 500));
      return fetchETHBalance(address, isTestnet, retries - 1);
    }
    console.error("Error fetching ETH balance:", error);
    return "0.00";
  }
}

export async function fetchSOLBalance(address: string, isTestnet: boolean = false, retries = 2): Promise<string> {
  try {
    const rpcUrl = isTestnet ? CONFIG.HELIUS_DEVNET_URL : CONFIG.HELIUS_SOL_URL;
    const connection = new Connection(rpcUrl, 'confirmed');
    const balance = await connection.getBalance(new PublicKey(address));
    return (balance / LAMPORTS_PER_SOL).toFixed(4).replace(/\.?0+$/, '');
  } catch (error) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 500));
      return fetchSOLBalance(address, isTestnet, retries - 1);
    }
    console.error("Error fetching SOL balance:", error);
    return "0.00";
  }
}

export async function fetchBTCBalance(address: string, isTestnet: boolean = false, retries = 2): Promise<string> {
  try {
    const rpcUrl = isTestnet ? CONFIG.MEMPOOL_TESTNET_URL : CONFIG.MEMPOOL_BTC_URL;
    const res = await fetch(`${rpcUrl}${address}`);
    if (!res.ok) throw new Error("Failed to fetch BTC balance");
    const data = await res.json();
    const balance = (data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum) / 100000000;
    return balance.toFixed(8).replace(/\.?0+$/, '');
  } catch (error) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 500));
      return fetchBTCBalance(address, isTestnet, retries - 1);
    }
    console.error("Error fetching BTC balance:", error);
    return "0.00";
  }
}

export async function fetchLivePrices(): Promise<{ 
  prices: { eth: number, sol: number, btc: number },
  changes: { eth: number, sol: number, btc: number }
}> {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum,solana,bitcoin&vs_currencies=usd&include_24hr_change=true', {
      headers: { 
        'x-cg-demo-api-key': CONFIG.COINGECKO_API_KEY, 
        'accept': 'application/json' 
      }
    });
    if (!res.ok) throw new Error("Failed to fetch prices");
    const data = await res.json();
    return {
      prices: {
        eth: data.ethereum?.usd || 0,
        sol: data.solana?.usd || 0,
        btc: data.bitcoin?.usd || 0
      },
      changes: {
        eth: data.ethereum?.usd_24h_change || 0,
        sol: data.solana?.usd_24h_change || 0,
        btc: data.bitcoin?.usd_24h_change || 0
      }
    };
  } catch (error) {
    console.error("Error fetching prices:", error);
    return { 
      prices: { eth: 0, sol: 0, btc: 0 },
      changes: { eth: 0, sol: 0, btc: 0 }
    };
  }
}

export async function fetchChartData(coinId: string, days: string): Promise<{ time: number; value: number }[]> {
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`, {
      headers: { 
        'x-cg-demo-api-key': CONFIG.COINGECKO_API_KEY, 
        'accept': 'application/json' 
      }
    });
    if (!res.ok) throw new Error("Failed to fetch chart data");
    const data = await res.json();
    return data.prices.map(([timestamp, price]: [number, number]) => ({
      time: timestamp,
      value: price,
    }));
  } catch (error) {
    console.error("Error fetching chart data:", error);
    return [];
  }
}
