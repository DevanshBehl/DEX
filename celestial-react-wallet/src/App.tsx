/// <reference types="chrome" />
import { useState, useEffect, useRef, useCallback } from 'react';
import './index.css';

// ---- Types ------------------------------------------------------------------

type WalletState = 'loading' | 'uninitialized' | 'locked' | 'unlocked';

interface MockToken {
  symbol: string;
  name: string;
  balance: string;
  usdValue: string;
  change: string;
  positive: boolean;
  color: string;
  neon: string;
}

const MOCK_TOKENS: MockToken[] = [
  { symbol: 'ETH', name: 'Ethereum', balance: '1.45', usdValue: '$4,350.00', change: '+2.4%', positive: true, color: '#627eea', neon: 'rgba(98,126,234,0.4)' },
  { symbol: 'SOL', name: 'Solana', balance: '45.2', usdValue: '$6,420.00', change: '+5.1%', positive: true, color: '#14F195', neon: 'rgba(20,241,149,0.4)' },
  { symbol: 'USDC', name: 'USD Coin', balance: '1,240.00', usdValue: '$1,240.00', change: '0.0%', positive: true, color: '#2775ca', neon: 'rgba(39,117,202,0.4)' },
  { symbol: 'BTC', name: 'Bitcoin', balance: '0.045', usdValue: '$2,850.00', change: '-1.2%', positive: false, color: '#F7931A', neon: 'rgba(247,147,26,0.4)' },
];

const MOCK_ADDRESS = '0x1A4...9B2';

// ---- App Component ----------------------------------------------------------

