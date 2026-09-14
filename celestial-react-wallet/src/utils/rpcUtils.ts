import { ethers } from 'ethers';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { CONFIG } from '../config/networks';

const withTimeout = <T>(promise: Promise<T>, ms: number = 5000): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Timeout")), ms))
  ]);
};

export async function fetchETHBalance(address: string, isTestnet: boolean = false, retries = 2): Promise<string> {
  try {
    const rpcUrl = isTestnet ? CONFIG.ALCHEMY_SEPOLIA_URL : CONFIG.ALCHEMY_ETH_URL;
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const balanceWei = await withTimeout(provider.getBalance(address));
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
    const balance = await withTimeout(connection.getBalance(new PublicKey(address)));
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
    const res = await withTimeout(fetch(`${rpcUrl}${address}`));
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

let cachedPrices: any = null;
let lastFetchTime = 0;

export async function fetchLivePrices(): Promise<{ 
  prices: { eth: number, sol: number, btc: number },
  changes: { eth: number, sol: number, btc: number }
}> {
  const now = Date.now();
  if (cachedPrices && now - lastFetchTime < 60000) {
    return cachedPrices;
  }

  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum,solana,bitcoin&vs_currencies=usd&include_24hr_change=true', {
      headers: { 
        'x-cg-demo-api-key': CONFIG.COINGECKO_API_KEY, 
        'accept': 'application/json' 
      }
    });
    if (!res.ok) throw new Error("Failed to fetch prices");
    const data = await res.json();
    cachedPrices = {
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
    lastFetchTime = now;
    return cachedPrices;
  } catch (error) {
    console.error("Error fetching prices:", error);
    if (cachedPrices) return cachedPrices;
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

// ---- Portfolio History (combined multi-coin chart) ----

const portfolioCache: Record<string, { data: { time: string; value: number }[]; ts: number }> = {};

export async function fetchPortfolioHistory(
  holdings: { eth: number; sol: number; btc: number },
  timeRange: string
): Promise<{ time: string; value: number }[]> {
  const daysMap: Record<string, string> = {
    '1D': '1', '1W': '7', '1M': '30', '3M': '90', '1Y': '365', 'ALL': 'max',
  };
  const days = daysMap[timeRange] || '7';
  
  // Cache key based on range (holdings change infrequently)
  const cacheKey = `${timeRange}_${holdings.eth.toFixed(4)}_${holdings.sol.toFixed(4)}_${holdings.btc.toFixed(4)}`;
  const cached = portfolioCache[cacheKey];
  if (cached && Date.now() - cached.ts < 120000) { // 2 min cache
    return cached.data;
  }

  try {
    const [ethHistory, solHistory, btcHistory] = await Promise.all([
      holdings.eth > 0 ? fetchChartData('ethereum', days) : Promise.resolve([]),
      holdings.sol > 0 ? fetchChartData('solana', days) : Promise.resolve([]),
      holdings.btc > 0 ? fetchChartData('bitcoin', days) : Promise.resolve([]),
    ]);

    // Find the dataset with the most points to use as the time base
    const baseHistory = [ethHistory, solHistory, btcHistory].reduce(
      (longest, arr) => arr.length > longest.length ? arr : longest, []
    );

    if (baseHistory.length === 0) return [];

    // Helper to find the closest price in a dataset for a given timestamp
    const findPrice = (history: { time: number; value: number }[], targetTime: number): number => {
      if (history.length === 0) return 0;
      let lo = 0, hi = history.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (history[mid].time < targetTime) lo = mid + 1;
        else hi = mid;
      }
      // Check neighbors for closest match
      if (lo > 0 && Math.abs(history[lo - 1].time - targetTime) < Math.abs(history[lo].time - targetTime)) {
        return history[lo - 1].value;
      }
      return history[lo].value;
    };

    // Format time labels based on range
    const formatTime = (ts: number): string => {
      const d = new Date(ts);
      if (timeRange === '1D') return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      if (timeRange === '1W') return d.toLocaleDateString('en-US', { weekday: 'short' });
      if (timeRange === '1M') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (timeRange === '3M') return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (timeRange === '1Y') return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    };

    // Downsample to max ~60 points for performance
    const maxPoints = 60;
    const step = Math.max(1, Math.floor(baseHistory.length / maxPoints));

    const result: { time: string; value: number }[] = [];
    for (let i = 0; i < baseHistory.length; i += step) {
      const ts = baseHistory[i].time;
      const ethPrice = findPrice(ethHistory, ts);
      const solPrice = findPrice(solHistory, ts);
      const btcPrice = findPrice(btcHistory, ts);
      const portfolioValue = holdings.eth * ethPrice + holdings.sol * solPrice + holdings.btc * btcPrice;
      result.push({ time: formatTime(ts), value: portfolioValue });
    }

    // Always include the last data point
    const lastTs = baseHistory[baseHistory.length - 1].time;
    const lastLabel = formatTime(lastTs);
    if (result.length === 0 || result[result.length - 1].time !== lastLabel) {
      const ethPrice = findPrice(ethHistory, lastTs);
      const solPrice = findPrice(solHistory, lastTs);
      const btcPrice = findPrice(btcHistory, lastTs);
      result.push({
        time: lastLabel,
        value: holdings.eth * ethPrice + holdings.sol * solPrice + holdings.btc * btcPrice,
      });
    }

    portfolioCache[cacheKey] = { data: result, ts: Date.now() };
    return result;
  } catch (error) {
    console.error("Error fetching portfolio history:", error);
    return [];
  }
}

// ---- USDC (stablecoin) balances ---------------------------------------------

// Circle's official USDC deployments
export const USDC_ADDRESSES = {
  eth: { mainnet: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', testnet: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' }, // Sepolia
  sol: { mainnet: 'EPjFWdd5AuFYLv44Nt4VcGCFfiQDVtcwyGmzZdnx1Wt8', testnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' }, // Devnet
};

const formatTokenAmount = (amount: number) => amount.toFixed(2);

export async function fetchUSDCBalanceETH(address: string, isTestnet: boolean = false, retries = 2): Promise<string> {
  try {
    const rpcUrl = isTestnet ? CONFIG.ALCHEMY_SEPOLIA_URL : CONFIG.ALCHEMY_ETH_URL;
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const token = new ethers.Contract(
      isTestnet ? USDC_ADDRESSES.eth.testnet : USDC_ADDRESSES.eth.mainnet,
      ['function balanceOf(address) view returns (uint256)'],
      provider,
    );
    const raw: bigint = await withTimeout(token.balanceOf(address));
    return formatTokenAmount(parseFloat(ethers.formatUnits(raw, 6)));
  } catch (error) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 500));
      return fetchUSDCBalanceETH(address, isTestnet, retries - 1);
    }
    console.error("Error fetching ETH USDC balance:", error);
    return "0.00";
  }
}

export async function fetchUSDCBalanceSOL(address: string, isTestnet: boolean = false, retries = 2): Promise<string> {
  try {
    const rpcUrl = isTestnet ? CONFIG.HELIUS_DEVNET_URL : CONFIG.HELIUS_SOL_URL;
    const connection = new Connection(rpcUrl, 'confirmed');
    const mint = new PublicKey(isTestnet ? USDC_ADDRESSES.sol.testnet : USDC_ADDRESSES.sol.mainnet);
    const res = await withTimeout(connection.getParsedTokenAccountsByOwner(new PublicKey(address), { mint }));
    const total = res.value.reduce(
      (sum, acc) => sum + (acc.account.data.parsed?.info?.tokenAmount?.uiAmount || 0),
      0,
    );
    return formatTokenAmount(total);
  } catch (error) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 500));
      return fetchUSDCBalanceSOL(address, isTestnet, retries - 1);
    }
    console.error("Error fetching SOL USDC balance:", error);
    return "0.00";
  }
}
