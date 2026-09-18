/**
 * Celestial Wallet — Solana devnet NFT fixtures (nft.md, Phase 0)
 *
 * Mints one of every Solana NFT standard the wallet must support to YOUR
 * Celestial wallet address, so the NFT tab / detail page / send flows can be
 * built and tested without mainnet funds.
 *
 *   Token Metadata collection  "Celestial Test Collection"
 *     • 2× Standard NFT          (verified into the collection)
 *     • 1× Programmable NFT      (pNFT, verified into the collection)
 *     • 2× Compressed NFT        (Bubblegum V1, minted into the collection)
 *     • 1× Spam-style NFT        (no collection, scam-like name)
 *     • 1× Broken-image NFT      (image URL never resolves)
 *   Metaplex Core collection   "Celestial Core Collection"
 *     • 1× Core asset
 *
 * A separate *fixture payer* keypair pays all fees and remains the update
 * authority. Your Celestial seed / private keys are never used or needed —
 * NFTs are simply minted TO your public address.
 *
 * Usage:
 *   npm run fixtures:solana -- --owner <YOUR_CELESTIAL_SOLANA_ADDRESS>
 *
 * Options:
 *   --owner <address>        (required) wallet that receives the NFTs
 *   --keypair <path>         fixture payer keypair JSON (default: scripts/.keys/devnet-fixture-payer.json, created if missing)
 *   --rpc <url>              devnet RPC (default: VITE_HELIUS_DEVNET_URL from .env, else public devnet)
 *   --output <path>          fixtures JSON (default: scripts/fixtures.devnet.json)
 *   --metadata-base-url <u>  skip Irys; write metadata to scripts/fixtures/solana-metadata/
 *                            and reference it at <u>/<file> (host that folder yourself)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Keypair } from '@solana/web3.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  createGenericFile,
  generateSigner,
  keypairIdentity,
  percentAmount,
  publicKey,
  type PublicKey,
  type Umi,
} from '@metaplex-foundation/umi';
import {
  createNft,
  createProgrammableNft,
  findMetadataPda,
  mplTokenMetadata,
  verifyCollectionV1,
} from '@metaplex-foundation/mpl-token-metadata';
import {
  create as createCoreAsset,
  createCollection as createCoreCollection,
  fetchCollection,
  mplCore,
} from '@metaplex-foundation/mpl-core';
import {
  createTree,
  mintToCollectionV1,
  mplBubblegum,
  parseLeafFromMintToCollectionV1Transaction,
} from '@metaplex-foundation/mpl-bubblegum';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';

// ---- Constants ------------------------------------------------------------------

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_KEYPAIR = path.join(SCRIPT_DIR, '.keys', 'devnet-fixture-payer.json');
const STATIC_METADATA_DIR = path.join(SCRIPT_DIR, 'fixtures', 'solana-metadata');
const OUTPUT_FILE = path.join(SCRIPT_DIR, 'fixtures.devnet.json');

const PUBLIC_DEVNET_RPC = 'https://api.devnet.solana.com';
const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const IRYS_DEVNET_NODE = 'https://devnet.irys.xyz';
const MIN_BALANCE_SOL = 0.5;
const BROKEN_IMAGE_URL = 'https://invalid.celestial.test/missing-image.png';

// ---- CLI ------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    owner: { type: 'string' },
    keypair: { type: 'string', default: DEFAULT_KEYPAIR },
    rpc: { type: 'string' },
    'metadata-base-url': { type: 'string' },
    output: { type: 'string', default: OUTPUT_FILE },
  },
});

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

// ---- Helpers --------------------------------------------------------------------

function loadEnvRpc(): string | undefined {
  try {
    process.loadEnvFile(path.join(PROJECT_DIR, '.env'));
  } catch {
    // no .env — fall back to public devnet
  }
  return process.env.VITE_HELIUS_DEVNET_URL || undefined;
}

function loadOrCreatePayer(file: string): Keypair {
  if (existsSync(file)) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, 'utf8'))));
  }
  const kp = Keypair.generate();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  console.log(`• Created new fixture payer keypair at ${path.relative(PROJECT_DIR, file)}`);
  return kp;
}

async function rpcCall<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result as T;
}

async function getBalanceSol(rpc: string, address: string): Promise<number> {
  const { value } = await rpcCall<{ value: number }>(rpc, 'getBalance', [address]);
  return value / 1e9;
}

async function ensureFunded(rpc: string, address: string) {
  let balance = await getBalanceSol(rpc, address);
  console.log(`• Fixture payer ${address} balance: ${balance.toFixed(3)} SOL`);
  if (balance >= MIN_BALANCE_SOL) return;

  console.log('• Requesting devnet airdrop (2 SOL)…');
  try {
    await rpcCall(PUBLIC_DEVNET_RPC, 'requestAirdrop', [address, 2e9]);
    for (let i = 0; i < 20 && balance < MIN_BALANCE_SOL; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      balance = await getBalanceSol(rpc, address);
    }
  } catch (e) {
    console.warn(`  Airdrop failed: ${(e as Error).message}`);
  }

  if (balance < MIN_BALANCE_SOL) {
    fail(
      `Fixture payer needs at least ${MIN_BALANCE_SOL} devnet SOL.\n` +
        `  Fund it at https://faucet.solana.com with address:\n  ${address}\n` +
        `  or: solana airdrop 2 ${address} --url devnet\n  Then re-run this script.`,
    );
  }
}

function orbSvg(color: string, label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
<rect width="400" height="400" fill="#050505"/>
<circle cx="200" cy="190" r="110" fill="${color}" opacity="0.85"/>
<circle cx="200" cy="190" r="150" fill="none" stroke="${color}" stroke-width="2" opacity="0.4"/>
<text x="200" y="370" font-family="monospace" font-size="26" fill="#ffffff" text-anchor="middle">${label}</text>
</svg>`;
}

type FixtureSpec = {
  slug: string;
  name: string;
  symbol: string;
  description: string;
  color: string;
  label: string;
  attributes: { trait_type: string; value: string }[];
  brokenImage?: boolean;
};

/** Uploads image + JSON metadata (Irys) or writes them locally (static mode); returns the metadata URI. */
function createMetadataPublisher(umi: Umi, staticBaseUrl?: string) {
  if (staticBaseUrl) mkdirSync(STATIC_METADATA_DIR, { recursive: true });
  const base = staticBaseUrl?.replace(/\/+$/, '');

  return async (spec: FixtureSpec): Promise<string> => {
    const svg = orbSvg(spec.color, spec.label);
    let imageUri: string;

    if (spec.brokenImage) {
      imageUri = BROKEN_IMAGE_URL;
    } else if (base) {
      writeFileSync(path.join(STATIC_METADATA_DIR, `${spec.slug}.svg`), svg);
      imageUri = `${base}/${spec.slug}.svg`;
    } else {
      [imageUri] = await umi.uploader.upload([
        createGenericFile(new TextEncoder().encode(svg), `${spec.slug}.svg`, { contentType: 'image/svg+xml' }),
      ]);
    }

    const metadata = {
      name: spec.name,
      symbol: spec.symbol,
      description: spec.description,
      image: imageUri,
      attributes: spec.attributes,
      properties: { files: [{ uri: imageUri, type: 'image/svg+xml' }], category: 'image' },
    };

    let uri: string;
    if (base) {
      writeFileSync(path.join(STATIC_METADATA_DIR, `${spec.slug}.json`), JSON.stringify(metadata, null, 2));
      uri = `${base}/${spec.slug}.json`;
    } else {
      uri = await umi.uploader.uploadJson(metadata);
    }

    if (uri.length > 200) fail(`Metadata URI for ${spec.slug} exceeds 200 characters: ${uri}`);
    return uri;
  };
}

