use anchor_lang::prelude::*;
use anchor_lang::solana_program;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};

declare_id!("53r6bg7JBFqf5Jfs7fe4kHDtwXwUgDWoLarYrsWcoF1V");

/// Percolator program instruction tags
mod percolator_ix {
    pub const INIT_USER: u8 = 1;
    pub const DEPOSIT_COLLATERAL: u8 = 3;
    pub const WITHDRAW_COLLATERAL: u8 = 4;
    pub const KEEPER_CRANK: u8 = 5;
    pub const TRADE_NO_CPI: u8 = 6;
}

#[program]
pub mod syntx_vault {
    use super::*;

    /// Initialize vault state only (step 1).
    /// Share mint, vault collateral account, and Percolator InitUser are done in step 2.
    pub fn init_vault(
        ctx: Context<InitVault>,
        performance_fee_bps: u16,
        management_fee_bps: u16,
        deposit_cap: u64,
    ) -> Result<()> {
        require!(performance_fee_bps <= 5000, SyntxError::FeeTooHigh);
        require!(management_fee_bps <= 1000, SyntxError::FeeTooHigh);

        let vault = &mut ctx.accounts.vault_state;
        vault.bump = ctx.bumps.vault_state;
        vault.manager = ctx.accounts.manager.key();
        vault.collateral_mint = ctx.accounts.collateral_mint.key();
        vault.share_mint = ctx.accounts.share_mint.key();
        vault.percolator_program = ctx.accounts.percolator_program.key();
        vault.percolator_slab = ctx.accounts.percolator_slab.key();
        vault.percolator_user_idx = 0;
        vault.total_shares = 0;
        vault.total_deposits = 0;
        vault.performance_fee_bps = performance_fee_bps;
        vault.management_fee_bps = management_fee_bps;
        vault.high_water_mark = 0;
        vault.last_fee_collection = Clock::get()?.unix_timestamp;
        vault.deposit_cap = deposit_cap;
        vault.paused = false;
        vault.initialized = false;

        msg!("Syntx vault state created");
        Ok(())
    }

    /// Register vault on Percolator (step 2).
    /// Calls Percolator InitUser with vault PDA as the owner.
    pub fn register_on_percolator(
        ctx: Context<RegisterOnPercolator>,
        initial_fee_payment: u64,
    ) -> Result<()> {
        let vault = &ctx.accounts.vault_state;
        require!(!vault.initialized, SyntxError::AlreadyInitialized);

        let vault_seeds: &[&[u8]] = &[
            b"vault",
            vault.collateral_mint.as_ref(),
            vault.manager.as_ref(),
            &[vault.bump],
        ];

        // Encode InitUser: tag(1) + fee_payment(8) = 9 bytes
        let mut ix_data = Vec::with_capacity(9);
        ix_data.push(percolator_ix::INIT_USER);
        ix_data.extend_from_slice(&initial_fee_payment.to_le_bytes());

        let ix = solana_program::instruction::Instruction {
            program_id: vault.percolator_program,
            accounts: vec![
                solana_program::instruction::AccountMeta::new_readonly(
                    ctx.accounts.vault_state.key(), true,
                ),
                solana_program::instruction::AccountMeta::new(
                    ctx.accounts.percolator_slab.key(), false,
                ),
                solana_program::instruction::AccountMeta::new(
                    ctx.accounts.vault_collateral.key(), false,
                ),
                solana_program::instruction::AccountMeta::new(
                    ctx.accounts.percolator_vault.key(), false,
                ),
                solana_program::instruction::AccountMeta::new_readonly(
                    ctx.accounts.token_program.key(), false,
                ),
                solana_program::instruction::AccountMeta::new_readonly(
                    ctx.accounts.clock.key(), false,
                ),
            ],
            data: ix_data,
        };

        solana_program::program::invoke_signed(
            &ix,
            &[
                ctx.accounts.vault_state.to_account_info(),
                ctx.accounts.percolator_slab.to_account_info(),
                ctx.accounts.vault_collateral.to_account_info(),
                ctx.accounts.percolator_vault.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.clock.to_account_info(),
            ],
            &[vault_seeds],
        )?;

        let vault = &mut ctx.accounts.vault_state;
        vault.initialized = true;

        msg!("Vault registered on Percolator");
        Ok(())
    }

