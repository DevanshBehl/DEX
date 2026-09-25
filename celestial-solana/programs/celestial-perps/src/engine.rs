//! Execution core — a step-for-step mirror of `PerpEngine.sol` and the `LiquidityPool.sol`
//! bucket hooks.
//!
//! Everything here works on in-memory copies of `Pool` / `Market` / `Position`. The caller
//! commits the copies only when a whole step succeeds. That is how a Solana instruction
//! reproduces the EVM `try/catch`: a failed request leaves no partial state behind and is
//! cancelled instead of failing the transaction.

use anchor_lang::prelude::*;

use crate::constants::{BPS, MARKET_SEED};
use crate::error::{CancelReason, PerpError};
use crate::math;
use crate::oracle;
use crate::state::{Config, Market, OracleKind, Pool, Position, Request};

/// A step either succeeds, cancels with a business reason, or fails hard.
#[derive(Debug)]
pub enum ExecError {
    Cancel(CancelReason),
    Fatal(Error),
}

impl From<Error> for ExecError {
    fn from(e: Error) -> Self {
        ExecError::Fatal(e)
    }
}

impl ExecError {
    /// Outside keeper execution (LP, liquidation, funding, views) the EVM reverts, so do we.
    pub fn into_error(self) -> Error {
        match self {
            ExecError::Fatal(e) => e,
            ExecError::Cancel(r) => match r {
                CancelReason::StalePrice => error!(PerpError::StalePrice),
                CancelReason::InvalidPrice => error!(PerpError::InvalidOracleAnswer),
                CancelReason::ReserveCap => error!(PerpError::ReserveExceedsPool),
                CancelReason::InsufficientPoolAmount => error!(PerpError::InsufficientPoolAmount),
                CancelReason::MarketDisabled => error!(PerpError::MarketDisabled),
                CancelReason::Paused => error!(PerpError::Paused),
                _ => error!(PerpError::MathOverflow),
            },
        }
    }

    /// Inside keeper execution every failure after account validation becomes a cancel.
    pub fn into_reason(self) -> CancelReason {
        match self {
            ExecError::Cancel(r) => r,
            ExecError::Fatal(_) => CancelReason::MathError,
        }
    }
}

pub type Exec<T> = core::result::Result<T, ExecError>;

fn cancel<T>(reason: CancelReason) -> Exec<T> {
    Err(ExecError::Cancel(reason))
}

pub fn add(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b).ok_or(error!(PerpError::MathOverflow))
}

pub fn sub(a: u64, b: u64) -> Result<u64> {
    a.checked_sub(b).ok_or(error!(PerpError::MathOverflow))
}

pub fn mul(a: u64, b: u64) -> Result<u64> {
    a.checked_mul(b).ok_or(error!(PerpError::MathOverflow))
}

// ═══════════════════════════════════════════════════════════
//  POOL BUCKETS (LiquidityPool.sol engine hooks)
// ═══════════════════════════════════════════════════════════

#[derive(Clone, Copy, Debug, Default)]
pub struct FeeSplit {
    pub amount: u64,
    pub to_protocol: u64,
    pub to_pool: u64,
}

pub fn escrow_to_collateral(pool: &mut Pool, amount: u64) -> Result<()> {
    pool.total_escrow = sub(pool.total_escrow, amount)?;
    pool.total_collateral = add(pool.total_collateral, amount)?;
    Ok(())
}

pub fn collateral_to_pool(pool: &mut Pool, amount: u64) -> Result<()> {
    pool.total_collateral = sub(pool.total_collateral, amount)?;
    pool.pool_amount = add(pool.pool_amount, amount)?;
    Ok(())
}

/// Returns the split for a `FeesAdded` event (`amount == 0` → no event, as on EVM).
pub fn collateral_to_fees(pool: &mut Pool, amount: u64) -> Result<FeeSplit> {
    if amount == 0 {
        return Ok(FeeSplit::default());
    }
    pool.total_collateral = sub(pool.total_collateral, amount)?;
    let to_protocol = math::to_u64(math::mul_div_floor(
        u128::from(amount),
        u128::from(pool.protocol_fee_share_bps),
        BPS,
    )?)?;
    let to_pool = sub(amount, to_protocol)?;
    pool.fee_reserves = add(pool.fee_reserves, to_protocol)?;
    pool.pool_amount = add(pool.pool_amount, to_pool)?;
    Ok(FeeSplit { amount, to_protocol, to_pool })
}

