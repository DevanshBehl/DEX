/// <reference types="chrome" />
import { useState, useEffect, useRef, useCallback } from 'react';
import './index.css';

// ---- Types ------------------------------------------------------------------

type WalletState = 'loading' | 'uninitialized' | 'locked' | 'unlocked';
type Mode = 'DEX' | 'CEX';

interface MockToken {
  symbol: string;
  name: string;
  balance: string;
  usdValue: string;
  change: string;
  positive: boolean;
  color: string;
}

const MOCK_TOKENS: MockToken[] = [];

const MOCK_ADDRESS = '0x0000...0000';

// ---- App Component ----------------------------------------------------------

export default function App() {
  const [walletState, setWalletState] = useState<WalletState>('loading');
  const [mode, setMode] = useState<Mode>('DEX');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ---- Dynamic Width --------------------------------------------------------

  useEffect(() => {
    document.body.style.width = mode === 'DEX' ? '360px' : '800px';
  }, [mode]);

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

    // Listen for storage changes (vault init from landing page)
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
      await navigator.clipboard.writeText('0x0000000000000000000000000000000000000000');
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

  // ---- Unlocked: Dashboard --------------------------------------------------

  return (
    <div className="flex flex-col h-full relative overflow-hidden">
      {/* Background ambient */}
      <div
        className="absolute -top-16 -left-10 w-48 h-48 rounded-full pointer-events-none opacity-50"
        style={{ background: 'radial-gradient(circle, rgba(187,134,252,0.1) 0%, transparent 70%)' }}
      />
      <div
        className="absolute -bottom-10 -right-8 w-56 h-56 rounded-full pointer-events-none opacity-40"
        style={{ background: 'radial-gradient(circle, rgba(55,0,179,0.08) 0%, transparent 70%)' }}
      />

      {/* ---- Header ---- */}
      <header className="flex items-center justify-between px-4 py-3 glass-panel border-b-0 z-10 flex-shrink-0">
        <div className="flex items-center gap-2">
          <MoonIcon size={18} />
          <span className="celestial-title text-lg text-star">Celestial</span>
        </div>

        <div className="flex items-center gap-2">
          {/* DEX/CEX Toggle */}
          <div className="flex gap-0.5 p-0.5 bg-white/5 rounded-lg border border-white/5">
            {(['DEX', 'CEX'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all duration-300 ${
                  mode === m
                    ? 'bg-accent text-black shadow-md'
                    : 'bg-transparent text-star-dim hover:text-star-muted'
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          {/* Lock Button */}
          <button
            onClick={handleLock}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-star-dim hover:text-star hover:bg-white/5 transition-all"
            title="Lock wallet"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </button>
        </div>
      </header>

      {/* ---- Balance Section ---- */}
      <div className="flex-shrink-0 px-5 py-5 flex flex-col items-center gap-3 z-10">
        {/* Address Chip */}
        <button
          onClick={handleCopyAddress}
          className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/6 text-xs text-star-muted hover:bg-white/8 transition-all"
        >
          <div className="w-3 h-3 rounded-full bg-gradient-to-br from-accent to-accent-dark" />
          <span className="font-mono">{MOCK_ADDRESS}</span>
          {copied ? (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
          )}
        </button>

        {/* Balance */}
        <div className="text-center">
          <p className="text-3xl font-bold tracking-tight text-star">$0.00</p>
          <p className="text-xs text-star-dim font-medium mt-1">
            --
          </p>
        </div>

        {/* Quick Actions */}
        <div className="flex gap-4 mt-1">
          {[
            { label: 'Send', icon: 'send' },
            { label: 'Receive', icon: 'receive' },
            { label: 'Swap', icon: 'swap' },
            { label: 'Buy', icon: 'buy' },
          ].map((action) => (
            <button key={action.label} className="quick-action">
              <div className="icon-circle">
                <QuickActionIcon icon={action.icon} />
              </div>
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ---- Token List ---- */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 z-10 scrollbar-hide min-h-0">
        <div className="flex items-center justify-between px-2 mb-2">
          <span className="text-xs font-semibold text-star-muted uppercase tracking-wider">Tokens</span>
          <span className="text-xs text-star-dim">{MOCK_TOKENS.length} assets</span>
        </div>
        <div className="flex flex-col gap-0.5">
          {MOCK_TOKENS.map((token) => (
            <div key={token.symbol} className="token-row">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                style={{ background: token.color }}
              >
                {token.symbol.slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-star">{token.name}</span>
                  <span className="text-sm font-semibold text-star">{token.usdValue}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-star-dim">
                    {token.balance} {token.symbol}
                  </span>
                  <span
                    className="text-xs font-medium"
                    style={{ color: token.positive ? '#22c55e' : '#ef4444' }}
                  >
                    {token.change}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ---- Bottom Nav ---- */}
      <nav className="flex items-center justify-around px-6 py-2.5 z-10 flex-shrink-0 glass-panel border-t-0"
        style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        <NavItem icon="home" label="Home" active />
        <NavItem icon="swap" label="Swap" />
        <NavItem icon="clock" label="Activity" />
        <NavItem icon="search" label="Explore" />
      </nav>
    </div>
  );
}

// ---- State Screens ----------------------------------------------------------

function LoadingScreen() {
  return (
    <div className="w-[360px] h-[600px] flex items-center justify-center" style={{ background: '#0b0b0e' }}>
      <div className="flex flex-col items-center gap-4 fade-in-up">
        <div className="relative w-12 h-12">
          <div className="absolute inset-0 rounded-full border-2 border-white/10" />
          <div className="absolute inset-0 rounded-full border-t-2 border-accent animate-spin" />
        </div>
        <p className="text-star-muted text-sm font-medium tracking-wide">Loading Celestial…</p>
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
    <div className="w-[360px] h-[600px] flex flex-col items-center justify-center px-8 relative overflow-hidden" style={{ background: '#0b0b0e' }}>
      {/* Ambient orbs */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(187,134,252,0.08) 0%, transparent 70%)' }}
      />

      <div className="flex flex-col items-center gap-6 text-center z-10 fade-in-up">
        {/* Animated Logo */}
        <div className="relative">
          <div
            className="absolute inset-0 rounded-full animate-glow-pulse"
            style={{
              background: 'radial-gradient(circle, rgba(187,134,252,0.12) 0%, transparent 70%)',
              transform: 'scale(3)',
            }}
          />
          <div className="relative animate-float">
            <MoonIcon size={48} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="celestial-title text-3xl text-star">Celestial</h1>
          <p className="text-sm text-star-muted leading-relaxed max-w-[280px]">
            Welcome to Celestial. Please visit the official setup page to
            initialize or restore your account.
          </p>
        </div>

        <button onClick={handleOpenSetup} className="btn-primary w-full max-w-[240px]">
          Open Setup Page
        </button>

        <p className="text-[10px] text-star-dim">
          Non-custodial • AES-256-GCM encrypted
        </p>
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

  return (
    <div className="w-[360px] h-[600px] flex flex-col relative overflow-hidden" style={{ background: '#0b0b0e' }}>
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full animate-glow-pulse"
          style={{ background: 'radial-gradient(circle, rgba(187,134,252,0.06) 0%, transparent 70%)' }}
        />
      </div>

      {/* Header */}
      <header className="flex items-center justify-between px-5 pt-6 z-10">
        <div className="flex items-center gap-2">
          <MoonIcon size={18} />
          <span className="celestial-title text-lg text-star">Celestial</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-star-dim">
          <div className="w-1.5 h-1.5 rounded-full bg-success" style={{ boxShadow: '0 0 6px rgba(34,197,94,0.6)' }} />
          Ethereum
        </div>
      </header>

      {/* Center Card */}
      <div className="flex-1 flex items-center justify-center px-6 z-10">
        <div className={`glass-card p-6 w-full fade-in-up ${shaking ? 'shake' : ''}`}>
          {/* Top glow line */}
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent/30 to-transparent rounded-t-[1.25rem]" />

          <div className="flex flex-col items-center text-center gap-1 mb-5">
            <span className="text-[11px] font-medium tracking-[0.15em] uppercase text-star-dim">Welcome Back</span>
            <span className="text-xl font-bold text-star">Wallet 1</span>
          </div>

          <div className="flex flex-col gap-3">
            <input
              ref={inputRef}
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onUnlock(); }}
              disabled={loading}
              className="input-field"
            />

            {error && (
              <p className="text-xs text-center" style={{ color: '#ef4444' }}>
                {error}
              </p>
            )}

            <button
              onClick={onUnlock}
              disabled={loading || !password}
              className="btn-primary w-full"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  Unlocking…
                </span>
              ) : (
                'Unlock Wallet'
              )}
            </button>
          </div>

          <div className="mt-4 text-center">
            <button className="text-star-dim hover:text-star-muted text-[11px] font-medium transition-colors">
              Forgot password?
            </button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="flex items-center justify-center px-6 pb-5 z-10">
        <span className="text-[10px] text-star-dim tracking-wider">
          Powered by Celestial
        </span>
      </footer>
    </div>
  );
}

// ---- Shared Icons -----------------------------------------------------------

function MoonIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <defs>
        <linearGradient id="moonG" x1="4" y1="4" x2="24" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#e2d4f5" />
          <stop offset="100%" stopColor="#bb86fc" />
        </linearGradient>
      </defs>
      <path
        d="M16 2C9.373 2 4 7.373 4 14s5.373 12 12 12c3.05 0 5.86-1.14 7.99-3.01A14 14 0 0 1 16 26C8.268 26 2 19.732 2 12S8.268-2 16-2c3.418 0 6.568 1.226 9.01 3.26A11.95 11.95 0 0 0 16 2Z"
        fill="url(#moonG)"
        transform="translate(1, 2)"
      />
      <path
        d="M26 5l1 2.5L29.5 9 27 10l-1 2.5L25 10l-2.5-1L25 7.5Z"
        fill="#e2d4f5"
        opacity="0.8"
      />
      <circle cx="28.5" cy="14" r="1" fill="#bb86fc" opacity="0.5" />
    </svg>
  );
}

function QuickActionIcon({ icon }: { icon: string }) {
  const p = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (icon) {
    case 'send':
      return <svg {...p}><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>;
    case 'receive':
      return <svg {...p}><polyline points="7 13 12 18 17 13" /><line x1="12" y1="18" x2="12" y2="6" /><path d="M20 21H4" /></svg>;
    case 'swap':
      return <svg {...p}><path d="M7 4v14M7 18l-3-3M7 18l3-3M17 20V6M17 6l-3 3M17 6l3 3" /></svg>;
    case 'buy':
      return <svg {...p}><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>;
    default:
      return null;
  }
}

function NavItem({ icon, label, active = false }: { icon: string; label: string; active?: boolean }) {
  const p = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: active ? 2 : 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <button className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-all ${active ? 'text-white' : 'text-star-dim hover:text-star-muted'}`}>
      {icon === 'home' && <svg {...p} fill={active ? 'currentColor' : 'none'}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z" /><path d="M9 22V12h6v10" stroke={active ? '#0b0b0e' : 'currentColor'} /></svg>}
      {icon === 'swap' && <svg {...p}><path d="M7 4v14M7 18l-3-3M7 18l3-3M17 20V6M17 6l-3 3M17 6l3 3" /></svg>}
      {icon === 'clock' && <svg {...p}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>}
      {icon === 'search' && <svg {...p}><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>}
      <span className={`text-[10px] font-medium ${active ? 'text-white' : 'text-star-dim'}`}>{label}</span>
    </button>
  );
}