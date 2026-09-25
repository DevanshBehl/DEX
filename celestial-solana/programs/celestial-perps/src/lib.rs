//! # Celestial Perps (Solana)
//!
//! Pool-counterparty perpetuals: the Solana half of the protocol in `docs/protocol-spec.md`.
//! Behaviour mirrors `celestial-contracts/src/PerpEngine.sol` and `pool/LiquidityPool.sol`
//! step for step; the differences Solana forces are listed in `celestial-solana/README.md`.

pub mod constants;
pub mod engine;
pub mod error;
pub mod events;
pub mod instructions;
pub mod math;
pub mod oracle;
pub mod state;
pub mod utils;

use anchor_lang::prelude::*;

pub use instructions::*;
use state::{MarketInfo, OracleKind};

declare_id!("EK1KpDGfUiZ4XkWixAaRFonDexZYSKnJm8oJz5s7HLTL");

#[program]
pub mod celestial_perps {
    use super::*;

    // ── Admin ──

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        process_initialize(ctx)
    }

    pub fn add_market(ctx: Context<AddMarket>, symbol: String, oracle_kind: OracleKind, max_age: u32) -> Result<()> {
        process_add_market(ctx, symbol, oracle_kind, max_age)
    }

    pub fn set_market_enabled(ctx: Context<SetMarketEnabled>, enabled: bool) -> Result<()> {
        process_set_market_enabled(ctx, enabled)
    }

    pub fn set_keeper(ctx: Context<SetKeeper>, keeper: Pubkey, active: bool) -> Result<()> {
        process_set_keeper(ctx, keeper, active)
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        process_set_paused(ctx, paused)
    }

    pub fn set_params<'info>(ctx: Context<'info, SetParams<'info>>, params: ParamsUpdate) -> Result<()> {
        process_set_params(ctx, params)
    }

    pub fn transfer_admin(ctx: Context<TransferAdmin>, new_admin: Pubkey) -> Result<()> {
        process_transfer_admin(ctx, new_admin)
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        process_accept_admin(ctx)
    }

    pub fn withdraw_fees(ctx: Context<WithdrawFees>) -> Result<()> {
        process_withdraw_fees(ctx)
    }

    // ── Faucet (mock USDC) ──

    pub fn faucet(ctx: Context<Faucet>) -> Result<()> {
        process_faucet(ctx)
    }

    // ── LP ──

    pub fn add_liquidity<'info>(ctx: Context<'info, AddLiquidity<'info>>, amount: u64, min_clp: u64) -> Result<()> {
        process_add_liquidity(ctx, amount, min_clp)
    }

    pub fn remove_liquidity<'info>(
        ctx: Context<'info, RemoveLiquidity<'info>>,
        clp_amount: u64,
        min_usdc: u64,
    ) -> Result<()> {
        process_remove_liquidity(ctx, clp_amount, min_usdc)
    }

    // ── Trader ──

    pub fn request_increase(
        ctx: Context<RequestIncrease>,
        nonce: u64,
        is_long: bool,
        collateral_delta: u64,
        size_delta: u64,
        acceptable_price: u64,
        execution_fee: u64,
    ) -> Result<()> {
        process_request_increase(ctx, nonce, is_long, collateral_delta, size_delta, acceptable_price, execution_fee)
    }

    pub fn request_decrease(
        ctx: Context<RequestDecrease>,
        nonce: u64,
        is_long: bool,
        collateral_delta: u64,
        size_delta: u64,
        acceptable_price: u64,
        execution_fee: u64,
    ) -> Result<()> {
        process_request_decrease(ctx, nonce, is_long, collateral_delta, size_delta, acceptable_price, execution_fee)
    }

    pub fn cancel_request(ctx: Context<CancelRequest>) -> Result<()> {
        process_cancel_request(ctx)
    }

    // ── Keeper ──

    pub fn execute_request<'info>(ctx: Context<'info, ExecuteRequest<'info>>) -> Result<()> {
        process_execute_request(ctx)
    }

    pub fn liquidate<'info>(ctx: Context<'info, Liquidate<'info>>) -> Result<()> {
        process_liquidate(ctx)
    }

    pub fn update_funding<'info>(ctx: Context<'info, UpdateFunding<'info>>, market: Pubkey) -> Result<()> {
        process_update_funding(ctx, market)
    }

    // ── Views (read-only; call them with `simulateTransaction` and read the return data) ──

    pub fn get_aum<'info>(ctx: Context<'info, PoolView<'info>>) -> Result<u64> {
        process_get_aum(ctx)
    }

    pub fn get_clp_price<'info>(ctx: Context<'info, ClpPriceView<'info>>) -> Result<u64> {
        process_get_clp_price(ctx)
    }

    pub fn get_liquidation_price(ctx: Context<PositionView>) -> Result<u64> {
        process_get_liquidation_price(ctx)
    }

    pub fn get_market_info<'info>(ctx: Context<'info, PoolView<'info>>, market: Pubkey) -> Result<MarketInfo> {
        process_get_market_info(ctx, market)
    }

    // ── Test-only price control (`mock-oracle` feature; never in the devnet build) ──

    #[cfg(feature = "mock-oracle")]
    pub fn init_mock_oracle(ctx: Context<InitMockOracle>, symbol: String, answer: i64, decimals: u8) -> Result<()> {
        process_init_mock_oracle(ctx, symbol, answer, decimals)
    }

    #[cfg(feature = "mock-oracle")]
    pub fn set_mock_price(ctx: Context<SetMockPrice>, answer: i64, timestamp: i64) -> Result<()> {
        process_set_mock_price(ctx, answer, timestamp)
    }
}
