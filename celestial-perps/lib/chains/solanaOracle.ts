// Oracle reads for Solana markets — same layout and validity rules as the program
// (celestial-solana/programs/celestial-perps/src/oracle.rs) and the keeper:
// - Chainlink OCR2 `Transmissions` (owner = store): decimals @138, live_length @148,
//   live_cursor @152, 48-byte rounds from @200, latest at (cursor + length − 1) % length.
// - Mock oracle (owner = the program; local test builds only): answer i64 @8, timestamp i64 @16, decimals u8 @24.

import type { AccountInfo, PublicKey } from "@solana/web3.js";
import { PublicKey as PK } from "@solana/web3.js";

export const CHAINLINK_STORE = new PK("HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny");
const MAX_FUTURE_SKEW = 60n;

type Round = { answer: bigint; timestamp: bigint; decimals: number };

function view(data: Uint8Array) {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function decodeChainlink(data: Uint8Array): Round {
  if (data.length < 248) throw new Error("feed account too small");
  const dv = view(data);
  const decimals = data[138];
  const length = dv.getUint32(148, true);
  const cursor = dv.getUint32(152, true);
  if (length === 0) throw new Error("feed has no rounds");
  const off = 200 + ((cursor + length - 1) % length) * 48;
  if (data.length < off + 48) throw new Error("feed ring buffer out of range");
  const lo = dv.getBigUint64(off + 16, true);
  const hi = dv.getBigInt64(off + 24, true);
  return { answer: (hi << 64n) | lo, timestamp: BigInt(dv.getUint32(off + 8, true)), decimals };
}

function decodeMock(data: Uint8Array): Round {
  const dv = view(data);
  return { answer: dv.getBigInt64(8, true), timestamp: dv.getBigInt64(16, true), decimals: data[24] };
}

export type OracleRead = { price: bigint | null; updatedAt: number | null; issue?: string };

/** 8-dp price if the round passes the program's checks at `now` (cluster clock), else null + why. */
export function readOraclePrice(info: AccountInfo<Uint8Array> | null, programId: PublicKey, now: bigint, maxAge: bigint): OracleRead {
  if (!info) return { price: null, updatedAt: null, issue: "oracle account missing" };
  let round: Round;
  try {
    if (info.owner.equals(CHAINLINK_STORE)) round = decodeChainlink(info.data);
    else if (info.owner.equals(programId)) round = decodeMock(info.data);
    else return { price: null, updatedAt: null, issue: "unexpected oracle owner" };
  } catch (e) {
    return { price: null, updatedAt: null, issue: (e as Error).message };
  }
  const updatedAt = Number(round.timestamp);
  if (round.answer <= 0n || round.decimals > 18) return { price: null, updatedAt, issue: "invalid oracle answer" };
  if (round.timestamp === 0n || round.timestamp > now + MAX_FUTURE_SKEW) return { price: null, updatedAt, issue: "bad oracle timestamp" };
  if (now - round.timestamp > maxAge) return { price: null, updatedAt, issue: `oracle stale (${now - round.timestamp}s)` };
  const d = BigInt(round.decimals);
  return { price: d > 8n ? round.answer / 10n ** (d - 8n) : round.answer * 10n ** (8n - d), updatedAt };
}
