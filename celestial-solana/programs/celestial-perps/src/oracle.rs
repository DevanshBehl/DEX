//! Chainlink (OCR2 store, v2 `Transmissions`) feed decoding — no external crate.
//!
//! Account layout (verified against devnet SOL/BTC/ETH feeds on 2026-09-22):
//!   [0..8)    anchor discriminator
//!   [8]       version (2)
//!   [138]     decimals (u8)
//!   [148..152) live_length (u32 LE)
//!   [152..156) live_cursor (u32 LE)
//!   [200 + 48·i ..)  Transmission { slot u64, timestamp u32, _pad u32, answer i128, _pad [u8;16] }
//! The latest round lives at index (live_cursor + live_length − 1) % live_length.

use crate::constants::{CHAINLINK_STORE_PROGRAM, MAX_FUTURE_SKEW_SECS, PRICE_DECIMALS};
use crate::error::{CancelReason, PerpError};
use crate::state::OracleKind;
use anchor_lang::prelude::*;

const DECIMALS_OFFSET: usize = 138;
const LIVE_LENGTH_OFFSET: usize = 148;
const LIVE_CURSOR_OFFSET: usize = 152;
const TRANSMISSIONS_OFFSET: usize = 200;
const TRANSMISSION_SIZE: usize = 48;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RawRound {
    pub answer: i128,
    pub timestamp: u32,
    pub decimals: u8,
}

fn read_u32(data: &[u8], off: usize) -> Result<u32> {
    let bytes: [u8; 4] = data
        .get(off..off + 4)
        .ok_or(PerpError::InvalidOracleData)?
        .try_into()
        .map_err(|_| error!(PerpError::InvalidOracleData))?;
    Ok(u32::from_le_bytes(bytes))
}

/// Decode the latest round from raw feed account data.
pub fn decode_latest_round(data: &[u8]) -> Result<RawRound> {
    require!(data.len() >= TRANSMISSIONS_OFFSET + TRANSMISSION_SIZE, PerpError::InvalidOracleData);
    let decimals = data[DECIMALS_OFFSET];
    let live_length = read_u32(data, LIVE_LENGTH_OFFSET)? as usize;
    let live_cursor = read_u32(data, LIVE_CURSOR_OFFSET)? as usize;
    require!(live_length > 0, PerpError::InvalidOracleData);

    let idx = (live_cursor + live_length - 1) % live_length;
    let off = TRANSMISSIONS_OFFSET + idx * TRANSMISSION_SIZE;
    require!(data.len() >= off + TRANSMISSION_SIZE, PerpError::InvalidOracleData);

    let timestamp = read_u32(data, off + 8)?;
    let answer_bytes: [u8; 16] = data[off + 16..off + 32]
        .try_into()
        .map_err(|_| error!(PerpError::InvalidOracleData))?;
    Ok(RawRound { answer: i128::from_le_bytes(answer_bytes), timestamp, decimals })
}

/// Validate a raw round and normalise it to an 8-decimal price. Business-level: the keeper
/// path turns the reason into a cancel instead of failing the transaction.
pub fn check_round(round: RawRound, now: i64, max_age_secs: u32) -> core::result::Result<u128, CancelReason> {
    if round.answer <= 0 || round.decimals > 18 {
        return Err(CancelReason::InvalidPrice);
    }
    let ts = i64::from(round.timestamp);
    if ts == 0 || ts > now.saturating_add(MAX_FUTURE_SKEW_SECS) || now.saturating_sub(ts) > i64::from(max_age_secs) {
        return Err(CancelReason::StalePrice);
    }
    let answer = u128::try_from(round.answer).map_err(|_| CancelReason::InvalidPrice)?;
    let dec = u32::from(round.decimals);
    if dec > PRICE_DECIMALS {
        Ok(answer / 10u128.pow(dec - PRICE_DECIMALS))
    } else {
        answer.checked_mul(10u128.pow(PRICE_DECIMALS - dec)).ok_or(CancelReason::InvalidPrice)
    }
}

/// `check_round` as a hard error (admin/LP paths, where the EVM version reverts).
pub fn validate_round(round: RawRound, now: i64, max_age_secs: u32) -> Result<u128> {
    check_round(round, now, max_age_secs).map_err(|r| match r {
        CancelReason::StalePrice => error!(PerpError::StalePrice),
        _ => error!(PerpError::InvalidOracleAnswer),
    })
}

/// Account-level checks + decode: key must equal `market.oracle`, owner must be the Chainlink
/// store (or this program for a mock). These are hard errors — a wrong account is never a
/// business condition. Freshness/answer checks are done separately by `validate_round`.
pub fn read_round(feed: &AccountInfo, expected: &Pubkey, kind: OracleKind) -> Result<RawRound> {
    require_keys_eq!(*feed.key, *expected, PerpError::OracleMismatch);
    match kind {
        OracleKind::Chainlink => {
            require_keys_eq!(*feed.owner, CHAINLINK_STORE_PROGRAM, PerpError::InvalidOracleOwner);
            let data = feed.try_borrow_data()?;
            decode_latest_round(&data)
        }
        #[cfg(feature = "mock-oracle")]
        OracleKind::Mock => {
            require_keys_eq!(*feed.owner, crate::ID, PerpError::InvalidOracleOwner);
            let data = feed.try_borrow_data()?;
            let m = crate::state::MockOracle::try_deserialize(&mut &data[..])?;
            Ok(RawRound {
                answer: i128::from(m.answer),
                timestamp: u32::try_from(m.timestamp).map_err(|_| error!(PerpError::InvalidOracleData))?,
                decimals: m.decimals,
            })
        }
        #[cfg(not(feature = "mock-oracle"))]
        OracleKind::Mock => err!(PerpError::UnsupportedOracleKind),
    }
}

