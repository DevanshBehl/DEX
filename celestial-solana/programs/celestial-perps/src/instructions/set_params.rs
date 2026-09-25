use anchor_lang::prelude::*;

use crate::constants::*;
use crate::engine::{update_funding, ExecError, MarketSet};
use crate::error::PerpError;
use crate::events::ParamUpdated;
use crate::state::{Config, Pool};
use crate::utils::emit_funding;

/// Every field is optional; only the given ones change. Bounds are the EVM setter bounds.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default, Debug)]
pub struct ParamsUpdate {
    pub max_leverage: Option<u64>,
    pub maintenance_margin_bps: Option<u64>,
    pub position_fee_bps: Option<u64>,
    pub liquidation_fee_bps: Option<u64>,
    pub execution_spread_bps: Option<u64>,
    pub max_profit_multiplier: Option<u64>,
    pub oi_cap_bps: Option<u64>,
    pub funding_factor_per_hour: Option<u64>,
    pub max_funding_rate_per_hour: Option<u64>,
    pub request_expiry: Option<i64>,
    pub min_execution_fee_lamports: Option<u64>,
    pub min_collateral: Option<u64>,
    pub lp_mint_fee_bps: Option<u64>,
    pub protocol_fee_share_bps: Option<u64>,
    pub lp_cooldown: Option<i64>,
}

/// Remaining accounts: every market (writable) + oracle in `Config` order — required only
/// when funding parameters change, so accrued funding is settled at the old rates first.
#[derive(Accounts)]
pub struct SetParams<'info> {
    pub admin: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ PerpError::NotAdmin)]
    pub config: Box<Account<'info, Config>>,

    #[account(mut, seeds = [POOL_SEED], bump = pool.bump)]
    pub pool: Box<Account<'info, Pool>>,
}

fn bounded(key: &str, v: u64, min: u64, max: u64) -> Result<u64> {
    require!(v >= min && v <= max, PerpError::InvalidParam);
    emit!(ParamUpdated { key: key.to_string(), value: v });
    Ok(v)
}

fn bounded_i64(key: &str, v: i64, min: i64, max: i64) -> Result<i64> {
    require!(v >= min && v <= max, PerpError::InvalidParam);
    emit!(ParamUpdated { key: key.to_string(), value: u64::try_from(v).map_err(|_| error!(PerpError::InvalidParam))? });
    Ok(v)
}

pub fn process_set_params<'info>(ctx: Context<'info, SetParams<'info>>, p: ParamsUpdate) -> Result<()> {
    let config = &mut ctx.accounts.config;

    // Margin params are validated together: maxLeverage × mmBps < BPS.
    if p.max_leverage.is_some() || p.maintenance_margin_bps.is_some() {
        let lev = p.max_leverage.unwrap_or(config.max_leverage);
        let mm = p.maintenance_margin_bps.unwrap_or(config.maintenance_margin_bps);
        let product = lev.checked_mul(mm).ok_or(error!(PerpError::InvalidParam))?;
        require!(lev > 0 && mm > 0 && u128::from(product) < BPS, PerpError::InvalidParam);
        config.max_leverage = lev;
        config.maintenance_margin_bps = mm;
        emit!(ParamUpdated { key: "maxLeverage".to_string(), value: lev });
        emit!(ParamUpdated { key: "maintenanceMarginBps".to_string(), value: mm });
    }
    if let Some(v) = p.position_fee_bps {
        config.position_fee_bps = bounded("positionFeeBps", v, 0, 100)?;
    }
    if let Some(v) = p.liquidation_fee_bps {
        config.liquidation_fee_bps = bounded("liquidationFeeBps", v, 0, 200)?;
    }
    if let Some(v) = p.execution_spread_bps {
        config.execution_spread_bps = bounded("executionSpreadBps", v, 0, 100)?;
    }
    if let Some(v) = p.max_profit_multiplier {
        config.max_profit_multiplier = bounded("maxProfitMultiplier", v, 1, 20)?;
    }
    if let Some(v) = p.oi_cap_bps {
        config.oi_cap_bps = bounded("oiCapBps", v, 0, 10_000)?;
    }
    if p.funding_factor_per_hour.is_some() || p.max_funding_rate_per_hour.is_some() {
        let factor = bounded("fundingFactorPerHour", p.funding_factor_per_hour.unwrap_or(config.funding_factor_per_hour), 0, 10_000_000_000_000_000)?;
        let max_rate = bounded("maxFundingRatePerHour", p.max_funding_rate_per_hour.unwrap_or(config.max_funding_rate_per_hour), 0, 10_000_000_000_000_000)?;
        // Settle accrued funding at the old rates first.
        let now = Clock::get()?.unix_timestamp;
        let mut set = MarketSet::load(config, ctx.remaining_accounts)?;
        let aum = set.aum(ctx.accounts.pool.pool_amount, now).map_err(ExecError::into_error)?;
        for i in 0..set.slots.len() {
            let update = update_funding(&mut set.slots[i].market, config, aum, now)?;
            set.persist(i)?;
            emit_funding(*set.slots[i].info.key, update)?;
        }
        config.funding_factor_per_hour = factor;
        config.max_funding_rate_per_hour = max_rate;
    }
    if let Some(v) = p.request_expiry {
        config.request_expiry = bounded_i64("requestExpiry", v, 10, 3_600)?;
    }
    if let Some(v) = p.min_execution_fee_lamports {
        config.min_execution_fee_lamports = bounded("minExecutionFee", v, 0, 10_000_000)?; // ≤ 0.01 SOL
    }
    if let Some(v) = p.min_collateral {
        config.min_collateral = bounded("minCollateral", v, 1_000_000, 10_000_000_000)?;
    }

    let pool = &mut ctx.accounts.pool;
    if let Some(v) = p.lp_mint_fee_bps {
        pool.lp_mint_fee_bps = bounded("lpMintFeeBps", v, 0, 100)?;
    }
    if let Some(v) = p.protocol_fee_share_bps {
        pool.protocol_fee_share_bps = bounded("protocolFeeShareBps", v, 0, 5_000)?;
    }
    if let Some(v) = p.lp_cooldown {
        pool.lp_cooldown = bounded_i64("lpCooldown", v, 0, 86_400)?;
    }
    Ok(())
}