pub fn collateral_out(pool: &mut Pool, amount: u64) -> Result<()> {
    pool.total_collateral = sub(pool.total_collateral, amount)?;
    Ok(())
}

pub fn pool_to_trader(pool: &mut Pool, amount: u64) -> Exec<()> {
    if amount == 0 {
        return Ok(());
    }
    if amount > pool.pool_amount {
        return cancel(CancelReason::InsufficientPoolAmount);
    }
    pool.pool_amount -= amount;
    if pool.reserved_amount > pool.pool_amount {
        return cancel(CancelReason::ReserveCap);
    }
    Ok(())
}

pub fn reserve(pool: &mut Pool, amount: u64) -> Exec<()> {
    pool.reserved_amount = add(pool.reserved_amount, amount)?;
    if pool.reserved_amount > pool.pool_amount {
        return cancel(CancelReason::ReserveCap);
    }
    Ok(())
}

pub fn unreserve(pool: &mut Pool, amount: u64) -> Result<()> {
    pool.reserved_amount = sub(pool.reserved_amount, amount)?;
    Ok(())
}

// ═══════════════════════════════════════════════════════════
//  MARKET SET (remaining accounts: [market_0, oracle_0, market_1, oracle_1, …])
// ═══════════════════════════════════════════════════════════

pub struct MarketSlot<'a, 'info> {
    pub info: &'a AccountInfo<'info>,
    pub oracle: &'a AccountInfo<'info>,
    pub market: Market,
}

/// Every listed market plus its oracle, validated against `Config.markets` (count, order, PDA,
/// owner, oracle key and owner). A missing or reordered market is a hard error, otherwise
/// AUM could be manipulated by leaving out a market with trader losses/profits.
pub struct MarketSet<'a, 'info> {
    pub slots: Vec<MarketSlot<'a, 'info>>,
}

impl<'a, 'info> MarketSet<'a, 'info> {
    pub fn load(config: &Config, remaining: &'a [AccountInfo<'info>]) -> Result<Self> {
        require!(remaining.len() == config.markets.len() * 2, PerpError::InvalidMarketAccounts);
        let mut slots = Vec::with_capacity(config.markets.len());
        for (i, key) in config.markets.iter().enumerate() {
            let info = &remaining[2 * i];
            let oracle_info = &remaining[2 * i + 1];
            require_keys_eq!(*info.key, *key, PerpError::InvalidMarketAccounts);
            require_keys_eq!(*info.owner, crate::ID, PerpError::InvalidMarketAccounts);
            let market = {
                let data = info.try_borrow_data()?;
                Market::try_deserialize(&mut &data[..])?
            };
            let pda = Pubkey::create_program_address(
                &[MARKET_SEED, market.symbol.as_bytes(), &[market.bump]],
                &crate::ID,
            )
            .map_err(|_| error!(PerpError::InvalidMarketAccounts))?;
            require_keys_eq!(pda, *key, PerpError::InvalidMarketAccounts);
            require_keys_eq!(*oracle_info.key, market.oracle, PerpError::OracleMismatch);
            check_oracle_owner(oracle_info, market.oracle_kind)?;
            slots.push(MarketSlot { info, oracle: oracle_info, market });
        }
        Ok(Self { slots })
    }

    pub fn index_of(&self, key: &Pubkey) -> Result<usize> {
        self.slots
            .iter()
            .position(|s| s.info.key == key)
            .ok_or(error!(PerpError::InvalidMarketAccounts))
    }

    /// Current 8-decimal price of market `i`; stale/invalid answers are business failures.
    pub fn price(&self, i: usize, now: i64) -> Exec<u128> {
        let slot = &self.slots[i];
        let round = oracle::read_round(slot.oracle, &slot.market.oracle, slot.market.oracle_kind)
            .map_err(|_| ExecError::Cancel(CancelReason::InvalidPrice))?;
        oracle::check_round(round, now, slot.market.max_age).map_err(ExecError::Cancel)
    }

    /// Σ per-market net trader PnL at the raw oracle price (floored at −collateral per market).
    /// Markets without open interest are skipped (no oracle read), as on EVM.
    pub fn net_trader_pnl(&self, now: i64) -> Exec<i128> {
        let mut net: i128 = 0;
        for (i, slot) in self.slots.iter().enumerate() {
            let m = &slot.market;
            if m.long_size == 0 && m.short_size == 0 {
                continue;
            }
            let price = self.price(i, now)?;
            let market_pnl = math::pnl(true, u128::from(m.long_size), m.long_tokens, price)?
                .checked_add(math::pnl(false, u128::from(m.short_size), m.short_tokens, price)?)
                .ok_or(error!(PerpError::MathOverflow))?;
            let floor = -i128::from(add(m.long_collateral, m.short_collateral)?);
            net = net
                .checked_add(market_pnl.max(floor))
                .ok_or(error!(PerpError::MathOverflow))?;
        }
        Ok(net)
    }

    /// AUM = max(0, poolAmount − net trader PnL) — docs/perp-math.md §10.
    pub fn aum(&self, pool_amount: u64, now: i64) -> Exec<u128> {
        let aum = i128::from(pool_amount)
            .checked_sub(self.net_trader_pnl(now)?)
            .ok_or(error!(PerpError::MathOverflow))?;
        Ok(if aum > 0 { aum as u128 } else { 0 }) // positive, checked
    }

    /// Write market `i` (after `slots[i].market` was modified) back to its account.
    pub fn persist(&self, i: usize) -> Result<()> {
        let slot = &self.slots[i];
        require!(slot.info.is_writable, PerpError::MarketNotWritable);
        let mut data = slot.info.try_borrow_mut_data()?;
        let mut dst: &mut [u8] = &mut data;
        slot.market.try_serialize(&mut dst)
    }
}