/// Read and validate a feed: any failure is an error.
pub fn read_price(feed: &AccountInfo, expected: &Pubkey, kind: OracleKind, now: i64, max_age_secs: u32) -> Result<u128> {
    validate_round(read_round(feed, expected, kind)?, now, max_age_secs)
}

/// Build feed account data in the Chainlink v2 layout (tests + local tooling).
#[cfg(not(target_os = "solana"))]
pub fn encode_feed(answer: i128, timestamp: u32, decimals: u8) -> Vec<u8> {
    let mut data = vec![0u8; TRANSMISSIONS_OFFSET + TRANSMISSION_SIZE];
    data[0..8].copy_from_slice(&[0x60, 0xb3, 0x45, 0x42, 0x80, 0x81, 0x49, 0x75]);
    data[8] = 2;
    data[DECIMALS_OFFSET] = decimals;
    data[LIVE_LENGTH_OFFSET..LIVE_LENGTH_OFFSET + 4].copy_from_slice(&1u32.to_le_bytes());
    let off = TRANSMISSIONS_OFFSET;
    data[off + 8..off + 12].copy_from_slice(&timestamp.to_le_bytes());
    data[off + 16..off + 32].copy_from_slice(&answer.to_le_bytes());
    data
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_and_normalises() {
        let data = encode_feed(11_688_000_000, 1_000, 8);
        let r = decode_latest_round(&data).unwrap();
        assert_eq!(r, RawRound { answer: 11_688_000_000, timestamp: 1_000, decimals: 8 });
        assert_eq!(validate_round(r, 1_050, 120).unwrap(), 11_688_000_000);
        assert_eq!(validate_round(RawRound { answer: 3_000_000_000_000_000_000_000, timestamp: 1, decimals: 18 }, 1, 120).unwrap(), 300_000_000_000);
        assert_eq!(validate_round(RawRound { answer: 3_000_000_000, timestamp: 1, decimals: 6 }, 1, 120).unwrap(), 300_000_000_000);
    }

    #[test]
    fn rejects_stale_future_and_invalid() {
        let r = RawRound { answer: 1, timestamp: 1_000, decimals: 8 };
        assert!(validate_round(r, 1_120, 120).is_ok());
        assert!(validate_round(r, 1_121, 120).is_err());
        assert!(validate_round(r, 1_000 - MAX_FUTURE_SKEW_SECS, 120).is_ok());
        assert!(validate_round(r, 1_000 - MAX_FUTURE_SKEW_SECS - 1, 120).is_err());
        assert!(validate_round(RawRound { answer: 0, ..r }, 1_000, 120).is_err());
        assert!(validate_round(RawRound { answer: -5, ..r }, 1_000, 120).is_err());
        assert!(validate_round(RawRound { timestamp: 0, ..r }, 1_000, 120).is_err());
        assert!(validate_round(RawRound { decimals: 19, ..r }, 1_000, 120).is_err());
        assert!(decode_latest_round(&[0u8; 100]).is_err());
        assert!(decode_latest_round(&vec![0u8; 248]).is_err()); // live_length 0
    }

    #[test]
    fn picks_latest_in_ring_buffer() {
        let mut data = vec![0u8; TRANSMISSIONS_OFFSET + 3 * TRANSMISSION_SIZE];
        data[DECIMALS_OFFSET] = 8;
        data[LIVE_LENGTH_OFFSET..LIVE_LENGTH_OFFSET + 4].copy_from_slice(&3u32.to_le_bytes());
        data[LIVE_CURSOR_OFFSET..LIVE_CURSOR_OFFSET + 4].copy_from_slice(&2u32.to_le_bytes());
        // cursor 2, length 3 → latest index 1
        let off = TRANSMISSIONS_OFFSET + TRANSMISSION_SIZE;
        data[off + 8..off + 12].copy_from_slice(&77u32.to_le_bytes());
        data[off + 16..off + 32].copy_from_slice(&123i128.to_le_bytes());
        let r = decode_latest_round(&data).unwrap();
        assert_eq!((r.answer, r.timestamp), (123, 77));
    }

    /// Real devnet SOL-USD feed account (all 248 bytes) captured 2026-09-22.
    #[test]
    fn decodes_real_devnet_account() {
        const HEX: &str = "60b3454280814975020164145186b600d9d4618adba9970d944053b279b5bcc6c00ff4a1c709f169d8bf00000000000000000000000000000000000000000000000000000000000000003e0000fd2331a613ab309a2557e84fa6a5e20d80d2788780320c689be8d0bbc2534f4c202f20555344000000000000000000000000000000000000000000000008000000006e8b640201010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002723f21d00000000ea69b26a000000007f11bebb02000000000000000000000000000000000000000000000000000000";
        let data: Vec<u8> = (0..HEX.len() / 2)
            .map(|i| u8::from_str_radix(&HEX[2 * i..2 * i + 2], 16).unwrap())
            .collect();
        assert_eq!(data.len(), 248);
        assert_eq!(&data[106..115], b"SOL / USD");
        let r = decode_latest_round(&data).unwrap();
        assert_eq!(r.decimals, 8);
        assert_eq!(r.answer, 11739730303);
        assert_eq!(r.timestamp, 1790077418);
        assert_eq!(validate_round(r, 1790077418 + 5, 120).unwrap(), 11739730303);
    }
}
