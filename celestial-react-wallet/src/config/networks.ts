// `import.meta.env` is replaced by Vite at build time, but is undefined when these
// modules are imported directly by the Node test runner — fall back to an empty env
// so `npm test` can import anything that reads CONFIG.
const env: Record<string, string | undefined> = import.meta.env ?? {};

export const CONFIG = {
  ALCHEMY_ETH_URL: env.VITE_ALCHEMY_ETH_URL || '',
  HELIUS_SOL_URL: env.VITE_HELIUS_SOL_URL || '',
  MEMPOOL_BTC_URL: env.VITE_MEMPOOL_BTC_URL || '',
  COINGECKO_API_KEY: env.VITE_COINGECKO_API_KEY || '',
  ALCHEMY_SEPOLIA_URL: env.VITE_ALCHEMY_SEPOLIA_URL || '',
  HELIUS_DEVNET_URL: env.VITE_HELIUS_DEVNET_URL || '',
  MEMPOOL_TESTNET_URL: env.VITE_MEMPOOL_TESTNET_URL || '',
  ETHERSCAN_API_KEY: env.VITE_ETHERSCAN_API_KEY || '',
  /**
   * Base URL of the Celestial API proxy (nft.md — Phase 4.2). It injects partner
   * marketplace keys server-side, so no partner key ever ships in the extension
   * bundle. Unset → only keyless marketplace endpoints are used.
   */
  CELESTIAL_API_URL: env.VITE_CELESTIAL_API_URL || ''
};
