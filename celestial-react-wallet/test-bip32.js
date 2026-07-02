import { Buffer } from 'buffer';
import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from 'bip39';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';

const bip32 = BIP32Factory(ecc);

const seedPhrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const seedBuffer = bip39.mnemonicToSeedSync(seedPhrase);
const btcPath = `m/84'/0'/0'/0/0`;
const rootNode = bip32.fromSeed(seedBuffer);
const childNode = rootNode.derivePath(btcPath);
const { address } = bitcoin.payments.p2wpkh({ pubkey: childNode.publicKey });
console.log('BTC address:', address);
