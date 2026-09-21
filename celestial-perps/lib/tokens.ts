// Mock USDC (testnet collateral) per chain — mirrors deployments/*.json.

export const MOCK_USDC = {
  sepolia: {
    address: "0x88a77050162285276d6346a4Bc07C406572d6cD2",
    decimals: 6,
    faucetAmount: 10_000,
  },
  solanaDevnet: {
    mint: "2LW8DzDa2KVxDxqUqZLALc6htcVSDwGK1JGz4VaaTn1Y",
    tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // Token-2022
    decimals: 6,
  },
} as const;
