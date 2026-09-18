import React from 'react';
import { formatNative } from '../../nft/marketplaces/format';
import type { NFTWithVisibility } from '../../nft/types';
import { NFTImage } from './NFTImage';

interface NFTCardProps {
  nft: NFTWithVisibility;
  onOpen: (nft: NFTWithVisibility) => void;
  dimmed?: boolean;
  /** Collection floor in native currency (Phase 4); absent on testnets and unlisted collections. */
  floorNative?: number | null;
}

export const NFTCard: React.FC<NFTCardProps> = ({ nft, onOpen, dimmed = false, floorNative }) => (
  <button
    onClick={() => onOpen(nft)}
    className={`text-left bg-white/[0.02] border border-white/5 rounded-xl overflow-hidden hover:bg-white/[0.05] hover:border-white/10 transition-colors group focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${dimmed ? 'opacity-60' : ''}`}
  >
    <div className="relative">
      <NFTImage
        sources={nft.images}
        alt={nft.name}
        className="w-full aspect-square"
        imgClassName="object-cover group-hover:scale-105 transition-transform duration-500"
      />
      <span className="absolute top-2 right-2 bg-black/60 backdrop-blur-md px-1.5 py-0.5 rounded text-[9px] font-bold text-white uppercase tracking-wider">
        {nft.chain === 'EVM' ? 'ETH' : 'SOL'}
      </span>
      {nft.standard === 'erc1155' && nft.amount !== '1' && (
        <span className="absolute top-2 left-2 bg-black/60 backdrop-blur-md px-1.5 py-0.5 rounded text-[10px] font-bold text-white">
          ×{nft.amount}
        </span>
      )}
      {dimmed && (
        <span className={`absolute bottom-2 left-2 px-1.5 py-0.5 rounded text-[9px] font-black text-white uppercase tracking-wider ${nft.isSpam ? 'bg-[#ff0055]/80' : 'bg-zinc-700/90'}`}>
          {nft.isSpam ? 'Spam' : 'Hidden'}
        </span>
      )}
    </div>
    <div className="px-2.5 py-2">
      <div className="text-xs font-bold text-white truncate">{nft.name}</div>
      {floorNative ? (
        <div className="flex items-baseline gap-1 mt-0.5" title="Collection floor price">
          <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-wider">Floor</span>
          <span className="text-[11px] font-bold text-zinc-300 truncate">{formatNative(floorNative, nft.chain)}</span>
        </div>
      ) : null}
    </div>
  </button>
);
