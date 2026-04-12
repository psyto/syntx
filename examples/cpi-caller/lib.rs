// =============================================================================
// Example: CPI into Syntx vault from another Solana program
//
// This is a minimal example showing how a lending protocol (or any program)
// can atomically trade through a Syntx vault using the cpi_trade instruction.
//
// NOTE: This is example code for reference — not a deployable program.
//       It demonstrates the account structure and CPI call pattern.
// =============================================================================

use anchor_lang::prelude::*;

// Syntx vault program ID (devnet)
const SYNTX_PROGRAM_ID: Pubkey = pubkey!("53r6bg7JBFqf5Jfs7fe4kHDtwXwUgDWoLarYrsWcoF1V");

declare_id!("ExampleCpiCa11er1111111111111111111111111");

#[program]
pub mod cpi_caller_example {
    use super::*;

    /// Example: a lending protocol hedges its exposure by shorting through Syntx.
    ///
    /// When a user borrows SOL, the lending protocol CPI calls Syntx to open
    /// a matching short position — all in one atomic transaction.
    pub fn hedge_via_syntx(
        ctx: Context<HedgeViaSyntx>,
        lp_idx: u16,
        hedge_size: i128, // negative = short
    ) -> Result<()> {
        msg!("Opening hedge via Syntx: size={}", hedge_size);

        // Build the Syntx cpi_trade instruction
        //
        // Anchor discriminator for "cpi_trade":
        //   sha256("global:cpi_trade")[..8]
        let disc = anchor_lang::solana_program::hash::hash(b"global:cpi_trade");
        let mut ix_data = disc.to_bytes()[..8].to_vec();
        ix_data.extend_from_slice(&lp_idx.to_le_bytes());
        ix_data.extend_from_slice(&hedge_size.to_le_bytes());

        let accounts = vec![
            // caller — this program's authority (signer)
            AccountMeta::new_readonly(ctx.accounts.authority.key(), true),
            // vault_state — the Syntx vault PDA
            AccountMeta::new_readonly(ctx.accounts.syntx_vault.key(), false),
            // lp_owner — LP signer on Percolator (vault PDA signs via invoke_signed)
            AccountMeta::new_readonly(ctx.accounts.syntx_vault.key(), true),
            // percolator_slab — the market slab
            AccountMeta::new(ctx.accounts.percolator_slab.key(), false),
            // oracle — price feed
            AccountMeta::new_readonly(ctx.accounts.oracle.key(), false),
            // percolator_program
            AccountMeta::new_readonly(ctx.accounts.percolator_program.key(), false),
            // clock sysvar
            AccountMeta::new_readonly(anchor_lang::solana_program::sysvar::clock::id(), false),
        ];

        let ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: SYNTX_PROGRAM_ID,
            accounts,
            data: ix_data,
        };

        // CPI call — Syntx vault PDA will sign the Percolator trade internally
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.syntx_vault.to_account_info(),
                ctx.accounts.percolator_slab.to_account_info(),
                ctx.accounts.oracle.to_account_info(),
                ctx.accounts.percolator_program.to_account_info(),
                ctx.accounts.clock.to_account_info(),
            ],
        )?;

        msg!("Hedge opened successfully via Syntx CPI");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct HedgeViaSyntx<'info> {
    /// The calling program's authority
    pub authority: Signer<'info>,

    /// Syntx vault PDA — the vault to trade through
    /// CHECK: Validated by Syntx program during CPI
    pub syntx_vault: AccountInfo<'info>,

    /// Percolator slab (market data)
    /// CHECK: Validated by Syntx program during CPI
    #[account(mut)]
    pub percolator_slab: AccountInfo<'info>,

    /// Oracle price feed
    /// CHECK: Validated by Percolator program
    pub oracle: AccountInfo<'info>,

    /// Percolator program
    /// CHECK: Validated by Syntx program
    #[account(executable)]
    pub percolator_program: AccountInfo<'info>,

    /// Clock sysvar
    pub clock: Sysvar<'info, Clock>,
}
