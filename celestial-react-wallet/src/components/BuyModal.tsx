import React, { useState } from 'react';
import type { ChainAccount } from '../utils/walletUtils';
import { getTransakUrl, resolveTransakParams } from '../utils/onrampUtils';
import ethLogo from '../assets/eth.svg';
import solLogo from '../assets/sol.svg';
import btcLogo from '../assets/btc.svg';

interface BuyModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: ChainAccount[];
}

const CHAIN_META: Record<string, { name: string; ticker: string; logo: string }> = {
  EVM: { name: 'Ethereum', ticker: 'ETH', logo: ethLogo },
  Solana: { name: 'Solana', ticker: 'SOL', logo: solLogo },
  Bitcoin: { name: 'Bitcoin', ticker: 'BTC', logo: btcLogo },
};

const PRESET_AMOUNTS = ['50', '100', '250', '500', '1000'];

export const BuyModal: React.FC<BuyModalProps> = ({ isOpen, onClose, accounts }) => {
  const [fiatAmount, setFiatAmount] = useState('100');
  const [selectedChainIndex, setSelectedChainIndex] = useState(0);
  const [isChainPickerOpen, setIsChainPickerOpen] = useState(false);

  const selectedAccount = accounts[selectedChainIndex] || accounts[0];
  const meta = selectedAccount ? CHAIN_META[selectedAccount.chain] : CHAIN_META['EVM'];

  const handleClose = () => {
    onClose();
    setTimeout(() => {
      setFiatAmount('100');
      setSelectedChainIndex(0);
      setIsChainPickerOpen(false);
    }, 500);
  };

  const handleBuy = () => {
    if (!selectedAccount || !fiatAmount || parseFloat(fiatAmount) <= 0) return;
    const { cryptoCurrencyCode, network } = resolveTransakParams(selectedAccount.chain);
    const url = getTransakUrl(selectedAccount.address, cryptoCurrencyCode, fiatAmount, network);
    window.open(url, '_blank');
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9.]/g, '');
    const parts = val.split('.');
    if (parts.length > 2) return;
    setFiatAmount(val);
  };

  const isValidAmount = fiatAmount !== '' && parseFloat(fiatAmount) > 0;

  return (
    <div 
      className="absolute inset-0 bg-[#0a0a0a] z-[300] flex flex-col transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
      style={{ transform: isOpen ? 'translateY(0)' : 'translateY(100%)' }}
    >
      {/* Header — fixed at top */}
      <div className="flex items-center justify-between flex-shrink-0 px-6 pt-8 pb-4">
        <h2 className="text-2xl font-black text-white tracking-tight">Buy Crypto</h2>
        <button
          onClick={handleClose}
          className="haptic-btn w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-6">
        <div className="flex flex-col items-center">
          {/* YOU PAY label */}
          <div className="text-sm font-semibold text-[#888] mb-4 uppercase tracking-wide">You Pay</div>
          
          {/* Input area */}
          <div className="flex items-center justify-center w-full mb-2 gap-4">
            <button
              onClick={() => setFiatAmount(String(Math.max(0, (parseFloat(fiatAmount) || 0) - 10)))}
              className="haptic-btn w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <div className="flex items-baseline">
              <span className="text-[#888] text-4xl font-bold mr-1">$</span>
              <input
                type="text"
                inputMode="decimal"
                value={fiatAmount}
                onChange={handleAmountChange}
                placeholder="0"
                className="bg-transparent text-6xl font-black text-white outline-none placeholder-white/20"
                style={{ width: `${Math.max(1, fiatAmount.length) * 36 + 8}px` }}
              />
            </div>
            <button
              onClick={() => setFiatAmount(String((parseFloat(fiatAmount) || 0) + 10))}
              className="haptic-btn w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
          <div className="text-sm font-semibold text-[#888] mb-8 uppercase tracking-wide">USD</div>

          {/* Quick Amount Pills */}
          <div className="flex gap-3 mb-10 flex-wrap justify-center">
            {PRESET_AMOUNTS.map((amount) => (
              <button
                key={amount}
                onClick={() => setFiatAmount(amount)}
                className={`haptic-btn px-4 py-2 rounded-full text-sm font-medium border transition-all ${
                  fiatAmount === amount
                    ? 'border-white/20 bg-white/10 text-white'
                    : 'border-white/10 bg-transparent text-[#888] hover:bg-white/5 hover:text-white'
                }`}
              >
                ${amount}
              </button>
            ))}
          </div>

          {/* Token Selector */}
          <div className="w-full relative mb-4">
            <button
              onClick={() => setIsChainPickerOpen(!isChainPickerOpen)}
              className="haptic-btn w-full flex items-center justify-between p-4 bg-white/5 border border-white/5 rounded-2xl hover:bg-white/10 transition-colors"
            >
              <div className="flex items-center gap-3">
                <img src={meta.logo} alt={meta.name} className="w-8 h-8 rounded-full" />
                <div className="flex flex-col items-start">
                  <span className="text-base font-bold text-white">{meta.name}</span>
                  <span className="text-xs font-semibold text-[#888]">{meta.ticker}</span>
                </div>
              </div>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`text-[#888] transition-transform duration-200 ${isChainPickerOpen ? 'rotate-180' : ''}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {isChainPickerOpen && (
              <div className="absolute bottom-full mb-2 w-full bg-[#0a0a0a] border border-white/10 rounded-2xl overflow-hidden z-50 animate-fade-in shadow-2xl">
                {accounts.map((account, idx) => {
                  const m = CHAIN_META[account.chain];
                  if (!m) return null;
                  return (
                    <button
                      key={account.chain}
                      onClick={() => {
                        setSelectedChainIndex(idx);
                        setIsChainPickerOpen(false);
                      }}
                      className={`haptic-btn w-full flex items-center gap-3 p-4 hover:bg-white/5 transition-colors ${
                        idx === selectedChainIndex ? 'bg-white/5' : ''
                      }`}
                    >
                      <img src={m.logo} alt={m.name} className="w-8 h-8 rounded-full" />
                      <div className="flex flex-col items-start">
                        <span className="text-base font-bold text-white">{m.name}</span>
                      </div>
                      <span className="text-xs font-semibold text-[#888] ml-auto">{m.ticker}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Info box */}
          <div className="w-full bg-white/5 border border-white/5 rounded-2xl p-4 mb-6 flex items-center gap-3">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            <p className="text-[11px] text-[#888] leading-tight text-left">
              You'll be redirected to Transak to complete your purchase. Crypto will be sent directly to your wallet.
            </p>
          </div>
        </div>
      </div>

      {/* Action Button — fixed at bottom */}
      <div className="flex-shrink-0 px-6 pb-6 pt-4">
        <button
          onClick={handleBuy}
          disabled={!isValidAmount}
          className="haptic-btn w-full py-4 rounded-xl bg-[#22c55e] text-black font-bold text-base disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#16a34a] transition-colors flex items-center justify-center gap-2"
        >
          Continue with Transak
        </button>
      </div>
    </div>
  );
};
