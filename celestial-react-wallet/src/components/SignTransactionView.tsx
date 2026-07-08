import { useState, useEffect } from 'react';
import { ethers } from 'ethers';

interface SignTransactionViewProps {
  id: string;
  origin: string;
  privateKey: string;
  providerUrl: string;
  networkName?: string;
}

export function SignTransactionView({ id, origin, privateKey, providerUrl, networkName = 'Ethereum' }: SignTransactionViewProps) {
  const isTestnetNetwork = networkName.toLowerCase().includes('sepolia') || networkName.toLowerCase().includes('testnet');
  const [txPayload, setTxPayload] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isSigning, setIsSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(`tx_${id}`, (result) => {
        if (result[`tx_${id}`]) {
          setTxPayload(result[`tx_${id}`]);
        } else {
          setError('Transaction payload not found');
        }
        setLoading(false);
      });
    } else {
      // Dev fallback
      setTxPayload({
        to: '0x1234567890123456789012345678901234567890',
        value: '0xDE0B6B3A7640000', // 1 ETH
        gas: '0x5208', // 21000
        data: '0x'
      });
      setLoading(false);
    }
  }, [id]);

  const handleConfirm = async () => {
    setIsSigning(true);
    setError(null);
    try {
      const provider = new ethers.JsonRpcProvider(providerUrl);
      const wallet = new ethers.Wallet(privateKey, provider);
      
      const tx = {
        to: txPayload.to,
        value: txPayload.value,
        data: txPayload.data,
        gasLimit: txPayload.gas || txPayload.gasLimit,
        maxPriorityFeePerGas: txPayload.maxPriorityFeePerGas,
        maxFeePerGas: txPayload.maxFeePerGas,
        gasPrice: txPayload.gasPrice,
      };

      const txResponse = await wallet.sendTransaction(tx);
      
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'TX_RESOLVED',
          payload: { id, result: txResponse.hash }
        }, () => {
          window.close();
        });
      }
    } catch (err: any) {
      console.error('Signing error:', err);
      setError(err.message || 'Failed to sign transaction');
      setIsSigning(false);
    }
  };

  const handleReject = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'TX_REJECTED',
        payload: { id }
      }, () => {
        window.close();
      });
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-[#000000] text-white">
        <div className="w-8 h-8 rounded-full border-2 border-[#00f0ff] border-t-transparent animate-spin mb-4" />
        <p className="text-zinc-400 font-inter text-sm">Loading request...</p>
      </div>
    );
  }

  if (error && !txPayload) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-[#000000] text-white p-6 text-center z-[9999] absolute inset-0">
        <div className="w-12 h-12 rounded-full bg-[#ff0055]/20 flex items-center justify-center mb-4">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff0055" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <h2 className="text-xl font-bold mb-2">Error</h2>
        <p className="text-zinc-400 font-inter text-sm mb-6">{error}</p>
        <button onClick={handleReject} className="px-6 py-2 rounded-full border border-zinc-700 text-white font-semibold hover:bg-zinc-800 transition-colors">
          Close
        </button>
      </div>
    );
  }

  const formatValue = (hexValue?: string) => {
    if (!hexValue) return '0 ETH';
    try {
      const ethValue = ethers.formatEther(hexValue);
      return `${parseFloat(ethValue).toPrecision(4)} ETH`;
    } catch {
      return 'Invalid Value';
    }
  };

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-[#0a0a0a] to-[#000000] relative overflow-hidden text-white font-sans animate-fade-in absolute inset-0 z-[9999]">
      {/* Background Neon Bleed */}
      <div className="absolute top-[-150px] left-[-100px] w-[400px] h-[400px] bg-[#00f0ff] opacity-[0.03] rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-[-100px] right-[-100px] w-[300px] h-[300px] bg-[#bd00ff] opacity-[0.03] rounded-full blur-[100px] pointer-events-none" />
      
      <div className="flex-1 flex flex-col p-5 z-10 relative h-full">
        <div className="flex flex-col items-center justify-center pt-2 pb-6 border-b border-white/5 mb-6">
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#111111] border border-white/10 mb-4">
            <div className={`w-2 h-2 rounded-full ${isTestnetNetwork ? 'bg-[#ffaa00] shadow-[0_0_8px_rgba(255,170,0,0.5)]' : 'bg-[#00ff66] shadow-[0_0_8px_rgba(0,255,102,0.5)]'}`} />
            <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest">{networkName}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white to-zinc-400">Signature Request</h1>
        </div>

        <div className="mb-6 flex items-center justify-start p-4 bg-white/[0.02] border border-white/5 rounded-2xl">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#00f0ff] to-[#bd00ff] p-[1px] mr-4 shrink-0">
            <div className="w-full h-full bg-[#0a0a0a] rounded-full flex items-center justify-center overflow-hidden">
               <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
            </div>
          </div>
          <div className="flex flex-col overflow-hidden">
            <p className="text-[11px] text-zinc-500 font-semibold uppercase tracking-wider mb-0.5">Request from</p>
            <p className="text-sm font-semibold truncate text-zinc-200">{origin}</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-1 pb-6 space-y-3 font-inter custom-scrollbar">
          <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 transition-colors hover:bg-white/[0.04]">
            <div className="text-[11px] text-zinc-500 font-semibold mb-1.5 uppercase tracking-wider">To Address</div>
            <div className="font-mono text-sm break-all text-zinc-300">{txPayload.to || 'Contract Creation'}</div>
          </div>
          
          <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 transition-colors hover:bg-white/[0.04]">
            <div className="text-[11px] text-zinc-500 font-semibold mb-1.5 uppercase tracking-wider">Value</div>
            <div className="text-xl font-bold text-white">{formatValue(txPayload.value)}</div>
          </div>

          <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 transition-colors hover:bg-white/[0.04] flex justify-between items-center">
            <div className="text-[11px] text-zinc-500 font-semibold uppercase tracking-wider">Estimated Gas</div>
            <div className="font-mono text-sm text-zinc-300">{txPayload.gas ? parseInt(txPayload.gas, 16).toString() : 'Auto'}</div>
          </div>

          {txPayload.data && txPayload.data !== '0x' && (
            <details className="bg-white/[0.02] border border-white/5 rounded-xl group transition-colors hover:bg-white/[0.04]">
              <summary className="p-4 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider cursor-pointer list-none flex items-center justify-between">
                <span>Raw Data</span>
                <svg className="w-4 h-4 transform group-open:rotate-180 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </summary>
              <div className="px-4 pb-4 font-mono text-[11px] text-zinc-400 break-all border-t border-white/5 pt-3 leading-relaxed">
                {txPayload.data}
              </div>
            </details>
          )}
        </div>
        
        {error && (
          <div className="mb-4 text-xs font-semibold text-[#ff0055] bg-[#ff0055]/10 border border-[#ff0055]/20 p-3 rounded-xl break-words">
            {error}
          </div>
        )}

        <div className="flex items-center gap-4 mt-auto pt-4 pb-2">
          <button 
            onClick={handleReject} 
            disabled={isSigning}
            className="flex-1 py-3.5 rounded-full bg-white/[0.05] border border-white/10 text-white font-semibold text-sm tracking-wide hover:bg-white/[0.1] hover:border-[#ff0055]/50 hover:text-[#ff0055] hover:shadow-[0_0_15px_rgba(255,0,85,0.2)] active:scale-95 transition-all disabled:opacity-50"
          >
            Reject
          </button>
          <button 
            onClick={handleConfirm} 
            disabled={isSigning}
            className="flex-1 py-3.5 rounded-full bg-white text-black font-semibold text-sm tracking-wide hover:bg-[#00ff66] hover:shadow-[0_0_20px_rgba(0,255,102,0.4)] active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center"
          >
            {isSigning ? (
              <div className="w-5 h-5 rounded-full border-2 border-black border-t-transparent animate-spin" />
            ) : (
              'Confirm'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
