use anchor_lang::prelude::*;

use crate::constants::*;
use crate::engine::{update_funding, ExecError, MarketSet};
use crate::error::PerpError;
use crate::state::{Config, Pool};
use crate::utils::emit_funding;

/// Accrue funding for one market (permissionless; the keeper calls it hourly, and it also runs
/// on every trade). Remaining accounts: every market + oracle in `Config` order, `market` writable.
#[derive(Accounts)]
pub struct UpdateFunding<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Box<Account<'info, Pool>>,
}

pub fn process_update_funding<'info>(ctx: Context<'info, UpdateFunding<'info>>, market: Pubkey) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let mut set = MarketSet::load(&ctx.accounts.config, ctx.remaining_accounts)?;
    let mi = set.index_of(&market)?;
    require!(set.slots[mi].info.is_writable, PerpError::MarketNotWritable);
    let aum = set.aum(ctx.accounts.pool.pool_amount, now).map_err(ExecError::into_error)?;
    let update = update_funding(&mut set.slots[mi].market, &ctx.accounts.config, aum, now)?;
    set.persist(mi)?;
    emit_funding(market, update)
}
