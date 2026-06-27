export interface SwapQuote {
  buyAmount: string;
  sellAmount: string;
  price: string;
  guaranteedPrice: string;
  to: string;
  data: string;
  value: string;
  gas: string;
  gasPrice: string;
  buyTokenAddress: string;
  sellTokenAddress: string;
  estimatedGas: string;
}

export async function fetchSwapQuote(
  sellTokenAddress: string,
  buyTokenAddress: string,
  sellAmountWei: string,
  chainId: number = 11155111,
  takerAddress?: string
): Promise<SwapQuote> {
  // If Sepolia Testnet, Mock the Response
  if (chainId === 11155111) {
    await new Promise(resolve => setTimeout(resolve, 800)); // Simulate delay
    
    let mockExchangeRate = 1;
    const isETH = sellTokenAddress.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const isUNI = buyTokenAddress.toLowerCase() === '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'.toLowerCase();

    if (isETH && isUNI) mockExchangeRate = 500;
    else if (!isETH && isUNI) mockExchangeRate = 500;
    
    // Simplistic float math for mock assuming 18 decimals
    const sellAmountFloat = Number(sellAmountWei) / 1e18;
    const buyAmountFloat = sellAmountFloat * mockExchangeRate;
    const expectedBuyAmountWei = BigInt(Math.floor(buyAmountFloat * 1e18)).toString();

    return {
      buyAmount: expectedBuyAmountWei,
      sellAmount: sellAmountWei,
      price: mockExchangeRate.toString(),
      guaranteedPrice: mockExchangeRate.toString(),
      to: takerAddress || '0x000000000000000000000000000000000000dEaD', // Burn address or self
      data: '0x', // Empty data for simple transfer
      value: isETH ? sellAmountWei : '0',
      gasPrice: '2000000000', // 2 gwei
      gas: '21000',
      estimatedGas: '21000',
      buyTokenAddress,
      sellTokenAddress
    };
  }

  // Real 0x API for Mainnet (v2 API requires chainId and taker)
  const apiKey = import.meta.env.VITE_ZEROEX_API_KEY;
  if (!apiKey) throw new Error('VITE_ZEROEX_API_KEY is missing');

  const url = `https://api.0x.org/swap/permit2/quote?chainId=${chainId}&sellToken=${sellTokenAddress}&buyToken=${buyTokenAddress}&sellAmount=${sellAmountWei}${takerAddress ? `&taker=${takerAddress}` : ''}`;
  
  const response = await fetch(url, {
    headers: {
      '0x-api-key': apiKey,
      '0x-version': 'v2',
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('0x API Error:', errorBody);
    
    try {
      const parsed = JSON.parse(errorBody);
      throw new Error(parsed.validationErrors?.[0]?.reason || parsed.reason || parsed.message || 'Failed to fetch quote');
    } catch {
      throw new Error(`Failed to fetch quote: ${response.statusText}`);
    }
  }

  return response.json();
}
