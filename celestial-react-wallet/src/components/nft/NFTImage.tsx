import React, { useState } from 'react';
import placeholder from '../../assets/nft-placeholder.svg';

interface NFTImageProps {
  /** Ordered candidates from NFTAsset.images — each is tried in turn on load error. */
  sources: string[];
  alt: string;
  /** Classes for the outer box (size, rounding). */
  className?: string;
  /** Classes for the <img> itself (object-fit, hover effects). */
  imgClassName?: string;
  eager?: boolean;
}

/**
 * Indexer "cached" URLs are not guaranteed to load (see nft.md Phase 0 findings),
 * so walk the candidate list and finish on a bundled placeholder. Shows a
 * pulsing skeleton until the current candidate has loaded.
 */
export const NFTImage: React.FC<NFTImageProps> = ({ sources, alt, className = '', imgClassName = '', eager = false }) => {
  const sourcesKey = sources.join('|');
  // Failure count is tied to the candidate list, so a new NFT starts from its first candidate
  const [failed, setFailed] = useState({ key: sourcesKey, count: 0 });
  const index = failed.key === sourcesKey ? failed.count : 0;
  const src = index < sources.length ? sources[index] : placeholder;

  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const loaded = loadedSrc === src;

  return (
    <div className={`relative overflow-hidden bg-white/5 ${loaded ? '' : 'animate-pulse'} ${className}`}>
      <img
        key={src}
        src={src}
        alt={alt}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        referrerPolicy="no-referrer"
        draggable={false}
        onLoad={() => setLoadedSrc(src)}
        onError={() =>
          setFailed((f) => {
            const current = f.key === sourcesKey ? f.count : 0;
            return { key: sourcesKey, count: current < sources.length ? current + 1 : current };
          })
        }
        className={`absolute inset-0 w-full h-full transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'} ${imgClassName}`}
      />
    </div>
  );
};
