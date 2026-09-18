import React from 'react';
import { useCollectionListings } from '../../nft/hooks/useExplore';
import { formatNative, formatUsd } from '../../nft/marketplaces/format';
import { MARKETPLACE_LABELS, type Listing } from '../../nft/marketplaces/types';
import { NFTImage } from './NFTImage';

interface CollectionPageProps {
  handle: string;
  name: string;
  isTestnet: boolean;
  solUsdPrice: number;
  onClose: () => void;
}

export const CollectionPage: React.FC<CollectionPageProps> = ({ handle, name, isTestnet, solUsdPrice, onClose }) => {
  const { listings, stats, isLoading, error, hasMore, loadMore } = useCollectionListings(handle, 'Solana', isTestnet);

  const statRows = stats
    ? [
        { label: 'Floor', value: stats.floorNative !== null ? formatNative(stats.floorNative, 'Solana') : '—' },
        ...(stats.listedCount !== null ? [{ label: 'Listed', value: stats.listedCount.toLocaleString('en-US') }] : []),
        ...(stats.volume ? [{ label: `${stats.volume.window} vol`, value: formatNative(stats.volume.native, 'Solana') }] : []),
      ]
    : [];

  return (
    // Above Explore (z-[100]), which it is pushed onto from.
    <div className="absolute inset-0 bg-[#000] z-[110] flex flex-col animate-fade-in">
      <div className="flex items-center gap-3 px-4 pt-6 pb-3 border-b border-white/5 shrink-0">
        <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 transition-colors shrink-0" aria-label="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <h1 className="flex-1 text-base font-bold text-white truncate">{name}</h1>
        {stats?.url && (
          <a
            href={stats.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 flex items-center gap-1 px-2.5 h-9 rounded-full bg-white/5 hover:bg-white/10 text-[11px] font-bold text-zinc-300 hover:text-white transition-colors"
          >
            {MARKETPLACE_LABELS[stats.source]}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
          </a>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide px-4 pt-4 pb-28">
        {statRows.length > 0 && (
          <div className="flex divide-x divide-white/5 bg-white/[0.02] border border-white/5 rounded-xl mb-4">
            {statRows.map((row) => (
              <div key={row.label} className="flex-1 px-3 py-2.5 min-w-0">
                <div className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider truncate">{row.label}</div>
                <div className="text-[13px] font-bold text-white truncate mt-0.5">{row.value}</div>
              </div>
            ))}
          </div>
        )}

        <h2 className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Listings</h2>

        {error ? (
          <p className="text-[12px] font-medium text-zinc-500 bg-white/[0.02] border border-white/5 rounded-xl px-3 py-3">
            {isTestnet ? 'Listings are mainnet only.' : 'Listings are unavailable right now.'}
          </p>
        ) : isLoading && listings.length === 0 ? (
          <div className="grid grid-cols-2 gap-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="animate-pulse bg-white/[0.03] border border-white/5 rounded-xl aspect-[4/5]" />
            ))}
          </div>
        ) : listings.length === 0 ? (
          <p className="text-[12px] font-medium text-zinc-500 bg-white/[0.02] border border-white/5 rounded-xl px-3 py-3">
            Nothing is listed in this collection right now.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              {listings.map((listing, i) => (
                <ListingCard key={`${listing.ref}-${i}`} listing={listing} solUsdPrice={solUsdPrice} />
              ))}
            </div>
            {hasMore && (
              <button
                onClick={() => void loadMore()}
                disabled={isLoading}
                className="w-full mt-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/5 text-[12px] font-bold text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors disabled:opacity-50"
              >
                {isLoading ? 'Loading…' : 'Load more'}
              </button>
            )}
          </>
        )}

        {/* Buying arrives with the Phase 5 safety pipeline — don't imply it works yet. */}
        <p className="text-[10px] font-medium text-zinc-600 mt-4 leading-snug text-center">
          Buying from Celestial is coming soon. Tap a listing to view it on the marketplace.
        </p>
      </div>
    </div>
  );
};

const ListingCard: React.FC<{ listing: Listing; solUsdPrice: number }> = ({ listing, solUsdPrice }) => {
  const href = listing.assetRef ? `https://magiceden.io/item-details/${listing.assetRef}` : undefined;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="block bg-white/[0.02] border border-white/5 rounded-xl overflow-hidden hover:bg-white/[0.05] hover:border-white/10 transition-colors group"
    >
      <NFTImage
        sources={listing.image ? [listing.image] : []}
        alt={listing.name || 'Listing'}
        className="w-full aspect-square"
        imgClassName="object-cover group-hover:scale-105 transition-transform duration-500"
      />
      <div className="px-2.5 py-2">
        <div className="text-xs font-bold text-white truncate">{listing.name || 'Unnamed'}</div>
        <div className="text-[11px] font-bold text-zinc-300 mt-0.5">{formatNative(listing.priceNative, 'Solana')}</div>
        {solUsdPrice > 0 && (
          <div className="text-[10px] font-semibold text-zinc-600">{formatUsd(listing.priceNative * solUsdPrice)}</div>
        )}
      </div>
    </a>
  );
};
