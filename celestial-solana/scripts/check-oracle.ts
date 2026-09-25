/**
 * Step 1 of Phase 4: decode the three Chainlink OCR2 feeds on Solana devnet and print the
 * price, decimals and age. Run before anything else — a stale or undecodable feed blocks the
 * whole phase.
 *
 *   pnpm check-oracle
 *
 * The layout decoded here is the same one `programs/celestial-perps/src/oracle.rs` uses.
 */
import { Connection, PublicKey } from "@solana/web3.js";

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

export const CHAINLINK_STORE = new PublicKey("HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny");

export const DEVNET_FEEDS: Record<string, string> = {
  "SOL-USD": "99B2bTijsU6f1GCT73HmdR7HCFFjGMBcPZY6jZ96ynrR",
  "BTC-USD": "6PxBx93S8x3tno1TsFZwT5VqP8drrRCbCXygEXYNkFJe",
  "ETH-USD": "669U43LNHx7LsVj95uYksnhXUfWKDsdzVqev3V4Jpw3P",
};

const DECIMALS_OFFSET = 138;
const LIVE_LENGTH_OFFSET = 148;
const LIVE_CURSOR_OFFSET = 152;
const TRANSMISSIONS_OFFSET = 200;
const TRANSMISSION_SIZE = 48;

export type Round = { answer: bigint; timestamp: number; decimals: number; description: string };

/** Latest round from a Chainlink v2 `Transmissions` account (the ring buffer's newest entry). */
export function decodeFeed(data: Buffer): Round {
  if (data.length < TRANSMISSIONS_OFFSET + TRANSMISSION_SIZE) throw new Error("account too small");
  const decimals = data[DECIMALS_OFFSET];
  const liveLength = data.readUInt32LE(LIVE_LENGTH_OFFSET);
  const liveCursor = data.readUInt32LE(LIVE_CURSOR_OFFSET);
  if (liveLength === 0) throw new Error("live_length is 0");
  const idx = (liveCursor + liveLength - 1) % liveLength;
  const off = TRANSMISSIONS_OFFSET + idx * TRANSMISSION_SIZE;
  if (data.length < off + TRANSMISSION_SIZE) throw new Error("ring buffer out of range");
  return {
    answer: readI128LE(data, off + 16),
    timestamp: data.readUInt32LE(off + 8),
    decimals,
    description: data.subarray(106, 138).toString("utf8").replace(/\0+$/, "").trim(),
  };
}

function readI128LE(data: Buffer, off: number): bigint {
  const lo = data.readBigUInt64LE(off);
  const hi = data.readBigInt64LE(off + 8);
  return (hi << 64n) | lo;
}

export function toPrice8(answer: bigint, decimals: number): bigint {
  return decimals > 8 ? answer / 10n ** BigInt(decimals - 8) : answer * 10n ** BigInt(8 - decimals);
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const now = Math.floor(Date.now() / 1000);
  let stale = false;

  console.log(`Chainlink devnet feeds via ${RPC}\n`);
  for (const [market, address] of Object.entries(DEVNET_FEEDS)) {
    const key = new PublicKey(address);
    const info = await connection.getAccountInfo(key);
    if (!info) {
      console.log(`${market.padEnd(8)} MISSING (${address})`);
      stale = true;
      continue;
    }
    const owner = info.owner.equals(CHAINLINK_STORE) ? "store ✓" : `owner ${info.owner.toBase58()} ✗`;
    try {
      const r = decodeFeed(info.data);
      const age = now - r.timestamp;
      const price = Number(toPrice8(r.answer, r.decimals)) / 1e8;
      console.log(
        `${market.padEnd(8)} $${price.toFixed(2).padStart(12)}  decimals=${r.decimals}  age=${age}s  ` +
          `ts=${new Date(r.timestamp * 1000).toISOString()}  "${r.description}"  ${owner}  bytes=${info.data.length}`,
      );
      if (age > 600) {
        console.log(`  ⚠️  ${market} is older than 10 minutes — STOP and report.`);
        stale = true;
      }
    } catch (e) {
      console.log(`${market.padEnd(8)} UNDECODABLE: ${(e as Error).message}`);
      stale = true;
    }
  }
  console.log(stale ? "\nRESULT: at least one feed is unusable." : "\nRESULT: all feeds fresh and decodable.");
  process.exit(stale ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
