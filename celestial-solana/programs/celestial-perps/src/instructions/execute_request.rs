use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Allocate, Assign};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::engine::{self, add, sub, MarketSet};
use crate::error::PerpError;
use crate::events::{PositionClosed, PositionDecreased, PositionIncreased, RequestCancelled, RequestExecuted};
use crate::state::{Config, Pool, Position, Request, RequestKind};
use crate::utils::{close_account, emit_fees, emit_funding, move_lamports, vault_transfer};

/// Keeper executes one request. Business failures (slippage, stale oracle, OI cap, reserve
/// cap, leverage, min collateral, liquidatable after the update, disabled market, paused…)
/// CANCEL the request — escrow refunded, keeper still paid, `RequestCancelled` emitted — and
/// the instruction succeeds. Only account-validation problems return an error, so a keeper
/// can batch several `execute_request` instructions in one transaction.
///
/// Remaining accounts: every market + oracle in `Config` order; the request's market writable.
#[derive(Accounts)]
pub struct ExecuteRequest<'info> {
    #[account(mut)]
    pub keeper: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = usdc_mint,
        has_one = token_program,
        constraint = config.is_keeper(&keeper.key()) @ PerpError::NotKeeper,
    )]
    pub config: Box<Account<'info, Config>>,

    #[account(mut, seeds = [POOL_SEED], bump = pool.bump, has_one = vault)]
    pub pool: Box<Account<'info, Pool>>,

    #[account(mut)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        seeds = [REQUEST_SEED, request.owner.as_ref(), &request.nonce.to_le_bytes()],
        bump = request.bump,
        has_one = owner @ PerpError::RequestMismatch,
        has_one = position @ PerpError::RequestMismatch,
        close = owner,
    )]
    pub request: Box<Account<'info, Request>>,

    /// CHECK: the request owner (receives rent, escrow refunds and payouts' lamports).
    #[account(mut)]
    pub owner: UncheckedAccount<'info>,

    #[account(mut, token::mint = usdc_mint, token::authority = owner, token::token_program = token_program)]
    pub owner_usdc: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: the position PDA recorded in the request; may not exist yet (created here).
    #[account(mut)]
    pub position: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn process_execute_request<'info>(ctx: Context<'info, ExecuteRequest<'info>>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let r: Request = (**ctx.accounts.request).clone();
    let mut set = MarketSet::load(&ctx.accounts.config, ctx.remaining_accounts)?;
    let mi = set.index_of(&r.market)?;
    require!(set.slots[mi].info.is_writable, PerpError::MarketNotWritable);

    let pos_info = ctx.accounts.position.to_account_info();
    let existing = if pos_info.owner == &crate::ID && !pos_info.data_is_empty() {
        let data = pos_info.try_borrow_data()?;
        Some(Position::try_deserialize(&mut &data[..])?)
    } else {
        None
    };
    let mut p = existing.clone().unwrap_or(Position {
        owner: r.owner,
        market: r.market,
        is_long: r.is_long,
        size: 0,
        collateral: 0,
        tokens: 0,
        reserved: 0,
        entry_funding_index: 0,
        last_updated: 0,
        bump: 0,
    });

    // Work on copies; commit only on success (EVM try/catch semantics).
    let mut pool: Pool = (**ctx.accounts.pool).clone();
    let config: &Config = &ctx.accounts.config;
    let result = match r.kind {
        RequestKind::Increase => engine::increase(config, &mut pool, &mut set, mi, &mut p, &r, now).map(Outcome::Increase),
        RequestKind::Decrease => engine::decrease(config, &mut pool, &mut set, mi, &mut p, &r, now).map(Outcome::Decrease),
    };

    let request_info = ctx.accounts.request.to_account_info();
    let keeper_info = ctx.accounts.keeper.to_account_info();
    let request_key = ctx.accounts.request.key();
    let position_key = pos_info.key();

    match result {
        Ok(outcome) => {
            ctx.accounts.pool.set_inner(pool);
            set.persist(mi)?;
            match outcome {
                Outcome::Increase(o) => {
                    emit_funding(r.market, o.funding_update)?;
                    emit_fees(o.fee_split);
                    if existing.is_none() {
                        create_position_account(&ctx, &request_info, &mut p)?;
                    }
                    write_position(&pos_info, &p)?;
                    emit!(PositionIncreased {
                        position: position_key,
                        owner: r.owner,
                        market: r.market,
                        is_long: r.is_long,
                        size_delta: r.size_delta,
                        collateral_delta: r.collateral_delta,
                        execution_price: o.execution_price,
                        fee: o.fee,
                        funding_paid: o.funding_paid,
                        size: p.size,
                        collateral: p.collateral,
                        entry_price: o.entry_price,
                    });
                }
                Outcome::Decrease(o) => {
                    emit_funding(r.market, o.funding_update)?;
                    emit_fees(o.fee_split);
                    vault_transfer(
                        &ctx.accounts.token_program,
                        &ctx.accounts.vault,
                        &ctx.accounts.usdc_mint,
                        ctx.accounts.owner_usdc.to_account_info(),
                        &ctx.accounts.pool,
                        add(o.profit, o.collateral_out)?,
                    )?;
                    let (size, collateral) = if o.is_full { (0, 0) } else { (p.size, p.collateral) };
                    emit!(PositionDecreased {
                        position: position_key,
                        owner: r.owner,
                        market: r.market,
                        is_long: r.is_long,
                        size_delta: r.size_delta,
                        collateral_out: o.collateral_out,
                        execution_price: o.execution_price,
                        realised_pnl: o.realised_pnl,
                        fee: o.fee,
                        funding_paid: o.funding_paid,
                        size,
                        collateral,
                    });
                    if o.is_full {
                        close_account(&pos_info, &ctx.accounts.owner.to_account_info())?;
                        emit!(PositionClosed {
                            position: position_key,
                            owner: r.owner,
                            market: r.market,
                            is_long: r.is_long,
                        });
                    } else {
                        write_position(&pos_info, &p)?;
                    }
                }
            }
            emit!(RequestExecuted { request: request_key, owner: r.owner, keeper: keeper_info.key() });
        }
        Err(e) => {
            let reason = e.into_reason();
            if r.kind == RequestKind::Increase {
                let pool = &mut ctx.accounts.pool;
                pool.total_escrow = sub(pool.total_escrow, r.collateral_delta)?;
                vault_transfer(
                    &ctx.accounts.token_program,
                    &ctx.accounts.vault,
                    &ctx.accounts.usdc_mint,
                    ctx.accounts.owner_usdc.to_account_info(),
                    &ctx.accounts.pool,
                    r.collateral_delta,
                )?;
            }
            emit!(RequestCancelled { request: request_key, owner: r.owner, by: keeper_info.key(), reason });
        }
    }

    // Keeper earns the fee either way; everything else in the request goes back to the owner
    // when Anchor closes it (`close = owner`).
    move_lamports(&request_info, &keeper_info, r.execution_fee)
}

