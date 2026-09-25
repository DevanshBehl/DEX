//! Events — same names and fields as the EVM PerpEngine / LiquidityPool events.

use anchor_lang::prelude::*;

use crate::error::CancelReason;
use crate::state::RequestKind;

#[event]
pub struct RequestCreated {
    pub request: Pubkey,
    pub owner: Pubkey,
    pub market: Pubkey,
    pub is_long: bool,
    pub kind: RequestKind,
    pub collateral_delta: u64,
    pub size_delta: u64,
    pub acceptable_price: u64,
    pub execution_fee: u64,
    pub nonce: u64,
}

#[event]
pub struct RequestExecuted {
    pub request: Pubkey,
    pub owner: Pubkey,
    pub keeper: Pubkey,
}

#[event]
pub struct RequestCancelled {
    pub request: Pubkey,
    pub owner: Pubkey,
    pub by: Pubkey,
    pub reason: CancelReason,
}

#[event]
pub struct PositionIncreased {
    pub position: Pubkey,
    pub owner: Pubkey,
    pub market: Pubkey,
    pub is_long: bool,
    pub size_delta: u64,
    pub collateral_delta: u64,
    pub execution_price: u64,
    pub fee: u64,
    pub funding_paid: u64,
    pub size: u64,
    pub collateral: u64,
    pub entry_price: u64,
}

#[event]
pub struct PositionDecreased {
    pub position: Pubkey,
    pub owner: Pubkey,
    pub market: Pubkey,
    pub is_long: bool,
    pub size_delta: u64,
    pub collateral_out: u64,
    pub execution_price: u64,
    /// Profit capped by the reserve; losses uncapped.
    pub realised_pnl: i64,
    pub fee: u64,
    pub funding_paid: u64,
    pub size: u64,
    pub collateral: u64,
}

#[event]
pub struct PositionClosed {
    pub position: Pubkey,
    pub owner: Pubkey,
    pub market: Pubkey,
    pub is_long: bool,
}

#[event]
pub struct PositionLiquidated {
    pub position: Pubkey,
    pub owner: Pubkey,
    pub market: Pubkey,
    pub is_long: bool,
    pub size: u64,
    pub collateral: u64,
    pub price: u64,
    pub keeper: Pubkey,
    pub keeper_fee: u64,
}

#[event]
pub struct FundingUpdated {
    pub market: Pubkey,
    pub rate_long_per_hour: u64,
    pub rate_short_per_hour: u64,
    pub cum_long: u128,
    pub cum_short: u128,
}

#[event]
pub struct LiquidityAdded {
    pub owner: Pubkey,
    pub amount: u64,
    pub fee: u64,
    pub clp_minted: u64,
    pub aum: u64,
}

#[event]
pub struct LiquidityRemoved {
    pub owner: Pubkey,
    pub clp_burned: u64,
    pub amount_out: u64,
    pub aum: u64,
}

#[event]
pub struct FeesAdded {
    pub amount: u64,
    pub to_protocol: u64,
    pub to_pool: u64,
}

#[event]
pub struct FeesWithdrawn {
    pub to: Pubkey,
    pub amount: u64,
}

#[event]
pub struct ParamUpdated {
    pub key: String,
    pub value: u64,
}

#[event]
pub struct MarketListed {
    pub market: Pubkey,
    pub symbol: String,
    pub oracle: Pubkey,
}

#[event]
pub struct MarketEnabled {
    pub market: Pubkey,
    pub enabled: bool,
}

#[event]
pub struct KeeperUpdated {
    pub keeper: Pubkey,
    pub active: bool,
}

#[event]
pub struct FaucetClaimed {
    pub user: Pubkey,
    pub amount: u64,
}
