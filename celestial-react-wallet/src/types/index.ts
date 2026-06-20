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
