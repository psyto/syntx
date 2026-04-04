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

// Percolator constants (production: MAX_ACCOUNTS=4096)
// Must match aeyakovenko/percolator-prog latest build
const SLAB_LEN: usize = 1_156_800;
const MAX_ACCOUNTS: usize = 4096;
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
    // OFF_VERIFICATION_LEVEL = 40: must be 1 (Full) for production builds
    data[40..42].copy_from_slice(&1u16.to_le_bytes());
    // OFF_FEED_ID = 42
    data[42..74].copy_from_slice(feed_id);
    // OFF_PRICE = 74
    data[74..82].copy_from_slice(&price.to_le_bytes());
    // OFF_CONF = 82
    data[82..90].copy_from_slice(&conf.to_le_bytes());
    // OFF_EXPO = 90
    data[90..94].copy_from_slice(&expo.to_le_bytes());
    // OFF_PUBLISH_TIME = 94
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
    data.extend_from_slice(&100_000_000_000_000_000_000u128.to_le_bytes()); // max_maintenance_fee_per_slot
    data.extend_from_slice(&10_000_000_000_000_000u128.to_le_bytes()); // max_insurance_floor
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
    data.extend_from_slice(&100u128.to_le_bytes());  // min_initial_deposit
    data.extend_from_slice(&1u128.to_le_bytes());    // min_nonzero_mm_req
    data.extend_from_slice(&2u128.to_le_bytes());    // min_nonzero_im_req
    // Extended tail
    data.extend_from_slice(&0u16.to_le_bytes());     // insurance_withdraw_max_bps
    data.extend_from_slice(&0u64.to_le_bytes());     // insurance_withdraw_cooldown_slots
    data.extend_from_slice(&u128::MAX.to_le_bytes()); // max_insurance_floor_change_per_day
    data.extend_from_slice(&0u64.to_le_bytes());     // permissionless_resolve_stale_slots
    data.extend_from_slice(&500u64.to_le_bytes());   // funding_horizon_slots
    data.extend_from_slice(&100u64.to_le_bytes());   // funding_k_bps
    data.extend_from_slice(&500i64.to_le_bytes());   // funding_max_premium_bps
    data.extend_from_slice(&5i64.to_le_bytes());     // funding_max_bps_per_slot
    data.extend_from_slice(&0u64.to_le_bytes());     // mark_min_fee
    data.extend_from_slice(&0u64.to_le_bytes());     // force_close_delay_slots
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

        // Load programs — syntx must be at its declared ID (Anchor checks)
        let syntx_id: Pubkey = "53r6bg7JBFqf5Jfs7fe4kHDtwXwUgDWoLarYrsWcoF1V".parse().unwrap();
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
        let ata = self.create_perc_ata(&owner.pubkey(), 1000); // min initial deposit
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
                AccountMeta::new_readonly(sysvar::clock::ID, false),
            ],
            data: encode_init_lp(&matcher, &ctx, 1000), // min initial deposit
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

// =============================================================================
// Syntx instruction helpers
// =============================================================================

/// Anchor discriminator: sha256("global:<name>")[..8]
fn disc(name: &str) -> Vec<u8> {
    let full = format!("global:{}", name);
    let hash = solana_sdk::hash::hash(full.as_bytes());
    hash.to_bytes()[..8].to_vec()
}

fn encode_syntx_init_vault(
    performance_fee_bps: u16,
    management_fee_bps: u16,
    deposit_cap: u64,
) -> Vec<u8> {
    let mut data = disc("init_vault");
    data.extend_from_slice(&performance_fee_bps.to_le_bytes());
    data.extend_from_slice(&management_fee_bps.to_le_bytes());
    data.extend_from_slice(&deposit_cap.to_le_bytes());
    data
}

fn encode_syntx_register(initial_fee_payment: u64) -> Vec<u8> {
    let mut data = disc("register_on_percolator");
    data.extend_from_slice(&initial_fee_payment.to_le_bytes());
    data
}

fn encode_syntx_set_idx(user_idx: u16) -> Vec<u8> {
    let mut data = disc("set_percolator_idx");
    data.extend_from_slice(&user_idx.to_le_bytes());
    data
}

fn encode_syntx_deposit(amount: u64) -> Vec<u8> {
    let mut data = disc("deposit");
    data.extend_from_slice(&amount.to_le_bytes());
    data
}

