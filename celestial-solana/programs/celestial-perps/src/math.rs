//! Pure perps math — a 1:1 mirror of `celestial-contracts/src/libraries/PerpMath.sol`.
//! Every worked example in docs/perp-math.md is asserted in the tests below.
//!
//! Units: usd/size/collateral/fees/pnl 6 dp · price 8 dp · tokens = size·1e20/price ·
//! funding 1e18 fraction of size. Every rounding choice goes against the trader.

use crate::constants::{BPS, CLP_SCALE, FUNDING_PRECISION, TOKEN_PRECISION};
use crate::error::PerpError;
use anchor_lang::prelude::*;

pub fn mul_div_floor(a: u128, b: u128, c: u128) -> Result<u128> {
    require!(c != 0, PerpError::DivisionByZero);
    Ok(a.checked_mul(b).ok_or(PerpError::MathOverflow)? / c)
}

pub fn mul_div_ceil(a: u128, b: u128, c: u128) -> Result<u128> {
    require!(c != 0, PerpError::DivisionByZero);
    let p = a.checked_mul(b).ok_or(PerpError::MathOverflow)?;
    Ok(p / c + u128::from(p % c != 0))
}

pub fn to_i128(v: u128) -> Result<i128> {
    i128::try_from(v).map_err(|_| error!(PerpError::MathOverflow))
}

pub fn to_u64(v: u128) -> Result<u64> {
    u64::try_from(v).map_err(|_| error!(PerpError::MathOverflow))
}

/// Oracle price adjusted by the execution spread, against the trader.
pub fn execution_price(price: u128, is_long: bool, is_increase: bool, spread_bps: u128) -> Result<u128> {
    if is_long == is_increase {
        mul_div_ceil(price, BPS + spread_bps, BPS)
    } else {
        mul_div_floor(price, BPS.checked_sub(spread_bps).ok_or(PerpError::MathOverflow)?, BPS)
    }
}

/// Base-asset tokens for `size` at `price`. Longs round down, shorts round up.
pub fn tokens_for(size: u128, price: u128, is_long: bool) -> Result<u128> {
    if is_long {
        mul_div_floor(size, TOKEN_PRECISION, price)
    } else {
        mul_div_ceil(size, TOKEN_PRECISION, price)
    }
}

pub fn entry_price(size: u128, tokens: u128) -> Result<u128> {
    if tokens == 0 {
        return Ok(0);
    }
    mul_div_floor(size, TOKEN_PRECISION, tokens)
}

/// Signed PnL: long floor(tokens·P/1e20) − S, short S − ceil(tokens·P/1e20).
pub fn pnl(is_long: bool, size: u128, tokens: u128, price: u128) -> Result<i128> {
    if is_long {
        let value = mul_div_floor(tokens, price, TOKEN_PRECISION)?;
        Ok(to_i128(value)? - to_i128(size)?)
    } else {
        let cost = mul_div_ceil(tokens, price, TOKEN_PRECISION)?;
        Ok(to_i128(size)? - to_i128(cost)?)
    }
}

pub fn position_fee(size_delta: u128, fee_bps: u128) -> Result<u128> {
    mul_div_ceil(size_delta, fee_bps, BPS)
}

pub fn funding_rate_per_hour(
    long_oi: u128,
    short_oi: u128,
    aum: u128,
    factor_per_hour: u128,
    max_rate_per_hour: u128,
) -> Result<u128> {
    if aum == 0 {
        return Ok(0);
    }
    let skew = long_oi.abs_diff(short_oi);
    Ok(max_rate_per_hour.min(mul_div_floor(factor_per_hour, skew, aum)?))
}

pub fn funding_index_delta(rate_per_hour: u128, elapsed_secs: u128) -> Result<u128> {
    mul_div_floor(rate_per_hour, elapsed_secs, 3_600)
}

pub fn funding_owed(size: u128, cumulative: u128, entry: u128) -> Result<u128> {
    if cumulative <= entry {
        return Ok(0);
    }
    mul_div_ceil(size, cumulative - entry, FUNDING_PRECISION)
}

pub fn maintenance_margin(size: u128, mm_bps: u128) -> Result<u128> {
    mul_div_ceil(size, mm_bps, BPS)
}