    /// Set the Percolator user index after registration.
    pub fn set_percolator_idx(ctx: Context<ManagerOnly>, user_idx: u16) -> Result<()> {
        let vault = &mut ctx.accounts.vault_state;
        require!(vault.percolator_user_idx == 0, SyntxError::IdxAlreadySet);
        vault.percolator_user_idx = user_idx;
        msg!("Percolator user index set to {}", user_idx);
        Ok(())
    }

    /// Deposit collateral into the vault. Mints share tokens to the depositor.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault_state;
        require!(vault.initialized, SyntxError::NotInitialized);
        require!(!vault.paused, SyntxError::VaultPaused);
        require!(amount > 0, SyntxError::ZeroAmount);

        if vault.deposit_cap > 0 {
            require!(
                vault.total_deposits.checked_add(amount).unwrap() <= vault.deposit_cap,
                SyntxError::DepositCapExceeded
            );
        }

        let shares_to_mint = if vault.total_shares == 0 {
            amount
        } else {
            (amount as u128)
                .checked_mul(vault.total_shares as u128)
                .unwrap()
                .checked_div(vault.total_deposits as u128)
                .unwrap() as u64
        };
        require!(shares_to_mint > 0, SyntxError::ZeroShares);

        // Transfer collateral from user to vault's token account
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_collateral.to_account_info(),
                    to: ctx.accounts.vault_collateral.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        // CPI: Percolator DepositCollateral
        let vault = &ctx.accounts.vault_state;
        let vault_seeds: &[&[u8]] = &[
            b"vault",
            vault.collateral_mint.as_ref(),
            vault.manager.as_ref(),
            &[vault.bump],
        ];

        let mut ix_data = Vec::with_capacity(11);
        ix_data.push(percolator_ix::DEPOSIT_COLLATERAL);
        ix_data.extend_from_slice(&vault.percolator_user_idx.to_le_bytes());
        ix_data.extend_from_slice(&amount.to_le_bytes());

        let ix = solana_program::instruction::Instruction {
            program_id: vault.percolator_program,
            accounts: vec![
                solana_program::instruction::AccountMeta::new_readonly(
                    ctx.accounts.vault_state.key(), true,
                ),
                solana_program::instruction::AccountMeta::new(
                    ctx.accounts.percolator_slab.key(), false,
                ),
                solana_program::instruction::AccountMeta::new(
                    ctx.accounts.vault_collateral.key(), false,
                ),
                solana_program::instruction::AccountMeta::new(
                    ctx.accounts.percolator_vault.key(), false,
                ),
                solana_program::instruction::AccountMeta::new_readonly(
                    ctx.accounts.token_program.key(), false,
                ),
                solana_program::instruction::AccountMeta::new_readonly(
                    ctx.accounts.clock.key(), false,
                ),
            ],
            data: ix_data,
        };

        solana_program::program::invoke_signed(
            &ix,
            &[
                ctx.accounts.vault_state.to_account_info(),
                ctx.accounts.percolator_slab.to_account_info(),
                ctx.accounts.vault_collateral.to_account_info(),
                ctx.accounts.percolator_vault.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.clock.to_account_info(),
            ],
            &[vault_seeds],
        )?;

