/// <reference types="chrome" />
import { useState, useEffect, useRef, useCallback } from 'react';
import './index.css';
import { deriveMultiChainAccounts, type ChainAccount } from './utils/walletUtils';
import { fetchETHBalance, fetchSOLBalance, fetchBTCBalance, fetchLivePrices } from './utils/rpcUtils';
import { TokenPage } from './components/TokenPage';
import { ReceiveModal } from './components/ReceiveModal';
import { SwapModal } from './components/SwapModal';
import { sendEVMTransaction, sendSolanaTransaction, sendBitcoinTransaction } from './utils/txUtils';
import { fetchAccountHistory } from './utils/historyUtils';
import type { TransactionRecord } from './types';
import { CONFIG } from './config/networks';

const AnimatedOdometer = ({ value, className = '' }: { value: string, className?: string }) => {
  const [target, setTarget] = useState(value.replace(/[0-9]/g, '0'));

  useEffect(() => {
    // Delay ensures CSS transition reliably triggers after initial render
    const timer = setTimeout(() => {
      setTarget(value);
    }, 50);
    return () => clearTimeout(timer);
  }, [value]);

  return (
    <span className={`inline-flex ${className}`}>
      {target.split('').map((char, i) => {
        const isNum = !isNaN(parseInt(char, 10)) && char !== ' ';
        if (!isNum) return <span key={i}>{char}</span>;
        
        return (
          <span key={i} className="inline-block relative overflow-hidden tabular-nums">
            {/* Invisible placeholder establishes exact native width, height, and true baseline */}
            <span className="invisible">{char}</span>
            <span 
              className="absolute inset-x-0 top-0 flex flex-col transition-transform duration-[1500ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
              style={{ 
                transform: `translateY(-${parseInt(char, 10) * 10}%)`,
                transitionDelay: `${i * 100}ms` 
              }}
            >
              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
                <span key={n}>{n}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
};

// ---- Types ------------------------------------------------------------------

type WalletState = 'loading' | 'uninitialized' | 'locked' | 'unlocked';

import btcLogo from './assets/btc.svg';
import ethLogo from './assets/eth.svg';
import solLogo from './assets/sol.svg';

interface MockToken {
  symbol: string;
  name: string;
  balance: string;
  usdValue: string;
  change: string;
  positive: boolean;
  color: string;
  neon: string;
  logo: string;
}

interface VaultInfo {
  id: string;
  name: string;
}

const MOCK_TOKENS: MockToken[] = [
  { symbol: 'ETH', name: 'Ethereum', balance: '1.45', usdValue: '$4,350.00', change: '+2.4%', positive: true, color: '#627eea', neon: 'rgba(98,126,234,0.4)', logo: ethLogo },
  { symbol: 'SOL', name: 'Solana', balance: '45.2', usdValue: '$6,420.00', change: '+5.1%', positive: true, color: '#14F195', neon: 'rgba(20,241,149,0.4)', logo: solLogo },
  { symbol: 'BTC', name: 'Bitcoin', balance: '0.045', usdValue: '$2,850.00', change: '-1.2%', positive: false, color: '#F7931A', neon: 'rgba(247,147,26,0.4)', logo: btcLogo },
];

// ---- App Component ----------------------------------------------------------

export default function App() {
  const [rawSeedPhrase, setRawSeedPhrase] = useState('');
  const [walletState, setWalletState] = useState<WalletState>('loading');
  const [vaults, setVaults] = useState<VaultInfo[]>([]);
  const [selectedVaultId, setSelectedVaultId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSwapOpen, setIsSwapOpen] = useState(false);
  const [isSendOpen, setIsSendOpen] = useState(false);
  const [sendScreen, setSendScreen] = useState<'pick' | 'form'>('pick');
  const [sendAsset, setSendAsset] = useState<'ETH' | 'SOL' | 'BTC'>('ETH');
  const [activeTokenPage, setActiveTokenPage] = useState<ChainAccount | null>(null);
  const [isReceiveOpen, setIsReceiveOpen] = useState(false);
  const [receiveInitialAccount, setReceiveInitialAccount] = useState<ChainAccount | null>(null);
  const [sendAddress, setSendAddress] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [slideX, setSlideX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const sliderRef = useRef<HTMLDivElement>(null);
  const sliderThumbRef = useRef<HTMLDivElement>(null);

  const [settingsMode, setSettingsMode] = useState<'idle' | 'seed_input' | 'seed_revealed' | 'manage_accounts' | 'account_details' | 'key_input' | 'key_revealed' | 'delete_confirm' | 'delete_password' | 'networks'>('idle');
  const [selectedManageAccountIndex, setSelectedManageAccountIndex] = useState<number | null>(null);
  const [selectedManageChain, setSelectedManageChain] = useState<ChainAccount | null>(null);

  const [revealPassword, setRevealPassword] = useState('');
  const [revealError, setRevealError] = useState('');
  const [revealedSeed, setRevealedSeed] = useState('');
  const [revealedPrivateKey, setRevealedPrivateKey] = useState('');
  const [isRevealing, setIsRevealing] = useState(false);
  const [accountCount, setAccountCount] = useState(1);
  const [activeAccountIndex, setActiveAccountIndex] = useState(() => {
    const saved = localStorage.getItem('celestial_active_account');
    return saved ? parseInt(saved, 10) : 0;
  });
  const [expandedAccounts, setExpandedAccounts] = useState<Record<number, boolean>>({ 0: true });
  const [isAccountsOpen, setIsAccountsOpen] = useState(false);
  const [allAccounts, setAllAccounts] = useState<{ name: string; chains: ChainAccount[] }[]>([]);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [activityHistory, setActivityHistory] = useState<TransactionRecord[]>([]);
  const [isActivityLoading, setIsActivityLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const settingsScrollRef = useRef<HTMLDivElement>(null);

  const resetSend = () => {
    setSendScreen('pick');
    setSendAsset('ETH');
    setSendAddress('');
    setSendAmount('');
    setIsSending(false);
    setSendSuccess(false);
    setSendError(null);
    setTxHash(null);
    setSlideX(0);
    setIsDragging(false);
  };

  const handleAddAccount = async () => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'VAULT_ADD_ACCOUNT' }, (response: any) => {
        if (response?.success && response.accountCount) {
          setAccountCount(response.accountCount);
        } else {
          console.error("Failed to add account:", response?.error);
          if (response?.error && response.error.includes('Unknown message')) {
            alert('Please reload the extension from chrome://extensions to apply background script updates.');
          }
        }
      });
    } else {
      setAccountCount(prev => prev + 1);
    }
  };

  const getSliderMax = () => {
    if (!sliderRef.current || !sliderThumbRef.current) return 200;
    return sliderRef.current.clientWidth - sliderThumbRef.current.clientWidth - 8;
  };

  const handleSliderStart = () => {
    if (!sendAddress || !sendAmount || isSending || sendSuccess) return;
    setIsDragging(true);
  };

  const handleSliderMove = (clientX: number) => {
    if (!isDragging || !sliderRef.current) return;
    const rect = sliderRef.current.getBoundingClientRect();
    const max = getSliderMax();
    const x = Math.min(Math.max(0, clientX - rect.left - 28), max);
    setSlideX(x);
    if (x >= max * 0.95) {
      setIsDragging(false);
      setSlideX(max);
      executeSend();
    }
  };

  const handleSliderEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);
    if (slideX < getSliderMax() * 0.95) {
      setSlideX(0);
    }
  };

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => handleSliderMove(e.clientX);
    const onTouchMove = (e: TouchEvent) => handleSliderMove(e.touches[0].clientX);
    const onEnd = () => handleSliderEnd();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, [isDragging, slideX]);

  const executeSend = async () => {
    setSendError(null);
    setTxHash(null);
    setIsSending(true);

    try {
      const activeAccountGroup = allAccounts[activeAccountIndex];
      if (!activeAccountGroup) throw new Error("No active account found");
      
      const chainName = sendAsset === 'ETH' ? 'EVM' : sendAsset === 'SOL' ? 'Solana' : 'Bitcoin';
      const account = activeAccountGroup.chains.find(a => a.chain === chainName);
      
      if (!account) throw new Error(`No private key found for ${chainName}`);

      let hash = '';
      if (sendAsset === 'ETH') {
        const rpcUrl = isTestnet ? CONFIG.ALCHEMY_SEPOLIA_URL : CONFIG.ALCHEMY_ETH_URL;
        hash = await sendEVMTransaction(account.privateKey, sendAddress, sendAmount, rpcUrl);
      } else if (sendAsset === 'SOL') {
        const rpcUrl = isTestnet ? CONFIG.HELIUS_DEVNET_URL : CONFIG.HELIUS_SOL_URL;
        hash = await sendSolanaTransaction(account.privateKey, sendAddress, sendAmount, rpcUrl);
      } else if (sendAsset === 'BTC') {
        hash = await sendBitcoinTransaction(account.privateKey, sendAddress, sendAmount, isTestnet ? 'testnet' : 'mainnet');
      }

      setTxHash(hash);
      setIsSending(false);
      setSendSuccess(true);
      fetchBalances();

    } catch (err: any) {
      console.error("Send failed:", err);
      setSendError(err.message || "Transaction failed");
      setIsSending(false);
      setSlideX(0);
    }
  };

  // ---- Persist State --------------------------------------------------------

  useEffect(() => {
    localStorage.setItem('celestial_active_account', activeAccountIndex.toString());
  }, [activeAccountIndex]);

  useEffect(() => {
    settingsScrollRef.current?.scrollTo(0, 0);
  }, [settingsMode]);

  // ---- Dynamic Width --------------------------------------------------------

  useEffect(() => {
    document.body.style.width = '360px'; // Set extension popup width
  }, []);

  // ---- Derive Accounts ------------------------------------------------------

  useEffect(() => {
    if (!rawSeedPhrase) return;
    const derived = [];
    for (let i = 0; i < accountCount; i++) {
      derived.push({
        name: `Account ${i + 1}`,
        chains: deriveMultiChainAccounts(rawSeedPhrase, i)
      });
    }
    setAllAccounts(derived);
  }, [rawSeedPhrase, accountCount]);

  const accounts = allAccounts[activeAccountIndex]?.chains || [];
  const ethAccount = accounts.find(c => c.chain === 'EVM')?.address;
  const solAccount = accounts.find(c => c.chain === 'Solana')?.address;
  const btcAccount = accounts.find(c => c.chain === 'Bitcoin')?.address;

  const [balances, setBalances] = useState({ eth: "0.00", sol: "0.00", btc: "0.00" });
  const [prices, setPrices] = useState({ eth: 0, sol: 0, btc: 0 });
  const [changes, setChanges] = useState({ eth: 0, sol: 0, btc: 0 });
  const [totalUsdValue, setTotalUsdValue] = useState(0.00);
  const [totalUsdChange, setTotalUsdChange] = useState(0.00);
  const [totalPercentChange, setTotalPercentChange] = useState(0.00);
  const [isTestnet, setIsTestnet] = useState<boolean>(false);
  const isTestnetRef = useRef(isTestnet);
  useEffect(() => {
    isTestnetRef.current = isTestnet;
  }, [isTestnet]);

  const fetchBalances = useCallback(async () => {
    if (accounts.length === 0) return;
    
    const networkAtFetch = isTestnet;

    const [liveData, eth, sol, btc] = await Promise.all([
      fetchLivePrices(),
      ethAccount ? fetchETHBalance(ethAccount, isTestnet) : Promise.resolve("0.00"),
      solAccount ? fetchSOLBalance(solAccount, isTestnet) : Promise.resolve("0.00"),
      btcAccount ? fetchBTCBalance(btcAccount, isTestnet) : Promise.resolve("0.00")
    ]);
    console.log("Fetched balances on", isTestnet ? "Testnet" : "Mainnet", { eth, sol, btc, liveData });

    if (networkAtFetch !== isTestnetRef.current) return;

    setPrices(liveData.prices);
    setChanges(liveData.changes);
    setBalances({ eth, sol, btc });

    const ethUsd = parseFloat(eth) * liveData.prices.eth;
    const solUsd = parseFloat(sol) * liveData.prices.sol;
    const btcUsd = parseFloat(btc) * liveData.prices.btc;

    const totalUsd = ethUsd + solUsd + btcUsd;
    setTotalUsdValue(totalUsd);

    const ethGain = ethUsd - (ethUsd / (1 + liveData.changes.eth / 100));
    const solGain = solUsd - (solUsd / (1 + liveData.changes.sol / 100));
    const btcGain = btcUsd - (btcUsd / (1 + liveData.changes.btc / 100));
    
    const totalGain = ethGain + solGain + btcGain;
    setTotalUsdChange(totalGain);
    
    const prevTotalUsd = totalUsd - totalGain;
    const totalGainPercent = prevTotalUsd > 0 ? (totalGain / prevTotalUsd) * 100 : 0;
    setTotalPercentChange(totalGainPercent);
  }, [accounts.length, ethAccount, solAccount, btcAccount, isTestnet]);

  // ---- Fetch Activity History ----
  useEffect(() => {
    if (!isActivityOpen || allAccounts.length === 0) return;
    const loadHistory = async () => {
      setIsActivityLoading(true);
      try {
        const activeGroup = allAccounts[activeAccountIndex];
        if (activeGroup) {
          const allHistories = await Promise.all(
            activeGroup.chains.map(chainAccount => fetchAccountHistory(chainAccount, isTestnet))
          );
          const combined = allHistories.flat().sort((a, b) => b.timestamp - a.timestamp);
          setActivityHistory(combined);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsActivityLoading(false);
      }
    };
    loadHistory();
  }, [isActivityOpen, activeAccountIndex, allAccounts, isTestnet]);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  // ---- Boot: Check vault state ----------------------------------------------

  const checkVaultState = useCallback(() => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(
        { type: 'VAULT_STATE_GET', payload: {} },
        (response: any) => {
          if (response?.success) {
            setVaults(response.vaults || []);
            if (response.vaults?.length > 0 && !selectedVaultId) {
              setSelectedVaultId(response.vaults[0].id);
            }

            if (!response.hasVault) {
              setWalletState('uninitialized');
            } else if (!response.isUnlocked) {
              setWalletState('locked');
            } else {
              if (response.mnemonic) {
                setRawSeedPhrase(response.mnemonic);
              }
              if (response.accountCount) {
                setAccountCount(response.accountCount);
              }
              setWalletState('unlocked');
            }
          } else {
            setWalletState('uninitialized');
          }
        },
      );
    } else {
      // Dev mode — no chrome API
      setWalletState('uninitialized');
    }
  }, [selectedVaultId]);

  useEffect(() => {
    checkVaultState();
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
        if (changes['celestial/vault']?.newValue) {
          setWalletState('locked');
        }
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    }
  }, [checkVaultState]);

  // ---- Unlock Handler -------------------------------------------------------

  async function handleUnlock() {
    if (!password) return;
    setError('');
    setLoading(true);

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage(
          { type: 'VAULT_UNLOCK', payload: { password, vaultId: selectedVaultId } },
          (response: any) => {
            setLoading(false);
            if (chrome.runtime.lastError) {
              console.error('Unlock message error:', chrome.runtime.lastError);
              setError('Extension error — try reloading');
              setPassword('');
              return;
            }
            if (!response) {
              setError('No response from wallet — try reloading extension');
              setPassword('');
              return;
            }
            if (response.success) {
              if (response.mnemonic) {
                setRawSeedPhrase(response.mnemonic);
              }
              if (response.accountCount) {
                setAccountCount(response.accountCount);
              }
              setWalletState('unlocked');
              setPassword('');
            } else {
              console.error('Unlock failed:', response.error, 'vaultId:', selectedVaultId);
              // Temporary debug: show real error
              setError(`${response.error || 'Unknown error'} [vault: ${selectedVaultId || 'NONE'}]`);
              setPassword('');
              setShaking(true);
              setTimeout(() => setShaking(false), 400);
              inputRef.current?.focus();
            }
          },
        );
      } else {
        // Dev fallback
        setLoading(false);
        setWalletState('unlocked');
      }
    } catch {
      setLoading(false);
      setError('Unlock failed');
    }
  }

  // ---- Lock Handler ---------------------------------------------------------

  function handleLock() {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'VAULT_LOCK', payload: {} });
    }
    setWalletState('locked');
    setPassword('');
    setError('');
  }

  // ---- Reveal Seed Handler --------------------------------------------------

  async function handleRevealSeed() {
    if (!revealPassword) return;
    setIsRevealing(true);
    setRevealError('');

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(
        { type: 'VAULT_UNLOCK', payload: { password: revealPassword, vaultId: selectedVaultId } },
        (response: any) => {
          setIsRevealing(false);
          if (response?.success && response.mnemonic) {
            setRevealedSeed(response.mnemonic);
            setSettingsMode('seed_revealed');
            setRevealPassword('');
          } else {
            setRevealError('Incorrect password');
          }
        }
      );
    } else {
      // Dev fallback
      setTimeout(() => {
        setIsRevealing(false);
        setRevealedSeed('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
        setSettingsMode('seed_revealed');
      }, 500);
    }
  }

  // ---- Reveal Private Key Handler -------------------------------------------

  async function handleRevealPrivateKey() {
    if (!revealPassword) return;
    setIsRevealing(true);
    setRevealError('');

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(
        { type: 'VAULT_UNLOCK', payload: { password: revealPassword, vaultId: selectedVaultId } },
        (response: any) => {
          setIsRevealing(false);
          if (response?.success) {
            if (selectedManageChain) {
              setRevealedPrivateKey(selectedManageChain.privateKey);
              setSettingsMode('key_revealed');
            }
            setRevealPassword('');
          } else {
            setRevealError('Incorrect password');
          }
        }
      );
    } else {
      // Dev fallback
      setTimeout(() => {
        setIsRevealing(false);
        if (selectedManageChain) {
          setRevealedPrivateKey(selectedManageChain.privateKey);
          setSettingsMode('key_revealed');
        }
      }, 500);
    }
  }

  function handleCloseSettings() {
    setIsSettingsOpen(false);
    setTimeout(() => {
      setSettingsMode('idle');
      setRevealPassword('');
      setRevealError('');
      setRevealedSeed('');
      setRevealedPrivateKey('');
      setSelectedManageAccountIndex(null);
      setSelectedManageChain(null);
    }, 500);
  }

  // ---- Render ---------------------------------------------------------------

  if (walletState === 'loading') {
    return <LoadingScreen />;
  }

  if (walletState === 'uninitialized') {
    return <UninitializedScreen />;
  }

  if (walletState === 'locked') {
    return (
      <LockedScreen
        vaults={vaults}
        selectedVaultId={selectedVaultId}
        onSelectVault={setSelectedVaultId}
        password={password}
        setPassword={(v) => { setPassword(v); setError(''); }}
        error={error}
        loading={loading}
        shaking={shaking}
        inputRef={inputRef}
        onUnlock={handleUnlock}
      />
    );
  }

  // ---- Unlocked: Dashboard (Obsidian) ---------------------------------------

  return (
    <div className="flex flex-col h-[600px] bg-[#000000] relative overflow-hidden text-white font-sans animate-fade-in">
      
      {isTestnet && (
        <div className="w-full bg-[#ffaa00] text-black text-[10px] font-black uppercase tracking-[0.2em] py-1.5 text-center flex-shrink-0 z-[200]">
          You are currently on Testnet
        </div>
      )}

      <div className="flex-1 relative w-full flex flex-col min-h-0">
        {/* Background Neon Bleed */}
        <div className="absolute top-[-100px] left-[-100px] w-64 h-64 bg-[#00f0ff] opacity-10 rounded-full blur-[80px] pointer-events-none" />
        <div className="absolute top-[-50px] right-[-50px] w-48 h-48 bg-[#bd00ff] opacity-10 rounded-full blur-[80px] pointer-events-none" />

      {/* ---- Header ---- */}
      <header className="flex items-center justify-between px-6 py-4 z-50 relative flex-shrink-0">
        <div className="flex items-center gap-3 relative">
          {/* Avatar Pill */}
          <button onClick={() => setIsAccountsOpen(true)} className="w-8 h-8 rounded-full bg-gradient-to-br from-[#00f0ff] to-[#bd00ff] p-[2px] hover:scale-105 transition-transform active:scale-95 z-10 relative">
            <div className="w-full h-full bg-black rounded-full flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
            </div>
          </button>
          
          <div className="relative group cursor-default">
            <div className="flex items-center gap-1.5 py-2 z-10 relative">
              <span className="font-semibold text-sm tracking-wide">Account {activeAccountIndex + 1}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="group-hover:rotate-180 transition-transform duration-300"><polyline points="6 9 12 15 18 9" /></svg>
            </div>

            {/* Hover Dropdown */}
          <div className="absolute top-[calc(100%-10px)] left-0 pt-[10px] w-56 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 z-50 origin-top-left scale-95 group-hover:scale-100">
            {/* Invisible bridge just in case */}
            <div className="absolute -top-4 left-0 w-full h-8 bg-transparent" />
            <div className="bg-[#1a1a1a] border border-[#333] rounded-2xl p-2 shadow-[0_8px_30px_rgb(0,0,0,0.8)] relative z-10">
              <div className="flex flex-col gap-0.5">
                {accounts.map(chain => (
                  <div key={chain.chain} className="flex items-center justify-between py-1.5 px-2 rounded-xl hover:bg-white/10 transition-colors group/item cursor-pointer" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(chain.address); setCopiedAddress(chain.address); setTimeout(() => setCopiedAddress(null), 2000); }}>
                    <div className="flex items-center gap-2.5">
                      {/* Chain Logo */}
                      {chain.chain === 'EVM' && (
                        <div className="w-6 h-6 rounded-full bg-[#627eea] flex items-center justify-center shadow-lg border border-white/10">
                          <svg width="10" height="10" viewBox="0 0 320 512" fill="#fff"><path d="M311.9 260.8L160 353.6 8 260.8 160 0l151.9 260.8zM160 383.4L8 290.6 160 512l152-221.4-152 92.8z"/></svg>
                        </div>
                      )}
                      {chain.chain === 'Solana' && (
                        <div className="w-6 h-6 rounded-full bg-black flex items-center justify-center shadow-lg border border-[#14F195]/30">
                          <svg width="12" height="12" viewBox="0 0 397 311" fill="url(#solana-grad-1)"><defs><linearGradient id="solana-grad-1" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#00FFA3" /><stop offset="100%" stopColor="#DC1FFF" /></linearGradient></defs><path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7zM64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8zM333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z"/></svg>
                        </div>
                      )}
                      {chain.chain === 'Bitcoin' && (
                        <div className="w-6 h-6 rounded-full bg-[#f7931a] flex items-center justify-center shadow-lg border border-white/10">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="#fff"><path d="M14.653 10.686c1.171-.341 1.996-1.045 2.128-2.656.16-1.954-1.127-2.92-3.327-3.237l.745-2.991-1.815-.452-.724 2.905c-.477-.119-.968-.232-1.464-.343l.732-2.936-1.814-.452-.746 2.994c-.396-.089-.785-.181-1.164-.282l-2.493-.621-.48 1.926s1.341.306 1.314.327c.732.182.865.666.843 1.049l-1.688 6.772c-.092.219-.344.545-.855.419.023.03-1.316-.328-1.316-.328l-.902 2.083 2.355.587c.435.108.865.223 1.291.332l-.75 3.013 1.815.452.744-2.986c.493.131.975.253 1.448.369l-.736 2.955 1.814.452.753-3.023c2.721.516 4.776.31 5.631-2.155.688-1.986-.019-3.13-1.503-3.878zM11.603 6.953c1.554.388 2.658.625 2.454 1.443-.203.815-1.428.614-2.982.227l.528-1.67zm1.189 7.747c-1.745-.436-3.05-.662-2.825-1.564.225-.902 1.623-.637 3.368-.201.597.149 1.139.317 1.488.586.643.493.58 1.408-.035 1.656-.475.191-1.189.163-1.996-.477z"/></svg>
                        </div>
                      )}
                      <span className="text-xs font-semibold text-zinc-300 tracking-wide font-mono group-hover/item:text-white transition-colors">
                        {chain.address.slice(0,6)}...{chain.address.slice(-4)}
                      </span>
                    </div>
                    <button 
                      className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/10 transition-colors"
                      title="Copy Address"
                    >
                      {copiedAddress === chain.address ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00ff66" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Network Pill */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#111111] border border-white/5">
            <div className="w-1.5 h-1.5 rounded-full bg-[#00ff66] shadow-[0_0_8px_rgba(0,255,102,0.5)]" />
            <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest">ETH</span>
          </div>
          <button onClick={handleLock} className="haptic-btn text-zinc-400 hover:text-white" title="Lock">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
          </button>
        </div>
      </header>

      {/* ---- Hero Balance ---- */}
      <div className="px-6 pt-6 pb-8 flex flex-col z-10">
        <span className="text-zinc-500 text-sm font-semibold mb-1">Total Balance</span>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold mt-1.5 mr-1 text-zinc-400">$</span>
          <span className="text-[2.75rem] font-black tracking-tighter leading-none">
            <AnimatedOdometer value={parseInt(totalUsdValue.toFixed(2).split('.')[0]).toLocaleString('en-US')} />
          </span>
          <span className="text-2xl font-bold text-zinc-400">
            .<AnimatedOdometer value={totalUsdValue.toFixed(2).split('.')[1]} />
          </span>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={totalUsdChange >= 0 ? "#00ff66" : "#ff0055"} strokeWidth="3" strokeLinecap="round">
            {totalUsdChange >= 0 ? (
              <>
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                <polyline points="17 6 23 6 23 12" />
              </>
            ) : (
              <>
                <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
                <polyline points="17 18 23 18 23 12" />
              </>
            )}
          </svg>
          <span className={`text-sm font-bold ${totalUsdChange >= 0 ? 'text-[#00ff66]' : 'text-[#ff0055]'}`}>
            {totalUsdChange >= 0 ? '+' : '-'}$<AnimatedOdometer value={Math.abs(totalUsdChange).toFixed(2)} /> ({totalUsdChange >= 0 ? '+' : ''}{totalPercentChange.toFixed(1)}%)
          </span>
          <span className="text-xs font-semibold text-zinc-500 ml-1 bg-zinc-900 px-2 py-0.5 rounded-full">Today</span>
        </div>
      </div>

      {/* ---- Action Island ---- */}
      <div className="px-6 mb-8 z-10">
        <div className="flex items-center justify-between bg-[#0a0a0a] p-1.5 rounded-2xl border border-white/5 shadow-2xl">
          {[
            { label: 'Send', onClick: () => { setIsSendOpen(true); setIsSwapOpen(false); setIsSettingsOpen(false); setIsAccountsOpen(false); }, icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg> },
            { label: 'Receive', onClick: () => { setIsReceiveOpen(true); setReceiveInitialAccount(null); }, icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="7 13 12 18 17 13" /><line x1="12" y1="18" x2="12" y2="6" /><path d="M20 21H4" /></svg> },
            { label: 'Swap', onClick: () => { setIsSwapOpen(true); setIsSendOpen(false); setIsSettingsOpen(false); setIsAccountsOpen(false); }, icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 4v14M7 18l-3-3M7 18l3-3M17 20V6M17 6l-3 3M17 6l3 3" /></svg> },
            { label: 'Buy', onClick: () => {}, icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg> },
          ].map((action) => (
            <button key={action.label} onClick={action.onClick} className="haptic-btn flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl hover:bg-[#18181b] group">
              <div className="text-zinc-300 group-hover:text-white transition-colors">
                {action.icon}
              </div>
              <span className="text-[10px] font-bold tracking-wide text-zinc-400 group-hover:text-white transition-colors">{action.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ---- Asset Drawer ---- */}
      <div className="flex-1 bg-[#0a0a0a] rounded-t-[32px] px-4 pt-6 z-10 border-t border-white/5 relative shadow-[0_-10px_40px_rgba(0,0,0,0.5)] animate-slide-up flex flex-col overflow-hidden">
        {/* Drag handle pill */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 w-12 h-1 bg-zinc-800 rounded-full z-20" />
        
        <div className="flex items-center justify-between px-2 mb-4">
          <div className="flex gap-4">
            <span className="text-sm font-bold text-white border-b-2 border-[#00f0ff] pb-1">Tokens</span>
            <span className="text-sm font-bold text-zinc-600 pb-1 hover:text-zinc-400 cursor-pointer transition-colors">NFTs</span>
          </div>
          <span className="text-xs font-bold text-zinc-600 bg-zinc-900 px-2 py-0.5 rounded-md">{MOCK_TOKENS.length}</span>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-hide flex flex-col gap-1 pb-24">
          {MOCK_TOKENS.map((token) => {
            let currentBalance = token.balance;
            let currentUsd = token.usdValue;
            let currentChange = token.change;
            let currentPositive = token.positive;
            
            if (token.symbol === 'ETH') {
              currentBalance = balances.eth;
              currentUsd = balances.eth === "..." ? "$..." : `$${(parseFloat(balances.eth) * prices.eth).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
              currentChange = `${changes.eth >= 0 ? '+' : ''}${changes.eth.toFixed(1)}%`;
              currentPositive = changes.eth >= 0;
            } else if (token.symbol === 'SOL') {
              currentBalance = balances.sol;
              currentUsd = balances.sol === "..." ? "$..." : `$${(parseFloat(balances.sol) * prices.sol).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
              currentChange = `${changes.sol >= 0 ? '+' : ''}${changes.sol.toFixed(1)}%`;
              currentPositive = changes.sol >= 0;
            } else if (token.symbol === 'BTC') {
              currentBalance = balances.btc;
              currentUsd = balances.btc === "..." ? "$..." : `$${(parseFloat(balances.btc) * prices.btc).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
              currentChange = `${changes.btc >= 0 ? '+' : ''}${changes.btc.toFixed(1)}%`;
              currentPositive = changes.btc >= 0;
            }

            return (
            <div 
              key={token.symbol} 
              className="token-row group relative overflow-hidden shrink-0 cursor-pointer"
              onClick={() => {
                const chainAccount = accounts.find(c => c.chain === (token.symbol === 'ETH' ? 'EVM' : token.symbol === 'SOL' ? 'Solana' : 'Bitcoin'));
                if (chainAccount) setActiveTokenPage(chainAccount);
              }}
            >
              {/* Subtle hover bleed */}
              <div className="absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity duration-300 pointer-events-none" style={{ background: `radial-gradient(circle at 10% 50%, ${token.color} 0%, transparent 80%)` }} />
              
              <div
                className="w-12 h-12 flex items-center justify-center flex-shrink-0 relative z-10 shadow-lg rounded-full overflow-hidden"
                style={{ boxShadow: `0 4px 20px ${token.neon}` }}
              >
                <img src={token.logo} alt={token.symbol} className="w-full h-full" />
              </div>
              <div className="flex-1 min-w-0 relative z-10">
                <div className="flex items-center justify-between">
                  <span className="text-base font-bold text-white">{token.name}</span>
                  <span className="text-base font-bold text-white">{currentUsd}</span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-xs font-medium text-zinc-400">
                    {currentBalance} {token.symbol}
                  </span>
                  <span
                    className="text-xs font-bold"
                    style={{ color: currentPositive ? '#00ff66' : '#ff0055' }}
                  >
                    {currentChange}
                  </span>
                </div>
              </div>
            </div>
          )})}
        </div>
      </div>

      {/* ---- Floating Bottom Nav ---- */}
      {(!isSettingsOpen || settingsMode === 'idle') && !isAccountsOpen && !isSendOpen && !activeTokenPage && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[200]">
          <nav className="flex items-center gap-1 bg-[#18181b]/90 backdrop-blur-xl p-1.5 rounded-full border border-white/10 shadow-[0_10px_40px_rgba(0,0,0,0.8)]">
            <NavItem icon="home" active={!isSettingsOpen && !isSwapOpen && !isActivityOpen} onClick={() => { handleCloseSettings(); setIsSwapOpen(false); setIsActivityOpen(false); }} />
            <NavItem 
              icon="swap" 
              active={isSwapOpen} 
              onClick={() => { setIsSwapOpen(!isSwapOpen); handleCloseSettings(); setIsActivityOpen(false); }} 
              iconClass={`transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${isSwapOpen ? 'rotate-[180deg]' : 'rotate-0'}`} 
            />
            <NavItem 
              icon="clock" 
              active={isActivityOpen}
              onClick={() => { isActivityOpen ? setIsActivityOpen(false) : setIsActivityOpen(true); handleCloseSettings(); setIsSwapOpen(false); }} 
            />
            <NavItem 
              icon="settings" 
              active={isSettingsOpen} 
              onClick={() => { isSettingsOpen ? handleCloseSettings() : setIsSettingsOpen(true); setIsSwapOpen(false); setIsActivityOpen(false); }} 
              iconClass={`transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${isSettingsOpen ? 'rotate-[180deg]' : 'rotate-0'}`} 
            />
          </nav>
        </div>
      )}

      {/* ---- Activity Sliding Panel ---- */}
      <div 
        className="absolute inset-0 z-[100] flex flex-col transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] bg-black/20 backdrop-blur-[40px]"
        style={{ transform: isActivityOpen ? 'translateY(0)' : 'translateY(-100%)' }}
      >
        <div className="flex-1 overflow-y-auto scrollbar-hide px-6 pt-6 pb-24">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-black text-white">Activity</h2>
            <button onClick={() => setIsActivityOpen(false)} className="haptic-btn w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>

          <div className="flex flex-col gap-3">
            {isActivityLoading ? (
              <div className="text-zinc-500 text-center py-10 text-sm animate-pulse font-medium">Loading history...</div>
            ) : activityHistory.length === 0 ? (
              <div className="text-zinc-500 text-center py-10 text-sm font-medium">No activity found</div>
            ) : (
              activityHistory.map((tx) => (
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
                      {tx.type === 'Transaction' && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>}
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

      {/* ---- Accounts Sliding Panel ---- */}
      <div 
        className="absolute inset-0 z-[100] flex flex-col transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] bg-black/20 backdrop-blur-[40px]"
        style={{ transform: isAccountsOpen ? 'translateY(0)' : 'translateY(-100%)' }}
      >
        <div className="flex-1 overflow-y-auto scrollbar-hide px-6 pt-6 pb-6">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-black text-white">Accounts</h2>
            <button onClick={() => setIsAccountsOpen(false)} className="haptic-btn w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {allAccounts.map((acc, idx) => (
              <div 
                key={idx} 
                className="py-2 px-4 transition-all bg-transparent"
              >
                <div className="flex items-center gap-3">
                  {/* Avatar Pill */}
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#00f0ff] to-[#bd00ff] p-[2px] shadow-lg">
                    <div className="w-full h-full bg-black rounded-full flex items-center justify-center">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                    </div>
                  </div>
                  
                  <span 
                    className="text-base font-bold text-white cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => {
                      setActiveAccountIndex(idx);
                      setIsAccountsOpen(false);
                    }}
                  >
                    {acc.name}
                  </span>

                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedAccounts(prev => ({ ...prev, [idx]: !prev[idx] }));
                    }} 
                    className="p-1 ml-auto text-zinc-400 hover:text-white transition-colors"
                  >
                    <svg 
                      width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                      className={`transition-transform duration-300 ${expandedAccounts[idx] ? 'rotate-180' : 'rotate-0'}`}
                    >
                      <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                  </button>
                </div>
                
                <div className={`overflow-hidden transition-all duration-300 ${expandedAccounts[idx] ? 'max-h-40 opacity-100 mt-1' : 'max-h-0 opacity-0 mt-0'}`}>
                  <div className="flex flex-col pl-4">
                    {acc.chains.map(chain => (
                      <div key={chain.chain} className="flex items-center justify-between py-1 px-1 bg-transparent">
                        <div className="flex items-center gap-3">
                          {/* Chain Logo */}
                          {chain.chain === 'EVM' && (
                            <div className="w-7 h-7 rounded-full bg-[#627eea] flex items-center justify-center shadow-lg border border-white/10">
                              <svg width="12" height="12" viewBox="0 0 320 512" fill="#fff"><path d="M311.9 260.8L160 353.6 8 260.8 160 0l151.9 260.8zM160 383.4L8 290.6 160 512l152-221.4-152 92.8z"/></svg>
                            </div>
                          )}
                          {chain.chain === 'Solana' && (
                            <div className="w-7 h-7 rounded-full bg-black flex items-center justify-center shadow-lg border border-[#14F195]/30">
                              <svg width="14" height="14" viewBox="0 0 397 311" fill="url(#solana-grad-2)"><defs><linearGradient id="solana-grad-2" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#00FFA3" /><stop offset="100%" stopColor="#DC1FFF" /></linearGradient></defs><path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7zM64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8zM333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z"/></svg>
                            </div>
                          )}
                          {chain.chain === 'Bitcoin' && (
                            <div className="w-7 h-7 rounded-full bg-[#f7931a] flex items-center justify-center shadow-lg border border-white/10">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><path d="M14.653 10.686c1.171-.341 1.996-1.045 2.128-2.656.16-1.954-1.127-2.92-3.327-3.237l.745-2.991-1.815-.452-.724 2.905c-.477-.119-.968-.232-1.464-.343l.732-2.936-1.814-.452-.746 2.994c-.396-.089-.785-.181-1.164-.282l-2.493-.621-.48 1.926s1.341.306 1.314.327c.732.182.865.666.843 1.049l-1.688 6.772c-.092.219-.344.545-.855.419.023.03-1.316-.328-1.316-.328l-.902 2.083 2.355.587c.435.108.865.223 1.291.332l-.75 3.013 1.815.452.744-2.986c.493.131.975.253 1.448.369l-.736 2.955 1.814.452.753-3.023c2.721.516 4.776.31 5.631-2.155.688-1.986-.019-3.13-1.503-3.878zM11.603 6.953c1.554.388 2.658.625 2.454 1.443-.203.815-1.428.614-2.982.227l.528-1.67zm1.189 7.747c-1.745-.436-3.05-.662-2.825-1.564.225-.902 1.623-.637 3.368-.201.597.149 1.139.317 1.488.586.643.493.58 1.408-.035 1.656-.475.191-1.189.163-1.996-.477z"/></svg>
                            </div>
                          )}
                          <span className="text-sm font-semibold text-zinc-300 tracking-wide font-mono">
                            {chain.address.slice(0,6)}...{chain.address.slice(-4)}
                          </span>
                        </div>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(chain.address);
                            setCopiedAddress(chain.address);
                            setTimeout(() => setCopiedAddress(null), 2000);
                          }}
                          className="p-2 rounded-xl hover:bg-white/10 transition-colors"
                          title="Copy Address"
                        >
                          {copiedAddress === chain.address ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00ff66" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="animate-fade-in"><polyline points="20 6 9 17 4 12" /></svg>
                          ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-6 border-t border-white/5 bg-transparent">
          <button 
            onClick={handleAddAccount} 
            className="w-full py-4 bg-white/5 hover:bg-white/10 text-white font-bold rounded-2xl flex items-center justify-center gap-2 border border-white/10 transition-colors active:scale-[0.98] backdrop-blur-md"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add New Account
          </button>
        </div>
      </div>

      {/* ---- Send Sliding Panel ---- */}
      <div 
        className="absolute inset-0 bg-[#0a0a0a] z-[100] flex flex-col transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
        style={{ transform: isSendOpen ? 'translateY(0)' : 'translateY(100%)' }}
      >
        {/* ===== SCREEN 1: Asset Picker ===== */}
        {sendScreen === 'pick' && (
          <div className="flex flex-col flex-1 animate-fade-in">
            <div className="flex items-center justify-between px-6 pt-8 pb-4 flex-shrink-0">
              <h2 className="text-2xl font-black text-white tracking-tight">Send</h2>
              <button onClick={() => { setIsSendOpen(false); resetSend(); }} className="haptic-btn w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <p className="text-zinc-500 text-xs font-semibold px-6 mb-4 tracking-wide uppercase">Select an asset to send</p>
            <div className="flex flex-col px-2 flex-1 overflow-y-auto pb-8">
              {/* ETH */}
              <button 
                onClick={() => { setSendAsset('ETH'); setSendScreen('form'); }}
                className="haptic-btn flex items-center gap-4 p-4 rounded-2xl bg-transparent hover:bg-[#111111] transition-all group"
              >
                <div className="w-11 h-11 rounded-full bg-[#627eea] flex items-center justify-center flex-shrink-0">
                  <svg width="18" height="18" viewBox="0 0 320 512" fill="#fff"><path d="M311.9 260.8L160 353.6 8 260.8 160 0l151.9 260.8zM160 383.4L8 290.6 160 512l152-221.4-152 92.8z"/></svg>
                </div>
                <div className="flex flex-col items-start flex-1 min-w-0">
                  <span className="text-sm font-bold text-white">Ethereum</span>
                  <span className="text-xs text-zinc-500 font-mono">{balances.eth} ETH</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-sm font-bold text-white">${(parseFloat(balances.eth) * prices.eth).toFixed(2)}</span>
                  <span className={`text-[10px] font-bold ${changes.eth >= 0 ? 'text-[#00ff66]' : 'text-[#ff0055]'}`}>{changes.eth >= 0 ? '+' : ''}{changes.eth.toFixed(1)}%</span>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#52525b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="group-hover:stroke-white transition-colors flex-shrink-0"><polyline points="9 18 15 12 9 6" /></svg>
              </button>

              {/* SOL */}
              <button 
                onClick={() => { setSendAsset('SOL'); setSendScreen('form'); }}
                className="haptic-btn flex items-center gap-4 p-4 rounded-2xl bg-transparent hover:bg-[#111111] transition-all group"
              >
                <div className="w-11 h-11 rounded-full bg-black flex items-center justify-center border border-[#14F195]/30 flex-shrink-0">
                  <svg width="20" height="20" viewBox="0 0 397 311" fill="url(#solana-grad-send)"><defs><linearGradient id="solana-grad-send" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#00FFA3" /><stop offset="100%" stopColor="#DC1FFF" /></linearGradient></defs><path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7zM64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8zM333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z"/></svg>
                </div>
                <div className="flex flex-col items-start flex-1 min-w-0">
                  <span className="text-sm font-bold text-white">Solana</span>
                  <span className="text-xs text-zinc-500 font-mono">{balances.sol} SOL</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-sm font-bold text-white">${(parseFloat(balances.sol) * prices.sol).toFixed(2)}</span>
                  <span className={`text-[10px] font-bold ${changes.sol >= 0 ? 'text-[#00ff66]' : 'text-[#ff0055]'}`}>{changes.sol >= 0 ? '+' : ''}{changes.sol.toFixed(1)}%</span>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#52525b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="group-hover:stroke-white transition-colors flex-shrink-0"><polyline points="9 18 15 12 9 6" /></svg>
              </button>

              {/* BTC */}
              <button 
                onClick={() => { setSendAsset('BTC'); setSendScreen('form'); }}
                className="haptic-btn flex items-center gap-4 p-4 rounded-2xl bg-transparent hover:bg-[#111111] transition-all group"
              >
                <div className="w-11 h-11 rounded-full bg-[#f7931a] flex items-center justify-center flex-shrink-0">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M14.653 10.686c1.171-.341 1.996-1.045 2.128-2.656.16-1.954-1.127-2.92-3.327-3.237l.745-2.991-1.815-.452-.724 2.905c-.477-.119-.968-.232-1.464-.343l.732-2.936-1.814-.452-.746 2.994c-.396-.089-.785-.181-1.164-.282l-2.493-.621-.48 1.926s1.341.306 1.314.327c.732.182.865.666.843 1.049l-1.688 6.772c-.092.219-.344.545-.855.419.023.03-1.316-.328-1.316-.328l-.902 2.083 2.355.587c.435.108.865.223 1.291.332l-.75 3.013 1.815.452.744-2.986c.493.131.975.253 1.448.369l-.736 2.955 1.814.452.753-3.023c2.721.516 4.776.31 5.631-2.155.688-1.986-.019-3.13-1.503-3.878zM11.603 6.953c1.554.388 2.658.625 2.454 1.443-.203.815-1.428.614-2.982.227l.528-1.67zm1.189 7.747c-1.745-.436-3.05-.662-2.825-1.564.225-.902 1.623-.637 3.368-.201.597.149 1.139.317 1.488.586.643.493.58 1.408-.035 1.656-.475.191-1.189.163-1.996-.477z"/></svg>
                </div>
                <div className="flex flex-col items-start flex-1 min-w-0">
                  <span className="text-sm font-bold text-white">Bitcoin</span>
                  <span className="text-xs text-zinc-500 font-mono">{balances.btc} BTC</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-sm font-bold text-white">${(parseFloat(balances.btc) * prices.btc).toFixed(2)}</span>
                  <span className={`text-[10px] font-bold ${changes.btc >= 0 ? 'text-[#00ff66]' : 'text-[#ff0055]'}`}>{changes.btc >= 0 ? '+' : ''}{changes.btc.toFixed(1)}%</span>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#52525b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="group-hover:stroke-white transition-colors flex-shrink-0"><polyline points="9 18 15 12 9 6" /></svg>
              </button>
            </div>
          </div>
        )}

        {/* ===== SCREEN 2: Send Form ===== */}
        {sendScreen === 'form' && (
          <div className="flex flex-col flex-1 animate-fade-in">
            <div className="flex items-center justify-between px-6 pt-8 pb-4 flex-shrink-0">
              <div className="flex items-center gap-3">
                <button onClick={() => { setSendScreen('pick'); setSendAddress(''); setSendAmount(''); setSlideX(0); }} className="haptic-btn w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                </button>
                <div className="flex items-center gap-2">
                  {sendAsset === 'ETH' && <div className="w-6 h-6 rounded-full bg-[#627eea] flex items-center justify-center shadow border border-white/10"><svg width="10" height="10" viewBox="0 0 320 512" fill="#fff"><path d="M311.9 260.8L160 353.6 8 260.8 160 0l151.9 260.8zM160 383.4L8 290.6 160 512l152-221.4-152 92.8z"/></svg></div>}
                  {sendAsset === 'SOL' && <div className="w-6 h-6 rounded-full bg-black flex items-center justify-center shadow border border-[#14F195]/30"><svg width="12" height="12" viewBox="0 0 397 311" fill="url(#solana-grad-send)"><path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7zM64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8zM333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z"/></svg></div>}
                  {sendAsset === 'BTC' && <div className="w-6 h-6 rounded-full bg-[#f7931a] flex items-center justify-center shadow border border-white/10"><svg width="12" height="12" viewBox="0 0 24 24" fill="#fff"><path d="M14.653 10.686c1.171-.341 1.996-1.045 2.128-2.656.16-1.954-1.127-2.92-3.327-3.237l.745-2.991-1.815-.452-.724 2.905c-.477-.119-.968-.232-1.464-.343l.732-2.936-1.814-.452-.746 2.994c-.396-.089-.785-.181-1.164-.282l-2.493-.621-.48 1.926s1.341.306 1.314.327c.732.182.865.666.843 1.049l-1.688 6.772c-.092.219-.344.545-.855.419.023.03-1.316-.328-1.316-.328l-.902 2.083 2.355.587c.435.108.865.223 1.291.332l-.75 3.013 1.815.452.744-2.986c.493.131.975.253 1.448.369l-.736 2.955 1.814.452.753-3.023c2.721.516 4.776.31 5.631-2.155.688-1.986-.019-3.13-1.503-3.878zM11.603 6.953c1.554.388 2.658.625 2.454 1.443-.203.815-1.428.614-2.982.227l.528-1.67zm1.189 7.747c-1.745-.436-3.05-.662-2.825-1.564.225-.902 1.623-.637 3.368-.201.597.149 1.139.317 1.488.586.643.493.58 1.408-.035 1.656-.475.191-1.189.163-1.996-.477z"/></svg></div>}
                  <h2 className="text-xl font-black text-white tracking-tight">Send {sendAsset}</h2>
                </div>
              </div>
              <button onClick={() => { setIsSendOpen(false); resetSend(); }} className="haptic-btn w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/10 transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            <div className="flex flex-col gap-4 relative flex-1 px-6 mt-2">
              {/* Recipient Address */}
              <div className="bg-[#111111] p-4 rounded-[20px] transition-all duration-300 focus-within:ring-1 focus-within:ring-white/20">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[11px] font-semibold text-zinc-500 tracking-wide uppercase">To</span>
                  <button 
                    className="text-[11px] font-semibold text-zinc-400 hover:text-white transition-colors flex items-center gap-1 haptic-btn" 
                    onClick={() => navigator.clipboard.readText().then(setSendAddress).catch(()=>{})}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                    Paste
                  </button>
                </div>
                <input 
                  type="text" 
                  placeholder={sendAsset === 'SOL' ? 'Solana address...' : sendAsset === 'BTC' ? 'Bitcoin address...' : '0x...'}
                  value={sendAddress}
                  onChange={(e) => setSendAddress(e.target.value)}
                  className="bg-transparent text-sm font-mono text-white outline-none w-full placeholder:text-zinc-700" 
                />
              </div>

              {/* Amount */}
              <div className="bg-[#111111] p-4 rounded-[20px] transition-all duration-300 focus-within:ring-1 focus-within:ring-white/20">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-[11px] font-semibold text-zinc-500 tracking-wide uppercase">Amount</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-zinc-500">
                      Balance: <span className="text-white font-mono">{sendAsset === 'ETH' ? balances.eth : sendAsset === 'SOL' ? balances.sol : balances.btc}</span>
                    </span>
                    <button 
                      onClick={() => setSendAmount(sendAsset === 'ETH' ? balances.eth : sendAsset === 'SOL' ? balances.sol : balances.btc)} 
                      className="haptic-btn text-[10px] font-bold bg-white/10 text-white px-2 py-1 rounded-full hover:bg-white/20 transition-colors"
                    >
                      MAX
                    </button>
                  </div>
                </div>
                <div className="flex items-baseline gap-2">
                  <input 
                    type="text" 
                    placeholder="0" 
                    value={sendAmount}
                    onChange={(e) => setSendAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    className="bg-transparent text-4xl font-black text-white outline-none w-full placeholder:text-zinc-800" 
                  />
                  <span className="text-lg font-bold text-zinc-500 flex-shrink-0">{sendAsset}</span>
                </div>
                {sendAmount && (
                  <span className="text-sm text-zinc-500 mt-2 block font-medium">
                    ≈ ${(parseFloat(sendAmount || '0') * (sendAsset === 'ETH' ? prices.eth : sendAsset === 'SOL' ? prices.sol : prices.btc)).toFixed(2)}
                  </span>
                )}
              </div>

              {/* Network Fee */}
              {sendAmount && sendAddress && (
                <div className="flex items-center justify-between px-2 py-1 animate-fade-in">
                  <span className="text-[11px] font-medium text-zinc-500">Estimated Network Fee</span>
                  <span className="text-[11px] font-medium text-zinc-400">~ $0.01</span>
                </div>
              )}

              <div className="flex-1" />

              {/* ---- Slide to Send ---- */}
              <div className="mt-auto mb-10 relative select-none flex flex-col gap-3">
                {sendError && (
                  <div className="w-full p-3 bg-[#ff0055]/10 border border-[#ff0055]/30 rounded-2xl flex flex-col items-center justify-center text-center animate-fade-in">
                    <span className="text-[#ff0055] font-bold text-[13px] mb-1">Transaction Failed</span>
                    <span className="text-[#ff0055]/80 font-medium text-[11px] leading-tight px-2">{sendError}</span>
                  </div>
                )}
                {sendSuccess ? (
                  <div className="w-full flex flex-col items-center gap-3 animate-fade-in">
                    <div className="w-full h-14 bg-[#111111] border border-[#00ff66]/20 rounded-full flex items-center justify-center gap-2 text-[#00ff66] font-bold tracking-wide text-[14px]">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      Sent Successfully
                    </div>
                    {txHash && (
                      <a 
                        href={
                          sendAsset === 'ETH' ? (isTestnet ? `https://sepolia.etherscan.io/tx/${txHash}` : `https://etherscan.io/tx/${txHash}`) :
                          sendAsset === 'SOL' ? (isTestnet ? `https://explorer.solana.com/tx/${txHash}?cluster=devnet` : `https://explorer.solana.com/tx/${txHash}`) :
                          (isTestnet ? `https://mempool.space/testnet/tx/${txHash}` : `https://mempool.space/tx/${txHash}`)
                        }
                        target="_blank" rel="noopener noreferrer"
                        className="text-[12px] font-semibold text-zinc-400 hover:text-white underline underline-offset-4 decoration-zinc-600 hover:decoration-white transition-all haptic-btn"
                      >
                        View on Explorer
                      </a>
                    )}
                  </div>
                ) : isSending ? (
                  <div className="w-full h-14 bg-[#111111] border border-white/5 rounded-full flex items-center justify-center gap-3 text-white font-bold tracking-wide text-[14px] animate-pulse">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin text-zinc-400"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                    Broadcasting
                  </div>
                ) : (
                  <div 
                    ref={sliderRef}
                    className={`relative w-full h-14 rounded-full overflow-hidden ${!sendAddress || !sendAmount ? 'bg-[#111111] opacity-50' : 'bg-[#111111]'}`}
                  >
                    {/* Track fill */}
                    <div 
                      className="absolute left-0 top-0 bottom-0 bg-white/10 rounded-full transition-none"
                      style={{ width: `${slideX + 56}px`, opacity: sendAddress && sendAmount ? 1 : 0 }}
                    />
                    {/* Label */}
                    <span className={`absolute inset-0 flex items-center justify-center text-[13px] font-bold text-zinc-400 transition-opacity ${slideX > 30 ? 'opacity-0' : 'opacity-100'} ${!sendAddress || !sendAmount ? 'text-zinc-600' : ''}`}>
                      Slide to send
                      {sendAddress && sendAmount && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-bounce-x ml-2"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>}
                    </span>
                    {/* Draggable Thumb */}
                    <div
                      ref={sliderThumbRef}
                      onMouseDown={(e) => { e.preventDefault(); handleSliderStart(); }}
                      onTouchStart={() => handleSliderStart()}
                      className={`absolute top-1 bottom-1 left-1 w-12 rounded-full flex items-center justify-center cursor-grab active:cursor-grabbing transition-none z-10 ${!sendAddress || !sendAmount ? 'bg-zinc-800 text-zinc-500 pointer-events-none' : 'bg-white text-black shadow-md'}`}
                      style={{ transform: `translateX(${slideX}px)`, transition: isDragging ? 'none' : 'transform 0.4s cubic-bezier(0.32,0.72,0,1)' }}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>


      {/* ---- Settings Sliding Panel ---- */}
      <div 
        className="absolute inset-0 bg-[#0a0a0a] z-[100] flex flex-col pt-8 px-6 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
        style={{ transform: isSettingsOpen ? 'translateY(0)' : 'translateY(100%)' }}
      >
        <div className="flex items-center justify-between mb-8">
          {settingsMode === 'idle' ? (
            <h2 className="text-2xl font-black text-white">Settings</h2>
          ) : (
            <div className="flex items-center gap-3">
              <button onClick={() => {
                if (settingsMode === 'account_details') setSettingsMode('manage_accounts');
                else if (settingsMode === 'key_input' || settingsMode === 'key_revealed') setSettingsMode('account_details');
                else if (settingsMode === 'delete_confirm' || settingsMode === 'delete_password') setSettingsMode('account_details');
                else setSettingsMode('idle');
              }} className="text-zinc-400 hover:text-white transition-colors">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
              </button>
              <h2 className="text-xl font-black text-white">
                {settingsMode.startsWith('seed') ? 'Recovery Phrase' : settingsMode === 'account_details' && selectedManageAccountIndex !== null ? allAccounts[selectedManageAccountIndex]?.name : settingsMode === 'delete_confirm' || settingsMode === 'delete_password' ? 'Delete Account' : settingsMode === 'networks' ? 'Networks' : 'Manage Accounts'}
              </h2>
            </div>
          )}
          <button onClick={handleCloseSettings} className="haptic-btn w-8 h-8 rounded-full bg-[#111111] border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div ref={settingsScrollRef} className="flex-1 overflow-y-auto pb-24 flex flex-col pr-2 -mr-2">
          {settingsMode === 'idle' && (
          <>
            <div className="flex flex-col gap-3">
              {[
                { title: 'General', desc: 'Currency, Language, Theme', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> },
                { id: 'manage_accounts', title: 'Manage Accounts', desc: 'View accounts & private keys', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg> },
                { id: 'security', title: 'Security & Privacy', desc: 'Reveal Recovery Phrase', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg> },
                { id: 'networks', title: 'Networks', desc: 'Ethereum, Solana, Polygon', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg> },
                { title: 'Address Book', desc: 'Saved Contacts', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg> },
                { id: 'lock', title: 'Lock Wallet', desc: 'Secure your session', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ff0055" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>, isDanger: true },
              ].map((item) => (
                <div 
                  key={item.title} 
                  className="flex items-center gap-4 bg-[#111111] border border-white/5 p-4 rounded-2xl haptic-btn group"
                  onClick={() => {
                    if (item.id === 'security') setSettingsMode('seed_input');
                    else if (item.id === 'manage_accounts') setSettingsMode('manage_accounts');
                    else if (item.id === 'networks') setSettingsMode('networks');
                    else if (item.id === 'lock') handleLock();
                  }}
                >
                  <div className={`w-10 h-10 rounded-xl bg-black flex items-center justify-center border border-white/10 ${item.isDanger ? 'group-hover:border-[#ff0055]' : 'group-hover:border-[#00f0ff]'} transition-colors`}>
                    {item.icon}
                  </div>
                  <div className="flex-1">
                    <h3 className={`text-sm font-bold ${item.isDanger ? 'text-[#ff0055]' : 'text-white'}`}>{item.title}</h3>
                    <p className="text-xs font-medium text-zinc-500">{item.desc}</p>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#52525b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="group-hover:stroke-white transition-colors"><polyline points="9 18 15 12 9 6" /></svg>
                </div>
              ))}
            </div>
            
          </>
        )}

        {settingsMode === 'seed_input' && (
          <div className="flex flex-col gap-6 animate-fade-in mt-4">
            <div className="text-center">
              <div className="w-16 h-16 bg-[#111111] rounded-[20px] border border-[#ff0055]/30 mx-auto flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(255,0,85,0.1)]">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ff0055" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
              </div>
              <p className="text-sm text-zinc-400 font-medium">Enter your password to reveal your secret recovery phrase. Never share this phrase with anyone.</p>
            </div>
            <div className="flex flex-col gap-3">
              <input
                type="password"
                placeholder="Enter password"
                value={revealPassword}
                onChange={(e) => setRevealPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRevealSeed(); }}
                disabled={isRevealing}
                className="input-field bg-[#111111] text-center tracking-widest text-lg border-white/5"
              />
              {revealError && <p className="text-xs font-bold text-center text-[#ff0055]">{revealError}</p>}
              <button onClick={handleRevealSeed} disabled={isRevealing || !revealPassword} className="btn-primary mt-2">
                {isRevealing ? 'Verifying...' : 'Reveal Phrase'}
              </button>
            </div>
          </div>
        )}

        {settingsMode === 'seed_revealed' && (
          <div className="flex flex-col gap-6 animate-fade-in mt-2">
            <div className="p-4 bg-[#ff0055]/10 border border-[#ff0055]/30 rounded-2xl">
              <p className="text-xs font-bold text-[#ff0055] text-center">WARNING: Anyone with this phrase can steal your assets. Do not screenshot.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {revealedSeed.split(' ').map((word, idx) => (
                <div key={idx} className="flex items-center bg-[#111111] border border-white/10 rounded-xl px-3 py-2.5 shadow-lg">
                  <span className="text-[10px] font-black text-zinc-600 w-5">{idx + 1}</span>
                  <span className="text-sm font-bold text-white tracking-wide">{word}</span>
                </div>
              ))}
            </div>
            <button 
              onClick={() => {
                navigator.clipboard.writeText(revealedSeed);
                setSettingsMode('idle');
              }} 
              className="btn-primary mt-4"
            >
              Copy to Clipboard
            </button>
          </div>
        )}

        {settingsMode === 'networks' && (
          <div className="flex flex-col gap-6 animate-fade-in mt-4">
            <div className="bg-[#111111] border border-white/5 p-4 rounded-3xl">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="text-white font-bold text-sm">Testnet Mode</h3>
                  <p className="text-zinc-500 text-xs font-medium mt-0.5">Connect to Sepolia, Devnet, and Testnet</p>
                </div>
                {/* Toggle Switch */}
                <div 
                  className={`w-12 h-6 rounded-full p-1 cursor-pointer transition-colors duration-300 ease-in-out flex items-center ${isTestnet ? 'bg-[#00f0ff]' : 'bg-[#27272a]'}`}
                  onClick={() => setIsTestnet(!isTestnet)}
                >
                  <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform duration-300 ease-in-out ${isTestnet ? 'translate-x-6' : 'translate-x-0'}`} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ---- Manage Accounts Views ---- */}

        {settingsMode === 'manage_accounts' && (
          <div className="flex flex-col gap-3 animate-fade-in mt-4">
            {allAccounts.map((acc, idx) => (
              <div 
                key={idx} 
                className="flex items-center gap-4 bg-[#111111] border border-white/5 p-4 rounded-2xl haptic-btn group"
                onClick={() => {
                  setSelectedManageAccountIndex(idx);
                  setSettingsMode('account_details');
                }}
              >
                <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center border border-white/10 group-hover:border-[#00f0ff] transition-colors">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-bold text-white">{acc.name}</h3>
                  <p className="text-xs font-medium text-zinc-500">{acc.chains.length} chains active</p>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#52525b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="group-hover:stroke-white transition-colors"><polyline points="9 18 15 12 9 6" /></svg>
              </div>
            ))}
          </div>
        )}

        {settingsMode === 'account_details' && selectedManageAccountIndex !== null && (
          <div className="flex flex-col gap-4 animate-fade-in mt-2">
            {/* Account Identity Header */}
            <div className="flex items-center gap-4 mb-2">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#00f0ff] to-[#bd00ff] p-[2px] shadow-[0_0_20px_rgba(0,240,255,0.15)]">
                <div className="w-full h-full bg-[#0a0a0a] rounded-full flex items-center justify-center">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                </div>
              </div>
              <div>
                <h3 className="text-lg font-black text-white">{allAccounts[selectedManageAccountIndex].name}</h3>
                <p className="text-xs font-medium text-zinc-500">{allAccounts[selectedManageAccountIndex].chains.length} chains · Index {selectedManageAccountIndex}</p>
              </div>
            </div>

            {/* Chain Cards */}
            {allAccounts[selectedManageAccountIndex].chains.map(chain => {
              const chainColor = chain.chain === 'EVM' ? '#627eea' : chain.chain === 'Solana' ? '#14F195' : '#f7931a';
              return (
              <div key={chain.chain} className="flex flex-col gap-3 bg-[#111111] border border-white/5 p-4 rounded-2xl relative overflow-hidden">
                {/* Subtle chain glow */}
                <div className="absolute top-0 right-0 w-24 h-24 rounded-full blur-[40px] opacity-[0.06] pointer-events-none" style={{ background: chainColor }} />
                
                <div className="flex items-center gap-2.5">
                  {chain.chain === 'EVM' && (
                    <div className="w-7 h-7 rounded-full bg-[#627eea] flex items-center justify-center shadow-lg border border-white/10">
                      <svg width="10" height="10" viewBox="0 0 320 512" fill="#fff"><path d="M311.9 260.8L160 353.6 8 260.8 160 0l151.9 260.8zM160 383.4L8 290.6 160 512l152-221.4-152 92.8z"/></svg>
                    </div>
                  )}
                  {chain.chain === 'Solana' && (
                    <div className="w-7 h-7 rounded-full bg-black flex items-center justify-center shadow-lg border border-[#14F195]/30">
                      <svg width="12" height="12" viewBox="0 0 397 311" fill="url(#solana-grad-2)"><path d="M64.6 237.9c2.4-2.4 5.7-3.8 9.2-3.8h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1l62.7-62.7zM64.6 3.8C67.1 1.4 70.4 0 73.8 0h317.4c5.8 0 8.7 7 4.6 11.1l-62.7 62.7c-2.4 2.4-5.7 3.8-9.2 3.8H6.5c-5.8 0-8.7-7-4.6-11.1L64.6 3.8zM333.1 120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8 0-8.7 7-4.6 11.1l62.7 62.7c2.4 2.4 5.7 3.8 9.2 3.8h317.4c5.8 0 8.7-7 4.6-11.1l-62.7-62.7z"/></svg>
                    </div>
                  )}
                  {chain.chain === 'Bitcoin' && (
                    <div className="w-7 h-7 rounded-full bg-[#f7931a] flex items-center justify-center shadow-lg border border-white/10">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="#fff"><path d="M14.653 10.686c1.171-.341 1.996-1.045 2.128-2.656.16-1.954-1.127-2.92-3.327-3.237l.745-2.991-1.815-.452-.724 2.905c-.477-.119-.968-.232-1.464-.343l.732-2.936-1.814-.452-.746 2.994c-.396-.089-.785-.181-1.164-.282l-2.493-.621-.48 1.926s1.341.306 1.314.327c.732.182.865.666.843 1.049l-1.688 6.772c-.092.219-.344.545-.855.419.023.03-1.316-.328-1.316-.328l-.902 2.083 2.355.587c.435.108.865.223 1.291.332l-.75 3.013 1.815.452.744-2.986c.493.131.975.253 1.448.369l-.736 2.955 1.814.452.753-3.023c2.721.516 4.776.31 5.631-2.155.688-1.986-.019-3.13-1.503-3.878zM11.603 6.953c1.554.388 2.658.625 2.454 1.443-.203.815-1.428.614-2.982.227l.528-1.67zm1.189 7.747c-1.745-.436-3.05-.662-2.825-1.564.225-.902 1.623-.637 3.368-.201.597.149 1.139.317 1.488.586.643.493.58 1.408-.035 1.656-.475.191-1.189.163-1.996-.477z"/></svg>
                    </div>
                  )}
                  <span className="text-xs font-black uppercase tracking-widest" style={{ color: chainColor }}>{chain.chain}</span>
                </div>

                {/* Public Key */}
                <div className="flex items-start gap-2">
                  <div className="flex-1 bg-black/50 p-3 rounded-xl border border-white/5">
                    <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider mb-1.5">Public Address</p>
                    <p className="text-[12px] font-mono text-zinc-200 leading-relaxed break-all select-all">{chain.address}</p>
                  </div>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      navigator.clipboard.writeText(chain.address);
                      setCopiedAddress(chain.address);
                      setTimeout(() => setCopiedAddress(null), 2000);
                    }}
                    className="mt-6 p-2.5 bg-black/50 rounded-xl border border-white/5 hover:bg-white/10 transition-all hover:scale-105 active:scale-95 flex-shrink-0"
                    title="Copy Address"
                  >
                    {copiedAddress === chain.address ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00ff66" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="animate-fade-in"><polyline points="20 6 9 17 4 12" /></svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                    )}
                  </button>
                </div>

                {/* Reveal Key Button */}
                <div className="flex justify-end">
                  <button 
                    onClick={() => {
                      setSelectedManageChain(chain);
                      setSettingsMode('key_input');
                    }}
                    className="flex items-center gap-1.5 text-[11px] font-bold text-zinc-500 hover:text-[#ff0055] transition-all py-1.5 px-3 rounded-full hover:bg-[#ff0055]/10 border border-white/5 hover:border-[#ff0055]/20"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                    Reveal Private Key
                  </button>
                </div>
              </div>
              );
            })}

            {/* Delete Account Button */}
            {accountCount > 1 && (
              <button
                onClick={() => setSettingsMode('delete_confirm')}
                className="mt-4 flex items-center justify-center gap-2 w-full py-3.5 bg-[#ff0055]/10 border border-[#ff0055]/20 rounded-2xl text-[#ff0055] text-sm font-bold hover:bg-[#ff0055]/20 transition-all active:scale-[0.98]"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                Delete Account
              </button>
            )}
          </div>
        )}

        {/* ---- Delete Confirmation ---- */}
        {settingsMode === 'delete_confirm' && selectedManageAccountIndex !== null && (
          <div className="flex flex-col gap-6 animate-fade-in mt-4">
            <div className="text-center">
              <div className="w-16 h-16 bg-[#111111] rounded-[20px] border border-[#ff0055]/30 mx-auto flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(255,0,85,0.15)]">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ff0055" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
              </div>
              <h3 className="text-lg font-black text-white mb-2">Delete {allAccounts[selectedManageAccountIndex].name}?</h3>
              <p className="text-sm text-zinc-400 font-medium leading-relaxed">This will remove the account from your wallet. You can always re-derive it later using the same seed phrase and account index.</p>
            </div>
            <div className="p-4 bg-[#ff0055]/10 border border-[#ff0055]/30 rounded-2xl">
              <p className="text-xs font-bold text-[#ff0055] text-center">⚠️ Make sure you have backed up any private keys before proceeding. This action cannot be undone.</p>
            </div>
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => setSettingsMode('delete_password')}
                className="w-full py-3.5 bg-[#ff0055] text-white font-bold rounded-2xl hover:bg-[#ff0055]/90 transition-all active:scale-[0.98]"
              >
                Continue
              </button>
              <button 
                onClick={() => setSettingsMode('account_details')}
                className="w-full py-3.5 bg-white/5 text-zinc-400 font-bold rounded-2xl hover:bg-white/10 border border-white/10 transition-all active:scale-[0.98]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ---- Delete Password ---- */}
        {settingsMode === 'delete_password' && selectedManageAccountIndex !== null && (
          <div className="flex flex-col gap-6 animate-fade-in mt-4">
            <div className="text-center">
              <div className="w-16 h-16 bg-[#111111] rounded-[20px] border border-[#ff0055]/30 mx-auto flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(255,0,85,0.1)]">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ff0055" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              </div>
              <p className="text-sm text-zinc-400 font-medium">Enter your password to confirm deletion of <span className="font-bold text-white">{allAccounts[selectedManageAccountIndex].name}</span>.</p>
            </div>
            <div className="flex flex-col gap-3">
              <input
                type="password"
                placeholder="Enter password"
                value={revealPassword}
                onChange={(e) => setRevealPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && revealPassword) {
                    setIsRevealing(true);
                    setRevealError('');
                    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                      chrome.runtime.sendMessage(
                        { type: 'VAULT_UNLOCK', payload: { password: revealPassword, vaultId: selectedVaultId } },
                        (response: any) => {
                          setIsRevealing(false);
                          if (response?.success) {
                            // Delete the account
                            if (activeAccountIndex >= accountCount - 1) setActiveAccountIndex(Math.max(0, accountCount - 2));
                            setAccountCount(prev => Math.max(1, prev - 1));
                            setRevealPassword('');
                            setSettingsMode('manage_accounts');
                            setSelectedManageAccountIndex(null);
                          } else {
                            setRevealError('Incorrect password');
                          }
                        }
                      );
                    }
                  }
                }}
                disabled={isRevealing}
                className="input-field bg-[#111111] text-center tracking-widest text-lg border-white/5"
              />
              {revealError && <p className="text-xs font-bold text-center text-[#ff0055]">{revealError}</p>}
              <button 
                onClick={() => {
                  if (!revealPassword) return;
                  setIsRevealing(true);
                  setRevealError('');
                  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                    chrome.runtime.sendMessage(
                      { type: 'VAULT_UNLOCK', payload: { password: revealPassword, vaultId: selectedVaultId } },
                      (response: any) => {
                        setIsRevealing(false);
                        if (response?.success) {
                          if (activeAccountIndex >= accountCount - 1) setActiveAccountIndex(Math.max(0, accountCount - 2));
                          setAccountCount(prev => Math.max(1, prev - 1));
                          setRevealPassword('');
                          setSettingsMode('manage_accounts');
                          setSelectedManageAccountIndex(null);
                        } else {
                          setRevealError('Incorrect password');
                        }
                      }
                    );
                  }
                }}
                disabled={isRevealing || !revealPassword} 
                className="w-full py-3.5 bg-[#ff0055] text-white font-bold rounded-2xl hover:bg-[#ff0055]/90 transition-all active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none"
              >
                {isRevealing ? 'Verifying...' : 'Delete Account'}
              </button>
            </div>
          </div>
        )}

        {settingsMode === 'key_input' && selectedManageChain && (
          <div className="flex flex-col gap-6 animate-fade-in mt-4">
            <div className="text-center">
              <div className="w-16 h-16 bg-[#111111] rounded-[20px] border border-[#ff0055]/30 mx-auto flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(255,0,85,0.1)]">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ff0055" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" /></svg>
              </div>
              <p className="text-sm text-zinc-400 font-medium">Enter your password to reveal the <span className="font-bold text-white">{selectedManageChain.chain}</span> private key. Never share this with anyone.</p>
            </div>
            <div className="flex flex-col gap-3">
              <input
                type="password"
                placeholder="Enter password"
                value={revealPassword}
                onChange={(e) => setRevealPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRevealPrivateKey(); }}
                disabled={isRevealing}
                className="input-field bg-[#111111] text-center tracking-widest text-lg border-white/5"
              />
              {revealError && <p className="text-xs font-bold text-center text-[#ff0055]">{revealError}</p>}
              <button onClick={handleRevealPrivateKey} disabled={isRevealing || !revealPassword} className="btn-primary mt-2">
                {isRevealing ? 'Verifying...' : 'Reveal Key'}
              </button>
            </div>
          </div>
        )}

        {settingsMode === 'key_revealed' && selectedManageChain && (
          <div className="flex flex-col gap-6 animate-fade-in mt-2">
            <div className="p-4 bg-[#ff0055]/10 border border-[#ff0055]/30 rounded-2xl">
              <p className="text-xs font-bold text-[#ff0055] text-center">WARNING: Anyone with this private key can steal your {selectedManageChain.chain} assets. Do not share it.</p>
            </div>
            <div className="p-4 bg-[#111111] border border-[#ff0055]/20 rounded-xl relative group">
              <p className="text-sm font-mono text-white break-all text-center selection:bg-[#ff0055]/30">{revealedPrivateKey}</p>
            </div>
            <button 
              onClick={() => {
                navigator.clipboard.writeText(revealedPrivateKey);
                setSettingsMode('account_details');
                setRevealedPrivateKey('');
              }} 
              className="btn-primary mt-4"
            >
              Copy and Close
            </button>
          </div>
        )}
        </div>
      </div>

      {/* ---- Token Page ---- */}
      {activeTokenPage && (
        <TokenPage 
          account={activeTokenPage}
          onClose={() => setActiveTokenPage(null)}
          onSend={(asset) => {
            setSendAsset(asset);
            setIsSendOpen(true);
            setActiveTokenPage(null);
          }}
          onReceive={() => {
            setReceiveInitialAccount(activeTokenPage);
            setIsReceiveOpen(true);
          }}
          balance={activeTokenPage.chain === 'EVM' ? balances.eth : activeTokenPage.chain === 'Solana' ? balances.sol : balances.btc}
          price={activeTokenPage.chain === 'EVM' ? prices.eth : activeTokenPage.chain === 'Solana' ? prices.sol : prices.btc}
          change={activeTokenPage.chain === 'EVM' ? changes.eth : activeTokenPage.chain === 'Solana' ? changes.sol : changes.btc}
        />
      )}

      {/* ---- Receive Modal ---- */}
      <ReceiveModal
        isOpen={isReceiveOpen}
        onClose={() => setIsReceiveOpen(false)}
        accounts={accounts}
        initialAccount={receiveInitialAccount}
        balances={balances}
        prices={prices}
        changes={changes}
      />

      {/* ---- Swap Modal ---- */}
      <SwapModal
        isOpen={isSwapOpen}
        onClose={() => setIsSwapOpen(false)}
        evmAccount={accounts.find(a => a.chain === 'EVM') || null}
        ethBalance={balances.eth}
      />
      </div>
    </div>
  );
}

// ---- State Screens ----------------------------------------------------------

function LoadingScreen() {
  return (
    <div className="w-[360px] h-[600px] flex items-center justify-center bg-black relative overflow-hidden">
      <div className="flex flex-col items-center gap-6 z-10 animate-fade-in">
        <div className="relative w-16 h-16">
          <div className="absolute inset-0 rounded-full border-2 border-white/5" />
          <div className="absolute inset-0 rounded-full border-t-2 border-[#00f0ff] animate-spin" />
          <div className="absolute inset-0 rounded-full border-r-2 border-[#bd00ff] animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
        </div>
        <p className="text-zinc-400 text-xs font-bold tracking-[0.2em] uppercase">Booting Core</p>
      </div>
    </div>
  );
}

function UninitializedScreen() {
  function handleOpenSetup() {
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url: 'http://localhost:5173' });
    } else {
      window.open('http://localhost:5173', '_blank');
    }
  }

  return (
    <div className="w-[360px] h-[600px] flex flex-col items-center justify-center px-8 bg-black relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-[20%] left-1/2 -translate-x-1/2 w-64 h-64 bg-[#00f0ff] opacity-[0.05] rounded-full blur-[80px]" />

      <div className="flex flex-col items-center gap-8 text-center z-10 animate-slide-up">
        <div className="relative w-20 h-20 bg-[#111111] rounded-[24px] border border-white/5 flex items-center justify-center shadow-2xl">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
        </div>

        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-black text-white tracking-tight">Celestial</h1>
          <p className="text-sm text-zinc-400 leading-relaxed font-medium">
            Vault uninitialized. Please set up your wallet via the web portal.
          </p>
        </div>

        <button onClick={handleOpenSetup} className="btn-primary w-full">
          Open Setup Portal
        </button>
      </div>
    </div>
  );
}

function LockedScreen({
  vaults,
  selectedVaultId,
  onSelectVault,
  password,
  setPassword,
  error,
  loading,
  shaking,
  inputRef,
  onUnlock,
}: {
  vaults: VaultInfo[];
  selectedVaultId: string;
  onSelectVault: (id: string) => void;
  password: string;
  setPassword: (v: string) => void;
  error: string;
  loading: boolean;
  shaking: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onUnlock: () => void;
}) {
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [inputRef]);

  // Reactive animation math based on password length
  const ringRotation = password.length * 20;
  const glowOpacity = Math.min(0.05 + (password.length * 0.08), 0.6);
  const ringScale = 1 + (password.length * 0.05);
  const isTyping = password.length > 0;

  return (
    <div className="w-[360px] h-[600px] flex flex-col items-center justify-center bg-[#000000] relative overflow-hidden">
      {/* Ambient glowing core that pulses and grows as you type */}
      <div 
        className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full blur-[80px] transition-all duration-300 ease-out pointer-events-none"
        style={{ 
          background: isTyping ? `rgba(0, 240, 255, ${glowOpacity})` : 'rgba(189, 0, 255, 0.05)',
          transform: `translate(-50%, -50%) scale(${ringScale})` 
        }}
      />

      <div className="flex-1 flex flex-col items-center justify-center px-8 w-full z-10 animate-fade-in relative mt-12">
        
        {/* Interactive Celestial Rings */}
        <div className="relative w-28 h-28 mb-8 flex-shrink-0">
          {/* Outer Cyan Ring */}
          <div 
            className="absolute inset-0 rounded-full border-[2px] border-white/5 border-t-[#00f0ff] transition-transform duration-300 ease-out"
            style={{ transform: `rotate(${ringRotation}deg)` }}
          />
          {/* Inner Purple Ring */}
          <div 
            className="absolute inset-3 rounded-full border-[2px] border-white/5 border-b-[#bd00ff] transition-transform duration-300 ease-out"
            style={{ transform: `rotate(${-ringRotation * 1.5}deg)` }}
          />
          {/* Center Hub */}
          <div className="absolute inset-6 rounded-full bg-[#0a0a0a] flex items-center justify-center border border-white/10 shadow-[0_0_40px_rgba(0,0,0,0.8)] z-10 transition-colors duration-300">
            {isTyping ? (
              // Unlocked Icon (Neon Cyan)
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00f0ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-fade-in drop-shadow-[0_0_8px_rgba(0,240,255,0.5)]">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 9.9-1" />
              </svg>
            ) : (
              // Locked Icon (White)
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-fade-in">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            )}
          </div>
        </div>

        <div className="flex flex-col items-center mb-8 w-full">
          <h2 className="text-[1.75rem] font-black text-white tracking-tight">Welcome Back</h2>
          
          {/* Wallet Selector Dropdown */}
          <div className="mt-3 relative w-full max-w-[200px]">
            <select
              value={selectedVaultId}
              onChange={(e) => onSelectVault(e.target.value)}
              className="appearance-none w-full bg-[#111111] border border-white/10 text-white text-sm font-bold rounded-xl px-4 py-2 text-center shadow-[0_4px_20px_rgba(0,0,0,0.5)] cursor-pointer hover:bg-[#18181b] hover:border-white/20 transition-all outline-none"
            >
              {vaults.map((vault) => (
                <option key={vault.id} value={vault.id} className="bg-[#111111]">
                  {vault.name}
                </option>
              ))}
            </select>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
            </div>
          </div>
        </div>

        <div className={`w-full flex flex-col gap-4 ${shaking ? 'shake' : ''}`}>
          <input
            ref={inputRef}
            type="password"
            placeholder="Enter password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onUnlock(); }}
            disabled={loading}
            className="input-field bg-[#0a0a0a] text-center tracking-widest text-lg"
          />

          {error && (
            <p className="text-xs font-bold text-center text-[#ff0055] animate-fade-in">
              {error}
            </p>
          )}

          <button
            onClick={onUnlock}
            disabled={loading || !password}
            className="btn-primary mt-2"
          >
            {loading ? 'Decrypting...' : 'Unlock Vault'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Shared Icons -----------------------------------------------------------

function NavItem({ icon, active = false, onClick, iconClass = '' }: { icon: string; active?: boolean; onClick?: () => void; iconClass?: string }) {
  const p = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: active ? 2.5 : 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, className: iconClass };
  return (
    <button onClick={onClick} className={`haptic-btn w-12 h-12 rounded-full flex items-center justify-center transition-colors ${active ? 'bg-white text-black' : 'text-zinc-500 hover:text-white'}`}>
      {icon === 'home' && <svg {...p}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z" /><path d="M9 22V12h6v10" /></svg>}
      {icon === 'swap' && <svg {...p}><path d="M7 4v14M7 18l-3-3M7 18l3-3M17 20V6M17 6l-3 3M17 6l3 3" /></svg>}
      {icon === 'clock' && (
        <svg {...p}>
          <circle cx="12" cy="12" r="10" />
          <g className="transition-transform duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)] origin-center" style={{ transform: active ? 'rotate(360deg)' : 'rotate(0deg)' }}>
            <path d="M12 6v6l4 2" />
          </g>
        </svg>
      )}
      {icon === 'settings' && <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>}
    </button>
  );
}