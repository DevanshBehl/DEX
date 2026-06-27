import React, { useState, useEffect, useRef } from 'react';
import { ethers } from 'ethers';
import { fetchSwapQuote, type SwapQuote } from '../utils/swapUtils';
import type { ChainAccount } from '../utils/walletUtils';
import { sendEVMContractTransaction } from '../utils/txUtils';
import { CONFIG } from '../config/networks';

interface SwapModalProps {
  isOpen: boolean;
  onClose: () => void;
  evmAccount: ChainAccount | null;
  ethBalance: string;
}

const TOKENS = [
  { symbol: 'ETH', name: 'Ethereum', address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', decimals: 18, logo: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
  { symbol: 'WETH', name: 'Wrapped ETH', address: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14', decimals: 18, logo: 'https://assets.coingecko.com/coins/images/2518/small/weth.png' },
  { symbol: 'UNI', name: 'Uniswap', address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', decimals: 18, logo: 'https://assets.coingecko.com/coins/images/12504/small/uniswap-uni.png' }
];

export const SwapModal: React.FC<SwapModalProps> = ({ isOpen, onClose, evmAccount, ethBalance }) => {
  const [sellToken, setSellToken] = useState(TOKENS[0]);
  const [buyToken, setBuyToken] = useState(TOKENS[1]);
  const [sellAmount, setSellAmount] = useState('');
  const [buyAmount, setBuyAmount] = useState('');
  const [isQuoting, setIsQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [quoteData, setQuoteData] = useState<SwapQuote | null>(null);
  const [screen, setScreen] = useState<'input' | 'review'>('input');
  
  const [isSwapping, setIsSwapping] = useState(false);
  const [swapError, setSwapError] = useState('');
  const [txHash, setTxHash] = useState('');

  const typingTimeout = useRef<NodeJS.Timeout | null>(null);

  // Fetch quote debounced
  useEffect(() => {
    if (!sellAmount || isNaN(Number(sellAmount)) || Number(sellAmount) <= 0) {
      setBuyAmount('');
      setQuoteData(null);
      setQuoteError('');
      setIsQuoting(false);
      return;
    }

    setIsQuoting(true);
    setQuoteError('');
    if (typingTimeout.current) clearTimeout(typingTimeout.current);

    typingTimeout.current = setTimeout(async () => {
      try {
        const sellAmountWei = ethers.parseUnits(sellAmount, sellToken.decimals).toString();
        const quote = await fetchSwapQuote(sellToken.address, buyToken.address, sellAmountWei, 11155111, evmAccount?.address);
        setQuoteData(quote);
        setBuyAmount(ethers.formatUnits(quote.buyAmount, buyToken.decimals));
      } catch (err: any) {
        setQuoteError(err.message || 'Failed to fetch quote');
        setQuoteData(null);
        setBuyAmount('');
      } finally {
        setIsQuoting(false);
      }
    }, 500);

    return () => {
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
    };
  }, [sellAmount, sellToken, buyToken]);

  const handleClose = () => {
    onClose();
    setTimeout(() => {
      setScreen('input');
      setSellAmount('');
      setBuyAmount('');
      setQuoteData(null);
      setQuoteError('');
      setSwapError('');
      setTxHash('');
      setSellToken(TOKENS[0]);
      setBuyToken(TOKENS[1]);
    }, 500);
  };

  const executeSwap = async () => {
    if (!evmAccount || !quoteData) return;
    setIsSwapping(true);
    setSwapError('');
    try {
      // Hardcoded Sepolia for now based on implementation plan
      const hash = await sendEVMContractTransaction(
        evmAccount.privateKey,
        {
          to: quoteData.to,
          data: quoteData.data,
          value: quoteData.value,
          gasPrice: quoteData.gasPrice,
        },
        CONFIG.ALCHEMY_SEPOLIA_URL
      );
      setTxHash(hash);
    } catch (err: any) {
      setSwapError(err.message || 'Swap failed');
    } finally {
      setIsSwapping(false);
    }
  };

  const handleTokenSwitch = () => {
    const temp = sellToken;
    setSellToken(buyToken);
    setBuyToken(temp);
  };

  const renderInputScreen = () => (
    <div className="flex flex-col flex-1 animate-fade-in">
      <div className="flex items-center justify-between px-6 pt-8 pb-4">
        <h2 className="text-2xl font-black text-white tracking-tight">Swap</h2>
        <button onClick={handleClose} className="haptic-btn w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>

      <div className="px-6 flex-1 overflow-y-auto">
        {/* You Pay */}
        <div className="bg-[#111] border border-white/5 rounded-3xl p-5 mb-2 relative">
          <div className="text-xs font-semibold text-zinc-500 mb-2 uppercase tracking-wide">You Pay</div>
          <div className="flex items-center justify-between gap-4">
            <input
              type="text"
              placeholder="0.0"
              value={sellAmount}
              onChange={(e) => setSellAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              className="bg-transparent text-4xl font-black text-white w-full outline-none placeholder:text-zinc-700"
            />
            <div className="flex items-center gap-2 bg-[#222] rounded-full p-2 pr-4 shrink-0 border border-white/10 cursor-not-allowed">
              <img src={sellToken.logo} alt={sellToken.symbol} className="w-6 h-6 rounded-full" />
              <span className="font-bold text-white text-sm">{sellToken.symbol}</span>
            </div>
          </div>
          {sellToken.symbol === 'ETH' && (
            <div className="mt-4 text-xs font-medium text-zinc-500">Balance: {ethBalance} ETH</div>
          )}
        </div>

        {/* Swap Direction Divider */}
        <div className="relative h-2 flex justify-center items-center z-10 -my-3">
          <button onClick={handleTokenSwitch} className="w-10 h-10 bg-[#1a1a1a] border-[4px] border-[#0a0a0a] rounded-xl flex items-center justify-center text-white hover:bg-[#222] transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
          </button>
        </div>

        {/* You Receive */}
        <div className="bg-[#111] border border-white/5 rounded-3xl p-5 mt-2">
          <div className="text-xs font-semibold text-zinc-500 mb-2 uppercase tracking-wide">You Receive</div>
          <div className="flex items-center justify-between gap-4">
            <input
              type="text"
              readOnly
              placeholder="0.0"
              value={buyAmount}
              className={`bg-transparent text-4xl font-black w-full outline-none placeholder:text-zinc-700 ${isQuoting ? 'text-zinc-600 animate-pulse' : 'text-white'}`}
            />
            <div className="flex items-center gap-2 bg-[#222] rounded-full p-2 pr-4 shrink-0 border border-white/10 cursor-not-allowed">
              <img src={buyToken.logo} alt={buyToken.symbol} className="w-6 h-6 rounded-full" />
              <span className="font-bold text-white text-sm">{buyToken.symbol}</span>
            </div>
          </div>
        </div>

        {quoteError && (
          <div className="mt-4 p-4 rounded-xl bg-[#ff0055]/10 border border-[#ff0055]/20 text-[#ff0055] text-sm font-medium">
            {quoteError}
          </div>
        )}
      </div>

      {/* Review Button */}
      <div className="p-6">
        <button
          disabled={!quoteData || isQuoting || !sellAmount}
          onClick={() => setScreen('review')}
          className="w-full py-4 rounded-2xl bg-white text-black font-bold text-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-200 transition-colors"
        >
          {isQuoting ? 'Fetching Quote...' : 'Review Swap'}
        </button>
      </div>
    </div>
  );

  const renderReviewScreen = () => {
    if (!quoteData) return null;
    const gasFeeEth = ethers.formatEther(BigInt(quoteData.estimatedGas || '0') * BigInt(quoteData.gasPrice || '0'));
    
    return (
      <div className="flex flex-col flex-1 animate-fade-in">
        <div className="flex items-center px-6 pt-8 pb-4 shrink-0">
          <button onClick={() => setScreen('input')} className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors mr-4 shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <h2 className="text-xl font-bold text-white flex-1 pr-14 text-center">Confirm Swap</h2>
        </div>

        <div className="px-6 flex-1 overflow-y-auto pt-4">
          <div className="flex flex-col items-center justify-center py-6 mb-8">
            <div className="flex items-center justify-center gap-6 mb-6">
              <img src={sellToken.logo} className="w-16 h-16 rounded-full border-4 border-[#0a0a0a]" alt={sellToken.symbol} />
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-30"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
              <img src={buyToken.logo} className="w-16 h-16 rounded-full border-4 border-[#0a0a0a]" alt={buyToken.symbol} />
            </div>
            
            <div className="text-3xl font-black text-white text-center tracking-tight mb-2">
              {Number(buyAmount).toFixed(4)} {buyToken.symbol}
            </div>
            <div className="text-sm font-semibold text-zinc-500">
              For {Number(sellAmount).toFixed(4)} {sellToken.symbol}
            </div>
          </div>

          <div className="bg-[#111] border border-white/5 rounded-2xl p-4 flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <span className="text-sm font-semibold text-zinc-500">Rate</span>
              <span className="text-sm font-bold text-white">1 {sellToken.symbol} = {Number(quoteData.price).toFixed(4)} {buyToken.symbol}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm font-semibold text-zinc-500">Network Fee (Est.)</span>
              <span className="text-sm font-bold text-white">{Number(gasFeeEth).toFixed(6)} ETH</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm font-semibold text-zinc-500">Provider</span>
              <span className="text-sm font-bold text-white">0x Aggregator</span>
            </div>
          </div>

          {swapError && (
             <div className="mt-4 p-4 rounded-xl bg-[#ff0055]/10 border border-[#ff0055]/20 text-[#ff0055] text-sm font-medium">
               {swapError}
             </div>
          )}

          {txHash && (
             <div className="mt-4 p-4 rounded-xl bg-[#00ff66]/10 border border-[#00ff66]/20 flex flex-col items-center">
               <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#00ff66" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mb-2"><polyline points="20 6 9 17 4 12" /></svg>
               <span className="text-[#00ff66] font-bold">Swap Submitted!</span>
               <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noreferrer" className="text-xs text-[#00ff66]/80 underline mt-1">View on Explorer</a>
             </div>
          )}
        </div>

        <div className="p-6">
          <button
            onClick={executeSwap}
            disabled={isSwapping || !!txHash}
            className="w-full py-4 rounded-2xl bg-[#00ff66] text-black font-bold text-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#00ff66]/90 transition-colors shadow-[0_0_20px_rgba(0,255,102,0.3)] flex justify-center items-center gap-2"
          >
            {isSwapping ? <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" /> : 'Confirm Swap'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div 
      className="absolute inset-0 bg-[#0a0a0a] z-[300] flex flex-col transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
      style={{ transform: isOpen ? 'translateY(0)' : 'translateY(100%)' }}
    >
      {screen === 'input' ? renderInputScreen() : renderReviewScreen()}
    </div>
  );
};
