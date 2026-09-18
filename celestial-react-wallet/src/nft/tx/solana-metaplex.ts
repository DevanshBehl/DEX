import { PublicKey as Web3PublicKey } from '@solana/web3.js';
import { ACCOUNT_SIZE, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { isSome, keypairIdentity, publicKey, type TransactionBuilder, type Umi } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import {
  TokenStandard,
  fetchDigitalAssetWithAssociatedToken,
  findTokenRecordPda,
  getTokenRecordSize,
  mplTokenMetadata,
  transferV1,
} from '@metaplex-foundation/mpl-token-metadata';
import {
  getAssetWithProof,
  mplBubblegum,
  transfer as transferCompressedV1,
  transferV2 as transferCompressedV2,
} from '@metaplex-foundation/mpl-bubblegum';
import { fetchAssetV1, fetchCollectionV1, mplCore, transfer as transferCore } from '@metaplex-foundation/mpl-core';
import { dasApi, type DasApiInterface } from '@metaplex-foundation/digital-asset-standard-api';
import { MPL_ACCOUNT_COMPRESSION_PROGRAM_ID } from '@metaplex-foundation/mpl-account-compression';
import { setComputeUnitLimit } from '@metaplex-foundation/mpl-toolbox';
import { NFTTransferError, type NFTTransferParams } from './types.ts';

// ---- Metaplex transfers: pNFT, compressed NFT, Core (nft.md — Phase 3.1) -------------
// Loaded lazily from solana.ts so the Umi/Metaplex bundle only downloads when a user
// actually sends one of these standards. The Umi identity is created from the locally
// held secret key; nothing but the signed transaction leaves the device.

const PNFT_COMPUTE_UNITS = 400_000; // pNFT transfers (token records, rule sets) exceed the 200k default

// dasApi() adds DAS methods to the RPC at runtime but can't widen Umi's static type
type DasUmi = Umi & { rpc: DasApiInterface };

function makeUmi(rpcUrl: string, secretKey?: Uint8Array): DasUmi {
  const umi = createUmi(rpcUrl, 'confirmed').use(mplTokenMetadata()).use(mplBubblegum()).use(mplCore()).use(dasApi()) as DasUmi;
  if (secretKey) umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(secretKey)));
  return umi;
}

const idOf = (params: NFTTransferParams) => {
  if (!params.nft.assetId) throw new NFTTransferError('Missing Solana asset id');
  return publicKey(params.nft.assetId);
};

/** Throws NFTTransferError if `from` no longer owns the asset. Returns extra rent (lamports) the transfer will create. */
export async function checkMetaplexTransfer(params: NFTTransferParams): Promise<{ rentLamports: bigint; notes: string[] }> {
  const umi = makeUmi(params.rpcUrl);
  const id = idOf(params);
  const from = publicKey(params.from);

  switch (params.nft.standard) {
    case 'metaplex-pnft': {
      const asset = await fetchDigitalAssetWithAssociatedToken(umi, id, from).catch(() => null);
      if (!asset || asset.token.amount < 1n) throw new NFTTransferError('You no longer own this NFT');
      if (asset.token.delegate && isSome(asset.token.delegate)) {
        throw new NFTTransferError('This NFT is delegated (e.g. staked or listed). Remove the delegate before sending.');
      }
      const destToken = publicKey(
        getAssociatedTokenAddressSync(new Web3PublicKey(id), new Web3PublicKey(params.to), true).toBase58(),
      );
      const destRecord = findTokenRecordPda(umi, { mint: id, token: destToken });
      const [tokenExists, recordExists] = await Promise.all([umi.rpc.accountExists(destToken), umi.rpc.accountExists(destRecord[0])]);
      let rent = 0n;
      const notes: string[] = [];
      if (!tokenExists) rent += (await umi.rpc.getRent(ACCOUNT_SIZE)).basisPoints;
      if (!recordExists) rent += (await umi.rpc.getRent(getTokenRecordSize())).basisPoints;
      if (rent > 0n) notes.push("Includes rent for the recipient's token account and pNFT token record");
      return { rentLamports: rent, notes };
    }
    case 'metaplex-cnft': {
      const asset = await umi.rpc.getAsset(id).catch(() => null);
      if (!asset || asset.ownership.owner !== from) throw new NFTTransferError('You no longer own this NFT');
      if (asset.ownership.frozen) throw new NFTTransferError('This compressed NFT is frozen and cannot be transferred');
      return { rentLamports: 0n, notes: ['Compressed NFTs need no new accounts'] };
    }
    case 'metaplex-core': {
      const asset = await fetchAssetV1(umi, id).catch(() => null);
      if (!asset || asset.owner !== from) throw new NFTTransferError('You no longer own this NFT');
      if (asset.freezeDelegate?.frozen) throw new NFTTransferError('This asset is frozen and cannot be transferred');
      return { rentLamports: 0n, notes: [] };
    }
    default:
      throw new NFTTransferError(`Not a Metaplex program standard: ${params.nft.standard}`);
  }
}