pub fn check_oracle_owner(info: &AccountInfo, kind: OracleKind) -> Result<()> {
    match kind {
        OracleKind::Chainlink => {
            require_keys_eq!(*info.owner, crate::constants::CHAINLINK_STORE_PROGRAM, PerpError::InvalidOracleOwner)
        }
        #[cfg(feature = "mock-oracle")]
        OracleKind::Mock => require_keys_eq!(*info.owner, crate::ID, PerpError::InvalidOracleOwner),
        #[cfg(not(feature = "mock-oracle"))]
        OracleKind::Mock => return err!(PerpError::UnsupportedOracleKind),
    }
    Ok(())
}

// ═══════════════════════════════════════════════════════════
//  FUNDING
// ═══════════════════════════════════════════════════════════

#[derive(Clone, Copy, Debug)]
pub struct FundingUpdate {
    pub rate_long: u128,
    pub rate_short: u128,
    pub cum_long: u128,
    pub cum_short: u128,
}

pub fn current_funding_rates(m: &Market, config: &Config, aum: u128) -> Result<(u128, u128)> {
    let rate = math::funding_rate_per_hour(
        u128::from(m.long_size),
        u128::from(m.short_size),
        aum,
        u128::from(config.funding_factor_per_hour),
        u128::from(config.max_funding_rate_per_hour),
    )?;
    Ok(if m.long_size > m.short_size {
        (rate, 0)
    } else if m.short_size > m.long_size {
        (0, rate)
    } else {
        (0, 0)
    })
}

/// `_updateFunding`: accrue the heavier side's index since the last update.
/// Returns the values for a `FundingUpdated` event, or `None` when nothing accrued.
pub fn update_funding(m: &mut Market, config: &Config, aum: u128, now: i64) -> Result<Option<FundingUpdate>> {
    let last = m.last_funding_time;
    if last == now {
        return Ok(None);
    }
    m.last_funding_time = now;
    if last == 0 {
        return Ok(None);
    }
    let (rate_long, rate_short) = current_funding_rates(m, config, aum)?;
    let elapsed = u128::try_from(now.checked_sub(last).ok_or(error!(PerpError::MathOverflow))?)
        .map_err(|_| error!(PerpError::MathOverflow))?;
    if rate_long > 0 {
        m.cum_funding_long = m
            .cum_funding_long
            .checked_add(math::funding_index_delta(rate_long, elapsed)?)
            .ok_or(error!(PerpError::MathOverflow))?;
    }
    if rate_short > 0 {
        m.cum_funding_short = m
            .cum_funding_short
            .checked_add(math::funding_index_delta(rate_short, elapsed)?)
            .ok_or(error!(PerpError::MathOverflow))?;
    }
    Ok(Some(FundingUpdate { rate_long, rate_short, cum_long: m.cum_funding_long, cum_short: m.cum_funding_short }))
}

