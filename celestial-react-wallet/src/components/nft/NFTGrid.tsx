import React, { useMemo, useState } from 'react';
import { formatNative } from '../../nft/marketplaces/format';
import type { NFTMarketData } from '../../nft/marketplaces/types';
import type { NFTWithVisibility } from '../../nft/types';
import { groupByCollection, UNGROUPED } from '../../nft/group';
import { NFTCard } from './NFTCard';
import { NFTImage } from './NFTImage';

interface NFTGridProps {
  visibleNfts: NFTWithVisibility[];
  hiddenNfts: NFTWithVisibility[];
  isLoading: boolean;
  errors: { EVM: string | null; Solana: string | null };
  onOpen: (nft: NFTWithVisibility) => void;
  onReceive: () => void;
  /** Floor prices by `nft.key` (Phase 4); empty on testnets. */
  market?: Map<string, NFTMarketData>;
}

export const NFTGrid: React.FC<NFTGridProps> = ({ visibleNfts, hiddenNfts, isLoading, errors, onOpen, onReceive, market }) => {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);
  const groups = useMemo(() => groupByCollection(visibleNfts), [visibleNfts]);

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const failedChains = (['EVM', 'Solana'] as const).filter((c) => errors[c]);
  const isEmpty = visibleNfts.length === 0 && hiddenNfts.length === 0;

  return (
    <div className="flex flex-col gap-4 pb-24">
      {failedChains.length > 0 && (
        <div className="mx-1 px-3 py-2 rounded-xl bg-[#ff0055]/10 border border-[#ff0055]/20 text-[11px] font-medium text-[#ff0055]/90">
          Couldn't refresh {failedChains.map((c) => (c === 'EVM' ? 'Ethereum' : 'Solana')).join(' & ')} NFTs
        </div>
      )}

      {isLoading && isEmpty ? (
        <div className="grid grid-cols-2 gap-3 px-1">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="animate-pulse bg-white/[0.03] border border-white/5 rounded-xl aspect-[4/5]" />
          ))}
        </div>
      ) : isEmpty ? (
        <div className="mx-1 flex flex-col items-center text-center py-12 px-6 bg-white/[0.02] border border-white/5 rounded-2xl">
          <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center mb-4 text-zinc-500">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
          </div>
          <p className="text-sm font-bold text-white">No NFTs yet</p>
          <p className="text-xs text-zinc-500 mt-1 mb-4">NFTs you receive on Ethereum or Solana will show up here.</p>
          <button onClick={onReceive} className="haptic-btn px-4 py-2 rounded-full bg-white text-black text-xs font-bold hover:opacity-90 transition-opacity">
            Receive
          </button>
        </div>
      ) : (
        <>
          {visibleNfts.length === 0 && (
            <div className="mx-1 text-zinc-500 text-center py-10 text-sm font-medium bg-white/[0.02] border border-white/5 rounded-2xl">
              All NFTs are hidden
            </div>
          )}

          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.key);
            // Every NFT in a group shares a collection, so the first floor found is the group's.
            const groupFloor = group.key === UNGROUPED
              ? null
              : group.nfts.reduce<number | null>((floor, n) => floor ?? market?.get(n.key)?.floorNative ?? null, null);
            return (
              <section key={group.key}>
                <button
                  onClick={() => toggle(group.key)}
                  className="w-full flex items-center gap-2.5 px-1 py-1.5 rounded-lg hover:bg-white/[0.03] transition-colors"
                  aria-expanded={!isCollapsed}
                >
                  {group.key === UNGROUPED ? (
                    <div className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center text-zinc-500 shrink-0">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
                    </div>
                  ) : (
                    <NFTImage
                      sources={group.image ? [group.image] : group.nfts[0].images}
                      alt={group.name}
                      className="w-7 h-7 rounded-lg shrink-0"
                      imgClassName="object-cover"
                    />
                  )}
                  <span className="text-[13px] font-bold text-white truncate">{group.name}</span>
                  {group.verified && (
                    <svg width="13" height="13" viewBox="0 0 24 24" className="shrink-0" aria-label="Verified collection"><circle cx="12" cy="12" r="10" fill="#00f0ff" /><polyline points="7.5 12.5 10.5 15.5 16.5 9" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  )}
                  <span className="text-[10px] font-bold text-zinc-500 bg-zinc-900 px-1.5 py-0.5 rounded-md shrink-0">{group.nfts.length}</span>
                  {groupFloor ? (
                    <span className="ml-auto text-[10px] font-bold text-zinc-500 shrink-0" title="Collection floor price">
                      {formatNative(groupFloor, group.nfts[0].chain)}
                    </span>
                  ) : null}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#71717a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`${groupFloor ? '' : 'ml-auto'} shrink-0 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`}><polyline points="6 9 12 15 18 9" /></svg>
                </button>
                {!isCollapsed && (
                  <div className="grid grid-cols-2 gap-3 px-1 mt-2">
                    {group.nfts.map((nft) => (
                      <NFTCard key={nft.key} nft={nft} onOpen={onOpen} floorNative={market?.get(nft.key)?.floorNative} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}

          {hiddenNfts.length > 0 && (
            <div className="px-1">
              <button
                onClick={() => setShowHidden((v) => !v)}
                className="w-full py-2.5 rounded-xl bg-white/[0.03] border border-white/5 text-[12px] font-bold text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors"
              >
                {showHidden ? 'Hide' : 'Show'} hidden & spam ({hiddenNfts.length})
              </button>
              {showHidden && (
                <div className="grid grid-cols-2 gap-3 mt-3">
                  {hiddenNfts.map((nft) => <NFTCard key={nft.key} nft={nft} onOpen={onOpen} dimmed />)}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
