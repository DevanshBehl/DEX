import React, { useState } from 'react';
import type { WalletAsset } from '../types';
import btcLogo from '../assets/btc.svg';
import ethLogo from '../assets/eth.svg';
import solLogo from '../assets/sol.svg';

const NATIVE_LOGOS: Record<string, string> = { ETH: ethLogo, SOL: solLogo, BTC: btcLogo };
const CHAIN_BADGES: Record<string, string> = { EVM: ethLogo, Solana: solLogo };

// Deterministic fallback colour for tokens without a logo
const colorFor = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h}, 55%, 45%)`;
};

export const TokenIcon: React.FC<{ asset: WalletAsset; size?: number; showChainBadge?: boolean }> = ({
  asset,
  size = 48,
  showChainBadge = true,
}) => {
  const [broken, setBroken] = useState(false);
  const src = asset.kind === 'native' ? NATIVE_LOGOS[asset.symbol] : asset.logo;
  const badge = asset.kind !== 'native' && showChainBadge ? CHAIN_BADGES[asset.chain] : null;
  const badgeSize = Math.round(size * 0.4);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {src && !broken ? (
        <img src={src} alt={asset.symbol} onError={() => setBroken(true)} className="w-full h-full rounded-full object-cover bg-zinc-900" />
      ) : (
        <div
          className="w-full h-full rounded-full flex items-center justify-center font-black text-white"
          style={{ background: colorFor(asset.key), fontSize: size * 0.36 }}
        >
          {asset.symbol.slice(0, 1).toUpperCase()}
        </div>
      )}
      {badge && (
        <img
          src={badge}
          alt=""
          className="absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-[#0a0a0a] bg-[#0a0a0a]"
          style={{ width: badgeSize, height: badgeSize }}
        />
      )}
    </div>
  );
};
