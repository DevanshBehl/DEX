use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::PerpError;
use crate::state::Config;

/// Step 1 of the two-step admin transfer (Ownable2Step). `Pubkey::default()` cancels.
#[derive(Accounts)]
pub struct TransferAdmin<'info> {
    pub admin: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ PerpError::NotAdmin)]
    pub config: Box<Account<'info, Config>>,
}

pub fn process_transfer_admin(ctx: Context<TransferAdmin>, new_admin: Pubkey) -> Result<()> {
    ctx.accounts.config.pending_admin = new_admin;
    Ok(())
}
