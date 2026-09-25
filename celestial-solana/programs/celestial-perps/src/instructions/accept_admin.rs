use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::PerpError;
use crate::state::Config;

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub pending_admin: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = pending_admin @ PerpError::NotPendingAdmin,
    )]
    pub config: Box<Account<'info, Config>>,
}

pub fn process_accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = config.pending_admin;
    config.pending_admin = Pubkey::default();
    Ok(())
}
