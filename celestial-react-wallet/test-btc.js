const btcAddress = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'; // From abandon seed

async function fetchBitcoinHistory(address) {
  const url = `https://mempool.space/api/address/${address}/txs`;
  const res = await fetch(url);
  const txs = await res.json();
  
  if (!Array.isArray(txs)) return [];

  return txs.map(tx => {
    let userInputs = 0;
    let userOutputs = 0;

    tx.vin.forEach(vin => {
      if (vin.prevout && vin.prevout.scriptpubkey_address === address) {
        userInputs += vin.prevout.value;
      }
    });

    tx.vout.forEach(vout => {
      if (vout.scriptpubkey_address === address) {
        userOutputs += vout.value;
      }
    });

    const netAmount = userOutputs - userInputs;
    const isSend = netAmount < 0;
    const amountBtc = Math.abs(netAmount) / 100000000;
    
    return {
      id: tx.txid,
      chain: 'Bitcoin',
      type: isSend ? 'Send' : 'Receive',
      amount: amountBtc.toFixed(8).replace(/\.?0+$/, ''),
      ticker: 'BTC',
      timestamp: tx.status.block_time || Math.floor(Date.now() / 1000),
      status: tx.status.confirmed ? 'Success' : 'Pending',
    };
  });
}

fetchBitcoinHistory(btcAddress).then(res => console.log(res));
