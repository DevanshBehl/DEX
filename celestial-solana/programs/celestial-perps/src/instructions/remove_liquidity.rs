use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Burn, Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::engine::{sub, ExecError, MarketSet};
use crate::error::PerpError;
use crate::events::LiquidityRemoved;
use crate::math;
use crate::state::{Config, Pool, UserState};
use crate::utils::vault_transfer;

/// Burn CLP for USDC at the current AUM; cannot dip into reserved liquidity.
/// Remaining accounts: every market + oracle.
#[derive(Accounts)]
pub struct RemoveLiquidity<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint, has_one = token_program)]
    pub config: Box<Account<'info, Config>>,

    #[account(mut, seeds = [POOL_SEED], bump = pool.bump, has_one = vault, has_one = clp_mint)]
    pub pool: Box<Account<'info, Pool>>,

    #[account(mut)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub clp_mint: Box<InterfaceAccount<'info, Mint>>,

    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, token::mint = usdc_mint, token::authority = user, token::token_program = token_program)]
    pub user_usdc: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = clp_mint, token::authority = user, token::token_program = token_program)]
    pub user_clp: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Created on the fly for holders who received CLP by transfer (never added liquidity).
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserState::INIT_SPACE,
        seeds = [USER_SEED, user.key().as_ref()],
        bump,
    )]
    pub user_state: Box<Account<'info, UserState>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn process_remove_liquidity<'info>(
    ctx: Context<'info, RemoveLiquidity<'info>>,
    clp_amount: u64,
    min_usdc: u64,
) -> Result<()> {
    require!(clp_amount > 0, PerpError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;
    let user = ctx.accounts.user.key();
    let state = &mut ctx.accounts.user_state;
    if state.owner == Pubkey::default() {
        state.owner = user;
        state.bump = ctx.bumps.user_state;
    }
    let available_at = ctx
        .accounts
        .user_state
        .last_lp_add_at
        .checked_add(ctx.accounts.pool.lp_cooldown)
        .ok_or(error!(PerpError::MathOverflow))?;
    require!(now >= available_at, PerpError::CooldownActive);

    let set = MarketSet::load(&ctx.accounts.config, ctx.remaining_accounts)?;
    let aum = set.aum(ctx.accounts.pool.pool_amount, now).map_err(ExecError::into_error)?;
    let amount_out = math::to_u64(math::usdc_for_clp(
        u128::from(clp_amount),
        aum,
        u128::from(ctx.accounts.clp_mint.supply),
    )?)?;
    require!(amount_out > 0 && amount_out >= min_usdc, PerpError::Slippage);

    let pool = &mut ctx.accounts.pool;
    let available = sub(pool.pool_amount, pool.reserved_amount)?;
    require!(amount_out <= available, PerpError::InsufficientUnreservedLiquidity);
    pool.pool_amount -= amount_out;

    token_interface::burn(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Burn {
                mint: ctx.accounts.clp_mint.to_account_info(),
                from: ctx.accounts.user_clp.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        clp_amount,
    )?;
    vault_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.vault,
        &ctx.accounts.usdc_mint,
        ctx.accounts.user_usdc.to_account_info(),
        &ctx.accounts.pool,
        amount_out,
    )?;
    emit!(LiquidityRemoved {
        owner: ctx.accounts.user.key(),
        clp_burned: clp_amount,
        amount_out,
        aum: math::to_u64(aum)?,
    });
    Ok(())
}
