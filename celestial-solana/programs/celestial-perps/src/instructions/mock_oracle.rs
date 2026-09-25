//! Admin-controlled price accounts for local tests only. Compiled in ONLY with the
//! `mock-oracle` Cargo feature, which the devnet build never enables — check the deployed
//! IDL: it must contain no `initMockOracle` / `setMockPrice` instruction.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::PerpError;
use crate::state::{Config, MockOracle};

#[derive(Accounts)]
#[instruction(symbol: String)]
pub struct InitMockOracle<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ PerpError::NotAdmin)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        init,
        payer = admin,
        space = 8 + MockOracle::INIT_SPACE,
        seeds = [MOCK_ORACLE_SEED, symbol.as_bytes()],
        bump,
    )]
    pub mock_oracle: Box<Account<'info, MockOracle>>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetMockPrice<'info> {
    pub admin: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ PerpError::NotAdmin)]
    pub config: Box<Account<'info, Config>>,

    #[account(mut)]
    pub mock_oracle: Box<Account<'info, MockOracle>>,
}

pub fn process_init_mock_oracle(
    ctx: Context<InitMockOracle>,
    _symbol: String,
    answer: i64,
    decimals: u8,
) -> Result<()> {
    let m = &mut ctx.accounts.mock_oracle;
    m.answer = answer;
    m.decimals = decimals;
    m.timestamp = Clock::get()?.unix_timestamp;
    Ok(())
}

/// `timestamp = 0` means "now".
pub fn process_set_mock_price(ctx: Context<SetMockPrice>, answer: i64, timestamp: i64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let m = &mut ctx.accounts.mock_oracle;
    m.answer = answer;
    m.timestamp = if timestamp == 0 { now } else { timestamp };
    Ok(())
}
