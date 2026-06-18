import { useState, useEffect, useReducer, useCallback } from 'react';
import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import './index.css';
import { onboardingPasswordSchema } from './lib/validation';
import { getPasswordStrength } from './lib/validation';
import { createVaultBlob } from './lib/crypto';
import PasswordStrength from './components/PasswordStrength';
import SeedPhraseGrid from './components/SeedPhraseGrid';

// ---- Global type for extension detection ------------------------------------

declare global {
  interface Window {
    celestial?: {
      isCelestial: boolean;
      version: string;
    };
  }
}

// ---- State ------------------------------------------------------------------

type Step = 'welcome' | 'set-password' | 'seed-phrase' | 'completion';

interface WizardState {
  step: Step;
  password: string;
  confirmPassword: string;
  mnemonic: string;
  acknowledged: boolean;
  isHovering: boolean;
  copied: boolean;
  extensionDetected: boolean;
  loading: boolean;
  error: string;
  showPassword: boolean;
  showConfirmPassword: boolean;
}

type WizardAction =
  | { type: 'SET_STEP'; step: Step }
  | { type: 'SET_PASSWORD'; value: string }
  | { type: 'SET_CONFIRM_PASSWORD'; value: string }
  | { type: 'SET_MNEMONIC'; value: string }
  | { type: 'SET_ACKNOWLEDGED'; value: boolean }
  | { type: 'SET_HOVERING'; value: boolean }
  | { type: 'SET_COPIED'; value: boolean }
  | { type: 'SET_EXTENSION'; value: boolean }
  | { type: 'SET_LOADING'; value: boolean }
  | { type: 'SET_ERROR'; value: string }
  | { type: 'TOGGLE_SHOW_PASSWORD' }
  | { type: 'TOGGLE_SHOW_CONFIRM_PASSWORD' }
  | { type: 'RESET' };

const INITIAL_STATE: WizardState = {
  step: 'welcome',
  password: '',
  confirmPassword: '',
  mnemonic: '',
  acknowledged: false,
  isHovering: false,
  copied: false,
  extensionDetected: false,
  loading: false,
  error: '',
  showPassword: false,
  showConfirmPassword: false,
};

function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'SET_STEP':
      return { ...state, step: action.step, error: '' };
    case 'SET_PASSWORD':
      return { ...state, password: action.value, error: '' };
    case 'SET_CONFIRM_PASSWORD':
      return { ...state, confirmPassword: action.value, error: '' };
    case 'SET_MNEMONIC':
      return { ...state, mnemonic: action.value };
    case 'SET_ACKNOWLEDGED':
      return { ...state, acknowledged: action.value };
    case 'SET_HOVERING':
      return { ...state, isHovering: action.value };
    case 'SET_COPIED':
      return { ...state, copied: action.value };
    case 'SET_EXTENSION':
      return { ...state, extensionDetected: action.value };
    case 'SET_LOADING':
      return { ...state, loading: action.value };
    case 'SET_ERROR':
      return { ...state, error: action.value };
    case 'TOGGLE_SHOW_PASSWORD':
      return { ...state, showPassword: !state.showPassword };
    case 'TOGGLE_SHOW_CONFIRM_PASSWORD':
      return { ...state, showConfirmPassword: !state.showConfirmPassword };
    case 'RESET':
      return INITIAL_STATE;
    default:
      return state;
  }
}

// ---- Network Logos ----------------------------------------------------------

