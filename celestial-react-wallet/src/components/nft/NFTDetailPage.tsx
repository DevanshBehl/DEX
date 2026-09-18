import React, { useState } from 'react';
import { formatNative, formatUsd } from '../../nft/marketplaces/format';
import { MARKETPLACE_LABELS, type NFTMarketData } from '../../nft/marketplaces/types';
import type { NFTStandard, NFTWithVisibility } from '../../nft/types';
import { NFTImage } from './NFTImage';

interface NFTDetailPageProps {
  nft: NFTWithVisibility;
  ownerAddress: string;
  isTestnet: boolean;
  onClose: () => void;
  onToggleHidden: (nft: NFTWithVisibility) => void;
  onSend: (nft: NFTWithVisibility) => void;
  /** Phase 4 market data for this NFT, if any provider indexes its collection. */
  marketData?: NFTMarketData | null;
  isMarketLoading?: boolean;
  /** USD price of the chain's native coin, for the estimated-value line. */
  nativeUsdPrice?: number;
}

const STANDARD_LABELS: Record<NFTStandard, string> = {
  erc721: 'ERC-721',
  erc1155: 'ERC-1155',
  'metaplex-nft': 'Metaplex NFT',
  'metaplex-pnft': 'Programmable NFT',
  'metaplex-cnft': 'Compressed NFT',
  'metaplex-core': 'Metaplex Core',
  'token-2022-nft': 'Token-2022 NFT',
};

const short = (value: string, head = 6, tail = 4) =>
  value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;

function explorerLinks(nft: NFTWithVisibility, isTestnet: boolean) {
  if (nft.chain === 'EVM') {
    const base = `https://${isTestnet ? 'sepolia.' : ''}etherscan.io`;
    return {
      item: `${base}/nft/${nft.contract}/${nft.tokenId}`,
      contract: `${base}/token/${nft.contract}`,
      owner: (address: string) => `${base}/address/${address}`,
    };
  }
  const cluster = isTestnet ? '?cluster=devnet' : '';
  return {
    item: `https://explorer.solana.com/address/${nft.assetId}${cluster}`,
    contract: `https://explorer.solana.com/address/${nft.assetId}${cluster}`,
    owner: (address: string) => `https://explorer.solana.com/address/${address}${cluster}`,
  };
}

