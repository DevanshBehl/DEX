use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::PerpError;
use crate::events::MarketEnabled;
use crate::state::{Config, Market};

#[derive(Accounts)]
pub struct SetMarketEnabled<'info> {
    pub admin: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ PerpError::NotAdmin)]
    pub config: Box<Account<'info, Config>>,

    #[account(mut, seeds = [MARKET_SEED, market.symbol.as_bytes()], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,
}

pub fn process_set_market_enabled(ctx: Context<SetMarketEnabled>, enabled: bool) -> Result<()> {
    ctx.accounts.market.enabled = enabled;
    emit!(MarketEnabled { market: ctx.accounts.market.key(), enabled });
    Ok(())
}
