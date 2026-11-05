use anchor_lang::prelude::*;
use anchor_lang::solana_program;
use anchor_lang::solana_program::program_option::COption;
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

/// Timelock for admin actions: 48 hours (in seconds)
const TIMELOCK_SECONDS: i64 = 48 * 60 * 60;

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
        min_drawdown_bps: u16,
    ) -> Result<()> {
        require!(performance_fee_bps <= 5000, SyntxError::FeeTooHigh);
        require!(management_fee_bps <= 1000, SyntxError::FeeTooHigh);
        require!(min_drawdown_bps <= 10_000, SyntxError::FeeTooHigh);

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
        // Immutable minimum circuit breaker — cannot be reduced after creation
        vault.min_drawdown_bps = min_drawdown_bps;
        // Set initial drawdown to the minimum floor
        vault.max_drawdown_bps = min_drawdown_bps;

        msg!("Syntx vault created: min_drawdown={}bps", min_drawdown_bps);
        Ok(())
    }

    /// Initialize a standalone vault (no Percolator dependency).
    /// Vault is immediately ready for deposits — no registration step needed.
    pub fn init_vault_standalone(
        ctx: Context<InitVaultStandalone>,
        performance_fee_bps: u16,
        management_fee_bps: u16,
        deposit_cap: u64,
        min_drawdown_bps: u16,
    ) -> Result<()> {
        require!(performance_fee_bps <= 5000, SyntxError::FeeTooHigh);
        require!(management_fee_bps <= 1000, SyntxError::FeeTooHigh);
        require!(min_drawdown_bps <= 10_000, SyntxError::FeeTooHigh);

        let vault = &mut ctx.accounts.vault_state;
        vault.bump = ctx.bumps.vault_state;
        vault.manager = ctx.accounts.manager.key();
        vault.collateral_mint = ctx.accounts.collateral_mint.key();
        vault.share_mint = ctx.accounts.share_mint.key();
        vault.percolator_program = Pubkey::default();
        vault.percolator_slab = Pubkey::default();
        vault.percolator_user_idx = 0;
        vault.total_shares = 0;
        vault.total_deposits = 0;
        vault.performance_fee_bps = performance_fee_bps;
        vault.management_fee_bps = management_fee_bps;
        vault.high_water_mark = 0;
        vault.last_fee_collection = Clock::get()?.unix_timestamp;
        vault.deposit_cap = deposit_cap;
        vault.paused = false;
        vault.initialized = true; // Ready immediately — no Percolator registration needed
        vault.min_drawdown_bps = min_drawdown_bps;
        vault.max_drawdown_bps = min_drawdown_bps;
        vault.standalone = true;

        msg!("Standalone vault created: min_drawdown={}bps", min_drawdown_bps);
        Ok(())
    }

    /// Deposit into a standalone vault (no Percolator CPI).
    /// Transfers collateral from user to vault, mints share tokens.
    pub fn deposit_standalone(ctx: Context<DepositStandalone>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault_state;
        require!(vault.initialized, SyntxError::NotInitialized);
        require!(vault.standalone, SyntxError::NotStandalone);
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

        // Transfer collateral from user to vault
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

        if vault.total_deposits > vault.peak_equity {
            vault.peak_equity = vault.total_deposits;
        }

        msg!("Standalone deposit: {}, minted {} shares", amount, shares_to_mint);
        Ok(())
    }

    /// Withdraw from a standalone vault (no Percolator CPI).
    /// Burns share tokens, transfers collateral back to user.
    pub fn withdraw_standalone(ctx: Context<WithdrawStandalone>, shares_to_burn: u64) -> Result<()> {
        let vault = &ctx.accounts.vault_state;
        require!(vault.initialized, SyntxError::NotInitialized);
        require!(vault.standalone, SyntxError::NotStandalone);
        require!(!vault.paused, SyntxError::VaultPaused);
        require!(shares_to_burn > 0, SyntxError::ZeroAmount);
        require!(shares_to_burn <= vault.total_shares, SyntxError::InsufficientShares);

        let withdraw_amount = (shares_to_burn as u128)
            .checked_mul(vault.total_deposits as u128)
            .unwrap()
            .checked_div(vault.total_shares as u128)
            .unwrap() as u64;
        require!(withdraw_amount > 0, SyntxError::ZeroAmount);

        // Burn shares
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

        // Transfer collateral to user
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

        let vault = &mut ctx.accounts.vault_state;
        vault.total_shares = vault.total_shares.checked_sub(shares_to_burn).unwrap();
        vault.total_deposits = vault.total_deposits.checked_sub(withdraw_amount).unwrap();

        msg!("Standalone withdraw: {}, burned {} shares", withdraw_amount, shares_to_burn);
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
    ///
    /// Per Percolator spec §10.3:
    /// - deposit is a pure capital-transfer instruction (no accrue_market_to)
    /// - for new accounts, amount must be >= MIN_INITIAL_DEPOSIT (enforced by Percolator CPI)
    /// - deposit does NOT realize recurring maintenance fees
    /// - deposit does NOT make A/K side effects authoritative
    ///
    /// Share price uses total_deposits / total_shares. This does NOT reflect:
    /// - Unrealized trading PnL (requires oracle)
    /// - Warmup reserves (R_i locked until matured)
    /// - Recurring maintenance fees (lazy, realized on touch)
    /// A future version should read true equity from the Percolator slab.
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

        // Update peak equity for circuit breaker (spec §10.4 compliance)
        if vault.total_deposits > vault.peak_equity {
            vault.peak_equity = vault.total_deposits;
        }

        msg!("Deposited {}, minted {} shares", amount, shares_to_mint);
        Ok(())
    }

    /// Withdraw collateral from the vault. Burns share tokens, returns USDC.
    ///
    /// Per Percolator spec §10.4: post-withdraw capital must be either 0 or
    /// >= MIN_INITIAL_DEPOSIT. This is enforced at the Percolator level, but
    /// we also check at the Syntx level to prevent wasted transaction fees.
    ///
    /// Share price note: total_deposits tracks cumulative deposits/withdrawals
    /// but does NOT reflect unrealized PnL, warmup reserves, or maintenance fees.
    /// The true vault equity requires reading the Percolator slab's account state
    /// (capital + PnL - fee_debt). This is a known limitation of the current
    /// share price model. A future version should read equity from the slab.
    pub fn withdraw(ctx: Context<Withdraw>, shares_to_burn: u64) -> Result<()> {
        let vault = &ctx.accounts.vault_state;
        require!(vault.initialized, SyntxError::NotInitialized);
        require!(!vault.paused, SyntxError::VaultPaused);
        require!(shares_to_burn > 0, SyntxError::ZeroAmount);
        require!(shares_to_burn <= vault.total_shares, SyntxError::InsufficientShares);

        // Calculate withdrawal amount: amount = shares * total_deposits / total_shares
        // NOTE: This uses total_deposits, not true Percolator equity. See doc comment above.
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
                // [0] user = vault PDA (signer, read-only — Percolator only reads owner check)
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

    /// Manager executes a trade on Percolator via TradeNoCpi.
    ///
    /// Per Percolator spec §10.5:
    /// - Percolator internally calls accrue_market_to before executing
    /// - Both user (vault PDA) and LP must be signers
    /// - Trade fees are charged via charge_fee_to_insurance
    /// - Post-trade margin is enforced by Percolator
    /// - Percolator handles warmup reserve for any new positive PnL
    ///
    /// Syntx-level checks:
    /// - Circuit breaker: drawdown from peak equity
    /// - Vault must be initialized and not paused
    pub fn manager_trade(
        ctx: Context<ManagerTrade>,
        lp_idx: u16,
        size: i128,
    ) -> Result<()> {
        let vault = &ctx.accounts.vault_state;
        require!(vault.initialized, SyntxError::NotInitialized);
        require!(!vault.paused, SyntxError::VaultPaused);

        // Circuit breaker: check drawdown from peak equity
        if vault.max_drawdown_bps > 0 && vault.peak_equity > 0 {
            let current_equity = vault.total_deposits;
            let drawdown_bps = if current_equity < vault.peak_equity {
                ((vault.peak_equity - current_equity) as u128 * 10_000 / vault.peak_equity as u128) as u16
            } else {
                0
            };
            if drawdown_bps > vault.max_drawdown_bps {
                msg!("CIRCUIT BREAKER: drawdown {}bps exceeds max {}bps — auto-pausing",
                    drawdown_bps, vault.max_drawdown_bps);
                // Can't mutate here (vault is immutable ref), but reject the trade
                return Err(SyntxError::CircuitBreakerTriggered.into());
            }
        }

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

    /// Collect the management fee. Fees are paid via share dilution
    /// (minting new shares to the manager).
    ///
    /// The fee base is computed on-chain, not supplied by the caller:
    /// equity = `total_deposits` (the amount withdrawals are priced against),
    /// and for standalone vaults it is further capped by the collateral the
    /// vault's own token account actually holds.
    ///
    /// Management fee: % of that base, pro-rated by time elapsed.
    ///
    /// LIMITATION: the performance fee is NOT charged. `performance_fee_bps`
    /// is stored but unused here. A performance fee needs the vault's trading
    /// gains, which live in the Percolator slab, and those cannot be read
    /// reliably on-chain today:
    /// - the slab layout is not a dependency of this crate (only TS copies of
    ///   byte offsets exist in keeper/ and app/), so a Percolator upgrade
    ///   could silently change what the offsets point at;
    /// - the slab's `pnl` field is realized PnL only; unrealized PnL needs the
    ///   position basis, ADL coefficients and an oracle price;
    /// - `percolator_program` is chosen by the manager at init, so a slab owned
    ///   by it is not an independent source for the manager's own fee.
    /// `total_deposits` does not include trading gains, so no share-price gain
    /// is visible here. A manager-supplied equity value is deliberately not
    /// accepted. `high_water_mark` is still tracked (share price, 1e6 fixed
    /// point) so a future verified performance fee starts from a known base.
    pub fn collect_fees(ctx: Context<CollectFees>) -> Result<()> {
        let vault = &ctx.accounts.vault_state;
        require!(vault.initialized, SyntxError::NotInitialized);
        require!(vault.total_shares > 0, SyntxError::ZeroShares);

        let vault_equity = if vault.standalone {
            vault.total_deposits.min(ctx.accounts.vault_collateral.amount)
        } else {
            vault.total_deposits
        };
        require!(vault_equity > 0, SyntxError::ZeroAmount);

        let now = Clock::get()?.unix_timestamp;
        let mut fee_shares: u64 = 0;

        // Share price before fees, 1e6 fixed point
        let share_price_e6 = ((vault_equity as u128) * 1_000_000 / (vault.total_shares as u128)) as u64;

        // --- Performance fee ---
        // Not charged: trading gains in the Percolator slab cannot be verified
        // on-chain (see the doc comment above).

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
            let vault = &mut ctx.accounts.vault_state;
            if share_price_e6 > vault.high_water_mark {
                vault.high_water_mark = share_price_e6;
            }
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

        // Update state. HWM is the pre-fee share price, so the same gain is
        // never charged twice.
        let vault = &mut ctx.accounts.vault_state;
        vault.total_shares = vault.total_shares.checked_add(fee_shares).unwrap();
        if share_price_e6 > vault.high_water_mark {
            vault.high_water_mark = share_price_e6;
        }
        vault.last_fee_collection = now;

        msg!("Collected fees: {} shares minted to manager (equity {})", fee_shares, vault_equity);
        Ok(())
    }

    /// Propose a manager transfer. Takes effect after TIMELOCK_SECONDS (48 hours).
    /// This prevents instant hostile takeover if the manager key is compromised.
    pub fn propose_manager(ctx: Context<UpdateManager>, new_manager: Pubkey) -> Result<()> {
        require!(new_manager != Pubkey::default(), SyntxError::ZeroAmount);
        let vault = &mut ctx.accounts.vault_state;
        vault.pending_manager = new_manager;
        vault.pending_manager_timestamp = Clock::get()?.unix_timestamp;
        msg!("Manager transfer proposed: {} → {} (effective after 48h)", vault.manager, new_manager);
        Ok(())
    }

    /// Execute a previously proposed manager transfer after the timelock has elapsed.
    /// Can be called by either the current or pending manager.
    pub fn execute_manager_transfer(ctx: Context<ExecuteManagerTransfer>) -> Result<()> {
        let vault = &mut ctx.accounts.vault_state;
        require!(vault.pending_manager != Pubkey::default(), SyntxError::NoPendingTransfer);

        let now = Clock::get()?.unix_timestamp;
        let elapsed = now - vault.pending_manager_timestamp;
        require!(elapsed >= TIMELOCK_SECONDS, SyntxError::TimelockNotElapsed);

        let old = vault.manager;
        vault.manager = vault.pending_manager;
        vault.pending_manager = Pubkey::default();
        vault.pending_manager_timestamp = 0;
        msg!("Manager transferred: {} → {}", old, vault.manager);
        Ok(())
    }

    /// Cancel a pending manager transfer (only current manager).
    pub fn cancel_manager_transfer(ctx: Context<ManagerOnly>) -> Result<()> {
        let vault = &mut ctx.accounts.vault_state;
        vault.pending_manager = Pubkey::default();
        vault.pending_manager_timestamp = 0;
        msg!("Manager transfer cancelled");
        Ok(())
    }

    /// Pause or unpause the vault.
    pub fn set_paused(ctx: Context<ManagerOnly>, paused: bool) -> Result<()> {
        ctx.accounts.vault_state.paused = paused;
        msg!("Vault paused: {}", paused);
        Ok(())
    }

    /// Configure circuit breaker parameters.
    /// max_drawdown_bps: auto-reject trades when equity drops this much from peak.
    ///   Cannot be set below min_drawdown_bps (immutable floor from init_vault).
    ///   Cannot be set to 0 if min_drawdown_bps > 0 (prevents disabling protection).
    /// cpi_whitelist: only this pubkey can call cpi_trade (Pubkey::default() = any)
    /// max_cpi_trade_size: max position size per CPI trade (0 = default 1M)
    pub fn set_circuit_breaker(
        ctx: Context<ManagerOnly>,
        max_drawdown_bps: u16,
        cpi_whitelist: Pubkey,
        max_cpi_trade_size: u64,
    ) -> Result<()> {
        require!(max_drawdown_bps <= 10_000, SyntxError::FeeTooHigh);
        let vault = &mut ctx.accounts.vault_state;
        // Enforce immutable minimum — manager cannot weaken protection below floor
        if vault.min_drawdown_bps > 0 {
            require!(
                max_drawdown_bps >= vault.min_drawdown_bps,
                SyntxError::BelowMinimumProtection
            );
        }
        vault.max_drawdown_bps = max_drawdown_bps;
        vault.cpi_whitelist = cpi_whitelist;
        vault.max_cpi_trade_size = max_cpi_trade_size;
        // Set peak equity to current deposits if not already set
        if vault.peak_equity == 0 && vault.total_deposits > 0 {
            vault.peak_equity = vault.total_deposits;
        }
        msg!("Circuit breaker: drawdown={}bps (min={}bps), cpi_whitelist={}, max_cpi_size={}",
            max_drawdown_bps, vault.min_drawdown_bps, cpi_whitelist, max_cpi_trade_size);
        Ok(())
    }

    /// On-chain share price oracle. Returns vault equity data via program return_data.
    /// Other programs can CPI this to get the current share price.
    ///
    /// Returns (as little-endian bytes):
    ///   total_shares: u64 (8 bytes)
    ///   total_deposits: u64 (8 bytes)
    ///   share_price_e6: u64 (8 bytes) — price in 1e6 fixed point
    pub fn get_share_price(ctx: Context<GetSharePrice>) -> Result<()> {
        let vault = &ctx.accounts.vault_state;

        let share_price_e6: u64 = if vault.total_shares > 0 {
            ((vault.total_deposits as u128) * 1_000_000 / (vault.total_shares as u128)) as u64
        } else {
            1_000_000 // 1.0 in e6
        };

        // Return data via set_return_data — other programs can read this via get_return_data
        let mut result = Vec::with_capacity(24);
        result.extend_from_slice(&vault.total_shares.to_le_bytes());
        result.extend_from_slice(&vault.total_deposits.to_le_bytes());
        result.extend_from_slice(&share_price_e6.to_le_bytes());

        solana_program::program::set_return_data(&result);

        msg!("Share price: {} e6 ({}/{})", share_price_e6, vault.total_deposits, vault.total_shares);
        Ok(())
    }

    /// Public CPI trade — allows other Solana programs to open/close positions
    /// via the vault. The calling program signs with its own authority.
    ///
    /// Unlike manager_trade (keeper-only), this is permissionless for CPI callers.
    /// The vault PDA still signs the Percolator trade.
    pub fn cpi_trade(
        ctx: Context<CpiTrade>,
        lp_idx: u16,
        size: i128,
    ) -> Result<()> {
        let vault = &ctx.accounts.vault_state;
        require!(vault.initialized, SyntxError::NotInitialized);
        require!(!vault.paused, SyntxError::VaultPaused);

        // CPI whitelist: if set, only the whitelisted program can call cpi_trade
        if vault.cpi_whitelist != Pubkey::default() {
            require!(
                ctx.accounts.caller.key() == vault.cpi_whitelist,
                SyntxError::CpiCallerNotWhitelisted
            );
        }

        // Size limit: use vault's configured max, or default 1M
        let max_cpi_size: i128 = if vault.max_cpi_trade_size > 0 {
            vault.max_cpi_trade_size as i128
        } else {
            1_000_000
        };
        require!(
            size.abs() <= max_cpi_size,
            SyntxError::CpiTradeTooLarge
        );

        // Circuit breaker check (same as manager_trade)
        if vault.max_drawdown_bps > 0 && vault.peak_equity > 0 {
            let drawdown_bps = if vault.total_deposits < vault.peak_equity {
                ((vault.peak_equity - vault.total_deposits) as u128 * 10_000 / vault.peak_equity as u128) as u16
            } else { 0 };
            if drawdown_bps > vault.max_drawdown_bps {
                return Err(SyntxError::CircuitBreakerTriggered.into());
            }
        }

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

        msg!("CPI trade: caller={}, lp={}, size={}", ctx.accounts.caller.key(), lp_idx, size);
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
    #[account(
        constraint = share_mint.supply == 0 @ SyntxError::InvalidShareMint,
        constraint = share_mint.mint_authority == COption::Some(vault_state.key()) @ SyntxError::InvalidShareMint,
        constraint = share_mint.freeze_authority.is_none() @ SyntxError::InvalidShareMint,
    )]
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

    /// Vault PDA's collateral token account. For standalone vaults its balance
    /// caps the fee base; donations cannot raise it above `total_deposits`.
    #[account(
        token::mint = vault_state.collateral_mint,
        token::authority = vault_state,
    )]
    pub vault_collateral: Box<Account<'info, TokenAccount>>,

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

