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
    <div className="relative min-h-screen flex flex-col items-center justify-center px-4 py-12 overflow-hidden">
      {/* Ambient Orbs */}
      <div className="orb-1" />
      <div className="orb-2" />

      {/* Main Content */}
      <div className="relative z-10 w-full max-w-lg">
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
    <div className="flex flex-col items-center gap-8 text-center">
      {/* Animated Logo */}
      <div className="relative">
        <div
          className="absolute inset-0 rounded-full animate-glow-pulse"
          style={{
            background:
              'radial-gradient(circle, rgba(187,134,252,0.15) 0%, transparent 70%)',
            transform: 'scale(2.5)',
          }}
        />
        <div className="relative w-20 h-20 flex items-center justify-center">
          <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
            {/* Crescent Moon */}
            <defs>
              <linearGradient
                id="moonGrad"
                x1="10"
                y1="8"
                x2="40"
                y2="48"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%" stopColor="#e2d4f5" />
                <stop offset="100%" stopColor="#bb86fc" />
              </linearGradient>
            </defs>
            <path
              d="M28 4C17.507 4 9 12.507 9 23s8.507 19 19 19c4.632 0 8.9-1.66 12.21-4.42A22 22 0 0 1 28 42C14.745 42 4 31.255 4 18S14.745-6 28-6c5.377 0 10.366 1.924 14.21 5.42A18.93 18.93 0 0 0 28 4Z"
              fill="url(#moonGrad)"
              transform="translate(4, 6)"
            />
            {/* Star Sparkle */}
            <path
              d="M44 10l1.5 3.5L49 15l-3.5 1.5L44 20l-1.5-3.5L39 15l3.5-1.5Z"
              fill="#e2d4f5"
              opacity="0.9"
            />
            <circle cx="48" cy="24" r="1.5" fill="#bb86fc" opacity="0.6" />
          </svg>
        </div>
      </div>

      {/* Title */}
      <div className="flex flex-col gap-3">
        <h1 className="text-5xl font-black tracking-tight md:text-6xl">
          Meet{' '}
          <span className="gradient-text">CELESTIAL</span>
        </h1>
        <p className="text-lg text-star-muted max-w-md mx-auto leading-relaxed">
          The next-generation non-custodial wallet.
          <br />
          Your keys. Your crypto. Your future.
        </p>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <button
          onClick={onCreateWallet}
          disabled={!extensionDetected}
          className="btn-primary w-full"
        >
          Create Wallet
        </button>
        <button className="btn-ghost w-full">Read the Docs</button>
      </div>

      {/* Extension Status */}
      <div className="flex items-center gap-2 text-sm text-star-dim">
        <div
          className="w-2 h-2 rounded-full transition-colors duration-500"
          style={{
            backgroundColor: extensionDetected ? '#22c55e' : '#ef4444',
            boxShadow: extensionDetected
              ? '0 0 8px rgba(34,197,94,0.6)'
              : '0 0 8px rgba(239,68,68,0.4)',
          }}
        />
        {extensionDetected ? 'Extension Active' : 'Extension Not Detected'}
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
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
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
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
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
            stroke="#bb86fc"
            strokeWidth="2"
            opacity="0.3"
          />
        </svg>
        {/* Inner circle */}
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center"
          style={{
            background:
              'linear-gradient(135deg, rgba(187,134,252,0.2) 0%, rgba(55,0,179,0.2) 100%)',
            border: '2px solid rgba(187,134,252,0.3)',
          }}
        >
          <svg
            className="animate-check-draw"
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#bb86fc"
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