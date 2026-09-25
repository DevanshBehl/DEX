use anchor_lang::prelude::*;

// ── Seeds ──
#[constant]
pub const CONFIG_SEED: &[u8] = b"config";
#[constant]
pub const POOL_SEED: &[u8] = b"pool";
#[constant]
pub const VAULT_SEED: &[u8] = b"vault";
#[constant]
pub const CLP_MINT_SEED: &[u8] = b"clp_mint";
#[constant]
pub const MARKET_SEED: &[u8] = b"market";
#[constant]
pub const POSITION_SEED: &[u8] = b"position";
#[constant]
pub const REQUEST_SEED: &[u8] = b"request";
#[constant]
pub const USER_SEED: &[u8] = b"user";
#[constant]
pub const MOCK_ORACLE_SEED: &[u8] = b"mock_oracle";
#[constant]
pub const MINT_AUTHORITY_SEED: &[u8] = b"mint_authority";

// ── Precision (identical to PerpMath.sol, see docs/perp-math.md) ──
pub const BPS: u128 = 10_000;
pub const PRICE_DECIMALS: u32 = 8;
pub const FUNDING_PRECISION: u128 = 1_000_000_000_000_000_000; // 1e18
pub const TOKEN_PRECISION: u128 = 100_000_000_000_000_000_000; // 1e20
pub const USDC_DECIMALS: u8 = 6;
/// CLP has 6 decimals on Solana (18 on EVM) so balances fit in u64 → first mint is 1:1.
pub const CLP_DECIMALS: u8 = 6;
pub const CLP_SCALE: u128 = 1;

// ── Limits ──
pub const MAX_MARKETS: usize = 8;
pub const MAX_KEEPERS: usize = 4;
pub const MAX_SYMBOL_LEN: usize = 16;
/// Chainlink timestamps slightly ahead of the validator clock are accepted up to this skew.
pub const MAX_FUTURE_SKEW_SECS: i64 = 60;

// ── Faucet (mock USDC, testnet only) ──
pub const FAUCET_AMOUNT: u64 = 10_000_000_000; // 10,000 USDC
pub const FAUCET_COOLDOWN_SECS: i64 = 86_400;

// ── Defaults (docs/protocol-spec.md) ──
pub const DEFAULT_MAX_LEVERAGE: u64 = 20;
pub const DEFAULT_MAINTENANCE_MARGIN_BPS: u64 = 250;
pub const DEFAULT_POSITION_FEE_BPS: u64 = 6;
pub const DEFAULT_LIQUIDATION_FEE_BPS: u64 = 50;
pub const DEFAULT_EXECUTION_SPREAD_BPS: u64 = 10;
pub const DEFAULT_MAX_PROFIT_MULTIPLIER: u64 = 9;
pub const DEFAULT_OI_CAP_BPS: u64 = 3_000;
pub const DEFAULT_FUNDING_FACTOR_PER_HOUR: u64 = 300_000_000_000_000; // 3e14
pub const DEFAULT_MAX_FUNDING_RATE_PER_HOUR: u64 = 100_000_000_000_000; // 1e14
pub const DEFAULT_REQUEST_EXPIRY_SECS: i64 = 60;
pub const DEFAULT_MIN_EXECUTION_FEE_LAMPORTS: u64 = 50_000;
pub const DEFAULT_MIN_COLLATERAL: u64 = 10_000_000; // 10 USDC
pub const DEFAULT_LP_MINT_FEE_BPS: u64 = 10;
pub const DEFAULT_PROTOCOL_FEE_SHARE_BPS: u64 = 1_000;
pub const DEFAULT_LP_COOLDOWN_SECS: i64 = 900;
pub const DEFAULT_ORACLE_MAX_AGE_SECS: u32 = 120;

/// Chainlink OCR2 store program (owner of every Chainlink feed account on Solana).
pub const CHAINLINK_STORE_PROGRAM: Pubkey = pubkey!("HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny");
