import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis } from 'recharts';
import { fetchChartData } from '../utils/rpcUtils';
import type { ChainAccount } from '../utils/walletUtils';

interface TokenPageProps {
  account: ChainAccount;
  onClose: () => void;
  onSend: (asset: 'ETH' | 'SOL' | 'BTC') => void;
  balance: string;
  price: number;
  change: number;
}

const TIMEFRAMES = ['1D', '1W', '1M', 'YTD', 'ALL'] as const;
type Timeframe = typeof TIMEFRAMES[number];

export const TokenPage: React.FC<TokenPageProps> = ({ account, onClose, onSend, balance, price, change }) => {
  const [timeframe, setTimeframe] = useState<Timeframe>('1D');
  const [chartData, setChartData] = useState<{ time: number; value: number }[]>([]);
  const [chartLoading, setChartLoading] = useState(true);
  const [chartError, setChartError] = useState('');
  const [copied, setCopied] = useState(false);

  // Map chain to CoinGecko ID
  const coinId = account.chain === 'EVM' ? 'ethereum' : account.chain === 'Solana' ? 'solana' : 'bitcoin';
  const symbol = account.chain === 'EVM' ? 'ETH' : account.chain === 'Solana' ? 'SOL' : 'BTC';
  const name = account.chain === 'EVM' ? 'Ethereum' : account.chain === 'Solana' ? 'Solana' : 'Bitcoin';
  const color = account.chain === 'EVM' ? '#627eea' : account.chain === 'Solana' ? '#14F195' : '#f7931a';

  useEffect(() => {
    let days = '1';
    if (timeframe === '1W') days = '7';
    if (timeframe === '1M') days = '30';
    if (timeframe === 'YTD') {
      const now = new Date();
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      days = Math.floor((now.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24)).toString();
    }
    if (timeframe === 'ALL') days = 'max';

    setChartLoading(true);
    setChartError('');
    fetchChartData(coinId, days)
      .then((data) => {
        console.log('[TokenPage] Chart data received:', data.length, 'points');
        setChartData(data);
        if (data.length === 0) {
          setChartError('No data returned from API');
        }
      })
      .catch((err) => {
        console.error('[TokenPage] Chart fetch error:', err);
        setChartError(err.message || 'Failed to load chart');
      })
      .finally(() => setChartLoading(false));
  }, [timeframe, coinId]);

  const handleCopy = () => {
    navigator.clipboard.writeText(account.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const usdValue = (parseFloat(balance) * price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const positive = change >= 0;

  return (
    <div className="absolute inset-0 bg-[#000] z-50 flex flex-col animate-fade-in pb-24 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center px-6 py-6 border-b border-white/5">
        <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 transition-colors mr-4 shrink-0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: color }}>
            <span className="text-white text-xs font-bold">{symbol.slice(0, 2)}</span>
          </div>
          <h1 className="text-xl font-bold text-white">{name}</h1>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#00ff66" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
        </div>
      </div>

      {/* Balance */}
      <div className="px-6 py-8 flex flex-col items-center">
        <div className="text-4xl font-black text-white tracking-tighter mb-2">${usdValue}</div>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-bold ${positive ? 'text-[#00ff66]' : 'text-[#ff0055]'}`}>
            {positive ? '+' : ''}{change.toFixed(2)}%
          </span>
          <span className="text-xs text-zinc-500 font-semibold px-2 py-0.5 bg-white/5 rounded-full">24h</span>
        </div>
        <div className="text-sm font-medium text-zinc-400 mt-2">
          {balance} {symbol}
        </div>
      </div>

      {/* Chart */}
      <div className="w-full px-2 mb-6" style={{ height: 200 }}>
        {chartLoading ? (
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-white/20 border-t-white/80 rounded-full animate-spin" />
          </div>
        ) : chartError || chartData.length === 0 ? (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-xs text-zinc-500">{chartError || 'Chart data unavailable'}</span>
          </div>
        ) : (
          <LineChart width={356} height={200} data={chartData}>
            <XAxis dataKey="time" hide />
            <YAxis domain={['dataMin', 'dataMax']} hide />
            <Line type="monotone" dataKey="value" stroke={chartData.length >= 2 && chartData[chartData.length - 1].value >= chartData[0].value ? "#00ff66" : "#ff0055"} strokeWidth={2.5} dot={false} isAnimationActive={true} />
          </LineChart>
        )}
      </div>

      {/* Timeframes */}
      <div className="px-6 mb-8 flex justify-between gap-2">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => setTimeframe(tf)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${timeframe === tf ? 'bg-white text-black' : 'bg-white/5 text-zinc-400 hover:bg-white/10'}`}
          >
            {tf}
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className="px-6 flex gap-4 mb-8">
        <button className="flex-1 py-4 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-bold transition-colors">
          Receive
        </button>
        <button 
          onClick={() => {
            onSend(symbol as 'ETH' | 'SOL' | 'BTC');
            onClose();
          }}
          className="flex-1 py-4 rounded-2xl bg-white text-black hover:opacity-90 font-bold transition-opacity"
        >
          Send
        </button>
      </div>

      {/* Address Details */}
      <div className="px-6 pb-12">
        <div className="bg-[#111] p-4 rounded-2xl border border-white/5 flex items-center justify-between">
          <div className="overflow-hidden">
            <div className="text-xs text-zinc-500 font-semibold mb-1">Your {name} Address</div>
            <div className="text-sm text-zinc-300 font-mono font-medium truncate w-[200px]">
              {account.address}
            </div>
          </div>
          <button onClick={handleCopy} className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors shrink-0">
            {copied ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00ff66" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
