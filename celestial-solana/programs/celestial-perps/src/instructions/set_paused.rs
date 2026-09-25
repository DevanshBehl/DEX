use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::PerpError;
use crate::events::ParamUpdated;
use crate::state::Config;

/// `pause` / `unpause`. Pausing blocks new increases (request + execution) only; decreases,
/// cancels, liquidations and LP flows keep working, as on EVM.
#[derive(Accounts)]
pub struct SetPaused<'info> {
    pub admin: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ PerpError::NotAdmin)]
    pub config: Box<Account<'info, Config>>,
}

pub fn process_set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
    ctx.accounts.config.paused = paused;
    emit!(ParamUpdated { key: "paused".to_string(), value: u64::from(paused) });
    Ok(())
}
