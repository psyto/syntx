//! Integration tests for Syntx Vault
//!
//! Full lifecycle: InitMarket (Percolator) → InitVault → RegisterOnPercolator → Deposit → Withdraw
//!
//! Build both programs first:
//!   cd percolator-prog && cargo-build-sbf --tools-version v1.53
//!   cd syntx && cargo-build-sbf --tools-version v1.53 -- --manifest-path programs/syntx-vault/Cargo.toml

use litesvm::LiteSVM;
use solana_sdk::{
    account::Account,
    clock::Clock,
    hash::Hash,
    instruction::{AccountMeta, Instruction},
    program_pack::Pack,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    sysvar,
    transaction::Transaction,
};
use spl_token::state::{Account as TokenAccount, AccountState, Mint};
use std::path::PathBuf;

// Percolator constants (test feature: MAX_ACCOUNTS=64)
// Build percolator-prog with: cargo-build-sbf --tools-version v1.53 -- --features test
const SLAB_LEN: usize = 17392;
const MAX_ACCOUNTS: usize = 64;
const TEST_FEED_ID: [u8; 32] = [0xABu8; 32];
const PYTH_RECEIVER_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    0x0c, 0xb7, 0xfa, 0xbb, 0x52, 0xf7, 0xa6, 0x48,
    0xbb, 0x5b, 0x31, 0x7d, 0x9a, 0x01, 0x8b, 0x90,
    0x57, 0xcb, 0x02, 0x47, 0x74, 0xfa, 0xfe, 0x01,
    0xe6, 0xc4, 0xdf, 0x98, 0xcc, 0x38, 0x58, 0x81,
]);

// =============================================================================
// Path helpers
// =============================================================================

fn syntx_program_path() -> PathBuf {
    let candidates = [
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy/syntx_vault.so"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/deploy/syntx_vault.so"),
    ];
    for path in &candidates {
        if path.exists() {
            return path.clone();
        }
    }
    panic!("syntx_vault.so not found");
}

fn percolator_program_path() -> PathBuf {
    let candidates = [
        PathBuf::from(format!("{}/src/percolator-prog/target/deploy/percolator_prog.so", env!("HOME"))),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy/percolator_prog.so"),
    ];
    for path in &candidates {
        if path.exists() {
            return path.clone();
        }
    }
    panic!("percolator_prog.so not found. Build from aeyakovenko/percolator-prog");
}

// =============================================================================
// Data helpers
// =============================================================================

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

fn make_mint_data_with_authority(authority: &Pubkey) -> Vec<u8> {
    let mut data = vec![0u8; Mint::LEN];
    let mint = Mint {
        mint_authority: solana_sdk::program_option::COption::Some(*authority),
        supply: 0,
        decimals: 6,
        is_initialized: true,
        freeze_authority: solana_sdk::program_option::COption::None,
    };
    Mint::pack(mint, &mut data).unwrap();
    data
}

fn make_pyth_data(feed_id: &[u8; 32], price: i64, expo: i32, conf: u64, publish_time: i64) -> Vec<u8> {
    let mut data = vec![0u8; 134];
    data[42..74].copy_from_slice(feed_id);
    data[74..82].copy_from_slice(&price.to_le_bytes());
    data[82..90].copy_from_slice(&conf.to_le_bytes());
    data[90..94].copy_from_slice(&expo.to_le_bytes());
    data[94..102].copy_from_slice(&publish_time.to_le_bytes());
    data
}

// =============================================================================
// Anchor discriminator helper
// =============================================================================

/// Compute Anchor instruction discriminator: sha256("global:<name>")[..8]
fn anchor_discriminator(name: &str) -> [u8; 8] {
    use std::io::Write;
    let full = format!("global:{}", name);
    let hash = solana_sdk::hash::hash(full.as_bytes());
    let mut disc = [0u8; 8];
    disc.copy_from_slice(&hash.to_bytes()[..8]);
    disc
}

// =============================================================================
// Percolator instruction encoders
// =============================================================================

