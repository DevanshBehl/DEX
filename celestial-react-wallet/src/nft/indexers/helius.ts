import { normalizeHeliusAsset, type HeliusAsset } from '../normalize.ts';
import type { NFTAsset } from '../types.ts';

// ---- Solana ownership via Helius DAS (nft.md — Phase 1.3) -------------------------

const PAGE_LIMIT = 1000; // DAS maximum per page
const MAX_PAGES = 10; // 10,000 assets

export async function fetchSolanaNFTs(owner: string, rpcUrl: string, signal?: AbortSignal): Promise<NFTAsset[]> {
  const assets: NFTAsset[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `celestial-nfts-${page}`,
        method: 'getAssetsByOwner',
        params: {
          ownerAddress: owner,
          page,
          limit: PAGE_LIMIT,
          options: { showCollectionMetadata: true },
        },
      }),
    });
    if (!res.ok) throw new Error(`Helius DAS error (${res.status})`);
    const data = (await res.json()) as {
      result?: { items?: HeliusAsset[] };
      error?: { message?: string };
    };
    if (data.error) throw new Error(`Helius DAS error: ${data.error.message || 'unknown'}`);

    const items = data.result?.items || [];
    for (const raw of items) {
      const nft = normalizeHeliusAsset(raw);
      if (nft) assets.push(nft);
    }

    if (items.length < PAGE_LIMIT) break;
  }

  return assets;
}
