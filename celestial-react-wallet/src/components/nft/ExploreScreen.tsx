import React from 'react';
import { useExplore, type ExploreEntry } from '../../nft/hooks/useExplore';
import { formatNative } from '../../nft/marketplaces/format';
import { NFTImage } from './NFTImage';

interface ExploreScreenProps {
  isTestnet: boolean;
  onOpenCollection: (handle: string, name: string) => void;
}

export const ExploreScreen: React.FC<ExploreScreenProps> = ({ isTestnet, onOpenCollection }) => {
  const { entries, ranked, isLoading, error, refresh } = useExplore(true, isTestnet);

  return (
    <div className="absolute inset-0 bg-[#000] z-40 flex flex-col animate-fade-in">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5 shrink-0">
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-black text-white tracking-tight">Explore</h1>
          <p className="text-[11px] font-semibold text-zinc-500 mt-0.5">
            {ranked ? 'Trending on Magic Eden' : 'Featured collections on Magic Eden'}
          </p>
        </div>
        <button
          onClick={refresh}
          title="Refresh"
          className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors shrink-0"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={isLoading ? 'animate-spin' : ''}><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide px-4 pt-4 pb-28">
        {error === 'testnet' ? (
          <Notice
            title="Not available on testnet"
            body="Marketplaces only index mainnet collections. Switch off Testnet Mode in Settings to explore."
          />
        ) : error === 'unavailable' ? (
          <Notice
            title="Market data unavailable"
            body="No marketplace provider is reachable right now. Floor prices and listings will appear once one is configured."
          />
        ) : isLoading && entries.length === 0 ? (
          <div className="flex flex-col gap-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-[68px] animate-pulse bg-white/[0.03] border border-white/5 rounded-2xl" />
            ))}
          </div>
        ) : (
          <>
            {!ranked && entries.length > 0 && (
              // Honesty: without a ranked feed this is a curated list, not a volume ranking.
              <p className="text-[10px] font-medium text-zinc-600 mb-3 leading-snug">
                A hand-picked set of established collections with live floor prices — not a volume ranking.
              </p>
            )}
            <div className="flex flex-col gap-2">
              {entries.map((entry) => (
                <CollectionRow key={entry.collection.handle} entry={entry} onOpen={onOpenCollection} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const CollectionRow: React.FC<{ entry: ExploreEntry; onOpen: (handle: string, name: string) => void }> = ({ entry, onOpen }) => {
  const { collection, stats } = entry;
  return (
    <button
      onClick={() => onOpen(collection.handle, collection.name)}
      className="flex items-center gap-3 p-2.5 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] hover:border-white/10 transition-colors text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
    >
      <NFTImage
        sources={collection.image ? [collection.image] : []}
        alt={collection.name}
        className="w-12 h-12 rounded-xl shrink-0"
        imgClassName="object-cover"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-bold text-white truncate">{collection.name}</span>
          {collection.verified && (
            <svg width="12" height="12" viewBox="0 0 24 24" className="shrink-0" aria-label="Verified collection"><circle cx="12" cy="12" r="10" fill="#00f0ff" /><polyline points="7.5 12.5 10.5 15.5 16.5 9" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          )}
        </div>
        <div className="text-[11px] font-semibold text-zinc-500 mt-0.5">
          {stats
            ? stats.floorNative !== null
              ? `Floor ${formatNative(stats.floorNative, 'Solana')}${stats.listedCount !== null ? ` · ${stats.listedCount.toLocaleString('en-US')} listed` : ''}`
              : 'Nothing listed'
            : '—'}
        </div>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#52525b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><polyline points="9 18 15 12 9 6" /></svg>
    </button>
  );
};

const Notice: React.FC<{ title: string; body: string }> = ({ title, body }) => (
  <div className="flex flex-col items-center text-center py-12 px-6 bg-white/[0.02] border border-white/5 rounded-2xl">
    <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center mb-4 text-zinc-500">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" /></svg>
    </div>
    <p className="text-sm font-bold text-white">{title}</p>
    <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{body}</p>
  </div>
);
