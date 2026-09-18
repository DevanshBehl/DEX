import { ethers } from 'ethers';
import { normalizeAlchemyNFT, type AlchemyOwnedNft } from '../normalize.ts';
import type { NFTAsset } from '../types.ts';

// ---- EVM ownership via Alchemy NFT API v3 (nft.md — Phase 1.3) --------------------

const PAGE_SIZE = 100;
const MAX_PAGES = 20; // 2,000 NFTs — protects the popup from pathological wallets

/** `https://eth-sepolia.g.alchemy.com/v2/<key>` → `https://eth-sepolia.g.alchemy.com/nft/v3/<key>` */
export function alchemyNftApiBase(rpcUrl: string): string {
  const url = new URL(rpcUrl);
  const key = url.pathname.split('/').filter(Boolean).pop();
  if (!url.hostname.endsWith('alchemy.com') || !key) {
    throw new Error('EVM NFT indexing requires an Alchemy RPC URL');
  }
  return `${url.origin}/nft/v3/${key}`;
}

// Contract name lookups are stable — cache for the lifetime of the popup
const contractNameCache = new Map<string, Promise<string | null>>();

function readContractName(contract: string, provider: ethers.JsonRpcProvider): Promise<string | null> {
  const cacheKey = contract.toLowerCase();
  if (!contractNameCache.has(cacheKey)) {
    const c = new ethers.Contract(contract, ['function name() view returns (string)'], provider);
    contractNameCache.set(
      cacheKey,
      (c.name() as Promise<string>).then((n) => (n?.trim() ? n.trim() : null)).catch(() => null),
    );
  }
  return contractNameCache.get(cacheKey)!;
}

export async function fetchEVMNFTs(owner: string, rpcUrl: string, signal?: AbortSignal): Promise<NFTAsset[]> {
  const base = alchemyNftApiBase(rpcUrl);
  const assets: NFTAsset[] = [];
  let pageKey: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ owner, withMetadata: 'true', pageSize: String(PAGE_SIZE) });
    if (pageKey) params.set('pageKey', pageKey);

    const res = await fetch(`${base}/getNFTsForOwner?${params}`, { signal });
    if (!res.ok) throw new Error(`Alchemy NFT API error (${res.status})`);
    const data = (await res.json()) as { ownedNfts?: AlchemyOwnedNft[]; pageKey?: string | null };

    for (const raw of data.ownedNfts || []) {
      const nft = normalizeAlchemyNFT(raw);
      if (nft) assets.push(nft);
    }

    pageKey = data.pageKey || undefined;
    if (!pageKey) break;
  }

  // Freshly deployed contracts have no contract metadata in Alchemy yet — read name() on-chain
  const unnamed = [...new Set(assets.filter((a) => !a.collection?.name).map((a) => a.contract!))];
  if (unnamed.length > 0) {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const names = new Map(
      await Promise.all(unnamed.map(async (c) => [c.toLowerCase(), await readContractName(c, provider)] as const)),
    );
    for (const a of assets) {
      const name = names.get(a.contract!.toLowerCase());
      if (name && a.collection && !a.collection.name) a.collection.name = name;
    }
  }

  return assets;
}