        // Mint shares to user
        let mint_seeds: &[&[u8]] = &[
            b"vault",
            ctx.accounts.vault_state.collateral_mint.as_ref(),
            ctx.accounts.vault_state.manager.as_ref(),
            &[ctx.accounts.vault_state.bump],
        ];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.share_mint.to_account_info(),
                    to: ctx.accounts.user_shares.to_account_info(),
                    authority: ctx.accounts.vault_state.to_account_info(),
                },
                &[mint_seeds],
            ),
            shares_to_mint,
        )?;

        let vault = &mut ctx.accounts.vault_state;
        vault.total_shares = vault.total_shares.checked_add(shares_to_mint).unwrap();
        vault.total_deposits = vault.total_deposits.checked_add(amount).unwrap();

        msg!("Deposited {}, minted {} shares", amount, shares_to_mint);
        Ok(())
    }

    /// Withdraw collateral from the vault. Burns share tokens, returns USDC.
    pub fn withdraw(ctx: Context<Withdraw>, shares_to_burn: u64) -> Result<()> {
        let vault = &ctx.accounts.vault_state;
        require!(vault.initialized, SyntxError::NotInitialized);
        require!(!vault.paused, SyntxError::VaultPaused);
        require!(shares_to_burn > 0, SyntxError::ZeroAmount);
        require!(shares_to_burn <= vault.total_shares, SyntxError::InsufficientShares);

        // Calculate withdrawal amount: amount = shares * total_deposits / total_shares
        let withdraw_amount = (shares_to_burn as u128)
            .checked_mul(vault.total_deposits as u128)
            .unwrap()
            .checked_div(vault.total_shares as u128)
            .unwrap() as u64;
        require!(withdraw_amount > 0, SyntxError::ZeroAmount);

        // Burn shares first
        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Burn {
                    mint: ctx.accounts.share_mint.to_account_info(),
                    from: ctx.accounts.user_shares.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            shares_to_burn,
        )?;

        // CPI: Percolator WithdrawCollateral
        // accounts: [0]user(signer) [1]slab(w) [2]perc_vault(w) [3]user_ata(w) [4]vault_pda [5]token [6]clock [7]oracle
        let vault = &ctx.accounts.vault_state;
        let vault_seeds: &[&[u8]] = &[
            b"vault",
            vault.collateral_mint.as_ref(),
            vault.manager.as_ref(),
            &[vault.bump],
        ];

        let mut ix_data = Vec::with_capacity(11);
        ix_data.push(percolator_ix::WITHDRAW_COLLATERAL);
        ix_data.extend_from_slice(&vault.percolator_user_idx.to_le_bytes());
        ix_data.extend_from_slice(&withdraw_amount.to_le_bytes());

        let ix = solana_program::instruction::Instruction {
            program_id: vault.percolator_program,
            accounts: vec![
                // [0] user = vault PDA (signer)
                solana_program::instruction::AccountMeta::new_readonly(
                    ctx.accounts.vault_state.key(), true,
                ),
                // [1] slab (writable)
                solana_program::instruction::AccountMeta::new(
                    ctx.accounts.percolator_slab.key(), false,
                ),
                // [2] percolator vault token account
                solana_program::instruction::AccountMeta::new(
                    ctx.accounts.percolator_vault.key(), false,
                ),
                // [3] destination = vault's collateral account (funds come here)
                solana_program::instruction::AccountMeta::new(
                    ctx.accounts.vault_collateral.key(), false,
                ),
                // [4] percolator vault authority PDA
                solana_program::instruction::AccountMeta::new_readonly(
                    ctx.accounts.percolator_vault_authority.key(), false,
                ),
                // [5] token program
                solana_program::instruction::AccountMeta::new_readonly(
                    ctx.accounts.token_program.key(), false,
                ),
                // [6] clock
                solana_program::instruction::AccountMeta::new_readonly(
                    ctx.accounts.clock.key(), false,
                ),
                // [7] oracle
                solana_program::instruction::AccountMeta::new_readonly(
                    ctx.accounts.oracle.key(), false,
                ),
            ],
            data: ix_data,
        };

        solana_program::program::invoke_signed(
            &ix,
            &[
                ctx.accounts.vault_state.to_account_info(),
                ctx.accounts.percolator_slab.to_account_info(),
                ctx.accounts.percolator_vault.to_account_info(),
                ctx.accounts.vault_collateral.to_account_info(),
                ctx.accounts.percolator_vault_authority.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
                ctx.accounts.clock.to_account_info(),
                ctx.accounts.oracle.to_account_info(),
            ],
            &[vault_seeds],
        )?;

        // Transfer withdrawn funds from vault's collateral account to user
        let transfer_seeds: &[&[u8]] = &[
            b"vault",
            ctx.accounts.vault_state.collateral_mint.as_ref(),
            ctx.accounts.vault_state.manager.as_ref(),
            &[ctx.accounts.vault_state.bump],
        ];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_collateral.to_account_info(),
                    to: ctx.accounts.user_collateral.to_account_info(),
                    authority: ctx.accounts.vault_state.to_account_info(),
                },
                &[transfer_seeds],
            ),
            withdraw_amount,
        )?;

        // Update vault state
        let vault = &mut ctx.accounts.vault_state;
        vault.total_shares = vault.total_shares.checked_sub(shares_to_burn).unwrap();
        vault.total_deposits = vault.total_deposits.checked_sub(withdraw_amount).unwrap();

        msg!("Withdrew {}, burned {} shares", withdraw_amount, shares_to_burn);
        Ok(())
    }

    /// Manager executes a trade on Percolator.
    pub fn manager_trade(
        ctx: Context<ManagerTrade>,
        lp_idx: u16,
        size: i128,
    ) -> Result<()> {
        let vault = &ctx.accounts.vault_state;
        require!(vault.initialized, SyntxError::NotInitialized);
        require!(!vault.paused, SyntxError::VaultPaused);

        let vault_seeds: &[&[u8]] = &[
            b"vault",
            vault.collateral_mint.as_ref(),
            vault.manager.as_ref(),
            &[vault.bump],
        ];

        let mut ix_data = Vec::with_capacity(21);
        ix_data.push(percolator_ix::TRADE_NO_CPI);
        ix_data.extend_from_slice(&lp_idx.to_le_bytes());
        ix_data.extend_from_slice(&vault.percolator_user_idx.to_le_bytes());
        ix_data.extend_from_slice(&size.to_le_bytes());

        let ix = solana_program::instruction::Instruction {
            program_id: vault.percolator_program,
            accounts: vec![
                solana_program::instruction::AccountMeta::new_readonly(
                    ctx.accounts.vault_state.key(), true,
                ),
                solana_program::instruction::AccountMeta::new_readonly(
                    ctx.accounts.lp_owner.key(), true,
                ),
                solana_program::instruction::AccountMeta::new(
                    ctx.accounts.percolator_slab.key(), false,
                ),
                solana_program::instruction::AccountMeta::new_readonly(
                    ctx.accounts.clock.key(), false,
                ),
                solana_program::instruction::AccountMeta::new_readonly(
                    ctx.accounts.oracle.key(), false,
                ),
            ],
            data: ix_data,
        };

        solana_program::program::invoke_signed(
            &ix,
            &[
                ctx.accounts.vault_state.to_account_info(),
                ctx.accounts.lp_owner.to_account_info(),
                ctx.accounts.percolator_slab.to_account_info(),
                ctx.accounts.clock.to_account_info(),
                ctx.accounts.oracle.to_account_info(),
            ],
            &[vault_seeds],
        )?;

        msg!("Trade executed: lp={}, size={}", lp_idx, size);
        Ok(())
    }

    /// Manager triggers a keeper crank on Percolator.
    pub fn manager_crank(ctx: Context<ManagerCrank>) -> Result<()> {
        let vault = &ctx.accounts.vault_state;

        let vault_seeds: &[&[u8]] = &[
            b"vault",
            vault.collateral_mint.as_ref(),
            vault.manager.as_ref(),
            &[vault.bump],
        ];

        let mut ix_data = Vec::with_capacity(4);
        ix_data.push(percolator_ix::KEEPER_CRANK);
        ix_data.extend_from_slice(&u16::MAX.to_le_bytes());
        ix_data.push(0u8);

        let ix = solana_program::instruction::Instruction {
            program_id: vault.percolator_program,
            accounts: vec![
                solana_program::instruction::AccountMeta::new_readonly(
                    ctx.accounts.vault_state.key(), true,
                ),
                solana_program::instruction::AccountMeta::new(
                    ctx.accounts.percolator_slab.key(), false,
                ),
                solana_program::instruction::AccountMeta::new_readonly(
                    ctx.accounts.clock.key(), false,
                ),
                solana_program::instruction::AccountMeta::new_readonly(
                    ctx.accounts.oracle.key(), false,
                ),
            ],
            data: ix_data,
        };

        solana_program::program::invoke_signed(
            &ix,
            &[
                ctx.accounts.vault_state.to_account_info(),
                ctx.accounts.percolator_slab.to_account_info(),
                ctx.accounts.clock.to_account_info(),
                ctx.accounts.oracle.to_account_info(),
            ],
            &[vault_seeds],
        )?;

        msg!("Keeper crank executed");
        Ok(())
    }

    /// Collect performance + management fees. Fees are paid via share dilution
    /// (minting new shares to the manager).
    ///
    /// Performance fee: % of profits above high-water mark.
    /// Management fee: % of AUM, pro-rated by time elapsed.
    pub fn collect_fees(ctx: Context<CollectFees>, vault_equity: u64) -> Result<()> {
        let vault = &ctx.accounts.vault_state;
        require!(vault.initialized, SyntxError::NotInitialized);
        require!(vault.total_shares > 0, SyntxError::ZeroShares);
        require!(vault_equity > 0, SyntxError::ZeroAmount);

        let now = Clock::get()?.unix_timestamp;
        let mut fee_shares: u64 = 0;

        // --- Performance fee ---
        // Only charged on profits above the high-water mark
        if vault_equity > vault.high_water_mark && vault.high_water_mark > 0 {
            let profit = vault_equity - vault.high_water_mark;
            let perf_fee_value = (profit as u128)
                .checked_mul(vault.performance_fee_bps as u128)
                .unwrap()
                .checked_div(10_000)
                .unwrap() as u64;

            if perf_fee_value > 0 && vault_equity > perf_fee_value {
                // shares_for_fee = fee_value * total_shares / (equity - fee_value)
                let perf_shares = (perf_fee_value as u128)
                    .checked_mul(vault.total_shares as u128)
                    .unwrap()
                    .checked_div((vault_equity - perf_fee_value) as u128)
                    .unwrap() as u64;
                fee_shares = fee_shares.checked_add(perf_shares).unwrap();
            }
        }

        // --- Management fee ---
        // Annual fee pro-rated by seconds elapsed
        let elapsed_secs = now.saturating_sub(vault.last_fee_collection).max(0) as u64;
        if elapsed_secs > 0 && vault.management_fee_bps > 0 {
            let seconds_per_year: u64 = 365 * 24 * 3600;
            // mgmt_fee_value = equity * mgmt_bps / 10000 * elapsed / year
            let mgmt_fee_value = (vault_equity as u128)
                .checked_mul(vault.management_fee_bps as u128)
                .unwrap()
                .checked_mul(elapsed_secs as u128)
                .unwrap()
                .checked_div(10_000u128 * seconds_per_year as u128)
                .unwrap() as u64;

            if mgmt_fee_value > 0 && vault_equity > mgmt_fee_value {
                let mgmt_shares = (mgmt_fee_value as u128)
                    .checked_mul(vault.total_shares as u128)
                    .unwrap()
                    .checked_div((vault_equity - mgmt_fee_value) as u128)
                    .unwrap() as u64;
                fee_shares = fee_shares.checked_add(mgmt_shares).unwrap();
            }
        }

        if fee_shares == 0 {
            msg!("No fees to collect");
            return Ok(());
        }

        // Mint fee shares to manager
        let mint_seeds: &[&[u8]] = &[
            b"vault",
            vault.collateral_mint.as_ref(),
            vault.manager.as_ref(),
            &[vault.bump],
        ];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.share_mint.to_account_info(),
                    to: ctx.accounts.manager_shares.to_account_info(),
                    authority: ctx.accounts.vault_state.to_account_info(),
                },
                &[mint_seeds],
            ),
            fee_shares,
        )?;

        // Update state
        let vault = &mut ctx.accounts.vault_state;
        vault.total_shares = vault.total_shares.checked_add(fee_shares).unwrap();
        if vault_equity > vault.high_water_mark {
            vault.high_water_mark = vault_equity;
        }
        vault.last_fee_collection = now;

        msg!("Collected fees: {} shares minted to manager", fee_shares);
        Ok(())
    }

    /// Transfer vault management to a new keeper address.
    pub fn update_manager(ctx: Context<UpdateManager>, new_manager: Pubkey) -> Result<()> {
        require!(new_manager != Pubkey::default(), SyntxError::ZeroAmount);
        let vault = &mut ctx.accounts.vault_state;
        let old = vault.manager;
        vault.manager = new_manager;
        msg!("Manager updated: {} → {}", old, new_manager);
        Ok(())
    }

    /// Pause or unpause the vault.
    pub fn set_paused(ctx: Context<ManagerOnly>, paused: bool) -> Result<()> {
        ctx.accounts.vault_state.paused = paused;
        msg!("Vault paused: {}", paused);
        Ok(())
    }
}

