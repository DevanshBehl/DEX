import { ethers } from 'ethers';
import { NFTTransferError, type NFTTransferEstimate, type NFTTransferParams } from './types.ts';

// ---- ERC-721 / ERC-1155 transfers (nft.md — Phase 3.1) ------------------------------
// Signing happens locally with ethers.Wallet; only the signed transaction is broadcast.

const ERC721_ABI = [
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
];
const ERC1155_ABI = [
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes data)',
];

const GAS_BUFFER_BPS = 12_000n; // +20%

/** Accepts any-case hex addresses; ethers rejects mixed case with a bad checksum. */
const normalizeAddress = (address: string) => ethers.getAddress(address.toLowerCase());

function buildCall(params: NFTTransferParams, runner: ethers.ContractRunner | null) {
  const { nft, amount } = params;
  const from = normalizeAddress(params.from);
  const to = normalizeAddress(params.to);
  if (!nft.contract || nft.tokenId === undefined) throw new NFTTransferError('Missing contract or token id');
  const tokenId = BigInt(nft.tokenId);

  if (nft.standard === 'erc1155') {
    const c = new ethers.Contract(nft.contract, ERC1155_ABI, runner);
    return {
      contract: c,
      fn: c.getFunction('safeTransferFrom(address,address,uint256,uint256,bytes)'),
      args: [from, to, tokenId, amount, '0x'] as const,
      assertOwnership: async () => {
        const bal: bigint = await c.balanceOf(from, tokenId);
        if (bal < amount) throw new NFTTransferError(bal === 0n ? 'You no longer own this NFT' : `You only own ${bal} of this NFT`);
      },
    };
  }
  if (nft.standard === 'erc721') {
    const c = new ethers.Contract(nft.contract, ERC721_ABI, runner);
    return {
      contract: c,
      fn: c.getFunction('safeTransferFrom(address,address,uint256)'),
      args: [from, to, tokenId] as const,
      assertOwnership: async () => {
        const owner: string = await c.ownerOf(tokenId);
        if (owner.toLowerCase() !== from.toLowerCase()) throw new NFTTransferError('You no longer own this NFT');
      },
    };
  }
  throw new NFTTransferError(`Unsupported EVM standard: ${nft.standard}`);
}

/** Unsigned call (target + calldata) for review and unit tests — no network. */
export function encodeEVMNFTTransfer(params: Omit<NFTTransferParams, 'rpcUrl'>): { to: string; data: string } {
  const call = buildCall({ ...params, rpcUrl: '' }, null);
  return { to: normalizeAddress(params.nft.contract!), data: call.contract.interface.encodeFunctionData(call.fn.fragment, [...call.args]) };
}

export async function estimateEVMNFTTransfer(params: NFTTransferParams): Promise<NFTTransferEstimate & { gasLimit: bigint }> {
  const provider = new ethers.JsonRpcProvider(params.rpcUrl);
  const call = buildCall(params, provider);
  await call.assertOwnership();

  const [gas, feeData, balance] = await Promise.all([
    call.fn.estimateGas(...call.args, { from: normalizeAddress(params.from) }),
    provider.getFeeData(),
    provider.getBalance(normalizeAddress(params.from)),
  ]);
  const gasLimit = (gas * GAS_BUFFER_BPS) / 10_000n;
  const pricePerGas = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
  const fee = gasLimit * pricePerGas;

  return {
    gasLimit,
    fee: ethers.formatEther(fee),
    symbol: 'ETH',
    nativeBalance: ethers.formatEther(balance),
    sufficient: balance >= fee,
    notes: ['Maximum fee — you are usually charged less.'],
  };
}

export interface SentTransaction {
  hash: string;
  wait: () => Promise<void>;
}

export async function sendEVMNFT(params: NFTTransferParams, privateKey: string, gasLimit?: bigint): Promise<SentTransaction> {
  const provider = new ethers.JsonRpcProvider(params.rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  if (wallet.address.toLowerCase() !== params.from.toLowerCase()) {
    throw new NFTTransferError('Signing key does not match the sending account');
  }

  const call = buildCall(params, wallet);
  await call.assertOwnership();
  const tx: ethers.ContractTransactionResponse = await call.fn(...call.args, gasLimit ? { gasLimit } : {});
  return {
    hash: tx.hash,
    wait: async () => {
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) throw new NFTTransferError('Transaction failed on-chain');
    },
  };
}