/// R = C + PnL − F − closeFee
pub fn remaining_margin(collateral: u128, pnl_: i128, funding: u128, close_fee: u128) -> Result<i128> {
    to_i128(collateral)?
        .checked_add(pnl_)
        .and_then(|v| v.checked_sub(to_i128(funding).ok()?))
        .and_then(|v| v.checked_sub(to_i128(close_fee).ok()?))
        .ok_or(error!(PerpError::MathOverflow))
}

pub fn is_liquidatable(
    collateral: u128,
    pnl_: i128,
    funding: u128,
    close_fee: u128,
    size: u128,
    mm_bps: u128,
) -> Result<bool> {
    Ok(remaining_margin(collateral, pnl_, funding, close_fee)? < to_i128(maintenance_margin(size, mm_bps)?)?)
}

/// need = mm + F + closeFee − C; long ceil((S+need)·1e20/tokens), short floor((S−need)·1e20/tokens).
pub fn liquidation_price(
    is_long: bool,
    size: u128,
    tokens: u128,
    collateral: u128,
    funding: u128,
    close_fee: u128,
    mm_bps: u128,
) -> Result<u128> {
    if size == 0 || tokens == 0 {
        return Ok(0);
    }
    let need = to_i128(maintenance_margin(size, mm_bps)?)? + to_i128(funding)? + to_i128(close_fee)?
        - to_i128(collateral)?;
    let threshold = if is_long { to_i128(size)? + need } else { to_i128(size)? - need };
    if threshold <= 0 {
        return Ok(0);
    }
    let t = threshold as u128; // positive, checked above
    if is_long {
        mul_div_ceil(t, TOKEN_PRECISION, tokens)
    } else {
        mul_div_floor(t, TOKEN_PRECISION, tokens)
    }
}

pub fn clp_to_mint(amount_after_fee: u128, aum: u128, supply: u128) -> Result<u128> {
    if supply == 0 {
        return amount_after_fee.checked_mul(CLP_SCALE).ok_or(error!(PerpError::MathOverflow));
    }
    mul_div_floor(amount_after_fee, supply, aum)
}

pub fn usdc_for_clp(clp_amount: u128, aum: u128, supply: u128) -> Result<u128> {
    mul_div_floor(clp_amount, aum, supply)
}

#[cfg(test)]
mod tests {
    //! Vectors from docs/perp-math.md — must match the EVM (test/PerpMath.t.sol) exactly.
    use super::*;

    const SPREAD: u128 = 10;
    const FEE: u128 = 6;
    const MM: u128 = 250;
    const ETH_3000: u128 = 300_000_000_000;
    const S1: u128 = 10_000_000_000;
    const TOKENS1: u128 = 3_330_003_330_003_330_003;
    const C1: u128 = 994_000_000;
    const LIQ1: u128 = 278_137_860_001;
    const S3: u128 = 2_500_000_000;
    const TOKENS3: u128 = 41_708_375_041_708_376;

    #[test]
    fn ex1_long_open() {
        let exec = execution_price(ETH_3000, true, true, SPREAD).unwrap();
        assert_eq!(exec, 300_300_000_000);
        assert_eq!(tokens_for(S1, exec, true).unwrap(), TOKENS1);
        assert_eq!(position_fee(S1, FEE).unwrap(), 6_000_000);
        assert_eq!(entry_price(S1, TOKENS1).unwrap(), 300_300_000_000);
    }

    #[test]
    fn ex2_long_close_profit() {
        let exec = execution_price(330_000_000_000, true, false, SPREAD).unwrap();
        assert_eq!(exec, 329_670_000_000);
        let p = pnl(true, S1, TOKENS1, exec).unwrap();
        assert_eq!(p, 978_021_978);
        assert_eq!(994_000_000 + p - 6_000_000, 1_966_021_978);
    }

    #[test]
    fn ex3_short_loss() {
        let open = execution_price(6_000_000_000_000, false, true, SPREAD).unwrap();
        assert_eq!(open, 5_994_000_000_000);
        assert_eq!(tokens_for(S3, open, false).unwrap(), TOKENS3);
        assert_eq!(position_fee(S3, FEE).unwrap(), 1_500_000);
        let close = execution_price(6_300_000_000_000, false, false, SPREAD).unwrap();
        assert_eq!(close, 6_306_300_000_000);
        let p = pnl(false, S3, TOKENS3, close).unwrap();
        assert_eq!(p, -130_255_256);
        assert_eq!(500_000_000 - 1_500_000 + p - 1_500_000, 366_744_744);
    }