fn encode_init_market(admin: &Pubkey, mint: &Pubkey, feed_id: &[u8; 32]) -> Vec<u8> {
    let mut data = vec![0u8]; // tag = 0
    data.extend_from_slice(admin.as_ref());
    data.extend_from_slice(mint.as_ref());
    data.extend_from_slice(feed_id);
    data.extend_from_slice(&u64::MAX.to_le_bytes()); // max_staleness_secs
    data.extend_from_slice(&500u16.to_le_bytes());   // conf_filter_bps
    data.push(0u8);                                   // invert = 0
    data.extend_from_slice(&0u32.to_le_bytes());     // unit_scale
    data.extend_from_slice(&0u64.to_le_bytes());     // initial_mark_price_e6
    // Per-market admin limits
    data.extend_from_slice(&u128::MAX.to_le_bytes()); // max_maintenance_fee_per_slot
    data.extend_from_slice(&u128::MAX.to_le_bytes()); // max_risk_threshold
    data.extend_from_slice(&0u64.to_le_bytes());     // min_oracle_price_cap_e2bps
    // RiskParams
    data.extend_from_slice(&0u64.to_le_bytes());     // warmup_period_slots
    data.extend_from_slice(&500u64.to_le_bytes());   // maintenance_margin_bps
    data.extend_from_slice(&1000u64.to_le_bytes());  // initial_margin_bps
    data.extend_from_slice(&0u64.to_le_bytes());     // trading_fee_bps
    data.extend_from_slice(&(MAX_ACCOUNTS as u64).to_le_bytes());
    data.extend_from_slice(&0u128.to_le_bytes());    // new_account_fee
    data.extend_from_slice(&0u128.to_le_bytes());    // risk_reduction_threshold
    data.extend_from_slice(&0u128.to_le_bytes());    // maintenance_fee_per_slot
    data.extend_from_slice(&u64::MAX.to_le_bytes()); // max_crank_staleness_slots
    data.extend_from_slice(&50u64.to_le_bytes());    // liquidation_fee_bps
    data.extend_from_slice(&1_000_000_000_000u128.to_le_bytes()); // liquidation_fee_cap
    data.extend_from_slice(&100u64.to_le_bytes());   // liquidation_buffer_bps
    data.extend_from_slice(&0u128.to_le_bytes());    // min_liquidation_abs
    data
}

fn encode_init_user(fee: u64) -> Vec<u8> {
    let mut data = vec![1u8];
    data.extend_from_slice(&fee.to_le_bytes());
    data
}

fn encode_init_lp(matcher: &Pubkey, ctx: &Pubkey, fee: u64) -> Vec<u8> {
    let mut data = vec![2u8];
    data.extend_from_slice(matcher.as_ref());
    data.extend_from_slice(ctx.as_ref());
    data.extend_from_slice(&fee.to_le_bytes());
    data
}

fn encode_deposit(user_idx: u16, amount: u64) -> Vec<u8> {
    let mut data = vec![3u8];
    data.extend_from_slice(&user_idx.to_le_bytes());
    data.extend_from_slice(&amount.to_le_bytes());
    data
}

fn encode_trade(lp: u16, user: u16, size: i128) -> Vec<u8> {
    let mut data = vec![6u8];
    data.extend_from_slice(&lp.to_le_bytes());
    data.extend_from_slice(&user.to_le_bytes());
    data.extend_from_slice(&size.to_le_bytes());
    data
}

fn encode_crank_permissionless() -> Vec<u8> {
    let mut data = vec![5u8];
    data.extend_from_slice(&u16::MAX.to_le_bytes());
    data.push(0u8);
    data
}

// =============================================================================
// Test environment
// =============================================================================

struct TestEnv {
    svm: LiteSVM,
    syntx_id: Pubkey,
    perc_id: Pubkey,
    payer: Keypair,
    // Percolator state
    slab: Pubkey,
    collateral_mint: Pubkey,
    perc_vault: Pubkey,       // Percolator's token vault
    perc_vault_pda: Pubkey,   // Percolator's vault authority PDA
    pyth_oracle: Pubkey,
    perc_account_count: u16,
}

impl TestEnv {
    fn new() -> Self {
        let mut svm = LiteSVM::new();

        // Load programs
        let syntx_id = Pubkey::new_unique();
        let perc_id = Pubkey::new_unique();
        let syntx_bytes = std::fs::read(syntx_program_path()).expect("Failed to read syntx_vault.so");
        let perc_bytes = std::fs::read(percolator_program_path()).expect("Failed to read percolator_prog.so");
        svm.add_program(syntx_id, &syntx_bytes);
        svm.add_program(perc_id, &perc_bytes);

        let payer = Keypair::new();
        svm.airdrop(&payer.pubkey(), 100_000_000_000).unwrap();

        // Collateral mint (USDC-like, 6 decimals)
        let collateral_mint = Pubkey::new_unique();
        svm.set_account(collateral_mint, Account {
            lamports: 1_000_000,
            data: make_mint_data_no_authority(),
            owner: spl_token::ID,
            executable: false,
            rent_epoch: 0,
        }).unwrap();

        // Percolator slab
        let slab = Pubkey::new_unique();
        svm.set_account(slab, Account {
            lamports: 1_000_000_000,
            data: vec![0u8; SLAB_LEN],
            owner: perc_id,
            executable: false,
            rent_epoch: 0,
        }).unwrap();

        // Percolator vault PDA + token account
        let (perc_vault_pda, _) = Pubkey::find_program_address(&[b"vault", slab.as_ref()], &perc_id);
        let perc_vault = Pubkey::new_unique();
        svm.set_account(perc_vault, Account {
            lamports: 1_000_000,
            data: make_token_account_data(&collateral_mint, &perc_vault_pda, 0),
            owner: spl_token::ID,
            executable: false,
            rent_epoch: 0,
        }).unwrap();

        // Pyth oracle
        let pyth_oracle = Pubkey::new_unique();
        let pyth_data = make_pyth_data(&TEST_FEED_ID, 138_000_000, -6, 1, 100);
        svm.set_account(pyth_oracle, Account {
            lamports: 1_000_000,
            data: pyth_data,
            owner: PYTH_RECEIVER_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        }).unwrap();

        svm.set_sysvar(&Clock {
            slot: 100,
            unix_timestamp: 100,
            ..Clock::default()
        });

        TestEnv {
            svm, syntx_id, perc_id, payer,
            slab, collateral_mint, perc_vault, perc_vault_pda, pyth_oracle,
            perc_account_count: 0,
        }
    }

