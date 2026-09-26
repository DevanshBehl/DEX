// Readable messages for contract / program errors and request cancel reasons. EVM custom
// errors and Solana Anchor error names are mapped to the same text where they mean the same.

const MESSAGES: Record<string, string> = {
  // wallet
  UserRejected: "Rejected in wallet.",
  WrongNetwork: "Switch your wallet to Sepolia to continue.",
  // trading / requests
  InsufficientExecutionFee: "Execution fee is below the minimum.",
  EmptyRequest: "Enter a collateral or size amount.",
  RequestNotExpired: "This order can be cancelled 60 s after it was placed.",
  RequestNotPending: "This order was already filled or cancelled.",
  NotRequestOwner: "Only the trader who placed this order can cancel it.",
  RequestMismatch: "This order belongs to another account.",
  InvalidNonce: "Order number out of sync — refresh and try again.",
  MarketDisabled: "This market is disabled.",
  MarketNotListed: "This market is not listed on this chain.",
  EnforcedPause: "Trading is paused — new positions are disabled (closing still works).",
  Paused: "Trading is paused — new positions are disabled (closing still works).",
  // cancel reasons (keeper execution)
  UserCancelled: "Cancelled by you.",
  SlippageExceeded: "Price moved past your slippage limit.",
  StalePrice: "Oracle price was stale.",
  InvalidPrice: "Oracle price was invalid.",
  PositionNotFound: "No open position to reduce.",
  SizeTooLarge: "Reduce size is larger than the position.",
  CollateralTooLow: "Collateral is below the 10 USDC minimum.",
  LeverageTooLow: "Size must be at least the collateral (1x).",
  LeverageTooHigh: "Leverage above the maximum.",
  OpenInterestCap: "Open-interest cap reached for this side.",
  ReserveCap: "Pool has no capacity to back this position.",
  ReserveExceedsPool: "Pool has no capacity to back this position.",
  PositionLiquidatable: "The position would be liquidatable after this change.",
  InsufficientCollateral: "Not enough collateral for fees and funding.",
  InsufficientPoolAmount: "Pool cannot pay this profit right now.",
  MathError: "Order could not be executed (amounts out of range).",
  // liquidity
  Slippage: "Amount out moved past your minimum — try again.",
  CooldownActive: "Liquidity can be removed 15 minutes after your last deposit.",
  InsufficientUnreservedLiquidity: "Not enough unreserved liquidity: open positions reserve part of the pool.",
  ZeroAum: "Pool AUM is zero.",
  ZeroAmount: "Enter an amount greater than zero.",
  // faucet / tokens
  FaucetCooldown: "Faucet already claimed — try again in 24 h.",
  ERC20InsufficientBalance: "Not enough USDC.",
  ERC20InsufficientAllowance: "Approve USDC first.",
  InsufficientFunds: "Not enough balance to pay for this transaction.",
};

export function messageFor(code: string | undefined | null, fallback = "Transaction failed."): string {
  if (!code) return fallback;
  return MESSAGES[code] ?? `${fallback} (${code})`;
}

/** True when the user closed/rejected the wallet prompt (EIP-1193 4001, Wallet Standard). */
export function isUserRejection(e: unknown): boolean {
  const x = e as { code?: unknown; info?: { error?: { code?: unknown } }; message?: string };
  if (x?.code === 4001 || x?.code === "ACTION_REJECTED" || x?.info?.error?.code === 4001) return true;
  return /user rejected|rejected the request|denied|cancelled by user|user declined/i.test(String(x?.message ?? ""));
}
