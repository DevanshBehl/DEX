import { ethers } from 'ethers';
import { Keypair } from '@solana/web3.js';
import { derivePath } from 'ed25519-hd-key';
import bs58 from 'bs58';
import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';

// Initialize BIP32 for Bitcoin
const bip32 = BIP32Factory(ecc);

export interface ChainAccount {
  chain: string;
  address: string;
  privateKey: string;
  derivationPath: string;
}

export function deriveMultiChainAccounts(seedPhrase: string, accountIndex: number = 0): ChainAccount[] {
  const accounts: ChainAccount[] = [];

  try {
    // Shared root seed buffer for non-EVM derivatives
    const seedBuffer = bip39.mnemonicToSeedSync(seedPhrase);

    // 1. EVM Derivation (m/44'/60'/0'/0/x)
    try {
      const evmPath = `m/44'/60'/0'/0/${accountIndex}`;
      const evmWallet = ethers.HDNodeWallet.fromPhrase(seedPhrase, undefined, evmPath);
      accounts.push({
        chain: 'EVM',
        address: evmWallet.address,
        privateKey: evmWallet.privateKey,
        derivationPath: evmPath,
      });
    } catch (e) {
      console.error('Failed to derive EVM account:', e);
    }

    // 2. Solana Derivation (m/44'/501'/x'/0')
    try {
      const solPath = `m/44'/501'/${accountIndex}'/0'`;
      const derivedSeed = derivePath(solPath, seedBuffer.toString('hex')).key;
      const keypair = Keypair.fromSeed(derivedSeed);
      accounts.push({
        chain: 'Solana',
        address: keypair.publicKey.toBase58(),
        privateKey: bs58.encode(keypair.secretKey),
        derivationPath: solPath,
      });
    } catch (e) {
      console.error('Failed to derive Solana account:', e);
    }

    // 3. Bitcoin Derivation Native SegWit (m/84'/0'/0'/0/x)
    try {
      const btcPath = `m/84'/0'/0'/0/${accountIndex}`;
      const rootNode = bip32.fromSeed(seedBuffer);
      const childNode = rootNode.derivePath(btcPath);
      const { address } = bitcoin.payments.p2wpkh({ pubkey: childNode.publicKey });
      accounts.push({
        chain: 'Bitcoin',
        address: address!,
        privateKey: childNode.toWIF(),
        derivationPath: btcPath,
      });
    } catch (e) {
      console.error('Failed to derive Bitcoin account:', e);
    }

  } catch (error) {
    console.error('Failed to derive accounts:', error);
    return [];
  }

  return accounts;
}
