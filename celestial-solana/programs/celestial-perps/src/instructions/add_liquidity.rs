use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, MintTo, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::engine::{add, ExecError, MarketSet};
use crate::error::PerpError;
use crate::events::LiquidityAdded;
use crate::math;
use crate::state::{Config, Pool, UserState};
use crate::utils::user_transfer;

/// Deposit USDC for CLP at the current AUM. Remaining accounts: every market + oracle.
#[derive(Accounts)]
pub struct AddLiquidity<'info> {
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

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = clp_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_clp: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserState::INIT_SPACE,
        seeds = [USER_SEED, user.key().as_ref()],
        bump,
    )]
    pub user_state: Box<Account<'info, UserState>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn process_add_liquidity<'info>(
    ctx: Context<'info, AddLiquidity<'info>>,
    amount: u64,
    min_clp: u64,
) -> Result<()> {
    require!(amount > 0, PerpError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;
    let set = MarketSet::load(&ctx.accounts.config, ctx.remaining_accounts)?;
    let aum = set.aum(ctx.accounts.pool.pool_amount, now).map_err(ExecError::into_error)?;
    let supply = u128::from(ctx.accounts.clp_mint.supply);
    require!(supply == 0 || aum != 0, PerpError::ZeroAum);

    let fee = math::position_fee(u128::from(amount), u128::from(ctx.accounts.pool.lp_mint_fee_bps))?;
    let after_fee = u128::from(amount).checked_sub(fee).ok_or(error!(PerpError::MathOverflow))?;
    let minted = math::to_u64(math::clp_to_mint(after_fee, aum, supply)?)?;
    require!(minted > 0 && minted >= min_clp, PerpError::Slippage);

    let pool = &mut ctx.accounts.pool;
    pool.pool_amount = add(pool.pool_amount, amount)?;

    let user = ctx.accounts.user.key();
    let state = &mut ctx.accounts.user_state;
    if state.owner == Pubkey::default() {
        state.owner = user;
        state.bump = ctx.bumps.user_state;
    }
    state.last_lp_add_at = now;

    user_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.user_usdc,
        &ctx.accounts.usdc_mint,
        &ctx.accounts.vault,
        ctx.accounts.user.to_account_info(),
        amount,
    )?;
    let bump = [ctx.accounts.pool.bump];
    let seeds: &[&[u8]] = &[POOL_SEED, &bump];
    token_interface::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.clp_mint.to_account_info(),
                to: ctx.accounts.user_clp.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            },
            &[seeds],
        ),
        minted,
    )?;
    emit!(LiquidityAdded {
        owner: user,
        amount,
        fee: math::to_u64(fee)?,
        clp_minted: minted,
        aum: math::to_u64(aum)?,
    });
    Ok(())
}
