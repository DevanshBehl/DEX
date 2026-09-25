use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, MintTo, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::error::PerpError;
use crate::events::FaucetClaimed;
use crate::state::{Config, UserState};

/// Mock USDC faucet (testnet only): 10,000 USDC to the caller's ATA once every 24 h,
/// minted by the `["mint_authority"]` PDA (the USDC mint authority after deployment).
#[derive(Accounts)]
pub struct Faucet<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint, has_one = token_program)]
    pub config: Box<Account<'info, Config>>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserState::INIT_SPACE,
        seeds = [USER_SEED, user.key().as_ref()],
        bump,
    )]
    pub user_state: Box<Account<'info, UserState>>,

    #[account(mut)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: PDA signer only.
    #[account(seeds = [MINT_AUTHORITY_SEED], bump = config.mint_authority_bump)]
    pub mint_authority: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = usdc_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program,
    )]
    pub user_usdc: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn process_faucet(ctx: Context<Faucet>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let user = ctx.accounts.user.key();
    let state = &mut ctx.accounts.user_state;
    if state.owner == Pubkey::default() {
        state.owner = user;
        state.bump = ctx.bumps.user_state;
    }
    require!(
        state.last_faucet_at == 0 || now >= state.last_faucet_at + FAUCET_COOLDOWN_SECS,
        PerpError::FaucetCooldown
    );
    state.last_faucet_at = now;

    let bump = [ctx.accounts.config.mint_authority_bump];
    let seeds: &[&[u8]] = &[MINT_AUTHORITY_SEED, &bump];
    token_interface::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.user_usdc.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
            &[seeds],
        ),
        FAUCET_AMOUNT,
    )?;
    emit!(FaucetClaimed { user, amount: FAUCET_AMOUNT });
    Ok(())
}
