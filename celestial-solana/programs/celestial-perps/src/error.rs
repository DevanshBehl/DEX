use anchor_lang::prelude::*;

/// Hard errors: the transaction fails. Business-rule failures during keeper execution are
/// NOT errors — they cancel the request instead (see `CancelReason`).
#[error_code]
pub enum PerpError {
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Division by zero")]
    DivisionByZero,
    #[msg("Signer is not the admin")]
    NotAdmin,
    #[msg("Signer is not the pending admin")]
    NotPendingAdmin,
    #[msg("Signer is not a keeper")]
    NotKeeper,
    #[msg("Keeper list is full")]
    KeeperListFull,
    #[msg("Program is paused")]
    Paused,
    #[msg("Invalid parameter")]
    InvalidParam,
    #[msg("Market symbol must be 1-16 bytes")]
    InvalidSymbol,
    #[msg("Market list is full")]
    MarketListFull,
    #[msg("Market is disabled")]
    MarketDisabled,
    #[msg("Remaining accounts must list every market and its oracle in config order")]
    InvalidMarketAccounts,
    #[msg("Oracle account does not match the market")]
    OracleMismatch,
    #[msg("Oracle account is not owned by the Chainlink store program")]
    InvalidOracleOwner,
    #[msg("Oracle account data could not be decoded")]
    InvalidOracleData,
    #[msg("Oracle answer is not positive")]
    InvalidOracleAnswer,
    #[msg("Oracle price is stale")]
    StalePrice,
    #[msg("Execution fee below minimum")]
    InsufficientExecutionFee,
    #[msg("Request is empty")]
    EmptyRequest,
    #[msg("Request has not expired yet")]
    RequestNotExpired,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Slippage exceeded")]
    Slippage,
    #[msg("LP cooldown is active")]
    CooldownActive,
    #[msg("Not enough unreserved liquidity")]
    InsufficientUnreservedLiquidity,
    #[msg("Pool AUM is zero")]
    ZeroAum,
    #[msg("Faucet cooldown is active")]
    FaucetCooldown,
    #[msg("Position is not liquidatable")]
    NotLiquidatable,
    #[msg("Position does not exist")]
    PositionNotFound,
    #[msg("No fees to withdraw")]
    NoFees,
    #[msg("Reserved amount would exceed pool amount")]
    ReserveExceedsPool,
    #[msg("Insufficient pool amount")]
    InsufficientPoolAmount,
    #[msg("Oracle kind is not supported by this build")]
    UnsupportedOracleKind,
    #[msg("Request nonce does not match the user's next nonce")]
    InvalidNonce,
    #[msg("Account does not match the request")]
    RequestMismatch,
    #[msg("Position account does not match the expected PDA")]
    InvalidPosition,
    #[msg("Market account must be writable")]
    MarketNotWritable,
    #[msg("Zero address")]
    ZeroAddress,
    #[msg("Execution fee lamports missing from the request account")]
    InsufficientRequestLamports,
}

/// Why a request was cancelled during execution (emitted in `RequestCancelled.reason`).
/// Mirrors the EVM custom errors that cause a cancel in `PerpEngine.executeRequests`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum CancelReason {
    UserCancelled,
    Paused,
    MarketDisabled,
    StalePrice,
    SlippageExceeded,
    PositionNotFound,
    SizeTooLarge,
    CollateralTooLow,
    LeverageTooLow,
    LeverageTooHigh,
    OpenInterestCap,
    ReserveCap,
    PositionLiquidatable,
    InsufficientCollateral,
    /// Oracle answer not positive / zero timestamp / unsupported decimals.
    InvalidPrice,
    /// Profit payout larger than `pool_amount` (EVM `InsufficientPoolAmount`).
    InsufficientPoolAmount,
    /// Arithmetic overflow on extreme inputs (EVM: panic caught by try/catch → cancel).
    MathError,
}
