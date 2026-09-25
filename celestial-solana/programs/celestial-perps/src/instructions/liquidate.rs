use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::engine::{self, MarketSet};
use crate::error::PerpError;
use crate::events::PositionLiquidated;
use crate::state::{Config, Pool, Position};
use crate::utils::{emit_funding, vault_transfer};

/// Keeper liquidates an under-margined position at the raw oracle price. Keeper fee =
/// min(0.5% × size, collateral) in USDC; the rest of the collateral goes to the pool; the
/// position account is closed and its rent returned to the trader. Works while paused.
///
/// Remaining accounts: every market + oracle in `Config` order; the position's market writable.
#[derive(Accounts)]
pub struct Liquidate<'info> {
    #[account(mut)]
    pub keeper: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = usdc_mint,
        has_one = token_program,
        constraint = config.is_keeper(&keeper.key()) @ PerpError::NotKeeper,
    )]
    pub config: Box<Account<'info, Config>>,

    #[account(mut, seeds = [POOL_SEED], bump = pool.bump, has_one = vault)]
    pub pool: Box<Account<'info, Pool>>,

    #[account(mut)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, token::mint = usdc_mint, token::authority = keeper, token::token_program = token_program)]
    pub keeper_usdc: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        seeds = [POSITION_SEED, position.owner.as_ref(), position.market.as_ref(), &[u8::from(position.is_long)]],
        bump = position.bump,
        has_one = owner @ PerpError::InvalidPosition,
        close = owner,
    )]
    pub position: Box<Account<'info, Position>>,

    /// CHECK: position owner; receives the position account's rent.
    #[account(mut)]
    pub owner: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn process_liquidate<'info>(ctx: Context<'info, Liquidate<'info>>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let p: Position = (**ctx.accounts.position).clone();
    require!(p.size > 0, PerpError::PositionNotFound);
    let mut set = MarketSet::load(&ctx.accounts.config, ctx.remaining_accounts)?;
    let mi = set.index_of(&p.market)?;

    let o = engine::liquidate(&ctx.accounts.config, &mut ctx.accounts.pool, &mut set, mi, &p, now)?;
    set.persist(mi)?;
    emit_funding(p.market, o.funding_update)?;

    vault_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.vault,
        &ctx.accounts.usdc_mint,
        ctx.accounts.keeper_usdc.to_account_info(),
        &ctx.accounts.pool,
        o.keeper_fee,
    )?;
    emit!(PositionLiquidated {
        position: ctx.accounts.position.key(),
        owner: p.owner,
        market: p.market,
        is_long: p.is_long,
        size: p.size,
        collateral: p.collateral,
        price: o.price,
        keeper: ctx.accounts.keeper.key(),
        keeper_fee: o.keeper_fee,
    });
    Ok(())
}