    #[test]
    fn ex4_short_profit() {
        let close = execution_price(5_700_000_000_000, false, false, SPREAD).unwrap();
        assert_eq!(close, 5_705_700_000_000);
        let p = pnl(false, S3, TOKENS3, close).unwrap();
        assert_eq!(p, 120_245_245);
        assert_eq!(500_000_000 - 1_500_000 + p - 1_500_000, 617_245_245);
    }

    #[test]
    fn ex5_funding() {
        let rate = funding_rate_per_hour(2_000_000_000_000, 1_000_000_000_000, 5_000_000_000_000, 300_000_000_000_000, 100_000_000_000_000).unwrap();
        assert_eq!(rate, 60_000_000_000_000);
        let delta = funding_index_delta(rate, 8 * 3_600).unwrap();
        assert_eq!(delta, 480_000_000_000_000);
        assert_eq!(funding_owed(10_000_000_000, delta, 0).unwrap(), 4_800_000);
    }

    #[test]
    fn ex5b_funding_capped() {
        let rate = funding_rate_per_hour(3_000_000_000_000, 0, 5_000_000_000_000, 300_000_000_000_000, 100_000_000_000_000).unwrap();
        assert_eq!(rate, 100_000_000_000_000);
        assert_eq!(funding_rate_per_hour(1, 0, 0, 1, 1).unwrap(), 0);
        assert_eq!(funding_owed(10, 5, 5).unwrap(), 0);
        assert_eq!(funding_owed(10, 4, 5).unwrap(), 0);
    }

    #[test]
    fn ex6_liquidation_price_long() {
        let fee = position_fee(S1, FEE).unwrap();
        assert_eq!(maintenance_margin(S1, MM).unwrap(), 250_000_000);
        assert_eq!(liquidation_price(true, S1, TOKENS1, C1, 0, fee, MM).unwrap(), LIQ1);
    }

    #[test]
    fn ex7_liquidation_boundary() {
        let fee = position_fee(S1, FEE).unwrap();
        let below = pnl(true, S1, TOKENS1, LIQ1 - 1).unwrap();
        assert_eq!(below, -738_000_001);
        assert_eq!(remaining_margin(C1, below, 0, fee).unwrap(), 249_999_999);
        assert!(is_liquidatable(C1, below, 0, fee, S1, MM).unwrap());
        let at = pnl(true, S1, TOKENS1, LIQ1).unwrap();
        assert_eq!(at, -738_000_000);
        assert_eq!(remaining_margin(C1, at, 0, fee).unwrap(), 250_000_000);
        assert!(!is_liquidatable(C1, at, 0, fee, S1, MM).unwrap());
        assert!(!is_liquidatable(C1, pnl(true, S1, TOKENS1, LIQ1 + 1).unwrap(), 0, fee, S1, MM).unwrap());
    }

    #[test]
    fn ex8_max_leverage_not_liquidatable() {
        let size: u128 = 19_762_845_840;
        let coll = 1_000_000_000 - position_fee(size, FEE).unwrap();
        assert_eq!(coll, 988_142_292);
        assert!(size <= coll * 20);
        assert!(size + 1 > (1_000_000_000 - position_fee(size + 1, FEE).unwrap()) * 20);
        let exec = execution_price(ETH_3000, true, true, SPREAD).unwrap();
        let tokens = tokens_for(size, exec, true).unwrap();
        let p = pnl(true, size, tokens, ETH_3000).unwrap();
        assert_eq!(p, -19_743_103);
        let fee = position_fee(size, FEE).unwrap();
        assert_eq!(remaining_margin(coll, p, 0, fee).unwrap(), 956_541_481);
        assert_eq!(maintenance_margin(size, MM).unwrap(), 494_071_146);
        assert!(!is_liquidatable(coll, p, 0, fee, size, MM).unwrap());
    }

    #[test]
    fn ex9_profit_cap() {
        let reserved = 9 * C1;
        assert_eq!(reserved, 8_946_000_000);
        let exec = execution_price(600_000_000_000, true, false, SPREAD).unwrap();
        assert_eq!(exec, 599_400_000_000);
        let p = pnl(true, S1, TOKENS1, exec).unwrap();
        assert_eq!(p, 9_960_039_960);
        assert_eq!((p as u128).min(reserved), 8_946_000_000);
    }