export const NFTDetailPage: React.FC<NFTDetailPageProps> = ({ nft, ownerAddress, isTestnet, onClose, onToggleHidden, onSend, marketData, isMarketLoading = false, nativeUsdPrice = 0 }) => {
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const links = explorerLinks(nft, isTestnet);

  const copy = (label: string, value: string) => {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopied(label);
    setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
  };

  const idRow = nft.chain === 'EVM'
    ? { label: 'Contract', value: nft.contract!, href: links.contract }
    : { label: nft.standard === 'metaplex-cnft' || nft.standard === 'metaplex-core' ? 'Asset ID' : 'Mint', value: nft.assetId!, href: links.item };

  const details: { label: string; value: string; copyValue?: string; href?: string }[] = [
    { label: 'Standard', value: STANDARD_LABELS[nft.standard] },
    { label: 'Network', value: nft.chain === 'EVM' ? (isTestnet ? 'Ethereum Sepolia' : 'Ethereum') : (isTestnet ? 'Solana Devnet' : 'Solana') },
    { label: idRow.label, value: short(idRow.value), copyValue: idRow.value, href: idRow.href },
    ...(nft.tokenId !== undefined ? [{ label: 'Token ID', value: short(nft.tokenId, 10, 6), copyValue: nft.tokenId }] : []),
    ...(nft.standard === 'erc1155' ? [{ label: 'Quantity owned', value: nft.amount }] : []),
    ...(nft.royaltyBps !== undefined ? [{ label: 'Creator royalty', value: `${(nft.royaltyBps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%` }] : []),
    { label: 'Owner', value: `${short(ownerAddress)} (you)`, copyValue: ownerAddress, href: links.owner(ownerAddress) },
  ];

  const description = nft.description || '';
  const longDescription = description.length > 160;

  return (
    <div className="absolute inset-0 bg-[#000] z-50 flex flex-col animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 shrink-0">
        <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 transition-colors shrink-0" aria-label="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <h1 className="flex-1 text-base font-bold text-white truncate">{nft.name}</h1>
        <button
          onClick={() => onToggleHidden(nft)}
          className="px-3 h-9 flex items-center gap-1.5 rounded-full bg-white/5 hover:bg-white/10 transition-colors text-[11px] font-bold text-zinc-300 shrink-0"
        >
          {nft.hidden ? (
            <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>Unhide</>
          ) : (
            <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22" /></svg>Hide</>
          )}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide pb-10">
        {/* Media */}
        <div className="px-4 pt-4">
          <div className="relative rounded-2xl overflow-hidden border border-white/5">
            {nft.animation?.kind === 'video' ? (
              <video
                src={nft.animation.url}
                poster={nft.images[0]}
                className="w-full aspect-square object-cover bg-white/5"
                autoPlay
                loop
                muted
                playsInline
                controls
              />
            ) : (
              <NFTImage sources={nft.images} alt={nft.name} className="w-full aspect-square" imgClassName="object-contain" eager />
            )}
            {nft.standard === 'erc1155' && nft.amount !== '1' && (
              <span className="absolute top-3 left-3 bg-black/70 backdrop-blur-md px-2 py-0.5 rounded-md text-xs font-bold text-white">×{nft.amount}</span>
            )}
          </div>
          {nft.animation?.kind === 'audio' && (
            <audio src={nft.animation.url} controls className="w-full mt-3" />
          )}
          {nft.animation && (nft.animation.kind === 'html' || nft.animation.kind === 'model' || nft.animation.kind === 'unknown') && (
            // Interactive media is never rendered inside the wallet (untrusted HTML/3D) — link out instead
            <a href={nft.animation.url} target="_blank" rel="noopener noreferrer" className="mt-3 flex items-center justify-center gap-2 py-2 rounded-xl bg-white/[0.03] border border-white/5 text-[11px] font-bold text-zinc-400 hover:text-white transition-colors">
              Open interactive media
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
            </a>
          )}
        </div>

        {/* Title + collection */}
        <div className="px-5 pt-5">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-zinc-400">
            <span className="truncate">{nft.collection?.name || 'No collection'}</span>
            {nft.collection?.verified && (
              <svg width="13" height="13" viewBox="0 0 24 24" className="shrink-0" aria-label="Verified collection"><circle cx="12" cy="12" r="10" fill="#00f0ff" /><polyline points="7.5 12.5 10.5 15.5 16.5 9" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            )}
          </div>
          <h2 className="text-2xl font-black text-white tracking-tight mt-1 break-words">{nft.name}</h2>
        </div>

        {/* Spam warning */}
        {nft.isSpam && (
          <div className="mx-5 mt-4 p-3 rounded-xl bg-[#ff0055]/10 border border-[#ff0055]/25">
            <div className="text-[12px] font-bold text-[#ff0055]">Likely spam</div>
            <p className="text-[11px] text-[#ff0055]/80 mt-1 leading-snug">
              Don't visit links or interact with contracts mentioned by this NFT. {nft.spamReasons.join(' · ')}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="px-5 mt-5 grid grid-cols-3 gap-2">
          <ActionButton label="Send" onClick={() => onSend(nft)} icon={<><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></>} />
          <ActionButton label="List" disabled hint={isTestnet ? 'Mainnet only' : 'Coming soon'} icon={<><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></>} />
          <ActionButton label="Explorer" href={links.item} icon={<><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></>} />
        </div>

        {/* Market (nft.md — Phase 4.3): read-only floor data, never a price guarantee */}
        <Section title="Market">
          <MarketPanel nft={nft} isTestnet={isTestnet} data={marketData ?? null} isLoading={isMarketLoading} nativeUsdPrice={nativeUsdPrice} />
        </Section>

        {/* Description (rendered as plain text — never HTML from metadata) */}
        {description && (
          <Section title="Description">
            <p className={`text-[13px] text-zinc-300 leading-relaxed whitespace-pre-line break-words ${!descriptionOpen && longDescription ? 'line-clamp-3' : ''}`}>
              {description}
            </p>
            {longDescription && (
              <button onClick={() => setDescriptionOpen((v) => !v)} className="mt-1.5 text-[12px] font-bold text-zinc-400 hover:text-white">
                {descriptionOpen ? 'Show less' : 'Show more'}
              </button>
            )}
          </Section>
        )}

        {/* Attributes */}
        {nft.attributes.length > 0 && (
          <Section title={`Attributes (${nft.attributes.length})`}>
            <div className="grid grid-cols-2 gap-2">
              {nft.attributes.map((a, i) => (
                <div key={`${a.trait_type}-${i}`} className="bg-white/[0.03] border border-white/5 rounded-xl px-3 py-2 min-w-0">
                  <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider truncate">{a.trait_type}</div>
                  <div className="text-[13px] font-bold text-white truncate mt-0.5" title={String(a.value)}>{String(a.value)}</div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Details */}
        <Section title="Details">
          <div className="bg-white/[0.02] border border-white/5 rounded-xl divide-y divide-white/5">
            {details.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="text-[12px] font-medium text-zinc-500 shrink-0">{row.label}</span>
                <div className="flex items-center gap-1.5 min-w-0">
                  {row.href ? (
                    <a href={row.href} target="_blank" rel="noopener noreferrer" className="text-[12px] font-mono font-semibold text-zinc-200 hover:text-white truncate underline decoration-zinc-700 underline-offset-2">
                      {row.value}
                    </a>
                  ) : (
                    <span className={`text-[12px] font-semibold text-zinc-200 truncate ${row.copyValue ? 'font-mono' : ''}`}>{row.value}</span>
                  )}
                  {row.copyValue && (
                    <button onClick={() => copy(row.label, row.copyValue!)} className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-white/10 text-zinc-500 hover:text-white shrink-0" aria-label={`Copy ${row.label}`}>
                      {copied === row.label ? (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#00ff66" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      ) : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                      )}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
};

const MarketPanel: React.FC<{
  nft: NFTWithVisibility;
  isTestnet: boolean;
  data: NFTMarketData | null;
  isLoading: boolean;
  nativeUsdPrice: number;
}> = ({ nft, isTestnet, data, isLoading, nativeUsdPrice }) => {
  const note = (text: string) => (
    <div className="bg-white/[0.02] border border-white/5 rounded-xl px-3 py-3 text-[12px] font-medium text-zinc-500">{text}</div>
  );

  if (isTestnet) return note(`No market data on ${nft.chain === 'EVM' ? 'Sepolia' : 'Devnet'} — marketplaces only index mainnet.`);
  if (isLoading && !data) {
    return <div className="h-[72px] animate-pulse bg-white/[0.03] border border-white/5 rounded-xl" />;
  }
  if (!data?.stats) return note('No market data — this collection isn\'t listed on a supported marketplace.');

  const { stats } = data;
  const units = Number(nft.amount) || 1;
  const estimate = stats.floorNative !== null ? stats.floorNative * units : null;

  const rows: { label: string; value: string }[] = [
    ...(stats.listedCount !== null ? [{ label: 'Listed', value: stats.listedCount.toLocaleString('en-US') }] : []),
    // The window is whatever the provider actually reports, not assumed to be 24h.
    ...(stats.volume ? [{ label: `${stats.volume.window} volume`, value: formatNative(stats.volume.native, nft.chain) }] : []),
    ...(stats.avgPrice24hNative !== null ? [{ label: '24h avg', value: formatNative(stats.avgPrice24hNative, nft.chain) }] : []),
    ...(stats.totalSupply !== null ? [{ label: 'Supply', value: stats.totalSupply.toLocaleString('en-US') }] : []),
  ];

  return (
    <div className="bg-white/[0.02] border border-white/5 rounded-xl divide-y divide-white/5">
      <div className="flex items-start justify-between gap-3 px-3 py-3">
        <div className="min-w-0">
          <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Collection floor</div>
          <div className="text-lg font-black text-white tracking-tight mt-0.5">
            {stats.floorNative !== null ? formatNative(stats.floorNative, nft.chain) : 'Not listed'}
          </div>
          {estimate !== null && nativeUsdPrice > 0 && (
            <div className="text-[11px] font-semibold text-zinc-500 mt-0.5">
              ≈ {formatUsd(estimate * nativeUsdPrice)}
              {units > 1 && ` · ${units} × floor`}
            </div>
          )}
        </div>
        {stats.url && (
          <a
            href={stats.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] font-bold text-zinc-300 hover:text-white transition-colors"
          >
            {MARKETPLACE_LABELS[stats.source]}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
          </a>
        )}
      </div>
      {rows.length > 0 && (
        <div className="flex divide-x divide-white/5">
          {rows.map((row) => (
            <div key={row.label} className="flex-1 px-3 py-2 min-w-0">
              <div className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider truncate">{row.label}</div>
              <div className="text-[12px] font-bold text-zinc-200 truncate mt-0.5">{row.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="px-5 mt-6">
    <h3 className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-2">{title}</h3>
    {children}
  </div>
);

const ActionButton: React.FC<{ label: string; icon: React.ReactNode; href?: string; onClick?: () => void; disabled?: boolean; hint?: string }> = ({ label, icon, href, onClick, disabled, hint }) => {
  const content = (
    <>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
      <span className="text-[11px] font-bold">{label}</span>
      {hint && <span className="text-[9px] font-semibold text-zinc-600 -mt-0.5">{hint}</span>}
    </>
  );
  const cls = `flex flex-col items-center justify-center gap-1 py-3 rounded-xl border transition-colors ${disabled ? 'bg-white/[0.02] border-white/5 text-zinc-600 cursor-not-allowed' : 'bg-white/[0.05] border-white/10 text-zinc-200 hover:bg-white/10 hover:text-white'}`;
  return href && !disabled ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>{content}</a>
  ) : (
    <button disabled={disabled} onClick={onClick} className={cls} title={hint}>{content}</button>
  );
};