export default function App() {
  const [walletState, setWalletState] = useState<WalletState>('loading');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSwapOpen, setIsSwapOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ---- Dynamic Width --------------------------------------------------------

  useEffect(() => {
    document.body.style.width = '360px'; // Set extension popup width
  }, []);

  // ---- Boot: Check vault state ----------------------------------------------

  const checkVaultState = useCallback(() => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(
        { type: 'VAULT_STATE_GET', payload: {} },
        (response: any) => {
          if (response?.success) {
            if (!response.hasVault) {
              setWalletState('uninitialized');
            } else if (!response.isUnlocked) {
              setWalletState('locked');
            } else {
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
  }, []);

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
          { type: 'VAULT_UNLOCK', payload: { password } },
          (response: any) => {
            setLoading(false);
            if (response?.success) {
              setWalletState('unlocked');
              setPassword('');
            } else {
              setError('Incorrect password');
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

  // ---- Copy Address ---------------------------------------------------------

  async function handleCopyAddress() {
    try {
      await navigator.clipboard.writeText('0x1A4F98c7D9bB2');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
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
      
      {/* Background Neon Bleed */}
      <div className="absolute top-[-100px] left-[-100px] w-64 h-64 bg-[#00f0ff] opacity-10 rounded-full blur-[80px] pointer-events-none" />
      <div className="absolute top-[-50px] right-[-50px] w-48 h-48 bg-[#bd00ff] opacity-10 rounded-full blur-[80px] pointer-events-none" />

      {/* ---- Header ---- */}
      <header className="flex items-center justify-between px-6 py-4 z-10 flex-shrink-0">
        <div className="flex items-center gap-3">
          {/* Avatar Pill */}
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#00f0ff] to-[#bd00ff] p-[2px]">
            <div className="w-full h-full bg-black rounded-full flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
            </div>
          </div>
          <button onClick={handleCopyAddress} className="flex items-center gap-1.5 hover:opacity-80 transition-opacity">
            <span className="font-semibold text-sm tracking-wide">{MOCK_ADDRESS}</span>
            {copied ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#00ff66" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            )}
          </button>
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
          <span className="text-[2.75rem] font-black tracking-tighter leading-none">$12,010</span>
          <span className="text-2xl font-bold text-zinc-400">.00</span>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00ff66" strokeWidth="3" strokeLinecap="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>
          <span className="text-sm font-bold text-[#00ff66]">+245.12 (2.4%)</span>
          <span className="text-xs font-semibold text-zinc-500 ml-1 bg-zinc-900 px-2 py-0.5 rounded-full">Today</span>
        </div>
      </div>

      {/* ---- Action Island ---- */}
      <div className="px-6 mb-8 z-10">
        <div className="flex items-center justify-between bg-[#0a0a0a] p-1.5 rounded-2xl border border-white/5 shadow-2xl">
          {[
            { label: 'Send', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg> },
            { label: 'Receive', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="7 13 12 18 17 13" /><line x1="12" y1="18" x2="12" y2="6" /><path d="M20 21H4" /></svg> },
            { label: 'Swap', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 4v14M7 18l-3-3M7 18l3-3M17 20V6M17 6l-3 3M17 6l3 3" /></svg> },
            { label: 'Buy', icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg> },
          ].map((action) => (
            <button key={action.label} className="haptic-btn flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl hover:bg-[#18181b] group">
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
          {MOCK_TOKENS.map((token) => (
            <div key={token.symbol} className="token-row group relative overflow-hidden shrink-0">
              {/* Subtle hover bleed */}
              <div className="absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity duration-300 pointer-events-none" style={{ background: `radial-gradient(circle at 10% 50%, ${token.color} 0%, transparent 80%)` }} />
              
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center text-sm font-black text-white flex-shrink-0 relative z-10 shadow-lg"
                style={{ background: token.color, boxShadow: `0 4px 20px ${token.neon}` }}
              >
                {token.symbol.slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0 relative z-10">
                <div className="flex items-center justify-between">
                  <span className="text-base font-bold text-white">{token.name}</span>
                  <span className="text-base font-bold text-white">{token.usdValue}</span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-xs font-medium text-zinc-400">
                    {token.balance} {token.symbol}
                  </span>
                  <span
                    className="text-xs font-bold"
                    style={{ color: token.positive ? '#00ff66' : '#ff0055' }}
                  >
                    {token.change}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ---- Floating Bottom Nav ---- */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30">
        <nav className="flex items-center gap-1 bg-[#18181b]/90 backdrop-blur-xl p-1.5 rounded-full border border-white/10 shadow-[0_10px_40px_rgba(0,0,0,0.8)]">
          <NavItem icon="home" active={!isSettingsOpen && !isSwapOpen} onClick={() => { setIsSettingsOpen(false); setIsSwapOpen(false); }} />
          <NavItem 
            icon="swap" 
            active={isSwapOpen} 
            onClick={() => { setIsSwapOpen(!isSwapOpen); setIsSettingsOpen(false); }} 
            iconClass={`transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${isSwapOpen ? 'rotate-[180deg]' : 'rotate-0'}`} 
          />
          <NavItem icon="clock" onClick={() => { setIsSettingsOpen(false); setIsSwapOpen(false); }} />
          <NavItem 
            icon="settings" 
            active={isSettingsOpen} 
            onClick={() => { setIsSettingsOpen(!isSettingsOpen); setIsSwapOpen(false); }} 
            iconClass={`transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${isSettingsOpen ? 'rotate-[180deg]' : 'rotate-0'}`} 
          />
        </nav>
      </div>

      {/* ---- Swap Sliding Panel ---- */}
      <div 
        className="absolute inset-0 bg-[#0a0a0a] z-20 flex flex-col pt-8 px-6 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
        style={{ transform: isSwapOpen ? 'translateY(0)' : 'translateY(100%)' }}
      >
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-black text-white">Swap Tokens</h2>
          <button onClick={() => setIsSwapOpen(false)} className="haptic-btn w-8 h-8 rounded-full bg-[#111111] border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="flex flex-col gap-2 relative">
          {/* From Token */}
          <div className="bg-[#111111] border border-white/5 p-4 rounded-3xl">
            <span className="text-xs font-bold text-zinc-500 mb-2 block">You pay</span>
            <div className="flex items-center justify-between">
              <input type="text" placeholder="0" className="bg-transparent text-4xl font-black text-white outline-none w-1/2" />
              <button className="haptic-btn flex items-center gap-2 bg-[#18181b] border border-white/10 px-3 py-1.5 rounded-full">
                <div className="w-5 h-5 rounded-full bg-[#627eea] flex items-center justify-center text-[8px] font-black">ET</div>
                <span className="font-bold">ETH</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="6 9 12 15 18 9" /></svg>
              </button>
            </div>
            <span className="text-xs font-medium text-zinc-500 mt-2 block">Balance: 1.45 ETH</span>
          </div>

          {/* Swap Arrow Button */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
            <button className="haptic-btn w-10 h-10 rounded-xl bg-[#00f0ff] text-black flex items-center justify-center shadow-[0_0_20px_rgba(0,240,255,0.3)]">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 4v14M7 18l-3-3M7 18l3-3M17 20V6M17 6l-3 3M17 6l3 3" /></svg>
            </button>
          </div>

          {/* To Token */}
          <div className="bg-[#111111] border border-white/5 p-4 rounded-3xl">
            <span className="text-xs font-bold text-zinc-500 mb-2 block">You receive</span>
            <div className="flex items-center justify-between">
              <input type="text" placeholder="0" className="bg-transparent text-4xl font-black text-zinc-500 outline-none w-1/2" readOnly />
              <button className="haptic-btn flex items-center gap-2 bg-[#18181b] border border-white/10 px-3 py-1.5 rounded-full">
                <div className="w-5 h-5 rounded-full bg-[#2775ca] flex items-center justify-center text-[8px] font-black">US</div>
                <span className="font-bold">USDC</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="6 9 12 15 18 9" /></svg>
              </button>
            </div>
            <span className="text-xs font-medium text-zinc-500 mt-2 block">Balance: 1,240.00 USDC</span>
          </div>
        </div>
        
        <div className="mt-auto mb-24">
          <button className="btn-primary">Review Swap</button>
        </div>
      </div>

      {/* ---- Settings Sliding Panel ---- */}
      <div 
        className="absolute inset-0 bg-[#0a0a0a] z-20 flex flex-col pt-8 px-6 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
        style={{ transform: isSettingsOpen ? 'translateY(0)' : 'translateY(100%)' }}
      >
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-black text-white">Settings</h2>
          <button onClick={() => setIsSettingsOpen(false)} className="haptic-btn w-8 h-8 rounded-full bg-[#111111] border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {[
            { title: 'General', desc: 'Currency, Language, Theme', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> },
            { title: 'Security & Privacy', desc: 'Recovery Phrase, Auto-Lock', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg> },
            { title: 'Networks', desc: 'Ethereum, Solana, Polygon', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg> },
            { title: 'Address Book', desc: 'Saved Contacts', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg> },
            { title: 'Support', desc: 'Help Center, Contact Us', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg> }
          ].map((item) => (
            <div key={item.title} className="flex items-center gap-4 bg-[#111111] border border-white/5 p-4 rounded-2xl haptic-btn group">
              <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center border border-white/10 group-hover:border-[#00f0ff] transition-colors">
                {item.icon}
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-bold text-white">{item.title}</h3>
                <p className="text-xs font-medium text-zinc-500">{item.desc}</p>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#52525b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="group-hover:stroke-white transition-colors"><polyline points="9 18 15 12 9 6" /></svg>
            </div>
          ))}
        </div>
        
        <div className="mt-auto mb-24 flex flex-col items-center gap-2">
          <span className="text-xs font-bold text-zinc-600 uppercase tracking-widest">Celestial v2.0.0</span>
          <button onClick={handleLock} className="text-xs font-bold text-[#ff0055] hover:text-white transition-colors">Lock Wallet</button>
        </div>
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
  password,
  setPassword,
  error,
  loading,
  shaking,
  inputRef,
  onUnlock,
}: {
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

        <div className="flex flex-col items-center mb-8">
          <h2 className="text-[1.75rem] font-black text-white tracking-tight">Welcome Back</h2>
          <p className="text-sm font-bold text-zinc-500 mt-1">Wallet 1</p>
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
      {icon === 'clock' && <svg {...p}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>}
      {icon === 'settings' && <svg {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>}
    </button>
  );
}