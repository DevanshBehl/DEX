import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { ethers } from 'ethers';
import { CONFIG } from '../config/networks';
import type { WalletAsset } from '../types';
import usdcLogo from '../assets/usdc.svg';

// Testnet tokens have no market data. Map well-known testnet deployments to their
// mainnet counterparts so they still get a price and chart.
const TESTNET_PRICE_ALIASES: Record<string, string> = {
  // Circle USDC — Sepolia → Ethereum
  '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238': '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  // Circle USDC — Solana Devnet → Mainnet
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
};

// Metadata overrides for well-known tokens whose on-chain metadata is missing (common on testnets)
const KNOWN_TOKENS: Record<string, { name: string; symbol: string; logo: string }> = {
  '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238': { name: 'USD Coin', symbol: 'USDC', logo: usdcLogo },
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { name: 'USD Coin', symbol: 'USDC', logo: usdcLogo },
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU': { name: 'USD Coin', symbol: 'USDC', logo: usdcLogo },
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { name: 'USD Coin', symbol: 'USDC', logo: usdcLogo },
};

const withTimeout = <T>(promise: Promise<T>, ms: number = 10000): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms)),
  ]);

const formatAmount = (n: number) => {
  if (n === 0) return '0';
  if (n >= 1) return n.toFixed(4).replace(/\.?0+$/, '');
  return n.toPrecision(4).replace(/\.?0+$/, '');
};

async function jsonRpc<T>(url: string, method: string, params: unknown): Promise<T> {
  const res = await withTimeout(fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }));
  if (!res.ok) throw new Error(`${method} failed: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`${method}: ${data.error.message}`);
  return data.result as T;
}

// ---- Prices (CoinGecko) -------------------------------------------------------

const priceCache: Record<string, { price: number; change: number; ts: number }> = {};

async function fetchTokenPrices(
  platform: 'ethereum' | 'solana',
  addresses: string[],
): Promise<Record<string, { price: number; change: number }>> {
  const out: Record<string, { price: number; change: number }> = {};
  const now = Date.now();
  const missing = addresses.filter((a) => {
    const c = priceCache[`${platform}:${a.toLowerCase()}`];
    if (c && now - c.ts < 120000) { out[a.toLowerCase()] = c; return false; }
    return true;
  });

  const query = async (batch: string[]) => {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${batch.join(',')}&vs_currencies=usd&include_24hr_change=true`,
      { headers: { 'x-cg-demo-api-key': CONFIG.COINGECKO_API_KEY, accept: 'application/json' } },
    );
    if (!res.ok) throw new Error(`token_price ${res.status}`);
    const data = await res.json();
    for (const [addr, v] of Object.entries<any>(data)) {
      const entry = { price: v.usd || 0, change: v.usd_24h_change || 0, ts: now };
      priceCache[`${platform}:${addr.toLowerCase()}`] = entry;
      out[addr.toLowerCase()] = entry;
    }
  };

  if (missing.length > 0) {
    try {
      await query(missing);
    } catch {
      // Some API plans only accept one address per request — fall back to individual lookups
      await Promise.all(missing.slice(0, 20).map((a) => query([a]).catch(() => {})));
    }
  }
  return out;
}

async function applyPrices(assets: WalletAsset[], platform: 'ethereum' | 'solana', isTestnet: boolean) {
  // Address used for market data (original casing — Solana mints are case-sensitive)
  const priced = assets
    .map((asset) => {
      const alias = TESTNET_PRICE_ALIASES[platform === 'ethereum' ? asset.contract!.toLowerCase() : asset.contract!];
      return { asset, addr: isTestnet ? alias : asset.contract! };
    })
    .filter((x): x is { asset: WalletAsset; addr: string } => !!x.addr);
  if (priced.length === 0) return;

  const prices = await fetchTokenPrices(platform, priced.map((x) => x.addr))
    .catch(() => ({} as Record<string, { price: number; change: number }>));

  for (const { asset, addr } of priced) {
    asset.chart = { kind: 'contract', platform, address: addr };
    const p = prices[addr.toLowerCase()];
    if (p && p.price > 0) {
      asset.price = p.price;
      asset.change = p.change;
      asset.hasPrice = true;
    }
  }
}

// ---- ERC-20 discovery (Alchemy) ----------------------------------------------

interface AlchemyTokenMetadata {
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  logo: string | null;
}

