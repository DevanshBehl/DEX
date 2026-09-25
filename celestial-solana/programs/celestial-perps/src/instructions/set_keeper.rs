use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::PerpError;
use crate::events::KeeperUpdated;
use crate::state::Config;

#[derive(Accounts)]
pub struct SetKeeper<'info> {
    pub admin: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ PerpError::NotAdmin)]
    pub config: Box<Account<'info, Config>>,
}

pub fn process_set_keeper(ctx: Context<SetKeeper>, keeper: Pubkey, active: bool) -> Result<()> {
    require_keys_neq!(keeper, Pubkey::default(), PerpError::ZeroAddress);
    let config = &mut ctx.accounts.config;
    let existing = config.keepers.iter().position(|k| *k == keeper);
    match (active, existing) {
        (true, None) => {
            let slot = config
                .keepers
                .iter()
                .position(|k| *k == Pubkey::default())
                .ok_or(error!(PerpError::KeeperListFull))?;
            config.keepers[slot] = keeper;
        }
        (false, Some(i)) => config.keepers[i] = Pubkey::default(),
        _ => {}
    }
    emit!(KeeperUpdated { keeper, active });
    Ok(())
}
