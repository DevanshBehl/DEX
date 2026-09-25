/**
 * Price reads for Solana markets, mirroring `celestial-solana/programs/celestial-perps/src/oracle.rs`:
 * - Chainlink OCR2 `Transmissions` (owner = store program): decimals @138, live_length @148,
 *   live_cursor @152, 48-byte rounds from @200, latest at (cursor + length − 1) % length.
 * - Mock oracle (owner = the program; only exists on a `mock-oracle` test build):
 *   discriminator(8) · answer i64 @8 · timestamp i64 @16 · decimals u8 @24.
 * Same validity rules as the program: answer > 0, timestamp ≠ 0, age ≤ max_age, ≤ 60 s in the
 * future. Returns an 8-decimal price or `null` with the reason.
 */
import { type AccountInfo, PublicKey } from "@solana/web3.js";

export const CHAINLINK_STORE = new PublicKey("HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny");
const MAX_FUTURE_SKEW = 60n;

export type Round = { answer: bigint; timestamp: bigint; decimals: number };

export function decodeChainlink(data: Buffer): Round {
  if (data.length < 248) throw new Error("feed account too small");
  const decimals = data[138];
  const length = data.readUInt32LE(148);
  const cursor = data.readUInt32LE(152);
  if (length === 0) throw new Error("live_length is 0");
  const off = 200 + ((cursor + length - 1) % length) * 48;
  if (data.length < off + 48) throw new Error("ring buffer out of range");
  const lo = data.readBigUInt64LE(off + 16);
  const hi = data.readBigInt64LE(off + 24);
  return { answer: (hi << 64n) | lo, timestamp: BigInt(data.readUInt32LE(off + 8)), decimals };
}

export function decodeMock(data: Buffer): Round {
  return { answer: data.readBigInt64LE(8), timestamp: data.readBigInt64LE(16), decimals: data[24] };
}

export function normalise(round: Round, now: bigint, maxAge: bigint): { price: bigint | null; issue?: string } {
  if (round.answer <= 0n || round.decimals > 18) return { price: null, issue: "invalid answer" };
  if (round.timestamp === 0n || round.timestamp > now + MAX_FUTURE_SKEW) return { price: null, issue: "bad timestamp" };
  if (now - round.timestamp > maxAge) return { price: null, issue: `stale (${now - round.timestamp}s > ${maxAge}s)` };
  const d = BigInt(round.decimals);
  return { price: d > 8n ? round.answer / 10n ** (d - 8n) : round.answer * 10n ** (8n - d) };
}

export function readOraclePrice(
  info: AccountInfo<Buffer> | null,
  programId: PublicKey,
  now: bigint,
  maxAge: bigint,
): { price: bigint | null; issue?: string } {
  if (!info) return { price: null, issue: "oracle account missing" };
  try {
    if (info.owner.equals(CHAINLINK_STORE)) return normalise(decodeChainlink(info.data), now, maxAge);
    if (info.owner.equals(programId)) return normalise(decodeMock(info.data), now, maxAge);
    return { price: null, issue: `unexpected oracle owner ${info.owner.toBase58()}` };
  } catch (e) {
    return { price: null, issue: (e as Error).message };
  }
}
