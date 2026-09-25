use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::error::PerpError;
use crate::events::FeesWithdrawn;
use crate::state::{Config, Pool};
use crate::utils::vault_transfer;

/// Send the protocol's `fee_reserves` to `to` (any USDC token account).
#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    pub admin: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ PerpError::NotAdmin,
        has_one = usdc_mint,
        has_one = token_program,
    )]
    pub config: Box<Account<'info, Config>>,

    #[account(mut, seeds = [POOL_SEED], bump = pool.bump, has_one = vault)]
    pub pool: Box<Account<'info, Pool>>,

    #[account(mut)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut, token::mint = usdc_mint, token::token_program = token_program)]
    pub to: Box<InterfaceAccount<'info, TokenAccount>>,

    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn process_withdraw_fees(ctx: Context<WithdrawFees>) -> Result<()> {
    let amount = ctx.accounts.pool.fee_reserves;
    require!(amount > 0, PerpError::NoFees);
    ctx.accounts.pool.fee_reserves = 0;
    vault_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.vault,
        &ctx.accounts.usdc_mint,
        ctx.accounts.to.to_account_info(),
        &ctx.accounts.pool,
        amount,
    )?;
    emit!(FeesWithdrawn { to: ctx.accounts.to.key(), amount });
    Ok(())
}
