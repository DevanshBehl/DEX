import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { NFTWithVisibility } from '../../nft/types';
import { isNewRecipient, validateAmount, validateRecipient } from '../../nft/tx/validate';
import { friendlyTransferError, type NFTTransferEstimate, type NFTTransferParams } from '../../nft/tx/types';
import { addRecentRecipient, readRecentRecipients } from '../../nft/storage';
import { NFTImage } from './NFTImage';
import { SlideToConfirm } from './SlideToConfirm';

// ---- Send NFT flow (nft.md — Phase 3.2) -------------------------------------------------
// form → review (live fee estimate + ownership check) → sending → success | error
// The private key is only handed to the local transaction builder; it is never sent anywhere.

interface SendNFTFlowProps {
  nft: NFTWithVisibility;
  ownerAddress: string;
  privateKey: string;
  rpcUrl: string;
  isTestnet: boolean;
  onClose: () => void;
  /** Called when the user leaves the success screen (so the grid updates after they've seen confirmation). */
  onSent: (amount: bigint) => void;
}

type Step = 'form' | 'review' | 'sending' | 'success' | 'error';

const loadTxModule = (chain: NFTWithVisibility['chain']) =>
  chain === 'EVM'
    ? import('../../nft/tx/evm').then((m) => ({
        estimate: m.estimateEVMNFTTransfer,
        send: (p: NFTTransferParams, key: string, est?: NFTTransferEstimate & { gasLimit?: bigint }) => m.sendEVMNFT(p, key, est?.gasLimit),
      }))
    : import('../../nft/tx/solana').then((m) => ({
        estimate: m.estimateSolanaNFTTransfer,
        send: (p: NFTTransferParams, key: string) => m.sendSolanaNFT(p, key),
      }));

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-6)}`;

export const SendNFTFlow: React.FC<SendNFTFlowProps> = ({ nft, ownerAddress, privateKey, rpcUrl, isTestnet, onClose, onSent }) => {
  const network = isTestnet ? 'testnet' : 'mainnet';
  const symbol = nft.chain === 'EVM' ? 'ETH' : 'SOL';

  const [step, setStep] = useState<Step>('form');
  const [recipientInput, setRecipientInput] = useState('');
  const [amountInput, setAmountInput] = useState('1');
  const [recent, setRecent] = useState<string[]>([]);
  const [estimate, setEstimate] = useState<(NFTTransferEstimate & { gasLimit?: bigint }) | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sendingRef = useRef(false);

  useEffect(() => {
    readRecentRecipients(network, nft.chain).then(setRecent);
  }, [network, nft.chain]);

  const recipient = useMemo(() => validateRecipient(nft, ownerAddress, recipientInput), [nft, ownerAddress, recipientInput]);
  const amount = useMemo(() => validateAmount(nft, amountInput), [nft, amountInput]);
  const canContinue = recipient.ok && amount.ok;

  const params = (): NFTTransferParams => ({ nft, from: ownerAddress, to: recipient.address!, amount: amount.amount!, rpcUrl });

  const explorerTx = (hash: string) =>
    nft.chain === 'EVM'
      ? `https://${isTestnet ? 'sepolia.' : ''}etherscan.io/tx/${hash}`
      : `https://explorer.solana.com/tx/${hash}${isTestnet ? '?cluster=devnet' : ''}`;

  // Re-estimate every time the review screen opens (fees and ownership can change)
  useEffect(() => {
    if (step !== 'review') return;
    let cancelled = false;
    setEstimate(null);
    setEstimateError(null);
    loadTxModule(nft.chain)
      .then((m) => m.estimate(params()))
      .then((est) => { if (!cancelled) setEstimate(est); })
      .catch((e) => { if (!cancelled) setEstimateError(friendlyTransferError(e)); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const send = async () => {
    if (sendingRef.current || !estimate?.sufficient) return;
    sendingRef.current = true;
    setStep('sending');
    setError(null);
    try {
      const m = await loadTxModule(nft.chain);
      const sent = await m.send(params(), privateKey, estimate);
      setTxHash(sent.hash);
      await sent.wait();
      void addRecentRecipient(network, nft.chain, recipient.address!);
      setStep('success');
    } catch (e) {
      console.error('[nft] send failed', e);
      setError(friendlyTransferError(e));
      setStep('error');
    } finally {
      sendingRef.current = false;
    }
  };

  const busy = step === 'sending';
  const close = () => {
    if (step === 'success') onSent(amount.amount!);
    onClose();
  };

  return (
    <div className="absolute inset-0 z-[60] bg-[#0a0a0a] flex flex-col animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 shrink-0">
        <button
          onClick={() => (step === 'review' || step === 'error') && !txHash ? setStep('form') : close()}
          disabled={busy}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 transition-colors shrink-0 disabled:opacity-40"
          aria-label="Back"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <h1 className="flex-1 text-base font-bold text-white">
          {step === 'form' ? 'Send NFT' : step === 'review' ? 'Review' : step === 'success' ? 'Sent' : step === 'error' ? 'Send failed' : 'Sending…'}
        </h1>
        {!busy && (
          <button onClick={close} className="w-9 h-9 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 transition-colors text-zinc-400" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide px-5 pt-4 pb-6 flex flex-col">
        {/* NFT summary */}
        <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.03] border border-white/5">
          <NFTImage sources={nft.images} alt={nft.name} className="w-14 h-14 rounded-xl shrink-0" imgClassName="object-cover" eager />
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-zinc-500 truncate">{nft.collection?.name || 'No collection'}</div>
            <div className="text-sm font-bold text-white truncate">{nft.name}</div>
            <div className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider mt-0.5">{nft.chain === 'EVM' ? 'Ethereum' : 'Solana'}{isTestnet ? ' · testnet' : ''}</div>
          </div>
        </div>

        {step === 'form' && (
          <>
            <label className="mt-5 block">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[11px] font-semibold text-zinc-500 tracking-wide uppercase">Recipient</span>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.readText().then((t) => setRecipientInput(t.trim())).catch(() => {})}
                  className="text-[11px] font-semibold text-zinc-400 hover:text-white"
                >
                  Paste
                </button>
              </div>
              <input
                autoFocus
                value={recipientInput}
                onChange={(e) => setRecipientInput(e.target.value)}
                placeholder={nft.chain === 'EVM' ? '0x…' : 'Solana address'}
                spellCheck={false}
                autoComplete="off"
                className={`w-full bg-[#111111] rounded-2xl px-4 py-3.5 text-sm font-mono text-white outline-none placeholder:text-zinc-700 border ${recipient.error ? 'border-[#ff0055]/40' : 'border-transparent focus:border-white/15'}`}
              />
            </label>
            {recipient.error && <p className="text-[11px] font-semibold text-[#ff0055] mt-2 px-1">{recipient.error}</p>}
            {recipient.warnings.map((w) => <p key={w} className="text-[11px] font-semibold text-[#ffaa00] mt-2 px-1">{w}</p>)}

            {recent.length > 0 && !recipientInput && (
              <div className="mt-4">
                <div className="text-[11px] font-semibold text-zinc-500 tracking-wide uppercase mb-2">Recent</div>
                <div className="flex flex-col gap-1">
                  {recent.map((a) => (
                    <button key={a} onClick={() => setRecipientInput(a)} className="text-left px-3 py-2 rounded-xl hover:bg-white/5 text-[12px] font-mono text-zinc-300">
                      {shortAddr(a)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {nft.standard === 'erc1155' && (
              <label className="mt-5 block">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[11px] font-semibold text-zinc-500 tracking-wide uppercase">Quantity</span>
                  <button type="button" onClick={() => setAmountInput(nft.amount)} className="text-[10px] font-bold bg-white/10 text-white px-2 py-0.5 rounded-full hover:bg-white/20">
                    MAX {nft.amount}
                  </button>
                </div>
                <input
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value.replace(/[^0-9]/g, ''))}
                  inputMode="numeric"
                  className="w-full bg-[#111111] rounded-2xl px-4 py-3.5 text-lg font-bold text-white outline-none border border-transparent focus:border-white/15"
                />
                {amount.error && <p className="text-[11px] font-semibold text-[#ff0055] mt-2 px-1">{amount.error}</p>}
              </label>
            )}

            <div className="flex-1" />
            <button
              disabled={!canContinue}
              onClick={() => setStep('review')}
              className="mt-6 w-full h-12 rounded-full bg-white text-black text-sm font-bold disabled:bg-zinc-800 disabled:text-zinc-500 transition-colors"
            >
              Continue
            </button>
          </>
        )}

        {(step === 'review' || step === 'sending') && (
          <>
            <div className="mt-5 rounded-2xl bg-white/[0.02] border border-white/5 divide-y divide-white/5">
              <Row label="To"><span className="font-mono break-all text-right">{recipient.address}</span></Row>
              {nft.standard === 'erc1155' && <Row label="Quantity">{amount.amount!.toString()} of {nft.amount}</Row>}
              <Row label="Network fee">
                {estimate ? `≈ ${estimate.fee} ${symbol}` : estimateError ? '—' : <span className="inline-block w-16 h-3 rounded bg-white/10 animate-pulse" />}
              </Row>
              {estimate && <Row label={`${symbol} balance`}>{estimate.nativeBalance} {symbol}</Row>}
            </div>

            {estimate?.notes.map((n) => <p key={n} className="text-[11px] text-zinc-500 mt-2 px-1">{n}</p>)}
            {recipient.warnings.map((w) => <p key={w} className="text-[11px] font-semibold text-[#ffaa00] mt-2 px-1">{w}</p>)}
            {recipient.address && isNewRecipient(nft.chain, recent, recipient.address) && (
              <p className="text-[11px] font-semibold text-[#ffaa00] mt-2 px-1">You haven't sent NFTs to this address recently — check it matches the intended wallet.</p>
            )}
            {estimate && !estimate.sufficient && (
              <Banner tone="error">Not enough {symbol} to pay the network fee. Add at least {estimate.fee} {symbol} and try again.</Banner>
            )}
            {estimateError && <Banner tone="error">{estimateError}</Banner>}
            {nft.isSpam && (
              <Banner tone="warn">This NFT looks like spam. Some spam contracts run malicious code when transferred — consider just hiding it instead.</Banner>
            )}
            <Banner tone="warn">NFT transfers can't be reversed. Double-check the recipient address.</Banner>

            <div className="flex-1" />
            <div className="mt-6">
              {step === 'sending' ? (
                <div className="w-full h-14 rounded-full bg-[#111111] border border-white/5 flex items-center justify-center gap-3 text-sm font-bold text-white">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-spin text-zinc-400"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                  {txHash ? 'Waiting for confirmation…' : 'Signing & broadcasting…'}
                </div>
              ) : (
                <SlideToConfirm label="Slide to send" disabled={!estimate?.sufficient} onConfirm={send} />
              )}
              {txHash && (
                <a href={explorerTx(txHash)} target="_blank" rel="noopener noreferrer" className="block text-center mt-3 text-[12px] font-semibold text-zinc-400 hover:text-white underline underline-offset-4 decoration-zinc-700">
                  View on explorer
                </a>
              )}
            </div>
          </>
        )}

        {step === 'success' && (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-full bg-[#00ff66]/10 border border-[#00ff66]/30 flex items-center justify-center mb-4">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#00ff66" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <p className="text-lg font-black text-white">NFT sent</p>
            <p className="text-xs text-zinc-500 mt-1">
              {nft.standard === 'erc1155' ? `${amount.amount} × ` : ''}{nft.name} → {shortAddr(recipient.address!)}
            </p>
            {txHash && (
              <a href={explorerTx(txHash)} target="_blank" rel="noopener noreferrer" className="mt-4 text-[12px] font-semibold text-zinc-400 hover:text-white underline underline-offset-4 decoration-zinc-700">
                View on explorer
              </a>
            )}
            <button onClick={close} className="mt-8 w-full h-12 rounded-full bg-white text-black text-sm font-bold">Done</button>
          </div>
        )}

        {step === 'error' && (
          <div className="flex-1 flex flex-col">
            <Banner tone="error">{error}</Banner>
            {txHash ? (
              <>
                <p className="text-[11px] text-zinc-500 mt-3 px-1">
                  The transaction was broadcast, so it may still succeed. Check the explorer before sending again.
                </p>
                <a href={explorerTx(txHash)} target="_blank" rel="noopener noreferrer" className="mt-3 text-center text-[12px] font-semibold text-zinc-300 hover:text-white underline underline-offset-4">
                  View on explorer
                </a>
                <div className="flex-1" />
                <button onClick={onClose} className="mt-6 w-full h-12 rounded-full bg-white/10 text-white text-sm font-bold">Close</button>
              </>
            ) : (
              <>
                <div className="flex-1" />
                <button onClick={() => setStep('review')} className="mt-6 w-full h-12 rounded-full bg-white text-black text-sm font-bold">Try again</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-start justify-between gap-4 px-3 py-2.5 text-[12px]">
    <span className="font-medium text-zinc-500 shrink-0">{label}</span>
    <span className="font-semibold text-zinc-200 min-w-0">{children}</span>
  </div>
);

const Banner: React.FC<{ tone: 'error' | 'warn'; children: React.ReactNode }> = ({ tone, children }) => (
  <div className={`mt-3 p-3 rounded-xl text-[11px] font-semibold leading-snug border ${tone === 'error' ? 'bg-[#ff0055]/10 border-[#ff0055]/25 text-[#ff0055]' : 'bg-[#ffaa00]/10 border-[#ffaa00]/25 text-[#ffaa00]'}`}>
    {children}
  </div>
);
