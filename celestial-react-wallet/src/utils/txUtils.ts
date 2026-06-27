import { Buffer } from 'buffer';
if (typeof window !== 'undefined') {
  window.Buffer = window.Buffer || Buffer;
}

import { ethers } from 'ethers';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';

const ECPair = ECPairFactory(ecc);

export async function sendEVMTransaction(privateKey: string, toAddress: string, amountEth: string, rpcUrl: string): Promise<string> {
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    const txAmount = ethers.parseEther(amountEth);
    const txResponse = await wallet.sendTransaction({ to: toAddress, value: txAmount });
    return txResponse.hash;
  } catch (error: any) {
    throw new Error(error.message || "Failed to send EVM transaction");
  }
}

export async function sendEVMContractTransaction(privateKey: string, txData: { to: string, data: string, value: string, gasPrice?: string }, rpcUrl: string): Promise<string> {
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    const txResponse = await wallet.sendTransaction({
      to: txData.to,
      data: txData.data,
      value: BigInt(txData.value || '0'),
      gasPrice: txData.gasPrice ? BigInt(txData.gasPrice) : undefined
    });
    return txResponse.hash;
  } catch (error: any) {
    throw new Error(error.message || "Failed to send EVM contract transaction");
  }
}

export async function sendSolanaTransaction(privateKey: string, toAddress: string, amountSol: string, rpcUrl: string): Promise<string> {
  try {
    const connection = new Connection(rpcUrl, 'confirmed');
    const fromKeypair = Keypair.fromSecretKey(bs58.decode(privateKey));
    const toPubkey = new PublicKey(toAddress);
    
    const ix = SystemProgram.transfer({
      fromPubkey: fromKeypair.publicKey,
      toPubkey,
      lamports: parseFloat(amountSol) * LAMPORTS_PER_SOL,
    });
    
    const tx = new Transaction().add(ix);
    const signature = await sendAndConfirmTransaction(connection, tx, [fromKeypair]);
    return signature;
  } catch (error: any) {
    throw new Error(error.message || "Failed to send Solana transaction");
  }
}

export async function sendBitcoinTransaction(privateKeyWIF: string, toAddress: string, amountBtc: string, networkMode: 'mainnet' | 'testnet'): Promise<string> {
  try {
    const network = networkMode === 'testnet' ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;
    const keyPair = ECPair.fromWIF(privateKeyWIF, network);
    const { address: senderAddress } = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network });
    
    if (!senderAddress) throw new Error("Could not derive sender address");

    // Fetch UTXOs from mempool.space
    const baseUrl = networkMode === 'testnet' ? 'https://mempool.space/testnet/api' : 'https://mempool.space/api';
    const utxoRes = await fetch(`${baseUrl}/address/${senderAddress}/utxo`);
    if (!utxoRes.ok) throw new Error("Failed to fetch UTXOs from Mempool.space");
    const utxos = await utxoRes.json();

    if (!utxos || utxos.length === 0) {
      throw new Error("No UTXOs found. Insufficient funds.");
    }

    const amountSats = Math.floor(parseFloat(amountBtc) * 100000000);
    const psbt = new bitcoin.Psbt({ network });
    
    let totalInputSats = 0;
    
    for (const utxo of utxos) {
      const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network });
      psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        witnessUtxo: {
          script: p2wpkh.output!,
          value: BigInt(utxo.value)
        }
      });
      totalInputSats += utxo.value;
      if (totalInputSats >= amountSats + 1000) break; // 1000 sats fee estimate
    }

    const estimatedFee = 500; // Flat 500 sats fee for simplicity
    if (totalInputSats < amountSats + estimatedFee) {
      throw new Error(`Insufficient funds. Have ${totalInputSats} sats, need ${amountSats + estimatedFee} sats.`);
    }

    // Output to recipient
    psbt.addOutput({
      address: toAddress,
      value: BigInt(amountSats),
    });

    // Change output
    const change = totalInputSats - amountSats - estimatedFee;
    if (change > 546) { // Dust limit
      psbt.addOutput({
        address: senderAddress,
        value: BigInt(change),
      });
    }

    psbt.signAllInputs(keyPair);
    psbt.finalizeAllInputs();
    const txHex = psbt.extractTransaction().toHex();

    // Broadcast
    const broadcastRes = await fetch(`${baseUrl}/tx`, {
      method: 'POST',
      body: txHex
    });

    if (!broadcastRes.ok) {
      const errorText = await broadcastRes.text();
      throw new Error(`Broadcast failed: ${errorText}`);
    }

    const txId = await broadcastRes.text();
    return txId;

  } catch (error: any) {
    throw new Error(error.message || "Failed to send Bitcoin transaction");
  }
}