export async function sendMetaplexNFT(params: NFTTransferParams, secretKey: Uint8Array): Promise<string> {
  const umi = makeUmi(params.rpcUrl, secretKey);
  if (umi.identity.publicKey !== params.from) throw new NFTTransferError('Signing key does not match the sending account');

  const id = idOf(params);
  const to = publicKey(params.to);
  let builder: TransactionBuilder;

  switch (params.nft.standard) {
    case 'metaplex-pnft': {
      const asset = await fetchDigitalAssetWithAssociatedToken(umi, id, umi.identity.publicKey);
      const config = asset.metadata.programmableConfig;
      const ruleSet = isSome(config) && isSome(config.value.ruleSet) ? config.value.ruleSet.value : undefined;
      builder = setComputeUnitLimit(umi, { units: PNFT_COMPUTE_UNITS }).add(
        transferV1(umi, {
          mint: id,
          authority: umi.identity,
          tokenOwner: umi.identity.publicKey,
          destinationOwner: to,
          tokenStandard: TokenStandard.ProgrammableNonFungible,
          authorizationRules: ruleSet,
        }),
      );
      break;
    }
    case 'metaplex-cnft': {
      const assetWithProof = await getAssetWithProof(umi, id, { truncateCanopy: true });
      if (assetWithProof.leafOwner !== umi.identity.publicKey) throw new NFTTransferError('You no longer own this NFT');
      // V2 trees are owned by mpl-account-compression; V1 by spl-account-compression.
      // (getAssetWithProof populates `currentMetadata` for both, so it can't be used to tell them apart.)
      const tree = await umi.rpc.getAccount(assetWithProof.merkleTree);
      if (!tree.exists) throw new NFTTransferError('Merkle tree for this compressed NFT was not found');
      builder = tree.owner === MPL_ACCOUNT_COMPRESSION_PROGRAM_ID
        ? transferCompressedV2(umi, { ...assetWithProof, authority: umi.identity, newLeafOwner: to })
        : transferCompressedV1(umi, { ...assetWithProof, leafOwner: umi.identity, newLeafOwner: to });
      break;
    }
    case 'metaplex-core': {
      const asset = await fetchAssetV1(umi, id);
      if (asset.owner !== umi.identity.publicKey) throw new NFTTransferError('You no longer own this NFT');
      const collection =
        asset.updateAuthority.type === 'Collection' && asset.updateAuthority.address
          ? await fetchCollectionV1(umi, asset.updateAuthority.address)
          : undefined;
      builder = transferCore(umi, { asset, newOwner: to, collection });
      break;
    }
    default:
      throw new NFTTransferError(`Not a Metaplex program standard: ${params.nft.standard}`);
  }

  const { signature, result } = await builder.sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });
  // Umi resolves (does not throw) when a transaction lands but fails on-chain
  if (result.value.err) {
    throw new NFTTransferError(`Transfer failed on-chain: ${JSON.stringify(result.value.err)}`);
  }
  return base58.deserialize(signature)[0];
}