pub fn funding_owed(p: &Position, m: &Market) -> Result<u64> {
    if p.size == 0 {
        return Ok(0);
    }
    let cum = if p.is_long { m.cum_funding_long } else { m.cum_funding_short };
    math::to_u64(math::funding_owed(u128::from(p.size), cum, p.entry_funding_index)?)
}

// ═══════════════════════════════════════════════════════════
//  POSITION HELPERS
// ═══════════════════════════════════════════════════════════

pub fn add_to_market(m: &mut Market, p: &Position) -> Result<()> {
    let overflow = || error!(PerpError::MathOverflow);
    if p.is_long {
        m.long_size = add(m.long_size, p.size)?;
        m.long_tokens = m.long_tokens.checked_add(p.tokens).ok_or_else(overflow)?;
        m.long_collateral = add(m.long_collateral, p.collateral)?;
    } else {
        m.short_size = add(m.short_size, p.size)?;
        m.short_tokens = m.short_tokens.checked_add(p.tokens).ok_or_else(overflow)?;
        m.short_collateral = add(m.short_collateral, p.collateral)?;
    }
    Ok(())
}

pub fn remove_from_market(m: &mut Market, p: &Position) -> Result<()> {
    let overflow = || error!(PerpError::MathOverflow);
    if p.is_long {
        m.long_size = sub(m.long_size, p.size)?;
        m.long_tokens = m.long_tokens.checked_sub(p.tokens).ok_or_else(overflow)?;
        m.long_collateral = sub(m.long_collateral, p.collateral)?;
    } else {
        m.short_size = sub(m.short_size, p.size)?;
        m.short_tokens = m.short_tokens.checked_sub(p.tokens).ok_or_else(overflow)?;
        m.short_collateral = sub(m.short_collateral, p.collateral)?;
    }
    Ok(())
}

pub fn close_fee(size: u64, config: &Config) -> Result<u128> {
    math::position_fee(u128::from(size), u128::from(config.position_fee_bps))
}

/// `_validatePosition`: min collateral, 1x ≤ leverage ≤ max, not liquidatable at the raw price.
pub fn validate_position(p: &Position, price: u128, config: &Config) -> Exec<()> {
    if p.collateral < config.min_collateral {
        return cancel(CancelReason::CollateralTooLow);
    }
    if p.size < p.collateral {
        return cancel(CancelReason::LeverageTooLow);
    }
    let max_size = u128::from(p.collateral)
        .checked_mul(u128::from(config.max_leverage))
        .ok_or(error!(PerpError::MathOverflow))?;
    if u128::from(p.size) > max_size {
        return cancel(CancelReason::LeverageTooHigh);
    }
    let pnl = math::pnl(p.is_long, u128::from(p.size), p.tokens, price)?;
    if math::is_liquidatable(
        u128::from(p.collateral),
        pnl,
        0,
        close_fee(p.size, config)?,
        u128::from(p.size),
        u128::from(config.maintenance_margin_bps),
    )? {
        return cancel(CancelReason::PositionLiquidatable);
    }
    Ok(())
}

/// `_setReserve`
pub fn set_reserve(pool: &mut Pool, p: &mut Position, target: u64) -> Exec<()> {
    if target > p.reserved {
        reserve(pool, target - p.reserved)?;
    } else if target < p.reserved {
        unreserve(pool, p.reserved - target)?;
    }
    p.reserved = target;
    Ok(())
}

// ═══════════════════════════════════════════════════════════
//  EXECUTION
// ═══════════════════════════════════════════════════════════

pub struct IncreaseOutcome {
    pub funding_update: Option<FundingUpdate>,
    pub execution_price: u64,
    pub fee: u64,
    pub fee_split: FeeSplit,
    pub funding_paid: u64,
    pub entry_price: u64,
}

pub struct DecreaseOutcome {
    pub funding_update: Option<FundingUpdate>,
    pub execution_price: u64,
    pub fee: u64,
    pub fee_split: FeeSplit,
    pub funding_paid: u64,
    pub realised_pnl: i64,
    pub collateral_out: u64,
    pub profit: u64,
    pub is_full: bool,
}

