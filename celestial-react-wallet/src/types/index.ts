export interface TransactionRecord {
  id: string; // The tx hash or signature
  chain: 'Ethereum' | 'Solana' | 'Bitcoin';
  type: 'Send' | 'Receive' | 'Transaction';
  amount: string; // Formatted to human-readable (e.g., "0.05")
  ticker: string; // ETH, SOL, BTC
  timestamp: number; // Unix timestamp for sorting
  status: 'Success' | 'Failed' | 'Pending';
  explorerUrl: string; // Direct link to view the tx on-chain
}

export type AssetChart =
  | { kind: 'coin'; id: string } // CoinGecko coin id (native assets)
  | { kind: 'contract'; platform: 'ethereum' | 'solana'; address: string }; // token contract / mint

export interface WalletAsset {
  key: string; // unique: 'native:ETH', 'erc20:0x…', 'spl:<mint>'
  kind: 'native' | 'erc20' | 'spl';
  chain: 'EVM' | 'Solana' | 'Bitcoin';
  symbol: string;
  name: string;
  logo: string | null;
  decimals: number;
  balance: string; // human-readable
  price: number; // USD per unit, 0 if unknown
  change: number; // 24h % change
  hasPrice: boolean;
  chart: AssetChart | null;
  contract?: string; // ERC-20 address or SPL mint
  programId?: string; // SPL Token or Token-2022 program
  tokenAccount?: string; // SPL source token account holding the balance
}
