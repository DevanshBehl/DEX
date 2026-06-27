import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { ChainAccount } from '../utils/walletUtils';

interface ReceiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: ChainAccount[];
  initialAccount?: ChainAccount | null;
  balances: { eth: string; sol: string; btc: string };
  prices: { eth: number; sol: number; btc: number };
  changes: { eth: number; sol: number; btc: number };
}

export const ReceiveModal: React.FC<ReceiveModalProps> = ({ 
  isOpen, onClose, accounts, initialAccount, balances, prices, changes 
}) => {
  const [selectedToken, setSelectedToken] = useState<ChainAccount | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (initialAccount) {
        setSelectedToken(initialAccount);
      }
    } else {
      setTimeout(() => {
        setSelectedToken(null);
        setCopied(false);
      }, 500);
    }
  }, [isOpen, initialAccount]);

  const handleCopy = (address: string) => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = () => {
    onClose();
  };

  const renderPicker = () => (
    <div className="flex flex-col flex-1 animate-fade-in">
      <div className="flex items-center justify-between px-6 pt-8 pb-4 flex-shrink-0">
        <h2 className="text-2xl font-black text-white tracking-tight">Receive</h2>
        <button onClick={handleClose} className="haptic-btn w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>
      <p className="text-zinc-500 text-xs font-semibold px-6 mb-4 tracking-wide uppercase">Select an asset to receive</p>
      
      <div className="flex flex-col px-2 flex-1 overflow-y-auto pb-8">
        {/* ETH */}
        {(() => {
          const acc = accounts.find(a => a.chain === 'EVM');
          if (!acc) return null;
          return (
            <button 
              onClick={() => setSelectedToken(acc)}
              className="haptic-btn flex items-center gap-4 p-4 rounded-2xl bg-transparent hover:bg-[#111111] transition-all group"
            >
              <div className="w-11 h-11 rounded-full bg-[#627eea] flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 320 512" fill="#fff"><path d="M311.9 260.8L160 353.6 8 260.8 160 0l151.9 260.8zM160 383.4L8 290.6 160 512l152-221.4-152 92.8z"/></svg>
              </div>
              <div className="flex flex-col items-start flex-1 min-w-0">
                <span className="text-sm font-bold text-white">Ethereum</span>
                <span className="text-xs text-zinc-500 font-mono">{balances.eth} ETH</span>
              </div>
              <div className="flex flex-col items-end mr-3">
                <span className="text-sm font-bold text-white">${(parseFloat(balances.eth) * prices.eth).toFixed(2)}</span>
                <span className={`text-[10px] font-bold ${changes.eth >= 0 ? 'text-[#00ff66]' : 'text-[#ff0055]'}`}>{changes.eth >= 0 ? '+' : ''}{changes.eth.toFixed(1)}%</span>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#52525b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="group-hover:stroke-white transition-colors flex-shrink-0"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          );
        })()}

        {/* SOL */}
        {(() => {
          const acc = accounts.find(a => a.chain === 'Solana');
          if (!acc) return null;
          return (
            <button 
              onClick={() => setSelectedToken(acc)}
              className="haptic-btn flex items-center gap-4 p-4 rounded-2xl bg-transparent hover:bg-[#111111] transition-all group"
            >
              <div className="w-11 h-11 rounded-full bg-black flex items-center justify-center border border-[#14F195]/30 flex-shrink-0">
                <svg width="20" height="20" viewBox="0 0 397 311" fill="url(#solana-grad-send)"><defs><linearGradient id="solana-grad-send" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#00FFA3" /><stop offset="100%" stopColor="#DC1FFF" /></linearGradient></defs><path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7zM64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8zM333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z"/></svg>
              </div>
              <div className="flex flex-col items-start flex-1 min-w-0">
                <span className="text-sm font-bold text-white">Solana</span>
                <span className="text-xs text-zinc-500 font-mono">{balances.sol} SOL</span>
              </div>
              <div className="flex flex-col items-end mr-3">
                <span className="text-sm font-bold text-white">${(parseFloat(balances.sol) * prices.sol).toFixed(2)}</span>
                <span className={`text-[10px] font-bold ${changes.sol >= 0 ? 'text-[#00ff66]' : 'text-[#ff0055]'}`}>{changes.sol >= 0 ? '+' : ''}{changes.sol.toFixed(1)}%</span>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#52525b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="group-hover:stroke-white transition-colors flex-shrink-0"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          );
        })()}

        {/* BTC */}
        {(() => {
          const acc = accounts.find(a => a.chain === 'Bitcoin');
          if (!acc) return null;
          return (
            <button 
              onClick={() => setSelectedToken(acc)}
              className="haptic-btn flex items-center gap-4 p-4 rounded-2xl bg-transparent hover:bg-[#111111] transition-all group"
            >
              <div className="w-11 h-11 rounded-full bg-[#f7931a] flex items-center justify-center flex-shrink-0">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="#fff"><path d="M14.4 7.7c.6-.4 1-.9 1.1-1.6.2-1.3-1-1.9-2.6-2l-1.5-.1-.4-1.6h-1.5l.4 1.5H8.7l-.4-1.5H6.8l.4 1.5H5v1.4h1.4c.5 0 .7.3.6.8l-1.5 5.8c-.1.2-.2.3-.4.3H4v1.4h1.7l-.4 1.6h1.5l.4-1.6h1.2l-.4 1.6h1.5l.4-1.6c2.1 0 3.7-.5 4-2.1.2-1-.3-1.6-1-1.9 1-.2 1.6-.8 1.5-1.9zm-4.7 4.5l1-.1c.8-.1 1.6 0 1.7.9.1.9-.6 1-1.4 1.1l-1 .1-.3-2zm.4-3.5l.9-.1c.7 0 1.4.1 1.5.8 0 .8-.6.9-1.3 1l-.9.1-.2-1.8z" /></svg>
              </div>
              <div className="flex flex-col items-start flex-1 min-w-0">
                <span className="text-sm font-bold text-white">Bitcoin</span>
                <span className="text-xs text-zinc-500 font-mono">{balances.btc} BTC</span>
              </div>
              <div className="flex flex-col items-end mr-3">
                <span className="text-sm font-bold text-white">${(parseFloat(balances.btc) * prices.btc).toFixed(2)}</span>
                <span className={`text-[10px] font-bold ${changes.btc >= 0 ? 'text-[#00ff66]' : 'text-[#ff0055]'}`}>{changes.btc >= 0 ? '+' : ''}{changes.btc.toFixed(1)}%</span>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#52525b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="group-hover:stroke-white transition-colors flex-shrink-0"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          );
        })()}
      </div>
    </div>
  );

  const renderQRCode = (acc: ChainAccount) => {
    const chainName = acc.chain === 'EVM' ? 'Ethereum' : acc.chain === 'Solana' ? 'Solana' : 'Bitcoin';
    const symbol = acc.chain === 'EVM' ? 'ETH' : acc.chain === 'Solana' ? 'SOL' : 'BTC';
    const color = acc.chain === 'EVM' ? '#627eea' : acc.chain === 'Solana' ? '#14F195' : '#f7931a';

    return (
      <div className="flex flex-col flex-1 animate-fade-in overflow-y-auto pb-24">
        {/* Header */}
        <div className="flex items-center px-6 py-5 border-b border-white/5 shrink-0">
          <button 
            onClick={() => initialAccount ? handleClose() : setSelectedToken(null)} 
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 transition-colors mr-4 shrink-0"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h2 className="text-lg font-bold text-white flex-1 text-center pr-14">Receive {symbol}</h2>
        </div>

        {/* QR Code Section */}
        <div className="flex-1 flex flex-col items-center px-6 pt-8 pb-6">
          <div className="bg-white rounded-3xl p-6 shadow-[0_0_60px_rgba(255,255,255,0.05)] mb-6">
            <QRCodeSVG
              value={acc.address}
              size={200}
              level="H"
              bgColor="#ffffff"
              fgColor="#000000"
              imageSettings={{
                src: `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='16' fill='${encodeURIComponent(color)}'/><text x='16' y='21' text-anchor='middle' font-size='14' font-weight='bold' fill='white' font-family='sans-serif'>${symbol.slice(0, 2)}</text></svg>`,
                height: 28,
                width: 28,
                excavate: true,
              }}
            />
          </div>

          {/* Chain Label */}
          <div className="flex items-center gap-2 mb-4">
            <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: color }}>
              <span className="text-white text-[8px] font-bold">{symbol.slice(0, 2)}</span>
            </div>
            <span className="text-sm font-semibold text-zinc-400">Your {chainName} Address</span>
          </div>

          {/* Address Box */}
          <div className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 mb-4">
            <p className="text-sm text-zinc-300 font-mono break-all text-center leading-relaxed select-all">
              {acc.address}
            </p>
          </div>

          {/* Copy Button */}
          <button
            onClick={() => handleCopy(acc.address)}
            className={`w-full py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 transition-all duration-300 ${
              copied
                ? 'bg-[#00ff66]/10 text-[#00ff66] border border-[#00ff66]/30'
                : 'bg-white text-black hover:opacity-90'
            }`}
          >
            {copied ? (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                Copied!
              </>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                Copy Address
              </>
            )}
          </button>

          {/* Disclaimer */}
          <p className="text-xs text-zinc-600 text-center mt-6 px-4 leading-relaxed">
            Use this address to receive tokens on the <span className="text-zinc-400 font-semibold">{chainName}</span> network only. Sending other network tokens to this address may result in permanent loss.
          </p>
        </div>
      </div>
    );
  };

  return (
    <div 
      className="absolute inset-0 bg-[#0a0a0a] z-[300] flex flex-col transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
      style={{ transform: isOpen ? 'translateY(0)' : 'translateY(100%)' }}
    >
      {selectedToken ? renderQRCode(selectedToken) : renderPicker()}
    </div>
  );
};