/// `_increase`. `p` is the existing position or a zeroed one (size 0) for a new position.
#[allow(clippy::too_many_arguments)]
pub fn increase(
    config: &Config,
    pool: &mut Pool,
    set: &mut MarketSet,
    mi: usize,
    p: &mut Position,
    r: &Request,
    now: i64,
) -> Exec<IncreaseOutcome> {
    if config.paused {
        return cancel(CancelReason::Paused);
    }
    if !set.slots[mi].market.enabled {
        return cancel(CancelReason::MarketDisabled);
    }

    let aum = set.aum(pool.pool_amount, now)?;
    let funding_update = update_funding(&mut set.slots[mi].market, config, aum, now)?;
    let price = set.price(mi, now)?;
    let exec = math::execution_price(price, r.is_long, true, u128::from(config.execution_spread_bps))?;
    let acceptable = u128::from(r.acceptable_price);
    if if r.is_long { exec > acceptable } else { exec < acceptable } {
        return cancel(CancelReason::SlippageExceeded);
    }

    let m = &mut set.slots[mi].market;
    if p.size > 0 {
        remove_from_market(m, p)?;
    }

    // Settle funding accrued on the existing position.
    let funding = funding_owed(p, m)?;
    if funding >= add(p.collateral, r.collateral_delta)? {
        return cancel(CancelReason::InsufficientCollateral);
    }

    // Move escrow into collateral, then charge funding and the open fee.
    escrow_to_collateral(pool, r.collateral_delta)?;
    p.collateral = add(p.collateral, r.collateral_delta)?;
    if funding > 0 {
        p.collateral -= funding;
        collateral_to_pool(pool, funding)?;
    }
    let fee = math::to_u64(close_fee(r.size_delta, config)?)?;
    if fee >= p.collateral {
        return cancel(CancelReason::InsufficientCollateral);
    }
    p.collateral -= fee;
    let fee_split = collateral_to_fees(pool, fee)?;

    p.size = add(p.size, r.size_delta)?;
    p.tokens = p
        .tokens
        .checked_add(math::tokens_for(u128::from(r.size_delta), exec, r.is_long)?)
        .ok_or(error!(PerpError::MathOverflow))?;
    p.entry_funding_index = if r.is_long { m.cum_funding_long } else { m.cum_funding_short };
    p.last_updated = now;

    // Open-interest cap on the side after this increase.
    let side_size = u128::from(add(if r.is_long { m.long_size } else { m.short_size }, p.size)?);
    let cap = math::mul_div_floor(aum, u128::from(config.oi_cap_bps), BPS)?;
    if side_size > cap {
        return cancel(CancelReason::OpenInterestCap);
    }

    validate_position(p, price, config)?;
    set_reserve(pool, p, mul(config.max_profit_multiplier, p.collateral)?)?;
    add_to_market(m, p)?;

    Ok(IncreaseOutcome {
        funding_update,
        execution_price: math::to_u64(exec)?,
        fee,
        fee_split,
        funding_paid: funding,
        entry_price: math::to_u64(math::entry_price(u128::from(p.size), p.tokens)?)?,
    })
}

