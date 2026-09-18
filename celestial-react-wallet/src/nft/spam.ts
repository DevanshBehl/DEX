import type { NFTAsset, NFTVisibility } from './types.ts';

// ---- Spam heuristics (nft.md — Phase 1.5) ----------------------------------------
//
// Providers only classify spam on some networks/plans (Alchemy returns
// `isSpam: false` on Sepolia for obvious scams), so the wallet scores every NFT
// locally. The score is intentionally conservative: legitimate NFTs without a
// verified collection are NOT flagged on that basis alone.

export const SPAM_THRESHOLD = 3;

const SCAM_PHRASES = [
  'claim', 'reward', 'airdrop', 'giveaway', 'free mint', 'voucher', 'redeem',
  'visit', 'congratulations', 'you won', 'you have won', 'eligible', 'bonus', 'gift',
];

// Domains / URL-ish text inside a name or description is the strongest scam signal
const URL_PATTERN = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(xyz|io|com|net|org|app|site|online|live|fun|top|club|link|click|gift|claims?)\b/i;
const CURRENCY_BAIT = /\b\d[\d,.]*\s*(\$|usd[ct]?|eth|sol|btc|usdc|usdt)\b|\$\s?\d/i;

export function scoreSpam(nft: Pick<NFTAsset, 'name' | 'description' | 'collection' | 'providerSpam' | 'symbol'>): {
  score: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  let score = 0;
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(reason);
  };

  if (nft.providerSpam) add(SPAM_THRESHOLD, 'Flagged as spam by indexer');

  const name = nft.name || '';
  const text = `${name} ${nft.description || ''}`.toLowerCase();

  if (URL_PATTERN.test(name)) add(3, 'Link in name');
  else if (URL_PATTERN.test(nft.description || '')) add(2, 'Link in description');

  const phrases = SCAM_PHRASES.filter((p) => text.includes(p));
  if (phrases.length > 0) add(Math.min(phrases.length, 2), `Scam phrases: ${phrases.join(', ')}`);

  if (CURRENCY_BAIT.test(name)) add(1, 'Currency amount in name');

  const noCollection = !nft.collection || (!nft.collection.verified && !nft.collection.name);
  if (noCollection && score > 0) add(1, 'No collection');

  return { score, reasons };
}

export function computeVisibility(
  nft: NFTAsset,
  userOverride: 'hidden' | 'visible' | null,
): NFTVisibility {
  const { score, reasons } = scoreSpam(nft);
  const isSpam = score >= SPAM_THRESHOLD;
  const hidden = userOverride ? userOverride === 'hidden' : isSpam;
  return { isSpam, spamReasons: isSpam ? reasons : [], hidden, userOverride };
}