    #[test]
    fn ex10_clp_solana_six_decimals() {
        // Same flow as EVM Ex 10, with CLP at 6 decimals (CLP_SCALE = 1).
        let seed: u128 = 5_000_000_000_000;
        let seed_fee = position_fee(seed, 10).unwrap();
        assert_eq!(seed_fee, 5_000_000_000);
        let seed_mint = clp_to_mint(seed - seed_fee, 0, 0).unwrap();
        assert_eq!(seed_mint, 4_995_000_000_000);
        let aum: u128 = 5_100_000_000_000;
        let dep: u128 = 1_000_000_000;
        let dep_fee = position_fee(dep, 10).unwrap();
        assert_eq!(dep_fee, 1_000_000);
        let minted = clp_to_mint(dep - dep_fee, aum, seed_mint).unwrap();
        assert_eq!(minted, 978_432_352);
        assert_eq!(usdc_for_clp(minted, aum + dep, seed_mint + minted).unwrap(), 999_000_194);
    }

    #[test]
    fn liquidation_price_zero_cases_and_short_boundary() {
        assert_eq!(liquidation_price(true, 0, 0, 1, 0, 0, MM).unwrap(), 0);
        assert_eq!(liquidation_price(true, 100_000_000, 1_000_000_000_000_000_000, 1_000_000_000, 0, 0, MM).unwrap(), 0);
        assert_eq!(liquidation_price(false, 100_000_000, 1_000_000_000_000_000_000, 0, 200_000_000, 0, MM).unwrap(), 0);

        let fee = position_fee(S3, FEE).unwrap();
        let c = 500_000_000 - 1_500_000;
        let liq = liquidation_price(false, S3, TOKENS3, c, 0, fee, MM).unwrap();
        assert!(liq > 5_994_000_000_000);
        assert!(!is_liquidatable(c, pnl(false, S3, TOKENS3, liq).unwrap(), 0, fee, S3, MM).unwrap());
        assert!(is_liquidatable(c, pnl(false, S3, TOKENS3, liq + 1).unwrap(), 0, fee, S3, MM).unwrap());
    }

    /// Deterministic pseudo-random sweep (no extra dev-dependency) for the fuzz properties.
    fn lcg(seed: &mut u64) -> u64 {
        *seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        *seed >> 11
    }

    #[test]
    fn property_spread_against_trader() {
        let mut s = 1;
        for _ in 0..2_000 {
            let price = u128::from(lcg(&mut s) % 100_000_000_000_000 + 1);
            let spread = u128::from(lcg(&mut s) % 101);
            assert!(execution_price(price, true, true, spread).unwrap() >= price);
            assert!(execution_price(price, true, false, spread).unwrap() <= price);
            assert!(execution_price(price, false, true, spread).unwrap() <= price);
            assert!(execution_price(price, false, false, spread).unwrap() >= price);
        }
    }

    #[test]
    fn property_open_close_same_price_never_profits() {
        let mut s = 7;
        for _ in 0..2_000 {
            let size = u128::from(lcg(&mut s) % 1_000_000_000_000_000 + 1_000_000);
            let price = u128::from(lcg(&mut s) % 100_000_000_000_000 + 1_000_000);
            for is_long in [true, false] {
                let tokens = tokens_for(size, price, is_long).unwrap();
                assert!(pnl(is_long, size, tokens, price).unwrap() <= 0);
            }
        }
    }

    #[test]
    fn property_liquidation_price_is_boundary() {
        let mut s = 42;
        for _ in 0..2_000 {
            let coll = u128::from(lcg(&mut s) % 1_000_000_000_000 + 10_000_000);
            let lev = u128::from(lcg(&mut s) % 19 + 2);
            let price = u128::from(lcg(&mut s) % 10_000_000_000_000 + 100_000_000);
            let size = coll * lev;
            let tokens = tokens_for(size, price, true).unwrap();
            let fee = position_fee(size, FEE).unwrap();
            let liq = liquidation_price(true, size, tokens, coll, 0, fee, MM).unwrap();
            if liq == 0 {
                continue;
            }
            assert!(!is_liquidatable(coll, pnl(true, size, tokens, liq).unwrap(), 0, fee, size, MM).unwrap());
            assert!(is_liquidatable(coll, pnl(true, size, tokens, liq - 1).unwrap(), 0, fee, size, MM).unwrap());
        }
    }
}
