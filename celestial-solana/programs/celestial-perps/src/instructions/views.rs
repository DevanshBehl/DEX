//! Read-only instructions. They change nothing and return a value through the transaction's
//! return data, so a client can read them with `simulateTransaction`.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::constants::*;
use crate::engine::{current_funding_rates, funding_owed, ExecError, MarketSet};
use crate::math;
use crate::state::{Config, Market, MarketInfo, Pool, Position};

#[derive(Accounts)]
pub struct PoolView<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Box<Account<'info, Pool>>,
}

#[derive(Accounts)]
pub struct ClpPriceView<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(seeds = [POOL_SEED], bump = pool.bump, has_one = clp_mint)]
    pub pool: Box<Account<'info, Pool>>,

    pub clp_mint: Box<InterfaceAccount<'info, Mint>>,
}

#[derive(Accounts)]
pub struct PositionView<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        seeds = [POSITION_SEED, position.owner.as_ref(), position.market.as_ref(), &[u8::from(position.is_long)]],
        bump = position.bump,
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(seeds = [MARKET_SEED, market.symbol.as_bytes()], bump = market.bump, constraint = market.key() == position.market)]
    pub market: Box<Account<'info, Market>>,
}

/// AUM in USDC units (6 dp). Remaining accounts: every market + oracle in `Config` order.
pub fn process_get_aum<'info>(ctx: Context<'info, PoolView<'info>>) -> Result<u64> {
    let now = Clock::get()?.unix_timestamp;
    let set = MarketSet::load(&ctx.accounts.config, ctx.remaining_accounts)?;
    math::to_u64(set.aum(ctx.accounts.pool.pool_amount, now).map_err(ExecError::into_error)?)
}

/// USD value of 1 CLP (1e6 units) in 8 decimals; $1 before the first deposit.
/// EVM uses `aum × 1e20 / supply` for 18-decimal CLP; here CLP has 6 decimals, so it is
/// `aum × 1e8 / supply` (docs/perp-math.md, Solana column).
pub fn process_get_clp_price<'info>(ctx: Context<'info, ClpPriceView<'info>>) -> Result<u64> {
    let now = Clock::get()?.unix_timestamp;
    let supply = u128::from(ctx.accounts.clp_mint.supply);
    if supply == 0 {
        return Ok(100_000_000);
    }
    let set = MarketSet::load(&ctx.accounts.config, ctx.remaining_accounts)?;
    let aum = set.aum(ctx.accounts.pool.pool_amount, now).map_err(ExecError::into_error)?;
    math::to_u64(math::mul_div_floor(aum, 100_000_000, supply)?)
}

/// Price at which the position becomes liquidatable (0 when it cannot be).
pub fn process_get_liquidation_price(ctx: Context<PositionView>) -> Result<u64> {
    let p = &ctx.accounts.position;
    let config = &ctx.accounts.config;
    math::to_u64(math::liquidation_price(
        p.is_long,
        u128::from(p.size),
        p.tokens,
        u128::from(p.collateral),
        u128::from(funding_owed(p, &ctx.accounts.market)?),
        math::position_fee(u128::from(p.size), u128::from(config.position_fee_bps))?,
        u128::from(config.maintenance_margin_bps),
    )?)
}

/// Price, OI, remaining capacity per side and the current funding rates.
/// Remaining accounts: every market + oracle in `Config` order.
pub fn process_get_market_info<'info>(
    ctx: Context<'info, PoolView<'info>>,
    market: Pubkey,
) -> Result<MarketInfo> {
    let now = Clock::get()?.unix_timestamp;
    let config = &ctx.accounts.config;
    let set = MarketSet::load(config, ctx.remaining_accounts)?;
    let mi = set.index_of(&market)?;
    let aum = set.aum(ctx.accounts.pool.pool_amount, now).map_err(ExecError::into_error)?;
    let price = set.price(mi, now).map_err(ExecError::into_error)?;
    let m = &set.slots[mi].market;
    let cap = math::to_u64(math::mul_div_floor(aum, u128::from(config.oi_cap_bps), BPS)?)?;
    let (rate_long, rate_short) = current_funding_rates(m, config, aum)?;
    Ok(MarketInfo {
        enabled: m.enabled,
        price: math::to_u64(price)?,
        long_size: m.long_size,
        short_size: m.short_size,
        long_capacity: cap.saturating_sub(m.long_size),
        short_capacity: cap.saturating_sub(m.short_size),
        funding_rate_long_per_hour: math::to_u64(rate_long)?,
        funding_rate_short_per_hour: math::to_u64(rate_short)?,
        cum_funding_long: m.cum_funding_long,
        cum_funding_short: m.cum_funding_short,
    })
}
