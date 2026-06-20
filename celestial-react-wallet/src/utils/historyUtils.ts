import { ethers } from 'ethers';
import { Connection, PublicKey } from '@solana/web3.js';
import { CONFIG } from '../config/networks';
import type { ChainAccount } from './walletUtils';
import type { TransactionRecord } from '../types';

export async function fetchAccountHistory(account: ChainAccount, isTestnet: boolean): Promise<TransactionRecord[]> {
  try {
    switch (account.chain) {
      case 'EVM':
        return await fetchEVMHistory(account.address, isTestnet);
      case 'Solana':
        return await fetchSolanaHistory(account.address, isTestnet);
      case 'Bitcoin':
        return await fetchBitcoinHistory(account.address, isTestnet);
      default:
        return [];
    }
  } catch (error) {
    console.error(`Failed to fetch history for ${account.chain}:`, error);
    // Graceful fallback
    return [];
  }
}

async function fetchEVMHistory(address: string, isTestnet: boolean): Promise<TransactionRecord[]> {
  const subdomain = isTestnet ? 'api-sepolia' : 'api';
  const url = `https://${subdomain}.etherscan.io/api?module=account&action=txlist&address=${address}&sort=desc&apikey=${CONFIG.ETHERSCAN_API_KEY}`;
  
  const res = await fetch(url);
  if (!res.ok) throw new Error("Etherscan API error");
  const data = await res.json();
  if (data.status !== "1" && data.message !== "No transactions found") {
    // sometimes Etherscan returns 0 status if no txs, gracefully return empty
    if (data.result && typeof data.result === 'string') {
      return [];
    }
  }

  const txs: any[] = Array.isArray(data.result) ? data.result : [];
  
  return txs.map(tx => {
    const isSend = tx.from.toLowerCase() === address.toLowerCase();
    const amount = parseFloat(ethers.formatEther(tx.value || "0"));
    const status = tx.isError === "1" ? "Failed" : "Success";
    const explorerUrl = isTestnet 
      ? `https://sepolia.etherscan.io/tx/${tx.hash}` 
      : `https://etherscan.io/tx/${tx.hash}`;

    return {
      id: tx.hash,
      chain: 'Ethereum',
      type: isSend ? 'Send' : 'Receive',
      amount: amount.toFixed(4).replace(/\.?0+$/, ''),
      ticker: 'ETH',
      timestamp: parseInt(tx.timeStamp, 10),
      status,
      explorerUrl
    };
  });
}

async function fetchSolanaHistory(address: string, isTestnet: boolean): Promise<TransactionRecord[]> {
  const rpcUrl = isTestnet ? CONFIG.HELIUS_DEVNET_URL : CONFIG.HELIUS_SOL_URL;
  const connection = new Connection(rpcUrl, 'confirmed');
  
  const signatures = await connection.getSignaturesForAddress(new PublicKey(address), { limit: 20 });
  
  return signatures.map(sig => {
    const explorerUrl = isTestnet 
      ? `https://explorer.solana.com/tx/${sig.signature}?cluster=devnet` 
      : `https://explorer.solana.com/tx/${sig.signature}`;
      
    return {
      id: sig.signature,
      chain: 'Solana',
      type: 'Transaction', // Generic for V1 as exact amount/type needs getParsedTransactions
      amount: 'N/A',
      ticker: 'SOL',
      timestamp: sig.blockTime || Math.floor(Date.now() / 1000),
      status: sig.err ? 'Failed' : 'Success',
      explorerUrl
    };
  });
}

async function fetchBitcoinHistory(address: string, isTestnet: boolean): Promise<TransactionRecord[]> {
  const baseUrl = isTestnet ? 'https://mempool.space/testnet/api' : 'https://mempool.space/api';
  const url = `${baseUrl}/address/${address}/txs`;
  
  const res = await fetch(url);
  if (!res.ok) throw new Error("Mempool API error");
  const txs = await res.json();
  
  if (!Array.isArray(txs)) return [];

  return txs.map(tx => {
    // Calculate net flow for the user's address
    let userInputs = 0;
    let userOutputs = 0;

    tx.vin.forEach((vin: any) => {
      if (vin.prevout && vin.prevout.scriptpubkey_address === address) {
        userInputs += vin.prevout.value;
      }
    });

    tx.vout.forEach((vout: any) => {
      if (vout.scriptpubkey_address === address) {
        userOutputs += vout.value;
      }
    });

    const netAmount = userOutputs - userInputs;
    const isSend = netAmount < 0;
    const amountBtc = Math.abs(netAmount) / 100000000;
    
    const explorerUrl = isTestnet 
      ? `https://mempool.space/testnet/tx/${tx.txid}` 
      : `https://mempool.space/tx/${tx.txid}`;

    return {
      id: tx.txid,
      chain: 'Bitcoin',
      type: isSend ? 'Send' : 'Receive',
      amount: amountBtc.toFixed(8).replace(/\.?0+$/, ''),
      ticker: 'BTC',
      timestamp: tx.status.block_time || Math.floor(Date.now() / 1000),
      status: tx.status.confirmed ? 'Success' : 'Pending',
      explorerUrl
    };
  });
}
