use anchor_lang::prelude::*;

use crate::constants::*;
use crate::engine::check_oracle_owner;
use crate::error::PerpError;
use crate::events::{MarketEnabled, MarketListed};
use crate::oracle;
use crate::state::{Config, Market, OracleKind};

/// `listMarket`: creates `["market", symbol]`. Rejected unless the oracle can be read right now.
#[derive(Accounts)]
#[instruction(symbol: String)]
pub struct AddMarket<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ PerpError::NotAdmin)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        init,
        payer = admin,
        space = 8 + Market::INIT_SPACE,
        seeds = [MARKET_SEED, symbol.as_bytes()],
        bump,
    )]
    pub market: Box<Account<'info, Market>>,

    /// CHECK: validated in the handler (owner per `oracle_kind`, decodable, fresh).
    pub oracle: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn process_add_market(
    ctx: Context<AddMarket>,
    symbol: String,
    oracle_kind: OracleKind,
    max_age: u32,
) -> Result<()> {
    require!(!symbol.is_empty() && symbol.len() <= MAX_SYMBOL_LEN, PerpError::InvalidSymbol);
    require!((1..=86_400).contains(&max_age), PerpError::InvalidParam);
    require!(ctx.accounts.config.markets.len() < MAX_MARKETS, PerpError::MarketListFull);

    let oracle_info = ctx.accounts.oracle.to_account_info();
    check_oracle_owner(&oracle_info, oracle_kind)?;
    let now = Clock::get()?.unix_timestamp;
    oracle::read_price(&oracle_info, oracle_info.key, oracle_kind, now, max_age)?;

    let key = ctx.accounts.market.key();
    let market = &mut ctx.accounts.market;
    market.symbol = symbol.clone();
    market.oracle = oracle_info.key();
    market.oracle_kind = oracle_kind;
    market.max_age = max_age;
    market.enabled = true;
    market.last_funding_time = now;
    market.bump = ctx.bumps.market;

    ctx.accounts.config.markets.push(key);
    emit!(MarketListed { market: key, symbol, oracle: oracle_info.key() });
    emit!(MarketEnabled { market: key, enabled: true });
    Ok(())
}
