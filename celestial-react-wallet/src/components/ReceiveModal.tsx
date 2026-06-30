import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { ChainAccount } from '../utils/walletUtils';
import btcLogo from '../assets/btc.svg';
import ethLogo from '../assets/eth.svg';
import solLogo from '../assets/sol.svg';

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
              <div className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden">
                <img src={ethLogo} alt="Ethereum" className="w-full h-full" />
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
              <div className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden">
                <img src={solLogo} alt="Solana" className="w-full h-full" />
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
              <div className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden">
                <img src={btcLogo} alt="Bitcoin" className="w-full h-full" />
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
                src: symbol === 'ETH' ? ethLogo : symbol === 'SOL' ? solLogo : btcLogo,
                height: 28,
                width: 28,
                excavate: true,
              }}
            />
          </div>

          {/* Chain Label */}
          <div className="flex items-center gap-2 mb-4">
            <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 overflow-hidden">
              <img src={symbol === 'ETH' ? ethLogo : symbol === 'SOL' ? solLogo : btcLogo} alt={symbol} className="w-full h-full" />
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