    /// Initialize Percolator market on the slab
    fn init_percolator_market(&mut self) {
        let admin = &self.payer;
        let dummy_ata = Pubkey::new_unique();
        self.svm.set_account(dummy_ata, Account {
            lamports: 1_000_000,
            data: vec![0u8; TokenAccount::LEN],
            owner: spl_token::ID,
            executable: false,
            rent_epoch: 0,
        }).unwrap();

        let ix = Instruction {
            program_id: self.perc_id,
            accounts: vec![
                AccountMeta::new(admin.pubkey(), true),
                AccountMeta::new(self.slab, false),
                AccountMeta::new_readonly(self.collateral_mint, false),
                AccountMeta::new(self.perc_vault, false),
                AccountMeta::new_readonly(spl_token::ID, false),
                AccountMeta::new_readonly(sysvar::clock::ID, false),
                AccountMeta::new_readonly(sysvar::rent::ID, false),
                AccountMeta::new_readonly(dummy_ata, false),
                AccountMeta::new_readonly(solana_sdk::system_program::ID, false),
            ],
            data: encode_init_market(&admin.pubkey(), &self.collateral_mint, &TEST_FEED_ID),
        };

        let tx = Transaction::new_signed_with_payer(
            &[ix], Some(&admin.pubkey()), &[admin], self.svm.latest_blockhash(),
        );
        self.svm.send_transaction(tx).expect("Percolator init_market failed");
    }

    /// Create LP directly on Percolator (for trade counterparty)
    fn init_percolator_lp(&mut self, owner: &Keypair) -> u16 {
        let idx = self.perc_account_count;
        self.svm.airdrop(&owner.pubkey(), 1_000_000_000).unwrap();
        let ata = self.create_perc_ata(&owner.pubkey(), 0);
        let matcher = spl_token::ID; // dummy matcher
        let ctx = Pubkey::new_unique();
        self.svm.set_account(ctx, Account {
            lamports: 1_000_000,
            data: vec![0u8; 320],
            owner: matcher,
            executable: false,
            rent_epoch: 0,
        }).unwrap();

        let ix = Instruction {
            program_id: self.perc_id,
            accounts: vec![
                AccountMeta::new(owner.pubkey(), true),
                AccountMeta::new(self.slab, false),
                AccountMeta::new(ata, false),
                AccountMeta::new(self.perc_vault, false),
                AccountMeta::new_readonly(spl_token::ID, false),
            ],
            data: encode_init_lp(&matcher, &ctx, 0),
        };

        let tx = Transaction::new_signed_with_payer(
            &[ix], Some(&owner.pubkey()), &[owner], self.svm.latest_blockhash(),
        );
        self.svm.send_transaction(tx).expect("init_lp failed");
        self.perc_account_count += 1;
        idx
    }

    fn create_perc_ata(&mut self, owner: &Pubkey, amount: u64) -> Pubkey {
        let ata = Pubkey::new_unique();
        self.svm.set_account(ata, Account {
            lamports: 1_000_000,
            data: make_token_account_data(&self.collateral_mint, owner, amount),
            owner: spl_token::ID,
            executable: false,
            rent_epoch: 0,
        }).unwrap();
        ata
    }

    /// Derive vault PDA for the Syntx vault
    fn vault_pda(&self, manager: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[b"vault", self.collateral_mint.as_ref(), manager.as_ref()],
            &self.syntx_id,
        )
    }
}

// =============================================================================
// Tests
// =============================================================================

#[test]
fn test_syntx_vault_loads() {
    let mut svm = LiteSVM::new();
    let syntx_id = Pubkey::new_unique();
    svm.add_program_from_file(syntx_id, syntx_program_path().to_str().unwrap())
        .expect("Failed to load syntx_vault");
    assert!(svm.get_account(&syntx_id).unwrap().executable);
}

#[test]
fn test_percolator_loads() {
    let mut svm = LiteSVM::new();
    let perc_id = Pubkey::new_unique();
    svm.add_program_from_file(perc_id, percolator_program_path().to_str().unwrap())
        .expect("Failed to load percolator_prog");
    assert!(svm.get_account(&perc_id).unwrap().executable);
}

#[test]
fn test_percolator_init_market() {
    let mut env = TestEnv::new();
    env.init_percolator_market();
    // If we get here, InitMarket succeeded
}

#[test]
fn test_percolator_init_market_and_lp() {
    let mut env = TestEnv::new();
    env.init_percolator_market();

    let lp_owner = Keypair::new();
    let lp_idx = env.init_percolator_lp(&lp_owner);
    assert_eq!(lp_idx, 0);
}