export async function fetchERC20Assets(owner: string, isTestnet: boolean): Promise<WalletAsset[]> {
  const rpcUrl = isTestnet ? CONFIG.ALCHEMY_SEPOLIA_URL : CONFIG.ALCHEMY_ETH_URL;
  if (!rpcUrl) return [];

  try {
    const { tokenBalances } = await jsonRpc<{ tokenBalances: { contractAddress: string; tokenBalance: string | null }[] }>(
      rpcUrl, 'alchemy_getTokenBalances', [owner, 'erc20'],
    );
    const held = tokenBalances.filter((t) => t.tokenBalance && BigInt(t.tokenBalance) > 0n).slice(0, 50);

    const assets = await Promise.all(held.map(async (t): Promise<WalletAsset | null> => {
      try {
        const meta = await jsonRpc<AlchemyTokenMetadata>(rpcUrl, 'alchemy_getTokenMetadata', [t.contractAddress]);
        if (!meta.symbol || meta.decimals === null) return null;
        const known = KNOWN_TOKENS[t.contractAddress.toLowerCase()];
        const amount = parseFloat(ethers.formatUnits(BigInt(t.tokenBalance!), meta.decimals));
        if (amount === 0) return null;
        return {
          key: `erc20:${t.contractAddress.toLowerCase()}`,
          kind: 'erc20',
          chain: 'EVM',
          symbol: known?.symbol || meta.symbol,
          name: known?.name || meta.name || meta.symbol,
          logo: known?.logo || meta.logo,
          decimals: meta.decimals,
          balance: formatAmount(amount),
          price: 0,
          change: 0,
          hasPrice: false,
          chart: null,
          contract: ethers.getAddress(t.contractAddress),
        };
      } catch {
        return null;
      }
    }));

    const list = assets.filter((a): a is WalletAsset => a !== null);
    await applyPrices(list, 'ethereum', isTestnet);
    return list;
  } catch (error) {
    console.error('Error fetching ERC-20 tokens:', error);
    return [];
  }
}

// ---- SPL + Token-2022 discovery (Solana RPC + Helius DAS metadata) ------------

export async function fetchSPLAssets(owner: string, isTestnet: boolean): Promise<WalletAsset[]> {
  const rpcUrl = isTestnet ? CONFIG.HELIUS_DEVNET_URL : CONFIG.HELIUS_SOL_URL;
  if (!rpcUrl) return [];

  try {
    const connection = new Connection(rpcUrl, 'confirmed');
    const ownerKey = new PublicKey(owner);
    const results = await Promise.all(
      [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((programId) =>
        withTimeout(connection.getParsedTokenAccountsByOwner(ownerKey, { programId }))
          .then((r) => r.value.map((v) => ({ ...v, programId: programId.toBase58() })))
          .catch(() => []),
      ),
    );

    // Aggregate by mint; remember the largest account as the send source
    const byMint = new Map<string, { raw: bigint; decimals: number; programId: string; tokenAccount: string; largest: bigint }>();
    for (const acc of results.flat()) {
      const info = acc.account.data.parsed?.info;
      const amt = info?.tokenAmount;
      if (!info || !amt) continue;
      const raw = BigInt(amt.amount);
      if (raw === 0n) continue;
      const existing = byMint.get(info.mint);
      if (existing) {
        existing.raw += raw;
        if (raw > existing.largest) { existing.largest = raw; existing.tokenAccount = acc.pubkey.toBase58(); }
      } else {
        byMint.set(info.mint, { raw, decimals: amt.decimals, programId: acc.programId, tokenAccount: acc.pubkey.toBase58(), largest: raw });
      }
    }

    // Skip NFTs (0 decimals, supply of one) — those belong in the NFT tab
    const mints = [...byMint.entries()].filter(([, v]) => !(v.decimals === 0 && v.raw === 1n));
    if (mints.length === 0) return [];

    // Metadata from Helius DAS (works for both SPL and Token-2022 metadata extensions)
    const meta: Record<string, { name?: string; symbol?: string; image?: string }> = {};
    try {
      const assets = await jsonRpc<any[]>(rpcUrl, 'getAssetBatch', { ids: mints.map(([m]) => m) });
      for (const a of assets || []) {
        if (!a?.id) continue;
        meta[a.id] = {
          name: a.content?.metadata?.name || a.token_info?.symbol,
          symbol: a.content?.metadata?.symbol || a.token_info?.symbol,
          image: a.content?.links?.image || a.content?.files?.[0]?.cdn_uri || a.content?.files?.[0]?.uri,
        };
      }
    } catch (e) {
      console.warn('Token metadata lookup failed, using mint addresses', e);
    }

    const list: WalletAsset[] = mints.map(([mint, v]) => {
      const m = { ...meta[mint], ...(KNOWN_TOKENS[mint] && { name: KNOWN_TOKENS[mint].name, symbol: KNOWN_TOKENS[mint].symbol, image: KNOWN_TOKENS[mint].logo }) };
      const short = `${mint.slice(0, 4)}…${mint.slice(-4)}`;
      const symbol = (m.symbol || short).trim();
      return {
        key: `spl:${mint}`,
        kind: 'spl',
        chain: 'Solana',
        symbol,
        name: (m.name || symbol).trim(),
        logo: m.image || null,
        decimals: v.decimals,
        balance: formatAmount(parseFloat(ethers.formatUnits(v.raw, v.decimals))),
        price: 0,
        change: 0,
        hasPrice: false,
        chart: null,
        contract: mint,
        programId: v.programId,
        tokenAccount: v.tokenAccount,
      };
    });

    await applyPrices(list, 'solana', isTestnet);
    return list;
  } catch (error) {
    console.error('Error fetching SPL tokens:', error);
    return [];
  }
}