const NETWORK_LOGOS = [
  // 1. Solana (SOL) - Green/Purple
  <svg viewBox="0 0 400 400" fill="none" className="w-full h-full drop-shadow-xl">
    <defs>
      <linearGradient id="solGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#14F195" />
        <stop offset="100%" stopColor="#9945FF" />
      </linearGradient>
    </defs>
    <path d="M64 268l42-42h230l-42 42H64zm0-136l42-42h230l-42 42H64zm42 68l-42-42h230l42 42H106z" fill="url(#solGrad)" />
  </svg>,
  // 2. Bitcoin (BTC) - Orange
  <svg viewBox="0 0 24 24" fill="none" className="w-full h-full drop-shadow-xl">
    <circle cx="12" cy="12" r="11" fill="#F7931A" />
    <path fill="#FFF" d="M16.66 10.56c.22-1.46-1.14-2.25-2.85-2.84l.58-2.34-1.42-.35-.57 2.27c-.37-.09-.76-.18-1.14-.27l.58-2.3-1.43-.36-.58 2.33c-.3-.07-.6-.15-.89-.22L7.33 5.9l-.4 1.6s1.07.24 1.05.26c.58.15.69.53.67.83l-1.34 5.37c.05.01.12.03.2.06l-.21-.06-1.87 7.5c-.09.2-.33.32-.82.19.02.01-1.06-.26-1.06-.26l-1.12 1.7 2.05.51c.38.1.75.2 1.12.3l-.59 2.38 1.42.36.58-2.34c.39.1.76.19 1.14.28l-.58 2.34 1.43.35.6-2.39c2.37.45 4.14.27 4.9-1.92.6-1.76-.02-2.78-1.33-3.44.95-.22 1.66-.85 1.83-2.14zm-3.32 4.67c-1.01 4.07-7.85 1.96-10.07 1.4l1.8-7.22c2.22.55 9.3 2.14 8.27 5.82z" />
  </svg>,
  // 3. Ethereum (ETH) - Multi-color gradient
  <svg viewBox="0 0 256 417" fill="none" className="w-full h-full drop-shadow-xl">
    <defs>
      <linearGradient id="ethGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#8A2BE2" />
        <stop offset="50%" stopColor="#4169E1" />
        <stop offset="100%" stopColor="#FF1493" />
      </linearGradient>
    </defs>
    <path fill="url(#ethGrad)" d="M127.96 0l-127.96 212.32 127.96 75.64 127.96-75.64z" />
    <path fill="url(#ethGrad)" opacity="0.7" d="M127.96 312.3l-127.96-100 127.96 204.45 127.96-204.45z" />
  </svg>,
  // 4. Arbitrum (ARB) - Blue
  <svg viewBox="0 0 400 400" fill="none" className="w-full h-full drop-shadow-xl">
    <path d="M200 40L40 340h80l80-150 80 150h80L200 40z" fill="#28A0F0" />
    <circle cx="200" cy="270" r="40" fill="#28A0F0" />
  </svg>,
  // 5. Sui (SUI) - Teal
  <svg viewBox="0 0 400 400" fill="none" className="w-full h-full drop-shadow-xl">
    <path d="M200 20C100.59 20 20 100.59 20 200s80.59 180 180 180 180-80.59 180-180S299.41 20 200 20zm0 280c-55.23 0-100-44.77-100-100s44.77-100 100-100 100 44.77 100 100-44.77 100-100 100z" fill="#4CA2FF" />
    <path d="M200 120L150 200h100L200 120z" fill="#4CA2FF" />
  </svg>
];

// ---- App Component ----------------------------------------------------------

