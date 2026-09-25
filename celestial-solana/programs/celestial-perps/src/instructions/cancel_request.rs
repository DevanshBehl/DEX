use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::engine::sub;
use crate::error::{CancelReason, PerpError};
use crate::events::RequestCancelled;
use crate::state::{Config, Pool, Request, RequestKind};
use crate::utils::vault_transfer;

/// Owner cancels their own request after `request_expiry`: escrow back to `owner_usdc`, the
/// execution fee and all rent back to the owner (the request account is closed).
#[derive(Accounts)]
pub struct CancelRequest<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint, has_one = token_program)]
    pub config: Box<Account<'info, Config>>,

    #[account(mut, seeds = [POOL_SEED], bump = pool.bump, has_one = vault)]
    pub pool: Box<Account<'info, Pool>>,

    #[account(mut)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, token::mint = usdc_mint, token::authority = owner, token::token_program = token_program)]
    pub owner_usdc: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, has_one = owner @ PerpError::RequestMismatch, close = owner)]
    pub request: Box<Account<'info, Request>>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn process_cancel_request(ctx: Context<CancelRequest>) -> Result<()> {
    let r = &ctx.accounts.request;
    let now = Clock::get()?.unix_timestamp;
    let cancellable_at = r
        .created_at
        .checked_add(ctx.accounts.config.request_expiry)
        .ok_or(error!(PerpError::MathOverflow))?;
    require!(now >= cancellable_at, PerpError::RequestNotExpired);

    if r.kind == RequestKind::Increase {
        let amount = r.collateral_delta;
        ctx.accounts.pool.total_escrow = sub(ctx.accounts.pool.total_escrow, amount)?;
        vault_transfer(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.usdc_mint,
            ctx.accounts.owner_usdc.to_account_info(),
            &ctx.accounts.pool,
            amount,
        )?;
    }
    emit!(RequestCancelled {
        request: r.key(),
        owner: r.owner,
        by: r.owner,
        reason: CancelReason::UserCancelled,
    });
    Ok(())
}