/// Either current manager or pending manager can execute the transfer after timelock.
#[derive(Accounts)]
pub struct ExecuteManagerTransfer<'info> {
    #[account(
        constraint = (
            caller.key() == vault_state.manager ||
            caller.key() == vault_state.pending_manager
        ) @ SyntxError::Unauthorized
    )]
    pub caller: Signer<'info>,

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

#[derive(Accounts)]
pub struct GetSharePrice<'info> {
    #[account(
        seeds = [b"vault", vault_state.collateral_mint.as_ref(), vault_state.manager.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,
}

#[derive(Accounts)]
pub struct CpiTrade<'info> {
    /// The calling program's authority — any signer can CPI trade
    pub caller: Signer<'info>,

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

// =============================================================================
// Standalone account structs (no Percolator dependency)
// =============================================================================

#[derive(Accounts)]
pub struct InitVaultStandalone<'info> {
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

    pub collateral_mint: Box<Account<'info, Mint>>,

    /// Share mint — must be pre-created with vault PDA as mint authority
    #[account(
        constraint = share_mint.supply == 0 @ SyntxError::InvalidShareMint,
        constraint = share_mint.mint_authority == COption::Some(vault_state.key()) @ SyntxError::InvalidShareMint,
        constraint = share_mint.freeze_authority.is_none() @ SyntxError::InvalidShareMint,
    )]
    pub share_mint: Box<Account<'info, Mint>>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositStandalone<'info> {
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

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawStandalone<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault", vault_state.collateral_mint.as_ref(), vault_state.manager.as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,

    #[account(mut, token::mint = vault_state.share_mint)]
    pub user_shares: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = vault_state.collateral_mint,
        token::authority = user,
    )]
    pub user_collateral: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        token::mint = vault_state.collateral_mint,
        token::authority = vault_state,
    )]
    pub vault_collateral: Box<Account<'info, TokenAccount>>,

    #[account(mut, address = vault_state.share_mint)]
    pub share_mint: Box<Account<'info, Mint>>,

    pub token_program: Program<'info, Token>,
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

    // Circuit breakers (auto-triggered, no governance needed)
    /// Maximum drawdown in basis points before auto-pause (e.g., 2000 = 20%)
    pub max_drawdown_bps: u16,
    /// Highest recorded equity (for drawdown calculation)
    pub peak_equity: u64,
    /// CPI trade whitelist — if non-zero, only this program can call cpi_trade
    pub cpi_whitelist: Pubkey,
    /// Maximum single trade size for cpi_trade (0 = use default 1M)
    pub max_cpi_trade_size: u64,

    // Timelock for manager transfer (48h delay)
    /// Pending new manager (Pubkey::default() = no pending transfer)
    pub pending_manager: Pubkey,
    /// Timestamp when manager transfer was proposed
    pub pending_manager_timestamp: i64,

    // Immutable minimum protection (set at vault creation, cannot be reduced)
    /// Minimum drawdown limit in bps — manager cannot set max_drawdown_bps below this
    pub min_drawdown_bps: u16,

    /// Standalone mode — vault operates without Percolator CPI on deposit/withdraw.
    /// Used for structured products that route through Kamino/Phoenix instead.
    pub standalone: bool,
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
    #[msg("CPI trade size exceeds limit")]
    CpiTradeTooLarge,
    #[msg("Circuit breaker triggered — drawdown exceeds max")]
    CircuitBreakerTriggered,
    #[msg("CPI caller not whitelisted")]
    CpiCallerNotWhitelisted,
    #[msg("No pending manager transfer")]
    NoPendingTransfer,
    #[msg("Timelock not elapsed — wait 48 hours after proposal")]
    TimelockNotElapsed,
    #[msg("Cannot reduce protection below minimum floor")]
    BelowMinimumProtection,
    #[msg("Instruction requires standalone vault")]
    NotStandalone,
    #[msg("Share mint must have zero supply, the vault PDA as mint authority, and no freeze authority")]
    InvalidShareMint,
}