export default function App() {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const [stepClass, setStepClass] = useState('step-active');

  // ---- Extension Detection --------------------------------------------------

  useEffect(() => {
    if (window.celestial?.isCelestial) {
      dispatch({ type: 'SET_EXTENSION', value: true });
      return;
    }

    let attempts = 0;
    const check = setInterval(() => {
      attempts++;
      if (window.celestial?.isCelestial) {
        dispatch({ type: 'SET_EXTENSION', value: true });
        clearInterval(check);
      }
      if (attempts >= 15) clearInterval(check);
    }, 100);

    return () => clearInterval(check);
  }, []);

  // ---- Step Transition Animation --------------------------------------------

  const transitionTo = useCallback(
    (nextStep: Step) => {
      setStepClass('step-exit');
      setTimeout(() => {
        dispatch({ type: 'SET_STEP', step: nextStep });
        setStepClass('step-enter');
        requestAnimationFrame(() => {
          requestAnimationFrame(() => setStepClass('step-active'));
        });
      }, 300);
    },
    [],
  );

  // ---- Handlers -------------------------------------------------------------

  function handleCreateWallet() {
    const phrase = generateMnemonic(wordlist, 128);
    dispatch({ type: 'SET_MNEMONIC', value: phrase });
    transitionTo('set-password');
  }

  function handlePasswordContinue() {
    const result = onboardingPasswordSchema.safeParse({
      password: state.password,
      confirmPassword: state.confirmPassword,
      acknowledged: state.acknowledged,
    });

    if (!result.success) {
      const firstError = result.error.issues[0]?.message ?? 'Validation error';
      dispatch({ type: 'SET_ERROR', value: firstError });
      return;
    }

    transitionTo('seed-phrase');
  }

  async function handleCopyPhrase() {
    try {
      await navigator.clipboard.writeText(state.mnemonic);
      dispatch({ type: 'SET_COPIED', value: true });
      setTimeout(() => dispatch({ type: 'SET_COPIED', value: false }), 2500);
    } catch {
      dispatch({ type: 'SET_ERROR', value: 'Failed to copy to clipboard' });
    }
  }

  async function handleComplete() {
    dispatch({ type: 'SET_LOADING', value: true });
    dispatch({ type: 'SET_ERROR', value: '' });

    try {
      // Encrypt mnemonic into a vault blob
      const vault = await createVaultBlob(state.mnemonic, state.password);

      // Send to extension via postMessage → content script → background
      window.postMessage(
        {
          target: 'celestial-wallet',
          type: 'VAULT_INIT',
          payload: { vault },
        },
        '*',
      );

      // Wait for acknowledgement from extension
      const ack = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 5000);

        function handler(event: MessageEvent) {
          if (
            event.data?.target === 'celestial-page' &&
            event.data?.type === 'VAULT_INIT_ACK'
          ) {
            clearTimeout(timeout);
            window.removeEventListener('message', handler);
            resolve(event.data.success === true);
          }
        }
        window.addEventListener('message', handler);
      });

      if (ack) {
        transitionTo('completion');
      } else {
        dispatch({
          type: 'SET_ERROR',
          value:
            'Could not connect to the Celestial extension. Make sure it is installed and try again.',
        });
      }
    } catch (err) {
      dispatch({
        type: 'SET_ERROR',
        value: `Encryption failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
    } finally {
      dispatch({ type: 'SET_LOADING', value: false });
    }
  }

  // ---- Render ---------------------------------------------------------------

  const strength = getPasswordStrength(state.password);
  const canContinuePassword =
    strength === 4 &&
    state.password === state.confirmPassword &&
    state.acknowledged;

  return (
    <div className="relative min-h-screen bg-white text-neutral-900 overflow-hidden font-sans tracking-tight flex flex-col">
      {/* Navigation Bar */}
      <nav className="w-full px-8 py-6 flex items-center justify-between z-20 flex-shrink-0">
        <div className="text-xl md:text-2xl font-black tracking-tighter text-black">CELESTIAL</div>
        <div className="flex items-center gap-6">
          <button className="text-sm font-semibold text-neutral-500 hover:text-black transition-colors hidden sm:block">Docs</button>
          {/* Extension Badge */}
          <div className="flex items-center gap-2 text-[10px] sm:text-xs font-bold text-neutral-500 uppercase tracking-widest bg-neutral-100 px-3 py-1.5 rounded-full border border-black/5">
            <div
              className="w-2 h-2 rounded-full transition-colors duration-500"
              style={{ backgroundColor: state.extensionDetected ? '#10b981' : '#ef4444' }}
            />
            {state.extensionDetected ? 'Active' : 'Missing'}
          </div>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="relative z-10 w-full flex-1 flex flex-col items-center px-6 lg:px-24 pt-24 lg:pt-32 pb-24 text-center">
        
        {/* Content Container */}
        <div className="relative w-full flex flex-col items-center">
          
          {/* Semicircle of Logos (Behind Content) */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] pointer-events-none z-0 blur-[2px] opacity-80">
            {NETWORK_LOGOS.map((logo, i) => {
              // Create a top-facing semi-circle arching over the title (-180 to 0 degrees)
              const angles = [-170, -135, -90, -45, -10];
              const radiusX = 450;
              const radiusY = 250;
              const angleRad = angles[i] * (Math.PI / 180);
              const x = Math.cos(angleRad) * radiusX;
              const y = Math.sin(angleRad) * radiusY;
              
              return (
                <div 
                  key={i} 
                  className="absolute w-20 h-20 md:w-28 md:h-28 animate-float"
                  style={{ 
                    left: `calc(50% + ${x}px - 56px)`, 
                    top: `calc(40% + ${y}px - 56px)`, 
                    animationDelay: `${i * 0.8}s` 
                  }}
                >
                  {logo}
                </div>
              );
            })}
          </div>

          <div className="relative z-10 flex flex-col items-center w-full">
            {/* Hero Section */}
            <div className="mb-20 w-full max-w-4xl">
              <h1 className="text-[5rem] md:text-[8rem] font-black tracking-tighter leading-[1.05] mb-8 text-black">
                Meet CELESTIAL.
              </h1>
              <p className="text-xl md:text-2xl text-neutral-500 max-w-2xl mx-auto leading-relaxed font-medium">
                The next-generation non-custodial wallet. <br className="hidden md:block"/> Your keys. Your crypto. Your future.
              </p>
            </div>

            {/* Wizard / Onboarding Section */}
            <div className="w-full max-w-md">
              <div className={stepClass}>
                {state.step === 'welcome' && (
                  <WelcomeStep
                    extensionDetected={state.extensionDetected}
                    onCreateWallet={handleCreateWallet}
                  />
                )}

                {state.step === 'set-password' && (
                  <PasswordStep
                    state={state}
                    dispatch={dispatch}
                    canContinue={canContinuePassword}
                    onContinue={handlePasswordContinue}
                    onBack={() => transitionTo('welcome')}
                  />
                )}

                {state.step === 'seed-phrase' && (
                  <SeedPhraseStep
                    state={state}
                    dispatch={dispatch}
                    onCopy={handleCopyPhrase}
                    onComplete={handleComplete}
                    onBack={() => transitionTo('set-password')}
                  />
                )}

                {state.step === 'completion' && <CompletionStep />}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full py-8 px-8 border-t border-black/5 flex flex-col md:flex-row items-center justify-between z-20 bg-white">
        <div className="text-xs font-bold text-black tracking-widest mb-4 md:mb-0">CELESTIAL WALLET</div>
        <div className="flex items-center gap-6 text-xs text-neutral-400 font-medium">
          <a href="#" className="hover:text-black transition-colors">Terms of Service</a>
          <a href="#" className="hover:text-black transition-colors">Privacy Policy</a>
          <a href="#" className="hover:text-black transition-colors">GitHub</a>
        </div>
      </footer>
    </div>
  );
}

// ---- Step Components --------------------------------------------------------

function WelcomeStep({
  extensionDetected,
  onCreateWallet,
}: {
  extensionDetected: boolean;
  onCreateWallet: () => void;
}) {
  return (
    <div className="glass-card p-10 flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-neutral-500 font-medium">Initialize your secure local vault to continue.</p>
      </div>

      <div className="flex flex-col gap-3">
        <button
          onClick={onCreateWallet}
          disabled={!extensionDetected}
          className="btn-primary w-full py-4 text-base"
        >
          Create Wallet
        </button>
        <button className="btn-ghost w-full py-4 text-base">
          Read the Docs
        </button>
      </div>
    </div>
  );
}

function PasswordStep({
  state,
  dispatch,
  canContinue,
  onContinue,
  onBack,
}: {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  canContinue: boolean;
  onContinue: () => void;
  onBack: () => void;
}) {
  return (
    <div className="glass-card p-8 flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-1.5">
        <h2 className="text-2xl font-bold text-star">Set Your Password</h2>
        <p className="text-sm text-star-muted leading-relaxed">
          This password encrypts your wallet locally. You'll need it every time
          you open Celestial.
        </p>
      </div>

      {/* Password Field */}
      <div className="flex flex-col gap-1.5">
        <div className="relative">
          <input
            type={state.showPassword ? 'text' : 'password'}
            placeholder="New Password"
            value={state.password}
            onChange={(e) =>
              dispatch({ type: 'SET_PASSWORD', value: e.target.value })
            }
            className="input-field pr-12"
            autoFocus
          />
          <button
            type="button"
            onClick={() => dispatch({ type: 'TOGGLE_SHOW_PASSWORD' })}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-star-dim hover:text-star-muted transition-colors p-1"
          >
            {state.showPassword ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
            )}
          </button>
        </div>
        <PasswordStrength password={state.password} />
      </div>

      {/* Confirm Password */}
      <div className="relative">
        <input
          type={state.showConfirmPassword ? 'text' : 'password'}
          placeholder="Confirm Password"
          value={state.confirmPassword}
          onChange={(e) =>
            dispatch({ type: 'SET_CONFIRM_PASSWORD', value: e.target.value })
          }
          className="input-field pr-12"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canContinue) onContinue();
          }}
        />
        <button
          type="button"
          onClick={() => dispatch({ type: 'TOGGLE_SHOW_CONFIRM_PASSWORD' })}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-star-dim hover:text-star-muted transition-colors p-1"
        >
          {state.showConfirmPassword ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
          )}
        </button>
      </div>

      {state.confirmPassword && state.password !== state.confirmPassword && (
        <p className="text-xs" style={{ color: '#ef4444' }}>
          Passwords do not match
        </p>
      )}

      {/* Acknowledgement Checkbox */}
      <label className="flex items-start gap-3 cursor-pointer group">
        <input
          type="checkbox"
          checked={state.acknowledged}
          onChange={(e) =>
            dispatch({ type: 'SET_ACKNOWLEDGED', value: e.target.checked })
          }
          className="checkbox-custom mt-0.5"
        />
        <span className="text-xs text-star-muted leading-relaxed group-hover:text-star transition-colors">
          I understand that Celestial cannot recover this password or my wallet
          if lost. This is a fully non-custodial wallet.
        </span>
      </label>

      {/* Error */}
      {state.error && (
        <p
          className="text-xs px-3 py-2 rounded-lg"
          style={{
            color: '#ef4444',
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.15)',
          }}
        >
          {state.error}
        </p>
      )}

      {/* Buttons */}
      <div className="flex gap-3">
        <button onClick={onBack} className="btn-ghost flex-1">
          Back
        </button>
        <button
          onClick={onContinue}
          disabled={!canContinue}
          className="btn-primary flex-1"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}

function SeedPhraseStep({
  state,
  dispatch,
  onCopy,
  onComplete,
  onBack,
}: {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  onCopy: () => void;
  onComplete: () => void;
  onBack: () => void;
}) {
  const words = state.mnemonic.split(' ');

  return (
    <div className="glass-card p-8 flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col gap-1.5">
        <h2 className="text-2xl font-bold text-star">Your Recovery Phrase</h2>
        <p className="text-sm text-star-muted leading-relaxed">
          Write these 12 words in order and store them in a secure offline
          location. Anyone with this phrase controls your wallet.
        </p>
      </div>

      {/* Seed Phrase Grid */}
      <SeedPhraseGrid
        words={words}
        isHovering={state.isHovering}
        onHoverChange={(v) => dispatch({ type: 'SET_HOVERING', value: v })}
        onCopy={onCopy}
        copied={state.copied}
      />

      {/* Warning Card */}
      <div className="glass-card-warning p-4 flex gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#ef4444"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold" style={{ color: '#ef4444' }}>
            WARNING
          </span>
          <p className="text-xs text-star-muted leading-relaxed">
            Keep this seed phrase completely safe. Never share it with anyone.
            Celestial employees will never ask for this. Without this phrase,
            your assets cannot be recovered if the wallet or device is lost.
          </p>
        </div>
      </div>

      {/* Error */}
      {state.error && (
        <p
          className="text-xs px-3 py-2 rounded-lg"
          style={{
            color: '#ef4444',
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.15)',
          }}
        >
          {state.error}
        </p>
      )}

      {/* Buttons */}
      <div className="flex gap-3">
        <button onClick={onBack} className="btn-ghost flex-1">
          Back
        </button>
        <button
          onClick={onComplete}
          disabled={state.loading}
          className="btn-primary flex-1"
        >
          {state.loading ? (
            <span className="flex items-center gap-2">
              <svg
                className="animate-spin"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="3"
                  opacity="0.25"
                />
                <path
                  d="M12 2a10 10 0 0 1 10 10"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
              Encrypting…
            </span>
          ) : (
            "I've Saved My Recovery Phrase →"
          )}
        </button>
      </div>
    </div>
  );
}

function CompletionStep() {
  return (
    <div className="glass-card p-10 flex flex-col items-center gap-6 text-center">
      {/* Success Animation */}
      <div className="relative w-24 h-24 flex items-center justify-center">
        {/* Expanding ring */}
        <svg
          className="absolute inset-0 animate-ring-expand"
          width="96"
          height="96"
          viewBox="0 0 96 96"
          fill="none"
        >
          <circle
            cx="48"
            cy="48"
            r="44"
            stroke="#0f172a"
            strokeWidth="2"
            opacity="0.3"
          />
        </svg>
        {/* Inner circle */}
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center"
          style={{
            background: '#0f172a',
            border: '2px solid rgba(15,23,42,0.1)',
          }}
        >
          <svg
            className="animate-check-draw"
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              strokeDasharray: 50,
              strokeDashoffset: 50,
            }}
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      </div>

      {/* Text */}
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-bold text-star">
          Wallet Successfully Configured!
        </h2>
        <p className="text-sm text-star-muted leading-relaxed max-w-sm">
          Your encrypted vault has been securely stored. You can now close this
          tab and open the Celestial extension icon in your browser toolbar to
          get started.
        </p>
      </div>

      {/* Visual divider */}
      <div className="w-16 h-px bg-gradient-to-r from-transparent via-accent/30 to-transparent" />

      <div className="flex flex-col gap-2 text-xs text-star-dim">
        <p>🔒 Your seed phrase is encrypted with AES-256-GCM</p>
        <p>🔑 600,000 PBKDF2 iterations protect your password</p>
        <p>💎 Fully non-custodial — only you have access</p>
      </div>
    </div>
  );
}