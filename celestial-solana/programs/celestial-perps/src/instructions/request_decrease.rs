use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::PerpError;
use crate::instructions::request_increase::{create_request, CreateRequestArgs};
use crate::state::{Config, Market, Request, RequestKind, UserState};

/// Request to decrease/close a position. `size_delta == size` closes it fully and returns all
/// remaining collateral; otherwise `collateral_delta` USDC is withdrawn. Allowed while paused.
#[derive(Accounts)]
#[instruction(nonce: u64, is_long: bool)]
pub struct RequestDecrease<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(seeds = [MARKET_SEED, market.symbol.as_bytes()], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,

    /// CHECK: PDA only (recorded in the request).
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

    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn process_request_decrease(
    ctx: Context<RequestDecrease>,
    nonce: u64,
    is_long: bool,
    collateral_delta: u64,
    size_delta: u64,
    acceptable_price: u64,
    execution_fee: u64,
) -> Result<()> {
    require!(collateral_delta > 0 || size_delta > 0, PerpError::EmptyRequest);
    require!(
        execution_fee >= ctx.accounts.config.min_execution_fee_lamports,
        PerpError::InsufficientExecutionFee
    );
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
        RequestKind::Decrease,
        collateral_delta,
        size_delta,
        acceptable_price,
        execution_fee,
        0,
    )
}