// =============================================================================
// Accounts
// =============================================================================

#[derive(Accounts)]
pub struct InitVault<'info> {
    #[account(mut)]
    pub manager: Signer<'info>,

    #[account(
        init,
        payer = manager,
        space = 8 + VaultState::INIT_SPACE,
        seeds = [b"vault", collateral_mint.key().as_ref(), manager.key().as_ref()],
        bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,

    /// Collateral mint (e.g., USDC)
    pub collateral_mint: Box<Account<'info, Mint>>,

    /// Share mint — must be pre-created with vault PDA as mint authority
    pub share_mint: Box<Account<'info, Mint>>,

    /// Percolator slab (just recorded, not mutated here)
    /// CHECK: Stored for later use
    pub percolator_slab: AccountInfo<'info>,

    /// CHECK: Stored for later use
    #[account(executable)]
    pub percolator_program: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterOnPercolator<'info> {
    #[account(
        constraint = manager.key() == vault_state.manager @ SyntxError::Unauthorized
    )]
    pub manager: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.collateral_mint.as_ref(), vault_state.manager.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,

    /// Vault PDA's token account for collateral
    #[account(
        mut,
        token::mint = vault_state.collateral_mint,
        token::authority = vault_state,
    )]
    pub vault_collateral: Box<Account<'info, TokenAccount>>,

    /// Percolator slab
    /// CHECK: Validated by Percolator program
    #[account(mut, address = vault_state.percolator_slab)]
    pub percolator_slab: AccountInfo<'info>,

    /// Percolator's vault token account
    /// CHECK: Validated by Percolator program
    #[account(mut)]
    pub percolator_vault: AccountInfo<'info>,

    /// CHECK: Percolator program
    #[account(executable, address = vault_state.percolator_program)]
    pub percolator_program: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.collateral_mint.as_ref(), vault_state.manager.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,

    #[account(
        mut,
        token::mint = vault_state.collateral_mint,
        token::authority = user,
    )]
    pub user_collateral: Box<Account<'info, TokenAccount>>,

    #[account(mut, token::mint = vault_state.share_mint)]
    pub user_shares: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = vault_state.collateral_mint,
        token::authority = vault_state,
    )]
    pub vault_collateral: Box<Account<'info, TokenAccount>>,

    #[account(mut, address = vault_state.share_mint)]
    pub share_mint: Box<Account<'info, Mint>>,

    /// CHECK: Validated by Percolator
    #[account(mut, address = vault_state.percolator_slab)]
    pub percolator_slab: AccountInfo<'info>,

    /// CHECK: Validated by Percolator
    #[account(mut)]
    pub percolator_vault: AccountInfo<'info>,

    /// CHECK: Percolator program
    #[account(executable, address = vault_state.percolator_program)]
    pub percolator_program: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.collateral_mint.as_ref(), vault_state.manager.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,

    /// User's share token account (source — shares burned from here)
    #[account(mut, token::mint = vault_state.share_mint)]
    pub user_shares: Box<Account<'info, TokenAccount>>,

    /// User's collateral token account (destination — USDC returned here)
    #[account(
        mut,
        token::mint = vault_state.collateral_mint,
        token::authority = user,
    )]
    pub user_collateral: Box<Account<'info, TokenAccount>>,

    /// Vault's collateral token account
    #[account(
        mut,
        token::mint = vault_state.collateral_mint,
        token::authority = vault_state,
    )]
    pub vault_collateral: Box<Account<'info, TokenAccount>>,

    /// Share mint (for burning)
    #[account(mut, address = vault_state.share_mint)]
    pub share_mint: Box<Account<'info, Mint>>,

    /// CHECK: Validated by Percolator
    #[account(mut, address = vault_state.percolator_slab)]
    pub percolator_slab: AccountInfo<'info>,

    /// Percolator's vault token account
    /// CHECK: Validated by Percolator
    #[account(mut)]
    pub percolator_vault: AccountInfo<'info>,

    /// Percolator's vault authority PDA
    /// CHECK: Validated by Percolator
    pub percolator_vault_authority: AccountInfo<'info>,

    /// CHECK: Oracle price feed
    pub oracle: AccountInfo<'info>,

    /// CHECK: Percolator program
    #[account(executable, address = vault_state.percolator_program)]
    pub percolator_program: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct ManagerTrade<'info> {
    #[account(constraint = manager.key() == vault_state.manager @ SyntxError::Unauthorized)]
    pub manager: Signer<'info>,

    #[account(
        seeds = [b"vault", vault_state.collateral_mint.as_ref(), vault_state.manager.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,

    /// LP owner (must be signer for TradeNoCpi)
    pub lp_owner: Signer<'info>,

    /// CHECK: Validated by Percolator
    #[account(mut, address = vault_state.percolator_slab)]
    pub percolator_slab: AccountInfo<'info>,

    /// CHECK: Oracle price feed
    pub oracle: AccountInfo<'info>,

    /// CHECK: Percolator program
    #[account(executable, address = vault_state.percolator_program)]
    pub percolator_program: AccountInfo<'info>,

    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct ManagerCrank<'info> {
    #[account(constraint = manager.key() == vault_state.manager @ SyntxError::Unauthorized)]
    pub manager: Signer<'info>,

    #[account(
        seeds = [b"vault", vault_state.collateral_mint.as_ref(), vault_state.manager.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,

    /// CHECK: Validated by Percolator
    #[account(mut, address = vault_state.percolator_slab)]
    pub percolator_slab: AccountInfo<'info>,

    /// CHECK: Oracle
    pub oracle: AccountInfo<'info>,

    /// CHECK: Percolator program
    #[account(executable, address = vault_state.percolator_program)]
    pub percolator_program: AccountInfo<'info>,

    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
pub struct CollectFees<'info> {
    #[account(constraint = manager.key() == vault_state.manager @ SyntxError::Unauthorized)]
    pub manager: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.collateral_mint.as_ref(), vault_state.manager.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,

    /// Share mint (for minting fee shares)
    #[account(mut, address = vault_state.share_mint)]
    pub share_mint: Box<Account<'info, Mint>>,

    /// Manager's share token account (fee destination)
    #[account(mut, token::mint = vault_state.share_mint)]
    pub manager_shares: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UpdateManager<'info> {
    #[account(constraint = manager.key() == vault_state.manager @ SyntxError::Unauthorized)]
    pub manager: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.collateral_mint.as_ref(), vault_state.manager.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,
}

#[derive(Accounts)]
pub struct ManagerOnly<'info> {
    #[account(constraint = manager.key() == vault_state.manager @ SyntxError::Unauthorized)]
    pub manager: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.collateral_mint.as_ref(), vault_state.manager.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,
}

