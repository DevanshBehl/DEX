import { fetchAccountNFTs } from './src/utils/nftUtils.js';
import { CONFIG } from './src/config/networks.js';

// We need to polyfill fetch if testing in old node, but node 18+ has fetch.
// Also we need to make sure the paths resolve. Since we are running outside Vite, TS compilation is missing.
