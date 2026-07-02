import React, { useState, useEffect } from 'react';
import type { TransactionRecord } from '../types';
import type { ChainAccount } from '../utils/walletUtils';
import { fetchAccountHistory } from '../utils/historyUtils';

interface ActivityTabProps {
  isOpen: boolean;
  onClose: () => void;
  activeAccountGroup?: { name: string; chains: ChainAccount[] };
  isTestnet: boolean;
}

export const ActivityTab: React.FC<ActivityTabProps> = ({
  isOpen,
  onClose,
  activeAccountGroup,
  isTestnet,
}) => {
  const [history, setHistory] = useState<TransactionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !activeAccountGroup) return;

    const loadHistory = async () => {
      setIsLoading(true);
      try {
        const allHistories = await Promise.all(
          activeAccountGroup.chains.map(chainAccount => fetchAccountHistory(chainAccount, isTestnet))
        );
        const combined = allHistories.flat().sort((a, b) => b.timestamp - a.timestamp);
        setHistory(combined);
      } catch (err) {
        console.error('Failed to load activity history', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadHistory();
  }, [isOpen, activeAccountGroup, isTestnet]);

  return (
    <div 
      className="absolute inset-0 z-[100] flex flex-col transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] bg-black/20 backdrop-blur-[40px]"
      style={{ transform: isOpen ? 'translateY(0)' : 'translateY(-100%)' }}
    >
      <div className="flex-1 overflow-y-auto scrollbar-hide px-6 pt-6 pb-24">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-black text-white">Activity</h2>
          <button onClick={onClose} className="haptic-btn w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {isLoading ? (
            <div className="text-zinc-500 text-center py-10 text-sm animate-pulse font-medium">Loading history...</div>
          ) : history.length === 0 ? (
            <div className="text-zinc-500 text-center py-10 text-sm font-medium">No activity found</div>
          ) : (
            history.map((tx) => (
              <a 
                key={tx.id}
                href={tx.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-white/[0.02] border border-white/5 p-4 rounded-2xl flex items-center justify-between hover:bg-white/[0.04] transition-colors active:scale-[0.98]"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${tx.type === 'Send' ? 'bg-white/10 text-white' : tx.type === 'Receive' ? 'bg-[#00ff66]/10 text-[#00ff66]' : 'bg-blue-500/10 text-blue-500'}`}>
                    {tx.type === 'Send' && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" /></svg>}
                    {tx.type === 'Receive' && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="17" y1="7" x2="7" y2="17" /><polyline points="17 17 7 17 7 7" /></svg>}
                    {tx.type !== 'Send' && tx.type !== 'Receive' && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>}
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white mb-0.5">{tx.type} {tx.ticker}</div>
                    <div className="text-[11px] font-medium text-zinc-500">
                      {new Date(tx.timestamp * 1000).toLocaleDateString()} • {tx.status}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-white">{tx.amount !== 'N/A' ? `${tx.amount} ${tx.ticker}` : 'N/A'}</div>
                  <div className="text-[10px] font-medium text-zinc-500 mt-0.5">{tx.chain}</div>
                </div>
              </a>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
