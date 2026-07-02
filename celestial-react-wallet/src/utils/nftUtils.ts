import { CONFIG } from '../config/networks';
import type { ChainAccount } from './walletUtils';
import type { NFTRecord } from '../types';

function parseIpfsUrl(url: string | undefined): string {
  if (!url) return '';
  if (url.startsWith('ipfs://')) {
    return url.replace('ipfs://', 'https://ipfs.io/ipfs/');
  }
  return url;
}

const resolveImageUrl = (nft: any): string => {
  // 1. Try Alchemy's cached URL first (most reliable)
  if (nft.image?.cachedUrl) return nft.image.cachedUrl;
  
  // 2. Fallback to raw metadata
  let rawUrl = nft.raw?.metadata?.image || nft.image?.originalUrl || "";
  
  // 3. Convert IPFS to HTTP Gateway
  if (rawUrl.startsWith("ipfs://")) {
    return rawUrl.replace("ipfs://", "https://ipfs.io/ipfs/");
  }
  
  return rawUrl;
};

export async function fetchAccountNFTs(account: ChainAccount, isTestnet: boolean): Promise<NFTRecord[]> {
  try {
    // MOCK OVERRIDE (as specified in instructions to ensure UI is testable)
    const testAddress = account.chain === 'EVM' 
      ? '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' // vitalik.eth
      : account.chain === 'Solana'
      ? 'vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg' // Valid solana address
      : account.address;

    switch (account.chain) {
      case 'EVM':
        return await fetchEVMNFTs(testAddress, isTestnet);
      case 'Solana':
        return await fetchSolanaNFTs(testAddress, isTestnet);
      default:
        return [];
    }
  } catch (error) {
    console.error(`Failed to fetch NFTs for ${account.chain}:`, error);
    return [];
  }
}

async function fetchEVMNFTs(address: string, isTestnet: boolean): Promise<NFTRecord[]> {
  const urlBase = isTestnet ? CONFIG.ALCHEMY_SEPOLIA_URL : CONFIG.ALCHEMY_ETH_URL;
  // We expect urlBase to be like https://eth-mainnet.g.alchemy.com/v2/KEY
  // We need to construct the NFT API URL. Alchemy v3 NFT API:
  // https://eth-mainnet.g.alchemy.com/nft/v3/KEY/getNFTsForOwner
  
  const apiKey = urlBase.split('/').pop();
  const networkDomain = isTestnet ? 'eth-sepolia.g.alchemy.com' : 'eth-mainnet.g.alchemy.com';
  
  const url = `https://${networkDomain}/nft/v3/${apiKey}/getNFTsForOwner?owner=${address}&withMetadata=true`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Alchemy NFT API error");
  const data = await res.json();
  
  if (!data.ownedNfts || !Array.isArray(data.ownedNfts)) return [];

  return data.ownedNfts.map((nft: any) => {
    return {
      id: `${nft.contract.address}-${nft.tokenId}`,
      chain: 'Ethereum',
      name: nft.name || nft.raw?.metadata?.name || `${nft.contract.symbol || 'NFT'} #${nft.tokenId}`,
      collectionName: nft.collection?.name || nft.contract.name || 'Unknown Collection',
      imageUrl: resolveImageUrl(nft)
    };
  });
}

async function fetchSolanaNFTs(address: string, isTestnet: boolean): Promise<NFTRecord[]> {
  const url = isTestnet ? CONFIG.HELIUS_DEVNET_URL : CONFIG.HELIUS_SOL_URL;
  
  const body = {
    jsonrpc: "2.0",
    id: "my-id",
    method: "getAssetsByOwner",
    params: {
      ownerAddress: address,
      page: 1,
      limit: 100
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  if (!res.ok) throw new Error("Helius DAS API error");
  const data = await res.json();
  
  if (!data.result || !data.result.items || !Array.isArray(data.result.items)) return [];

  return data.result.items
    .filter((item: any) => item.interface === 'V1_NFT' || item.interface === 'Custom' || item.interface === 'V1_PRINT' || item.content?.links?.image)
    .map((item: any) => {
      let imageUrl = item.content?.links?.image || '';
      
      return {
        id: item.id,
        chain: 'Solana',
        name: item.content?.metadata?.name || 'Unknown NFT',
        collectionName: item.grouping && item.grouping.length > 0 && item.grouping[0].collection_metadata 
          ? item.grouping[0].collection_metadata.name 
          : 'Unknown Collection',
        imageUrl: parseIpfsUrl(imageUrl)
      };
    });
}
