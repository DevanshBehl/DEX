use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::error::PerpError;
use crate::state::{Config, Pool};

/// One-time setup: config, pool, the USDC vault and the CLP mint (Token-2022, 6 decimals,
/// authority = Pool PDA). `token_program` must own the USDC mint; both are pinned in `Config`.
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(init, payer = admin, space = 8 + Pool::INIT_SPACE, seeds = [POOL_SEED], bump)]
    pub pool: Box<Account<'info, Pool>>,

    #[account(
        init,
        payer = admin,
        seeds = [VAULT_SEED],
        bump,
        token::mint = usdc_mint,
        token::authority = pool,
        token::token_program = token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = admin,
        seeds = [CLP_MINT_SEED],
        bump,
        mint::decimals = CLP_DECIMALS,
        mint::authority = pool,
        mint::token_program = token_program,
    )]
    pub clp_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mint::token_program = token_program,
        constraint = usdc_mint.decimals == USDC_DECIMALS @ PerpError::InvalidParam,
    )]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn process_initialize(ctx: Context<Initialize>) -> Result<()> {
    let (_, mint_authority_bump) = Pubkey::find_program_address(&[MINT_AUTHORITY_SEED], ctx.program_id);

    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.pending_admin = Pubkey::default();
    config.keepers = [Pubkey::default(); MAX_KEEPERS];
    config.paused = false;
    config.usdc_mint = ctx.accounts.usdc_mint.key();
    config.token_program = ctx.accounts.token_program.key();
    config.markets = Vec::new();
    config.max_leverage = DEFAULT_MAX_LEVERAGE;
    config.maintenance_margin_bps = DEFAULT_MAINTENANCE_MARGIN_BPS;
    config.position_fee_bps = DEFAULT_POSITION_FEE_BPS;
    config.liquidation_fee_bps = DEFAULT_LIQUIDATION_FEE_BPS;
    config.execution_spread_bps = DEFAULT_EXECUTION_SPREAD_BPS;
    config.max_profit_multiplier = DEFAULT_MAX_PROFIT_MULTIPLIER;
    config.oi_cap_bps = DEFAULT_OI_CAP_BPS;
    config.funding_factor_per_hour = DEFAULT_FUNDING_FACTOR_PER_HOUR;
    config.max_funding_rate_per_hour = DEFAULT_MAX_FUNDING_RATE_PER_HOUR;
    config.request_expiry = DEFAULT_REQUEST_EXPIRY_SECS;
    config.min_execution_fee_lamports = DEFAULT_MIN_EXECUTION_FEE_LAMPORTS;
    config.min_collateral = DEFAULT_MIN_COLLATERAL;
    config.bump = ctx.bumps.config;
    config.mint_authority_bump = mint_authority_bump;

    let pool = &mut ctx.accounts.pool;
    pool.vault = ctx.accounts.vault.key();
    pool.clp_mint = ctx.accounts.clp_mint.key();
    pool.pool_amount = 0;
    pool.reserved_amount = 0;
    pool.fee_reserves = 0;
    pool.total_collateral = 0;
    pool.total_escrow = 0;
    pool.lp_mint_fee_bps = DEFAULT_LP_MINT_FEE_BPS;
    pool.protocol_fee_share_bps = DEFAULT_PROTOCOL_FEE_SHARE_BPS;
    pool.lp_cooldown = DEFAULT_LP_COOLDOWN_SECS;
    pool.bump = ctx.bumps.pool;
    pool.vault_bump = ctx.bumps.vault;
    pool.clp_mint_bump = ctx.bumps.clp_mint;
    Ok(())
}