/// `_decrease`. `p` must be an existing position (size > 0).
pub fn decrease(
    config: &Config,
    pool: &mut Pool,
    set: &mut MarketSet,
    mi: usize,
    p: &mut Position,
    r: &Request,
    now: i64,
) -> Exec<DecreaseOutcome> {
    if p.size == 0 {
        return cancel(CancelReason::PositionNotFound);
    }
    if r.size_delta > p.size {
        return cancel(CancelReason::SizeTooLarge);
    }

    let aum = set.aum(pool.pool_amount, now)?;
    let funding_update = update_funding(&mut set.slots[mi].market, config, aum, now)?;
    let price = set.price(mi, now)?;
    let exec = math::execution_price(price, r.is_long, false, u128::from(config.execution_spread_bps))?;
    let acceptable = u128::from(r.acceptable_price);
    if if r.is_long { exec < acceptable } else { exec > acceptable } {
        return cancel(CancelReason::SlippageExceeded);
    }

    let m = &mut set.slots[mi].market;
    remove_from_market(m, p)?;
    let is_full = r.size_delta == p.size;

    // Realise PnL on the closed portion.
    let tokens_out = if is_full {
        p.tokens
    } else {
        math::mul_div_floor(p.tokens, u128::from(r.size_delta), u128::from(p.size))?
    };
    let pnl = math::pnl(p.is_long, u128::from(r.size_delta), tokens_out, exec)?;
    let funding = funding_owed(p, m)?;
    let fee = math::to_u64(close_fee(r.size_delta, config)?)?;

    let (profit, loss) = if pnl > 0 {
        (math::to_u64(pnl as u128)?.min(p.reserved), 0u64) // positive, checked
    } else {
        (0u64, math::to_u64(pnl.unsigned_abs())?)
    };
    let realised: i128 = if pnl > 0 { i128::from(profit) } else { pnl }; // profit capped by the reserve

    let charges = add(add(loss, funding)?, fee)?;
    if charges > p.collateral {
        return cancel(CancelReason::PositionLiquidatable);
    }
    p.collateral -= charges;

    let collateral_out_amt = if is_full { p.collateral } else { r.collateral_delta };
    if collateral_out_amt > p.collateral {
        return cancel(CancelReason::InsufficientCollateral);
    }
    p.collateral -= collateral_out_amt;

    p.size -= r.size_delta;
    p.tokens = p.tokens.checked_sub(tokens_out).ok_or(error!(PerpError::MathOverflow))?;
    p.entry_funding_index = if p.is_long { m.cum_funding_long } else { m.cum_funding_short };
    p.last_updated = now;

    // Settle buckets: losses + funding → pool, fee → fees, profit ← pool, collateral → trader.
    let to_pool = add(loss, funding)?;
    if to_pool > 0 {
        collateral_to_pool(pool, to_pool)?;
    }
    let fee_split = collateral_to_fees(pool, fee)?;

    let old_reserve = p.reserved;
    unreserve(pool, old_reserve)?;
    p.reserved = 0;
    pool_to_trader(pool, profit)?;
    collateral_out(pool, collateral_out_amt)?;

    if !is_full {
        validate_position(p, price, config)?;
        // Never re-reserve more than was released minus profit paid, so a partial close
        // can't fail on capacity.
        let new_reserve = mul(config.max_profit_multiplier, p.collateral)?.min(sub(old_reserve, profit)?);
        reserve(pool, new_reserve)?;
        p.reserved = new_reserve;
        add_to_market(m, p)?;
    }

    Ok(DecreaseOutcome {
        funding_update,
        execution_price: math::to_u64(exec)?,
        fee,
        fee_split,
        funding_paid: funding,
        realised_pnl: i64::try_from(realised).map_err(|_| error!(PerpError::MathOverflow))?,
        collateral_out: collateral_out_amt,
        profit,
        is_full,
    })
}

pub struct LiquidationOutcome {
    pub funding_update: Option<FundingUpdate>,
    pub price: u64,
    pub keeper_fee: u64,
}

/// `liquidate`: raw oracle price, keeper fee = min(size × liqFee, collateral), rest to the pool.
pub fn liquidate(
    config: &Config,
    pool: &mut Pool,
    set: &mut MarketSet,
    mi: usize,
    p: &Position,
    now: i64,
) -> Result<LiquidationOutcome> {
    let aum = set.aum(pool.pool_amount, now).map_err(ExecError::into_error)?;
    let funding_update = update_funding(&mut set.slots[mi].market, config, aum, now)?;
    let price = set.price(mi, now).map_err(ExecError::into_error)?;
    let m = &mut set.slots[mi].market;
    let funding = funding_owed(p, m)?;
    let pnl = math::pnl(p.is_long, u128::from(p.size), p.tokens, price)?;
    require!(
        math::is_liquidatable(
            u128::from(p.collateral),
            pnl,
            u128::from(funding),
            close_fee(p.size, config)?,
            u128::from(p.size),
            u128::from(config.maintenance_margin_bps),
        )?,
        PerpError::NotLiquidatable
    );

    remove_from_market(m, p)?;
    let keeper_fee = math::to_u64(math::mul_div_floor(
        u128::from(p.size),
        u128::from(config.liquidation_fee_bps),
        BPS,
    )?)?
    .min(p.collateral);
    unreserve(pool, p.reserved)?;
    collateral_to_pool(pool, p.collateral - keeper_fee)?;
    collateral_out(pool, keeper_fee)?;

    Ok(LiquidationOutcome { funding_update, price: math::to_u64(price)?, keeper_fee })
}
