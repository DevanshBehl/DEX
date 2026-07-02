import { ethers } from 'ethers';

async function fetchEVMHistory(address, isTestnet) {
  const subdomain = isTestnet ? 'api-sepolia' : 'api';
  const url = `https://${subdomain}.etherscan.io/api?module=account&action=txlist&address=${address}&sort=desc&apikey=`;
  console.log('EVM url', url);
  const res = await fetch(url);
  const data = await res.json();
  console.log('EVM data', data);
  if (data.status !== "1" && data.message !== "No transactions found") {
    if (data.result && typeof data.result === 'string') {
      return [];
    }
  }
  const txs = Array.isArray(data.result) ? data.result : [];
  return txs.length;
}

async function fetchBitcoinHistory(address, isTestnet) {
  const baseUrl = isTestnet ? 'https://mempool.space/testnet/api' : 'https://mempool.space/api';
  const url = `${baseUrl}/address/${address}/txs`;
  console.log('BTC url', url);
  const res = await fetch(url);
  const txs = await res.json();
  console.log('BTC data type', typeof txs, Array.isArray(txs) ? txs.length : txs);
  if (!Array.isArray(txs)) return [];
  return txs.length;
}

async function run() {
  // Use known addresses
  try {
    const evm = await fetchEVMHistory('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', false);
    console.log('EVM count', evm);
  } catch(e) { console.error('EVM err', e); }
  
  try {
    const btc = await fetchBitcoinHistory('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', false);
    console.log('BTC count', btc);
  } catch(e) { console.error('BTC err', e); }
}

run();