// =============================================================================
// State
// =============================================================================

#[account]
#[derive(InitSpace)]
pub struct VaultState {
    pub bump: u8,
    pub manager: Pubkey,
    pub collateral_mint: Pubkey,
    pub share_mint: Pubkey,

    // Percolator integration
    pub percolator_program: Pubkey,
    pub percolator_slab: Pubkey,
    pub percolator_user_idx: u16,

    // Share accounting
    pub total_shares: u64,
    pub total_deposits: u64,

    // Fee structure
    pub performance_fee_bps: u16,
    pub management_fee_bps: u16,
    pub high_water_mark: u64,
    pub last_fee_collection: i64,

    // Safety
    pub deposit_cap: u64,
    pub paused: bool,
    pub initialized: bool,
}

// =============================================================================
// Errors
// =============================================================================

#[error_code]
pub enum SyntxError {
    #[msg("Fee exceeds maximum")]
    FeeTooHigh,
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Amount must be > 0")]
    ZeroAmount,
    #[msg("Shares would be zero — deposit too small")]
    ZeroShares,
    #[msg("Deposit would exceed cap")]
    DepositCapExceeded,
    #[msg("Not the vault manager")]
    Unauthorized,
    #[msg("Percolator idx already set")]
    IdxAlreadySet,
    #[msg("Vault already initialized on Percolator")]
    AlreadyInitialized,
    #[msg("Vault not yet initialized on Percolator")]
    NotInitialized,
    #[msg("Not enough shares to burn")]
    InsufficientShares,
}
