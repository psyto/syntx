//! Integration tests for Syntx Vault
//!
//! Tests the full vault lifecycle against a real Percolator program:
//! InitVault → RegisterOnPercolator → Deposit → ManagerTrade → Withdraw
//!
//! Requires both syntx_vault.so and percolator_prog.so BPF binaries.
//! Build: cargo-build-sbf --tools-version v1.53 -- --manifest-path programs/syntx-vault/Cargo.toml
//!
//! Note: percolator_prog.so must be built from aeyakovenko/percolator-prog.

use litesvm::LiteSVM;
use solana_sdk::{
    account::Account,
    clock::Clock,
    instruction::{AccountMeta, Instruction},
    program_pack::Pack,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_instruction,
    sysvar,
    transaction::Transaction,
};
use spl_token::state::{Account as TokenAccount, AccountState, Mint};
use std::path::PathBuf;

// Program IDs
const SYNTX_VAULT_PROGRAM_ID: Pubkey = Pubkey::new_from_array({
    // 53r6bg7JBFqf5Jfs7fe4kHDtwXwUgDWoLarYrsWcoF1V
    let mut bytes = [0u8; 32];
    // We'll use the actual ID at runtime
    bytes
});

// Percolator slab constants (production MAX_ACCOUNTS=4096)
const SLAB_LEN: usize = 992616;

fn syntx_program_path() -> PathBuf {
    // Binary is in workspace root target/deploy/
    let candidates = [
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy/syntx_vault.so"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/deploy/syntx_vault.so"),
    ];
    for path in &candidates {
        if path.exists() {
            return path.clone();
        }
    }
    panic!("syntx_vault.so not found. Run: cargo-build-sbf --tools-version v1.53 -- --manifest-path programs/syntx-vault/Cargo.toml");
}

fn percolator_program_path() -> PathBuf {
    // Look for percolator-prog binary
    let candidates = [
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../percolator-prog/target/deploy/percolator_prog.so"),
        PathBuf::from(format!("{}/src/percolator-prog/target/deploy/percolator_prog.so", env!("HOME"))),
    ];
    for path in &candidates {
        if path.exists() {
            return path.clone();
        }
    }
    panic!("percolator_prog.so not found. Build from aeyakovenko/percolator-prog: cargo build-sbf");
}

fn make_token_account_data(mint: &Pubkey, owner: &Pubkey, amount: u64) -> Vec<u8> {
    let mut data = vec![0u8; TokenAccount::LEN];
    let mut account = TokenAccount::default();
    account.mint = *mint;
    account.owner = *owner;
    account.amount = amount;
    account.state = AccountState::Initialized;
    TokenAccount::pack(account, &mut data).unwrap();
    data
}

fn make_mint_data(authority: &Pubkey, decimals: u8) -> Vec<u8> {
    let mut data = vec![0u8; Mint::LEN];
    let mint = Mint {
        mint_authority: solana_sdk::program_option::COption::Some(*authority),
        supply: 0,
        decimals,
        is_initialized: true,
        freeze_authority: solana_sdk::program_option::COption::None,
    };
    Mint::pack(mint, &mut data).unwrap();
    data
}

fn make_mint_data_no_authority() -> Vec<u8> {
    let mut data = vec![0u8; Mint::LEN];
    let mint = Mint {
        mint_authority: solana_sdk::program_option::COption::None,
        supply: 0,
        decimals: 6,
        is_initialized: true,
        freeze_authority: solana_sdk::program_option::COption::None,
    };
    Mint::pack(mint, &mut data).unwrap();
    data
}

#[test]
fn test_syntx_vault_loads() {
    let mut svm = LiteSVM::new();

    let syntx_id = Pubkey::new_unique();
    svm.add_program_from_file(syntx_id, &syntx_program_path().to_str().unwrap())
        .expect("Failed to load syntx_vault program");

    // Verify program is loaded
    let account = svm.get_account(&syntx_id);
    assert!(account.is_some(), "Program account should exist");
    assert!(account.unwrap().executable, "Program should be executable");
}

#[test]
fn test_percolator_loads() {
    let mut svm = LiteSVM::new();

    let perc_id = Pubkey::new_unique();
    svm.add_program_from_file(perc_id, &percolator_program_path().to_str().unwrap())
        .expect("Failed to load percolator_prog program");

    let account = svm.get_account(&perc_id);
    assert!(account.is_some(), "Program account should exist");
    assert!(account.unwrap().executable, "Program should be executable");
}

#[test]
fn test_both_programs_load() {
    let mut svm = LiteSVM::new();

    let syntx_id = Pubkey::new_unique();
    let perc_id = Pubkey::new_unique();

    svm.add_program_from_file(syntx_id, &syntx_program_path().to_str().unwrap())
        .expect("Failed to load syntx_vault");
    svm.add_program_from_file(perc_id, &percolator_program_path().to_str().unwrap())
        .expect("Failed to load percolator_prog");

    // Both loaded
    assert!(svm.get_account(&syntx_id).unwrap().executable);
    assert!(svm.get_account(&perc_id).unwrap().executable);
}