// ---- Main -----------------------------------------------------------------------

async function main() {
  if (!args.owner) fail('Missing --owner <YOUR_CELESTIAL_SOLANA_ADDRESS>');

  let owner: PublicKey;
  try {
    owner = publicKey(args.owner);
  } catch {
    fail(`Invalid Solana address: ${args.owner}`);
  }

  const rpc = args.rpc || loadEnvRpc() || PUBLIC_DEVNET_RPC;
  const genesis = await rpcCall<string>(rpc, 'getGenesisHash', []);
  if (genesis !== DEVNET_GENESIS_HASH) fail('RPC is not Solana devnet — refusing to mint fixtures.');

  const payer = loadOrCreatePayer(args.keypair!);
  await ensureFunded(rpc, payer.publicKey.toBase58());

  const umi = createUmi(rpc, 'confirmed')
    .use(mplTokenMetadata())
    .use(mplCore())
    .use(mplBubblegum());
  umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(payer.secretKey)));
  if (!args['metadata-base-url']) {
    umi.use(irysUploader({ address: IRYS_DEVNET_NODE }));
  }

  const publish = createMetadataPublisher(umi, args['metadata-base-url']);
  const results: Record<string, unknown> = {};
  const step = (msg: string) => console.log(`\n▸ ${msg}`);

  console.log(`\n• Minting fixtures to ${owner}`);
  console.log(`• Metadata: ${args['metadata-base-url'] ? `static (${args['metadata-base-url']})` : 'Irys devnet'}`);

  // 1. Token Metadata collection
  step('Token Metadata collection');
  const collectionMint = generateSigner(umi);
  await createNft(umi, {
    mint: collectionMint,
    name: 'Celestial Test Collection',
    symbol: 'CTEST',
    uri: await publish({
      slug: 'collection', name: 'Celestial Test Collection', symbol: 'CTEST',
      description: 'Celestial wallet devnet fixture collection. No value.',
      color: '#bd00ff', label: 'COLLECTION', attributes: [],
    }),
    sellerFeeBasisPoints: percentAmount(5),
    isCollection: true,
  }).sendAndConfirm(umi);
  results.collection = collectionMint.publicKey;
  console.log(`  ${collectionMint.publicKey}`);

  const verifyIntoCollection = (mint: PublicKey) =>
    verifyCollectionV1(umi, {
      metadata: findMetadataPda(umi, { mint }),
      collectionMint: collectionMint.publicKey,
      authority: umi.identity,
    }).sendAndConfirm(umi);

  // 2. Standard NFTs
  const standard: string[] = [];
  for (const [i, color] of ['#00f0ff', '#00ff66'].entries()) {
    step(`Standard NFT #${i + 1}`);
    const mint = generateSigner(umi);
    await createNft(umi, {
      mint,
      tokenOwner: owner,
      name: `Celestial Orb #${i + 1}`,
      symbol: 'CTEST',
      uri: await publish({
        slug: `standard-${i + 1}`, name: `Celestial Orb #${i + 1}`, symbol: 'CTEST',
        description: 'Standard Metaplex NFT fixture (devnet).',
        color, label: `ORB #${i + 1}`,
        attributes: [{ trait_type: 'Standard', value: 'NonFungible' }, { trait_type: 'Color', value: color }],
      }),
      sellerFeeBasisPoints: percentAmount(5),
      collection: { key: collectionMint.publicKey, verified: false },
    }).sendAndConfirm(umi);
    await verifyIntoCollection(mint.publicKey);
    standard.push(mint.publicKey);
    console.log(`  ${mint.publicKey}`);
  }
  results.standardNfts = standard;

  // 3. Programmable NFT
  step('Programmable NFT (pNFT)');
  const pnftMint = generateSigner(umi);
  await createProgrammableNft(umi, {
    mint: pnftMint,
    tokenOwner: owner,
    name: 'Celestial Relic (pNFT)',
    symbol: 'CTEST',
    uri: await publish({
      slug: 'pnft', name: 'Celestial Relic (pNFT)', symbol: 'CTEST',
      description: 'Programmable NFT fixture — requires transferV1, not a plain SPL transfer.',
      color: '#ffaa00', label: 'pNFT',
      attributes: [{ trait_type: 'Standard', value: 'ProgrammableNonFungible' }],
    }),
    sellerFeeBasisPoints: percentAmount(5),
    collection: { key: collectionMint.publicKey, verified: false },
  }).sendAndConfirm(umi);
  await verifyIntoCollection(pnftMint.publicKey);
  results.programmableNft = pnftMint.publicKey;
  console.log(`  ${pnftMint.publicKey}`);

  // 4. Compressed NFTs (Bubblegum V1)
  step('Merkle tree for compressed NFTs');
  const merkleTree = generateSigner(umi);
  // (maxDepth 5, maxBufferSize 8) → 32 leaves; smallest practical size keeps rent low
  await (await createTree(umi, { merkleTree, maxDepth: 5, maxBufferSize: 8 })).sendAndConfirm(umi);
  results.merkleTree = merkleTree.publicKey;
  console.log(`  ${merkleTree.publicKey}`);

  const compressed: string[] = [];
  for (const i of [1, 2]) {
    step(`Compressed NFT #${i}`);
    const uri = await publish({
      slug: `cnft-${i}`, name: `Celestial Dust #${i}`, symbol: 'CTEST',
      description: 'Compressed NFT fixture — transfers require an asset proof.',
      color: '#14f195', label: `cNFT #${i}`,
      attributes: [{ trait_type: 'Standard', value: 'Compressed' }],
    });
    const { signature } = await mintToCollectionV1(umi, {
      leafOwner: owner,
      merkleTree: merkleTree.publicKey,
      collectionMint: collectionMint.publicKey,
      metadata: {
        name: `Celestial Dust #${i}`,
        symbol: 'CTEST',
        uri,
        sellerFeeBasisPoints: 500,
        collection: { key: collectionMint.publicKey, verified: false },
        creators: [{ address: umi.identity.publicKey, verified: false, share: 100 }],
      },
    }).sendAndConfirm(umi);
    const leaf = await parseLeafFromMintToCollectionV1Transaction(umi, signature);
    compressed.push(leaf.id);
    console.log(`  ${leaf.id}`);
  }
  results.compressedNfts = compressed;

  // 5. Metaplex Core collection + asset
  step('Core collection');
  const coreCollection = generateSigner(umi);
  await createCoreCollection(umi, {
    collection: coreCollection,
    name: 'Celestial Core Collection',
    uri: await publish({
      slug: 'core-collection', name: 'Celestial Core Collection', symbol: 'CCORE',
      description: 'Metaplex Core fixture collection (devnet).',
      color: '#627eea', label: 'CORE', attributes: [],
    }),
  }).sendAndConfirm(umi);
  results.coreCollection = coreCollection.publicKey;
  console.log(`  ${coreCollection.publicKey}`);

  step('Core asset');
  const coreAsset = generateSigner(umi);
  await createCoreAsset(umi, {
    asset: coreAsset,
    owner,
    collection: await fetchCollection(umi, coreCollection.publicKey),
    name: 'Celestial Core Orb',
    uri: await publish({
      slug: 'core-asset', name: 'Celestial Core Orb', symbol: 'CCORE',
      description: 'Metaplex Core asset fixture — single-account NFT standard.',
      color: '#627eea', label: 'CORE ORB',
      attributes: [{ trait_type: 'Standard', value: 'MplCore' }],
    }),
  }).sendAndConfirm(umi);
  results.coreAsset = coreAsset.publicKey;
  console.log(`  ${coreAsset.publicKey}`);

  // 6. Edge cases
  step('Spam-style NFT');
  const spamMint = generateSigner(umi);
  await createNft(umi, {
    mint: spamMint,
    tokenOwner: owner,
    name: 'Claim 500 SOL Reward',
    symbol: 'CLAIM',
    uri: await publish({
      slug: 'spam', name: 'Claim 500 SOL Reward', symbol: 'CLAIM',
      description: 'Congratulations! Visit celestial-airdrop-claim.xyz to claim your reward now.',
      color: '#ff0055', label: 'CLAIM NOW', attributes: [],
    }),
    sellerFeeBasisPoints: percentAmount(0),
  }).sendAndConfirm(umi);
  results.spamNft = spamMint.publicKey;
  console.log(`  ${spamMint.publicKey}`);

  step('Broken-image NFT');
  const brokenMint = generateSigner(umi);
  await createNft(umi, {
    mint: brokenMint,
    tokenOwner: owner,
    name: 'Celestial Broken Image',
    symbol: 'CTEST',
    uri: await publish({
      slug: 'broken-image', name: 'Celestial Broken Image', symbol: 'CTEST',
      description: 'Fixture whose image URL never resolves (fallback test).',
      color: '#71717a', label: 'BROKEN', attributes: [], brokenImage: true,
    }),
    sellerFeeBasisPoints: percentAmount(0),
  }).sendAndConfirm(umi);
  results.brokenImageNft = brokenMint.publicKey;
  console.log(`  ${brokenMint.publicKey}`);

  // Output
  const output = {
    network: 'solana-devnet',
    createdAt: new Date().toISOString(),
    owner,
    fixturePayer: umi.identity.publicKey,
    ...results,
  };
  const outputFile = path.resolve(args.output!);
  writeFileSync(outputFile, JSON.stringify(output, null, 2) + '\n');

  const remaining = await getBalanceSol(rpc, payer.publicKey.toBase58());
  console.log('\n============================================');
  console.log('  CELESTIAL DEVNET NFT FIXTURES MINTED');
  console.log('============================================');
  console.log(`  Owner:     ${owner}`);
  console.log(`  Output:    ${path.relative(PROJECT_DIR, outputFile)}`);
  console.log(`  Payer SOL: ${remaining.toFixed(3)} remaining`);
  if (args['metadata-base-url']) {
    console.log(`  Metadata:  host ${path.relative(PROJECT_DIR, STATIC_METADATA_DIR)}/ at ${args['metadata-base-url']}`);
  }
  console.log('============================================\n');
}

main().catch((err) => {
  console.error('\n✖ Fixture minting failed:', err);
  process.exit(1);
});