enum Outcome {
    Increase(engine::IncreaseOutcome),
    Decrease(engine::DecreaseOutcome),
}

/// Create the position PDA with lamports the trader prepaid into the request.
fn create_position_account<'info>(
    ctx: &Context<'info, ExecuteRequest<'info>>,
    request_info: &AccountInfo<'info>,
    p: &mut Position,
) -> Result<()> {
    let pos_info = ctx.accounts.position.to_account_info();
    let (pda, bump) = Pubkey::find_program_address(
        &[POSITION_SEED, p.owner.as_ref(), p.market.as_ref(), &[u8::from(p.is_long)]],
        &crate::ID,
    );
    require_keys_eq!(pda, pos_info.key(), PerpError::InvalidPosition);
    p.bump = bump;

    let space = 8 + Position::INIT_SPACE;
    let needed = Rent::get()?.minimum_balance(space).saturating_sub(pos_info.lamports());

    // Allocate + assign first: the runtime rejects a CPI after a direct lamport change in the
    // same instruction (UnbalancedInstruction), so the prepaid rent is moved afterwards.
    let bump_bytes = [bump];
    let seeds: &[&[u8]] = &[POSITION_SEED, p.owner.as_ref(), p.market.as_ref(), &[u8::from(p.is_long)], &bump_bytes];
    let sys = ctx.accounts.system_program.key();
    system_program::allocate(
        CpiContext::new_with_signer(sys, Allocate { account_to_allocate: pos_info.clone() }, &[seeds]),
        space as u64,
    )?;
    system_program::assign(
        CpiContext::new_with_signer(sys, Assign { account_to_assign: pos_info.clone() }, &[seeds]),
        &crate::ID,
    )?;
    move_lamports(request_info, &pos_info, needed)
}

fn write_position(info: &AccountInfo, p: &Position) -> Result<()> {
    let mut data = info.try_borrow_mut_data()?;
    let mut dst: &mut [u8] = &mut data;
    p.try_serialize(&mut dst)
}
