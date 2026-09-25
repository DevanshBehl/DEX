use anchor_lang::prelude::*;

use crate::constants::{MAX_KEEPERS, MAX_MARKETS, MAX_SYMBOL_LEN};

/// Global configuration and engine parameters (mirror of PerpEngine.sol state).
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    pub keepers: [Pubkey; MAX_KEEPERS],
    pub paused: bool,
    pub usdc_mint: Pubkey,
    pub token_program: Pubkey,
    #[max_len(MAX_MARKETS)]
    pub markets: Vec<Pubkey>,

    pub max_leverage: u64,
    pub maintenance_margin_bps: u64,
    pub position_fee_bps: u64,
    pub liquidation_fee_bps: u64,
    pub execution_spread_bps: u64,
    pub max_profit_multiplier: u64,
    pub oi_cap_bps: u64,
    pub funding_factor_per_hour: u64,
    pub max_funding_rate_per_hour: u64,
    pub request_expiry: i64,
    pub min_execution_fee_lamports: u64,
    pub min_collateral: u64,
    pub bump: u8,
    pub mint_authority_bump: u8,
}

impl Config {
    pub fn is_keeper(&self, key: &Pubkey) -> bool {
        *key != Pubkey::default() && self.keepers.contains(key)
    }
}

/// LP pool accounting. All USDC sits in one vault owned by this PDA.
#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub vault: Pubkey,
    pub clp_mint: Pubkey,
    pub pool_amount: u64,
    pub reserved_amount: u64,
    pub fee_reserves: u64,
    pub total_collateral: u64,
    pub total_escrow: u64,
    pub lp_mint_fee_bps: u64,
    pub protocol_fee_share_bps: u64,
    pub lp_cooldown: i64,
    pub bump: u8,
    pub vault_bump: u8,
    pub clp_mint_bump: u8,
}

/// Where a market's price comes from. `Mock` is only readable when the program is built with
/// the `mock-oracle` feature (local tests); the devnet build rejects it.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum OracleKind {
    Chainlink,
    Mock,
}

#[account]
#[derive(InitSpace)]
pub struct Market {
    #[max_len(MAX_SYMBOL_LEN)]
    pub symbol: String,
    pub oracle: Pubkey,
    pub oracle_kind: OracleKind,
    pub max_age: u32,
    pub enabled: bool,
    pub last_funding_time: i64,
    pub long_size: u64,
    pub short_size: u64,
    pub long_tokens: u128,
    pub short_tokens: u128,
    pub long_collateral: u64,
    pub short_collateral: u64,
    pub cum_funding_long: u128,
    pub cum_funding_short: u128,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub owner: Pubkey,
    pub market: Pubkey,
    pub is_long: bool,
    pub size: u64,
    pub collateral: u64,
    pub tokens: u128,
    pub reserved: u64,
    pub entry_funding_index: u128,
    pub last_updated: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum RequestKind {
    Increase,
    Decrease,
}

/// Pending order. Holds `execution_fee` (+ `position_rent`) lamports on top of its own rent;
/// closed on execute/cancel.
#[account]
#[derive(InitSpace)]
pub struct Request {
    pub owner: Pubkey,
    pub market: Pubkey,
    pub position: Pubkey,
    pub is_long: bool,
    pub kind: RequestKind,
    pub collateral_delta: u64,
    pub size_delta: u64,
    pub acceptable_price: u64,
    pub execution_fee: u64,
    /// Lamports prepaid by the trader for the `Position` account's rent (increase requests
    /// when the position does not exist yet); used to create it on execution, else refunded.
    pub position_rent: u64,
    pub created_at: i64,
    pub nonce: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserState {
    pub owner: Pubkey,
    pub request_nonce: u64,
    pub last_lp_add_at: i64,
    pub last_faucet_at: i64,
    pub bump: u8,
}

/// View payload returned by `get_market_info`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct MarketInfo {
    pub enabled: bool,
    pub price: u64,
    pub long_size: u64,
    pub short_size: u64,
    pub long_capacity: u64,
    pub short_capacity: u64,
    pub funding_rate_long_per_hour: u64,
    pub funding_rate_short_per_hour: u64,
    pub cum_funding_long: u128,
    pub cum_funding_short: u128,
}

/// Admin-settable price account for local tests (`mock-oracle` feature only).
#[cfg(feature = "mock-oracle")]
#[account]
#[derive(InitSpace)]
pub struct MockOracle {
    pub answer: i64,
    pub timestamp: i64,
    pub decimals: u8,
}
