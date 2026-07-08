/**
 * Transak Fiat On-Ramp URL Builder
 * 
 * Constructs a URL for Transak's staging environment that opens their
 * buy-crypto widget pre-filled with the user's wallet address and preferences.
 */

// Maps our internal chain identifiers to Transak's expected format
const CHAIN_TO_TRANSAK: Record<string, { cryptoCurrencyCode: string; network: string }> = {
  EVM: { cryptoCurrencyCode: 'ETH', network: 'ethereum' },
  Solana: { cryptoCurrencyCode: 'SOL', network: 'solana' },
  Bitcoin: { cryptoCurrencyCode: 'BTC', network: 'bitcoin' },
};

export const getTransakUrl = (
  walletAddress: string,
  cryptoCurrencyCode: string, // e.g., 'ETH', 'SOL', 'BTC'
  fiatAmount: string,
  network: string // e.g., 'ethereum', 'solana', 'bitcoin'
): string => {
  // Transak Staging (Test) Environment
  const baseUrl = 'https://global-stg.transak.com/';

  const params = new URLSearchParams({
    cryptoCurrencyCode,
    walletAddress,
    fiatAmount,
    fiatCurrency: 'USD',
    network,
    themeColor: '22c55e', // Celestial Neon Green (no hash for Transak)
  });

  return `${baseUrl}?${params.toString()}`;
};

/**
 * Resolves our internal chain name (e.g. 'EVM', 'Solana') to 
 * the Transak crypto code and network identifiers.
 */
export const resolveTransakParams = (chain: string) => {
  return CHAIN_TO_TRANSAK[chain] ?? CHAIN_TO_TRANSAK['EVM'];
};
