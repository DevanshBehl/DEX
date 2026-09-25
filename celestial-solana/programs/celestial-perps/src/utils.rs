use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::POOL_SEED;
use crate::engine::{FeeSplit, FundingUpdate};
use crate::error::PerpError;
use crate::events::{FeesAdded, FundingUpdated};
use crate::state::Pool;

/// USDC out of the vault, signed by the `Pool` PDA.
pub fn vault_transfer<'info>(
    token_program: &Interface<'info, TokenInterface>,
    vault: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    to: AccountInfo<'info>,
    pool: &Account<'info, Pool>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let bump = [pool.bump];
    let seeds: &[&[u8]] = &[POOL_SEED, &bump];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: vault.to_account_info(),
                mint: mint.to_account_info(),
                to,
                authority: pool.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        mint.decimals,
    )
}

/// USDC from a user into the vault, signed by the user.
pub fn user_transfer<'info>(
    token_program: &Interface<'info, TokenInterface>,
    from: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    vault: &InterfaceAccount<'info, TokenAccount>,
    authority: AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token_interface::transfer_checked(
        CpiContext::new(
            token_program.key(),
            TransferChecked {
                from: from.to_account_info(),
                mint: mint.to_account_info(),
                to: vault.to_account_info(),
                authority,
            },
        ),
        amount,
        mint.decimals,
    )
}

/// Move lamports out of a program-owned account.
pub fn move_lamports(from: &AccountInfo, to: &AccountInfo, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let from_balance = from.lamports();
    require!(from_balance >= amount, PerpError::InsufficientRequestLamports);
    **from.try_borrow_mut_lamports()? = from_balance - amount;
    **to.try_borrow_mut_lamports()? = to
        .lamports()
        .checked_add(amount)
        .ok_or(error!(PerpError::MathOverflow))?;
    Ok(())
}

/// Close a program-owned account: all lamports to `dest`, data wiped, owner back to System.
pub fn close_account<'info>(info: &AccountInfo<'info>, dest: &AccountInfo<'info>) -> Result<()> {
    move_lamports(info, dest, info.lamports())?;
    info.assign(&System::id());
    info.resize(0)?;
    Ok(())
}

pub fn emit_funding(market: Pubkey, u: Option<FundingUpdate>) -> Result<()> {
    if let Some(u) = u {
        emit!(FundingUpdated {
            market,
            rate_long_per_hour: crate::math::to_u64(u.rate_long)?,
            rate_short_per_hour: crate::math::to_u64(u.rate_short)?,
            cum_long: u.cum_long,
            cum_short: u.cum_short,
        });
    }
    Ok(())
}

pub fn emit_fees(split: FeeSplit) {
    if split.amount > 0 {
        emit!(FeesAdded { amount: split.amount, to_protocol: split.to_protocol, to_pool: split.to_pool });
    }
}