fn encode_syntx_withdraw(shares_to_burn: u64) -> Vec<u8> {
    let mut data = disc("withdraw");
    data.extend_from_slice(&shares_to_burn.to_le_bytes());
    data
}

fn encode_syntx_manager_trade(lp_idx: u16, size: i128) -> Vec<u8> {
    let mut data = disc("manager_trade");
    data.extend_from_slice(&lp_idx.to_le_bytes());
    data.extend_from_slice(&size.to_le_bytes());
    data
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

#[test]
fn test_syntx_init_vault() {
    let mut env = TestEnv::new();
    env.init_percolator_market();

    let manager = &env.payer;
    let (vault_pda, _bump) = env.vault_pda(&manager.pubkey());

    // Pre-create share mint with vault PDA as authority
    let share_mint = Pubkey::new_unique();
    env.svm.set_account(share_mint, Account {
        lamports: 1_000_000,
        data: make_mint_data_with_authority(&vault_pda),
        owner: spl_token::ID,
        executable: false,
        rent_epoch: 0,
    }).unwrap();

    let ix = Instruction {
        program_id: env.syntx_id,
        accounts: vec![
            AccountMeta::new(manager.pubkey(), true),       // manager (signer, payer)
            AccountMeta::new(vault_pda, false),             // vault_state (init PDA)
            AccountMeta::new_readonly(env.collateral_mint, false), // collateral_mint
            AccountMeta::new_readonly(share_mint, false),   // share_mint
            AccountMeta::new_readonly(env.slab, false),     // percolator_slab
            AccountMeta::new_readonly(env.perc_id, false),  // percolator_program
            AccountMeta::new_readonly(solana_sdk::system_program::ID, false), // system_program
        ],
        data: encode_syntx_init_vault(2000, 200, 1_000_000_000), // 20% perf, 2% mgmt, 1000 USDC cap
    };

    let tx = Transaction::new_signed_with_payer(
        &[ix], Some(&manager.pubkey()), &[manager], env.svm.latest_blockhash(),
    );
    env.svm.send_transaction(tx).expect("Syntx init_vault failed");

    // Verify vault state was created
    let vault_account = env.svm.get_account(&vault_pda).expect("Vault PDA should exist");
    assert_eq!(vault_account.owner, env.syntx_id);
    assert!(vault_account.data.len() > 0);
}

#[test]
fn test_syntx_full_lifecycle() {
    let mut env = TestEnv::new();
    env.init_percolator_market();

    let manager = &env.payer;
    let manager_pubkey = manager.pubkey();
    let (vault_pda, _bump) = env.vault_pda(&manager_pubkey);

    // --- Step 1: Create share mint with vault PDA as authority ---
    let share_mint = Pubkey::new_unique();
    env.svm.set_account(share_mint, Account {
        lamports: 1_000_000,
        data: make_mint_data_with_authority(&vault_pda),
        owner: spl_token::ID,
        executable: false,
        rent_epoch: 0,
    }).unwrap();

    // --- Step 2: InitVault ---
    let ix = Instruction {
        program_id: env.syntx_id,
        accounts: vec![
            AccountMeta::new(manager_pubkey, true),
            AccountMeta::new(vault_pda, false),
            AccountMeta::new_readonly(env.collateral_mint, false),
            AccountMeta::new_readonly(share_mint, false),
            AccountMeta::new_readonly(env.slab, false),
            AccountMeta::new_readonly(env.perc_id, false),
            AccountMeta::new_readonly(solana_sdk::system_program::ID, false),
        ],
        data: encode_syntx_init_vault(2000, 200, 1_000_000_000),
    };
    let tx = Transaction::new_signed_with_payer(
        &[ix], Some(&manager_pubkey), &[manager], env.svm.latest_blockhash(),
    );
    env.svm.send_transaction(tx).expect("init_vault failed");

    // --- Step 3: Create vault's collateral token account (with initial balance for registration fee) ---
    let registration_fee: u64 = 1000; // min_initial_deposit is 100 units, use 1000 for safety
    let vault_collateral = Pubkey::new_unique();
    env.svm.set_account(vault_collateral, Account {
        lamports: 1_000_000,
        data: make_token_account_data(&env.collateral_mint, &vault_pda, registration_fee),
        owner: spl_token::ID,
        executable: false,
        rent_epoch: 0,
    }).unwrap();

    // --- Step 4: RegisterOnPercolator (CPI → Percolator InitUser) ---
    let ix = Instruction {
        program_id: env.syntx_id,
        accounts: vec![
            AccountMeta::new(manager_pubkey, true),         // manager
            AccountMeta::new(vault_pda, false),             // vault_state
            AccountMeta::new(vault_collateral, false),      // vault_collateral
            AccountMeta::new(env.slab, false),              // percolator_slab
            AccountMeta::new(env.perc_vault, false),        // percolator_vault
            AccountMeta::new_readonly(env.perc_id, false),  // percolator_program
            AccountMeta::new_readonly(spl_token::ID, false), // token_program
            AccountMeta::new_readonly(sysvar::clock::ID, false), // clock
        ],
        data: encode_syntx_register(registration_fee), // fee payment for account creation
    };
    let tx = Transaction::new_signed_with_payer(
        &[ix], Some(&manager_pubkey), &[manager], env.svm.latest_blockhash(),
    );
    let result = env.svm.send_transaction(tx);
    match &result {
        Ok(_) => println!("RegisterOnPercolator succeeded"),
        Err(e) => {
            println!("RegisterOnPercolator failed: {:?}", e);
            for log in &e.meta.logs {
                println!("  LOG: {}", log);
            }
        }
    }
    result.expect("register_on_percolator failed");

    // --- Step 5: Set Percolator user index ---
    // The vault was registered as the first user after LP, so index depends on setup
    // In our test, we didn't create any LP, so vault user_idx = 0
    let vault_user_idx: u16 = 0;
    let ix = Instruction {
        program_id: env.syntx_id,
        accounts: vec![
            AccountMeta::new(manager_pubkey, true),
            AccountMeta::new(vault_pda, false),
        ],
        data: encode_syntx_set_idx(vault_user_idx),
    };
    let tx = Transaction::new_signed_with_payer(
        &[ix], Some(&manager_pubkey), &[manager], env.svm.latest_blockhash(),
    );
    env.svm.send_transaction(tx).expect("set_percolator_idx failed");

    // --- Step 6: Create a user who will deposit ---
    let user = Keypair::new();
    env.svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();

    // User's USDC token account (with 1000 USDC = 1_000_000_000 lamports at 6 decimals)
    let deposit_amount: u64 = 100_000_000; // 100 USDC
    let user_collateral = Pubkey::new_unique();
    env.svm.set_account(user_collateral, Account {
        lamports: 1_000_000,
        data: make_token_account_data(&env.collateral_mint, &user.pubkey(), deposit_amount),
        owner: spl_token::ID,
        executable: false,
        rent_epoch: 0,
    }).unwrap();

    // User's share token account (empty)
    let user_shares = Pubkey::new_unique();
    env.svm.set_account(user_shares, Account {
        lamports: 1_000_000,
        data: make_token_account_data(&share_mint, &user.pubkey(), 0),
        owner: spl_token::ID,
        executable: false,
        rent_epoch: 0,
    }).unwrap();

    // --- Step 7: Deposit ---
    let ix = Instruction {
        program_id: env.syntx_id,
        accounts: vec![
            AccountMeta::new(user.pubkey(), true),          // user
            AccountMeta::new(vault_pda, false),             // vault_state
            AccountMeta::new(user_collateral, false),       // user_collateral
            AccountMeta::new(user_shares, false),           // user_shares
            AccountMeta::new(vault_collateral, false),      // vault_collateral
            AccountMeta::new(share_mint, false),            // share_mint
            AccountMeta::new(env.slab, false),              // percolator_slab
            AccountMeta::new(env.perc_vault, false),        // percolator_vault
            AccountMeta::new_readonly(env.perc_id, false),  // percolator_program
            AccountMeta::new_readonly(spl_token::ID, false), // token_program
            AccountMeta::new_readonly(sysvar::clock::ID, false), // clock
        ],
        data: encode_syntx_deposit(deposit_amount),
    };
    let tx = Transaction::new_signed_with_payer(
        &[ix], Some(&user.pubkey()), &[&user], env.svm.latest_blockhash(),
    );
    let result = env.svm.send_transaction(tx);
    match &result {
        Ok(_) => println!("Deposit succeeded"),
        Err(e) => {
            println!("Deposit failed: {:?}", e);
            for log in &e.meta.logs {
                println!("  LOG: {}", log);
            }
        }
    }
    result.expect("deposit failed");

    // Verify shares were minted
    let shares_account = env.svm.get_account(&user_shares).unwrap();
    let shares_state = TokenAccount::unpack(&shares_account.data).unwrap();
    assert_eq!(shares_state.amount, deposit_amount, "First deposit should mint 1:1 shares");

    // Verify USDC was transferred
    let user_col_account = env.svm.get_account(&user_collateral).unwrap();
    let user_col_state = TokenAccount::unpack(&user_col_account.data).unwrap();
    assert_eq!(user_col_state.amount, 0, "User should have 0 USDC after deposit");

    println!("  Deposit OK: {} USDC → {} shares", deposit_amount, deposit_amount);

    // --- Step 8: Create LP on Percolator for trade counterparty ---
    let lp_owner = Keypair::new();
    env.svm.airdrop(&lp_owner.pubkey(), 10_000_000_000).unwrap();
    let lp_ata = Pubkey::new_unique();
    env.svm.set_account(lp_ata, Account {
        lamports: 1_000_000,
        data: make_token_account_data(&env.collateral_mint, &lp_owner.pubkey(), 0),
        owner: spl_token::ID,
        executable: false,
        rent_epoch: 0,
    }).unwrap();
    // Dummy matcher context
    let matcher_prog = spl_token::ID;
    let matcher_ctx = Pubkey::new_unique();
    env.svm.set_account(matcher_ctx, Account {
        lamports: 1_000_000,
        data: vec![0u8; 320],
        owner: matcher_prog,
        executable: false,
        rent_epoch: 0,
    }).unwrap();

    // Give LP some initial collateral
    env.svm.set_account(lp_ata, Account {
        lamports: 1_000_000,
        data: make_token_account_data(&env.collateral_mint, &lp_owner.pubkey(), 1000),
        owner: spl_token::ID,
        executable: false,
        rent_epoch: 0,
    }).unwrap();

    let lp_ix = Instruction {
        program_id: env.perc_id,
        accounts: vec![
            AccountMeta::new(lp_owner.pubkey(), true),
            AccountMeta::new(env.slab, false),
            AccountMeta::new(lp_ata, false),
            AccountMeta::new(env.perc_vault, false),
            AccountMeta::new_readonly(spl_token::ID, false),
            AccountMeta::new_readonly(sysvar::clock::ID, false),
        ],
        data: encode_init_lp(&matcher_prog, &matcher_ctx, 1000),
    };
    let tx = Transaction::new_signed_with_payer(
        &[lp_ix], Some(&lp_owner.pubkey()), &[&lp_owner], env.svm.latest_blockhash(),
    );
    env.svm.send_transaction(tx).expect("init_lp failed");
    let lp_idx: u16 = 1; // LP is account 1 (vault user was 0)
    println!("  LP created at index {}", lp_idx);

    // --- Step 9: Deposit collateral to LP so it can take the trade ---
    let lp_deposit_ata = Pubkey::new_unique();
    let lp_deposit_amount: u64 = 500_000_000; // 500 USDC
    env.svm.set_account(lp_deposit_ata, Account {
        lamports: 1_000_000,
        data: make_token_account_data(&env.collateral_mint, &lp_owner.pubkey(), lp_deposit_amount),
        owner: spl_token::ID,
        executable: false,
        rent_epoch: 0,
    }).unwrap();

    let lp_dep_ix = Instruction {
        program_id: env.perc_id,
        accounts: vec![
            AccountMeta::new(lp_owner.pubkey(), true),
            AccountMeta::new(env.slab, false),
            AccountMeta::new(lp_deposit_ata, false),
            AccountMeta::new(env.perc_vault, false),
            AccountMeta::new_readonly(spl_token::ID, false),
            AccountMeta::new_readonly(sysvar::clock::ID, false),
        ],
        data: encode_deposit(lp_idx, lp_deposit_amount),
    };
    let tx = Transaction::new_signed_with_payer(
        &[lp_dep_ix], Some(&lp_owner.pubkey()), &[&lp_owner], env.svm.latest_blockhash(),
    );
    env.svm.send_transaction(tx).expect("lp deposit failed");
    println!("  LP deposited {} USDC", lp_deposit_amount);

    // --- Step 10: Manager Trade (vault PDA trades against LP) ---
    let trade_size: i128 = 1_000_000; // 1 unit long
    let ix = Instruction {
        program_id: env.syntx_id,
        accounts: vec![
            AccountMeta::new(manager_pubkey, true),           // manager
            AccountMeta::new(vault_pda, false),               // vault_state
            AccountMeta::new(lp_owner.pubkey(), true),        // lp_owner (signer)
            AccountMeta::new(env.slab, false),                // percolator_slab
            AccountMeta::new_readonly(env.pyth_oracle, false), // oracle
            AccountMeta::new_readonly(env.perc_id, false),    // percolator_program
            AccountMeta::new_readonly(sysvar::clock::ID, false), // clock
        ],
        data: encode_syntx_manager_trade(lp_idx, trade_size),
    };
    let tx = Transaction::new_signed_with_payer(
        &[ix], Some(&manager_pubkey), &[&env.payer, &lp_owner], env.svm.latest_blockhash(),
    );
    let result = env.svm.send_transaction(tx);
    match &result {
        Ok(_) => println!("  Trade OK: size={}", trade_size),
        Err(e) => {
            println!("Trade failed:");
            for log in &e.meta.logs {
                println!("  LOG: {}", log);
            }
        }
    }
    result.expect("manager_trade failed");

    // --- Step 11: Withdraw half the shares ---
    let withdraw_shares: u64 = deposit_amount / 2; // 50 USDC worth
    let ix = Instruction {
        program_id: env.syntx_id,
        accounts: vec![
            AccountMeta::new(user.pubkey(), true),                  // user
            AccountMeta::new(vault_pda, false),                     // vault_state
            AccountMeta::new(user_shares, false),                   // user_shares
            AccountMeta::new(user_collateral, false),               // user_collateral
            AccountMeta::new(vault_collateral, false),              // vault_collateral
            AccountMeta::new(share_mint, false),                    // share_mint
            AccountMeta::new(env.slab, false),                      // percolator_slab
            AccountMeta::new(env.perc_vault, false),                // percolator_vault
            AccountMeta::new_readonly(env.perc_vault_pda, false),   // percolator_vault_authority
            AccountMeta::new_readonly(env.pyth_oracle, false),      // oracle
            AccountMeta::new_readonly(env.perc_id, false),          // percolator_program
            AccountMeta::new_readonly(spl_token::ID, false),        // token_program
            AccountMeta::new_readonly(sysvar::clock::ID, false),    // clock
        ],
        data: encode_syntx_withdraw(withdraw_shares),
    };
    let tx = Transaction::new_signed_with_payer(
        &[ix], Some(&user.pubkey()), &[&user], env.svm.latest_blockhash(),
    );
    let result = env.svm.send_transaction(tx);
    match &result {
        Ok(_) => println!("  Withdraw OK: {} shares burned", withdraw_shares),
        Err(e) => {
            println!("Withdraw failed:");
            for log in &e.meta.logs {
                println!("  LOG: {}", log);
            }
        }
    }
    result.expect("withdraw failed");

    // Verify shares were burned
    let shares_account = env.svm.get_account(&user_shares).unwrap();
    let shares_state = TokenAccount::unpack(&shares_account.data).unwrap();
    assert_eq!(shares_state.amount, deposit_amount - withdraw_shares, "Half shares should remain");

    // Verify USDC was returned
    let user_col_account = env.svm.get_account(&user_collateral).unwrap();
    let user_col_state = TokenAccount::unpack(&user_col_account.data).unwrap();
    let expected_usdc = deposit_amount / 2; // 50 USDC
    assert_eq!(user_col_state.amount, expected_usdc, "User should have half USDC back");

    println!("=== Full lifecycle test passed ===");
    println!("  InitVault + RegisterOnPercolator");
    println!("  Deposit: {} USDC → {} shares", deposit_amount, deposit_amount);
    println!("  Trade: size={} via vault PDA", trade_size);
    println!("  Withdraw: {} shares → {} USDC", withdraw_shares, expected_usdc);
    println!("  Remaining: {} shares", deposit_amount - withdraw_shares);
}
