use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::engine::add;
use crate::error::PerpError;
use crate::events::RequestCreated;
use crate::state::{Config, Market, Pool, Position, Request, RequestKind, UserState};
use crate::utils::user_transfer;

/// Request to open/increase a position. Escrows `collateral_delta` USDC in the vault, holds
/// `execution_fee` lamports (+ the future `Position` rent when it does not exist yet) in the
/// new `Request` account. `nonce` must equal `UserState.request_nonce` (0 for a new user).
#[derive(Accounts)]
#[instruction(nonce: u64, is_long: bool)]
pub struct RequestIncrease<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint, has_one = token_program)]
    pub config: Box<Account<'info, Config>>,

    #[account(mut, seeds = [POOL_SEED], bump = pool.bump, has_one = vault)]
    pub pool: Box<Account<'info, Pool>>,

    #[account(mut)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,

    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(mut, token::mint = usdc_mint, token::authority = owner, token::token_program = token_program)]
    pub owner_usdc: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(seeds = [MARKET_SEED, market.symbol.as_bytes()], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,

    /// CHECK: PDA only — used to know whether the position exists (rent prepay).
    #[account(seeds = [POSITION_SEED, owner.key().as_ref(), market.key().as_ref(), &[u8::from(is_long)]], bump)]
    pub position: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + UserState::INIT_SPACE,
        seeds = [USER_SEED, owner.key().as_ref()],
        bump,
    )]
    pub user_state: Box<Account<'info, UserState>>,

    #[account(
        init,
        payer = owner,
        space = 8 + Request::INIT_SPACE,
        seeds = [REQUEST_SEED, owner.key().as_ref(), &nonce.to_le_bytes()],
        bump,
    )]
    pub request: Box<Account<'info, Request>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn process_request_increase(
    ctx: Context<RequestIncrease>,
    nonce: u64,
    is_long: bool,
    collateral_delta: u64,
    size_delta: u64,
    acceptable_price: u64,
    execution_fee: u64,
) -> Result<()> {
    require!(!ctx.accounts.config.paused, PerpError::Paused);
    require!(ctx.accounts.market.enabled, PerpError::MarketDisabled);
    require!(collateral_delta > 0 || size_delta > 0, PerpError::EmptyRequest);
    require!(
        execution_fee >= ctx.accounts.config.min_execution_fee_lamports,
        PerpError::InsufficientExecutionFee
    );

    let position_rent = if ctx.accounts.position.owner == &crate::ID {
        0
    } else {
        Rent::get()?.minimum_balance(8 + Position::INIT_SPACE)
    };
    create_request(
        CreateRequestArgs {
            owner: &ctx.accounts.owner,
            user_state: &mut ctx.accounts.user_state,
            user_state_bump: ctx.bumps.user_state,
            request: &mut ctx.accounts.request,
            request_bump: ctx.bumps.request,
            system_program: &ctx.accounts.system_program,
            market: ctx.accounts.market.key(),
            position: ctx.accounts.position.key(),
        },
        nonce,
        is_long,
        RequestKind::Increase,
        collateral_delta,
        size_delta,
        acceptable_price,
        execution_fee,
        position_rent,
    )?;

    let pool = &mut ctx.accounts.pool;
    pool.total_escrow = add(pool.total_escrow, collateral_delta)?;
    user_transfer(
        &ctx.accounts.token_program,
        &ctx.accounts.owner_usdc,
        &ctx.accounts.usdc_mint,
        &ctx.accounts.vault,
        ctx.accounts.owner.to_account_info(),
        collateral_delta,
    )
}

pub struct CreateRequestArgs<'a, 'info> {
    pub owner: &'a Signer<'info>,
    pub user_state: &'a mut Account<'info, UserState>,
    pub user_state_bump: u8,
    pub request: &'a mut Account<'info, Request>,
    pub request_bump: u8,
    pub system_program: &'a Program<'info, System>,
    pub market: Pubkey,
    pub position: Pubkey,
}

/// `_createRequest` shared by increase/decrease: nonce check, fields, lamports, event.
#[allow(clippy::too_many_arguments)]
pub fn create_request(
    a: CreateRequestArgs,
    nonce: u64,
    is_long: bool,
    kind: RequestKind,
    collateral_delta: u64,
    size_delta: u64,
    acceptable_price: u64,
    execution_fee: u64,
    position_rent: u64,
) -> Result<()> {
    let owner = a.owner.key();
    if a.user_state.owner == Pubkey::default() {
        a.user_state.owner = owner;
        a.user_state.bump = a.user_state_bump;
    }
    require!(nonce == a.user_state.request_nonce, PerpError::InvalidNonce);
    a.user_state.request_nonce = nonce.checked_add(1).ok_or(error!(PerpError::MathOverflow))?;

    let r = &mut *a.request;
    r.owner = owner;
    r.market = a.market;
    r.position = a.position;
    r.is_long = is_long;
    r.kind = kind;
    r.collateral_delta = collateral_delta;
    r.size_delta = size_delta;
    r.acceptable_price = acceptable_price;
    r.execution_fee = execution_fee;
    r.position_rent = position_rent;
    r.created_at = Clock::get()?.unix_timestamp;
    r.nonce = nonce;
    r.bump = a.request_bump;

    let lamports = add(execution_fee, position_rent)?;
    if lamports > 0 {
        system_program::transfer(
            CpiContext::new(
                a.system_program.key(),
                system_program::Transfer { from: a.owner.to_account_info(), to: a.request.to_account_info() },
            ),
            lamports,
        )?;
    }

    emit!(RequestCreated {
        request: a.request.key(),
        owner,
        market: a.market,
        is_long,
        kind,
        collateral_delta,
        size_delta,
        acceptable_price,
        execution_fee,
        nonce,
    });
    Ok(())
}
