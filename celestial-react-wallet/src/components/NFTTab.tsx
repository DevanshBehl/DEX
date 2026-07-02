import React, { useState, useEffect } from 'react';
import type { ChainAccount } from '../utils/walletUtils';
import type { NFTRecord } from '../types';
import { fetchAccountNFTs } from '../utils/nftUtils';

interface NFTTabProps {
  isOpen: boolean;
  onClose: () => void;
  activeAccountGroup: { name: string; chains: ChainAccount[] };
  isTestnet: boolean;
}

export const NFTTab: React.FC<NFTTabProps> = ({ isOpen, onClose, activeAccountGroup, isTestnet }) => {
  const [nfts, setNfts] = useState<NFTRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !activeAccountGroup) return;

    let isMounted = true;
    const loadNFTs = async () => {
      setIsLoading(true);
      try {
        const allNFTs = await Promise.all(
          activeAccountGroup.chains.map(chainAccount => {
            return fetchAccountNFTs(chainAccount, isTestnet);
          })
        );

        if (isMounted) {
          const combined = allNFTs.flat();
          setNfts(combined);
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };
    loadNFTs();

    return () => {
      isMounted = false;
    };
  }, [isOpen, activeAccountGroup, isTestnet]);

  return (
    <div 
      className="absolute inset-0 z-[100] flex flex-col transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] bg-black/20 backdrop-blur-[40px]"
      style={{ transform: isOpen ? 'translateY(0)' : 'translateY(-100%)' }}
    >
      <div className="flex-1 overflow-y-auto scrollbar-hide px-6 pt-6 pb-24">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-black text-white">NFTs</h2>
          <button onClick={onClose} className="haptic-btn w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="animate-pulse bg-white/[0.02] border border-white/5 rounded-xl aspect-square"></div>
            ))}
          </div>
        ) : nfts.length === 0 ? (
          <div className="text-zinc-500 text-center py-20 text-sm font-medium bg-white/[0.02] border border-white/5 rounded-2xl">
            No NFTs found
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {nfts.map((nft) => (
              <div key={nft.id} className="bg-white/[0.02] border border-white/5 rounded-xl overflow-hidden hover:bg-white/[0.04] transition-colors group cursor-pointer">
                <div className="w-full aspect-square bg-white/5 relative">
                  {nft.imageUrl ? (
                    <img 
                      src={nft.imageUrl} 
                      alt={nft.name}
                      className="w-full aspect-square object-cover group-hover:scale-105 transition-transform duration-500"
                      onError={(e) => {
                        e.currentTarget.src = 'https://via.placeholder.com/400x400/1a1a1a/ffffff?text=No+Image';
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-700">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    </div>
                  )}
                  <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded text-[10px] font-bold text-white uppercase tracking-wider">
                    {nft.chain === 'Ethereum' ? 'ETH' : 'SOL'}
                  </div>
                </div>
                <div className="p-3">
                  <div className="text-[10px] font-medium text-zinc-500 truncate">{nft.collectionName}</div>
                  <div className="text-xs font-bold text-white truncate mt-0.5">{nft.name}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
