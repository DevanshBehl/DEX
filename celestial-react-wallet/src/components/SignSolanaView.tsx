import { useEffect, useMemo, useState } from 'react';
import { Connection, type VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { CONFIG } from '../config/networks';
import {
  SolanaSignError,
  assertSigner,
  base64ToBytes,
  bytesToBase64,
  clusterFor,
  decodeTransaction,
  displayMessage,
  signMessage,
  signTransaction,
  summarize,
  type SolanaCluster,
  type SolanaSignRequest,
  type TransactionSummary,
} from '../solana/signing';

// ---- Solana signature approval (docs/wallet.md — Solana provider) ---------------------
// Opened by the background for window.solana / Wallet Standard signing requests. Decodes the
// request, refuses transactions that don't need this wallet's account, simulates them on the
// cluster the dApp asked for, and signs locally only after the user confirms.

interface SignSolanaViewProps {
  id: string;
  origin: string;
  /** every unlocked Solana account (address + bs58 secret key) — the request names which one */
  accounts: { address: string; privateKey: string }[];
  isTestnet: boolean;
}

const RPC: Record<SolanaCluster, string> = {
  mainnet: CONFIG.HELIUS_SOL_URL || 'https://api.mainnet-beta.solana.com',
  devnet: CONFIG.HELIUS_DEVNET_URL || 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
};

const CLUSTER_LABEL: Record<SolanaCluster, string> = { mainnet: 'Solana Mainnet', devnet: 'Solana Devnet', testnet: 'Solana Testnet' };

type Simulation = { status: 'running' } | { status: 'ok'; units?: number } | { status: 'failed'; reason: string } | { status: 'unavailable' };

const TITLES: Record<SolanaSignRequest['method'], string> = {
  signTransaction: 'Sign Transaction',
  signAllTransactions: 'Sign Transactions',
  signAndSendTransaction: 'Approve Transaction',
  signMessage: 'Sign Message',
};

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

/** Most useful line of a failed simulation: the program error, else the last log. */
function simulationReason(err: unknown, logs: string[] | null): string {
  const line = (logs ?? []).find((l) => /Error Code:|failed:|insufficient/i.test(l)) ?? (logs ?? []).at(-1);
  return line ? line.replace(/^Program log: /, '') : JSON.stringify(err);
}

export function SignSolanaView({ id, origin, accounts, isTestnet }: SignSolanaViewProps) {
  const inExtension = typeof chrome !== 'undefined' && !!chrome.storage;
  const [request, setRequest] = useState<SolanaSignRequest | null>(null);
  const [loading, setLoading] = useState(inExtension);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(inExtension ? null : 'Signing requests only work inside the extension.');
  const [simulation, setSimulation] = useState<Simulation>({ status: 'running' });

  useEffect(() => {
    if (!inExtension) return;
    chrome.storage.local.get(`solreq_${id}`, (result) => {
      const req = result[`solreq_${id}`] as SolanaSignRequest | undefined;
      if (req) setRequest(req);
      else setError('This signature request has expired.');
      setLoading(false);
    });
  }, [id, inExtension]);

  const cluster = clusterFor(request?.chain, isTestnet);
  const signer = useMemo(() => accounts.find((a) => a.address === request?.account) ?? null, [accounts, request]);

  // Decode once; any problem (bad bytes, wrong signer) blocks the Confirm button.
  const decoded = useMemo((): { txs: VersionedTransaction[]; summaries: TransactionSummary[]; problem?: string } => {
    if (!request || request.method === 'signMessage') return { txs: [], summaries: [] };
    try {
      const txs = (request.transactions ?? []).map(decodeTransaction);
      txs.forEach((tx) => assertSigner(tx, request.account));
      return { txs, summaries: txs.map(summarize) };
    } catch (e) {
      return { txs: [], summaries: [], problem: e instanceof Error ? e.message : String(e) };
    }
  }, [request]);

  const message = useMemo(
    () => (request?.method === 'signMessage' && request.message ? displayMessage(base64ToBytes(request.message)) : null),
    [request],
  );

  // Simulate every transaction on the requested cluster so the user sees whether it will land.
  useEffect(() => {
    if (!request || request.method === 'signMessage' || decoded.problem || decoded.txs.length === 0) return;
    let cancelled = false;
    const connection = new Connection(RPC[cluster], 'confirmed');
    (async () => {
      try {
        let units = 0;
        for (const tx of decoded.txs) {
          const r = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' });
          if (r.value.err) {
            if (!cancelled) setSimulation({ status: 'failed', reason: simulationReason(r.value.err, r.value.logs) });
            return;
          }
          units += r.value.unitsConsumed ?? 0;
        }
        if (!cancelled) setSimulation({ status: 'ok', units: units || undefined });
      } catch {
        if (!cancelled) setSimulation({ status: 'unavailable' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request, decoded, cluster]);

  const respond = (type: 'SOL_SIGN_RESOLVED' | 'SOL_SIGN_REJECTED', payload: Record<string, unknown>) => {
    chrome.runtime.sendMessage({ type, payload: { id, ...payload } }, () => window.close());
  };

  const handleConfirm = async () => {
    if (!request || !signer) return;
    setBusy(true);
    setError(null);
    try {
      const secretKey = bs58.decode(signer.privateKey);
      if (request.method === 'signMessage') {
        const signature = await signMessage(base64ToBytes(request.message!), secretKey);
        respond('SOL_SIGN_RESOLVED', { result: { signature: bytesToBase64(signature) } });
        return;
      }
      const signed = decoded.txs.map((tx) => signTransaction(tx, secretKey));
      if (request.method === 'signAndSendTransaction') {
        const connection = new Connection(RPC[cluster], 'confirmed');
        const signature = await connection.sendRawTransaction(signed[0], {
          skipPreflight: request.options?.skipPreflight ?? false,
          preflightCommitment: (request.options?.preflightCommitment as 'confirmed' | undefined) ?? 'confirmed',
          maxRetries: request.options?.maxRetries ?? 5,
        });
        respond('SOL_SIGN_RESOLVED', { result: { signature } });
        return;
      }
      respond('SOL_SIGN_RESOLVED', { result: { transactions: signed.map(bytesToBase64) } });
    } catch (e) {
      setError(e instanceof SolanaSignError || e instanceof Error ? e.message : 'Failed to sign.');
      setBusy(false);
    }
  };

  const handleReject = () => respond('SOL_SIGN_REJECTED', {});

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-[#000000] text-white absolute inset-0 z-[9999]">
        <div className="w-8 h-8 rounded-full border-2 border-[#00f0ff] border-t-transparent animate-spin mb-4" />
        <p className="text-zinc-400 font-inter text-sm">Loading request...</p>
      </div>
    );
  }

  const blocked = !request
    ? 'This signature request has expired.'
    : !signer
      ? `The requested account ${short(request.account)} is not in this wallet. Switch accounts in the site and try again.`
      : decoded.problem;

  const simulationRow = request?.method === 'signMessage' ? null : (
    <div
      className={`rounded-xl p-4 border text-xs font-semibold ${
        simulation.status === 'failed'
          ? 'bg-[#ff0055]/10 border-[#ff0055]/20 text-[#ff0055]'
          : simulation.status === 'ok'
            ? 'bg-[#00ff66]/5 border-[#00ff66]/20 text-[#00ff66]'
            : 'bg-white/[0.02] border-white/5 text-zinc-400'
      }`}
    >
      {simulation.status === 'running' && `Simulating on ${CLUSTER_LABEL[cluster]}…`}
      {simulation.status === 'ok' && `Simulation succeeded on ${CLUSTER_LABEL[cluster]}${simulation.units ? ` · ${simulation.units.toLocaleString()} compute units` : ''}`}
      {simulation.status === 'failed' && <span className="break-words">Simulation failed — this transaction would revert: {simulation.reason}</span>}
      {simulation.status === 'unavailable' && `Could not reach ${CLUSTER_LABEL[cluster]} to simulate. Review carefully.`}
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-[#0a0a0a] to-[#000000] overflow-hidden text-white font-sans animate-fade-in absolute inset-0 z-[9999]">
      <div className="absolute top-[-150px] left-[-100px] w-[400px] h-[400px] bg-[#bd00ff] opacity-[0.03] rounded-full blur-[100px] pointer-events-none" />

      <div className="flex-1 flex flex-col p-5 z-10 relative h-full min-h-0">
        <div className="flex flex-col items-center justify-center pt-2 pb-5 border-b border-white/5 mb-5">
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#111111] border border-white/10 mb-4">
            <div className={`w-2 h-2 rounded-full ${cluster === 'mainnet' ? 'bg-[#00ff66]' : 'bg-[#ffaa00]'}`} />
            <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest">{CLUSTER_LABEL[cluster]}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white to-zinc-400">
            {request ? TITLES[request.method] : 'Signature Request'}
          </h1>
        </div>

        <div className="mb-4 p-4 bg-white/[0.02] border border-white/5 rounded-2xl">
          <p className="text-[11px] text-zinc-500 font-semibold uppercase tracking-wider mb-0.5">Request from</p>
          <p className="text-sm font-semibold truncate text-zinc-200">{origin}</p>
          {request && <p className="text-[11px] text-zinc-500 mt-2 font-mono">Account {short(request.account)}</p>}
        </div>

        <div className="flex-1 overflow-y-auto pr-1 pb-4 space-y-3 font-inter custom-scrollbar min-h-0">
          {message && (
            <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4">
              <div className="text-[11px] text-zinc-500 font-semibold mb-1.5 uppercase tracking-wider">{message.isUtf8 ? 'Message' : 'Message (hex)'}</div>
              <pre className="font-mono text-xs whitespace-pre-wrap break-all text-zinc-300">{message.text}</pre>
              <p className="text-[11px] text-zinc-500 mt-3">Signing a message costs nothing and moves no funds.</p>
            </div>
          )}

          {!blocked && simulationRow}

          {decoded.summaries.map((s, i) => (
            <div key={i} className="bg-white/[0.02] border border-white/5 rounded-xl p-4 space-y-2">
              {decoded.summaries.length > 1 && <div className="text-[11px] text-zinc-500 font-semibold uppercase tracking-wider">Transaction {i + 1}</div>}
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">Fee payer</span>
                <span className="font-mono text-zinc-300">{s.feePayer === request?.account ? 'You' : short(s.feePayer)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">Instructions</span>
                <span className="font-mono text-zinc-300">{s.instructionCount}</span>
              </div>
              <div className="text-xs">
                <span className="text-zinc-500">Programs</span>
                <ul className="mt-1 space-y-1">
                  {s.programs.map((p) => (
                    <li key={p.id} className="flex justify-between gap-2">
                      <span className={p.name === 'Unknown program' ? 'text-[#ffaa00]' : 'text-zinc-300'}>{p.name}</span>
                      <span className="font-mono text-zinc-500">{short(p.id)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>

        {(blocked || error) && (
          <div className="mb-4 text-xs font-semibold text-[#ff0055] bg-[#ff0055]/10 border border-[#ff0055]/20 p-3 rounded-xl break-words">
            {blocked || error}
          </div>
        )}

        <div className="flex items-center gap-4 mt-auto pt-3 pb-2">
          <button
            onClick={handleReject}
            disabled={busy}
            className="flex-1 py-3.5 rounded-full bg-white/[0.05] border border-white/10 text-white font-semibold text-sm tracking-wide hover:bg-white/[0.1] hover:border-[#ff0055]/50 hover:text-[#ff0055] active:scale-95 transition-all disabled:opacity-50"
          >
            Reject
          </button>
          <button
            onClick={handleConfirm}
            disabled={busy || !!blocked || (request?.method !== 'signMessage' && simulation.status === 'running')}
            className="flex-1 py-3.5 rounded-full bg-white text-black font-semibold text-sm tracking-wide hover:bg-[#00ff66] active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center"
          >
            {busy ? <div className="w-5 h-5 rounded-full border-2 border-black border-t-transparent animate-spin" /> : request?.method === 'signMessage' ? 'Sign' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
