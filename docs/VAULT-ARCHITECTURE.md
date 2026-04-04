# Syntx Vault Program — Technical Architecture

## Program Overview

The Syntx vault program (`programs/syntx-vault/src/lib.rs`) is an Anchor-based Solana program that provides a vault layer on top of Percolator. It has 8 instructions and one state account.

## State: VaultState

```rust
pub struct VaultState {
    pub bump: u8,                    // PDA bump seed
    pub manager: Pubkey,             // Keeper wallet — authorized to trade
    pub collateral_mint: Pubkey,     // e.g., USDC mint
    pub share_mint: Pubkey,          // Vault share SPL token mint

    // Percolator integration
    pub percolator_program: Pubkey,  // Percolator program ID
    pub percolator_slab: Pubkey,     // Which market slab this vault targets
    pub percolator_user_idx: u16,    // Account index in the slab (0-4095)

    // Share accounting
    pub total_shares: u64,           // Total share tokens outstanding
    pub total_deposits: u64,         // Total collateral deposited (before PnL)

    // Fee structure
    pub performance_fee_bps: u16,    // 2000 = 20% of profits
    pub management_fee_bps: u16,     // 200 = 2% annual
    pub high_water_mark: u64,        // For performance fee calculation
    pub last_fee_collection: i64,    // Unix timestamp

    // Safety
    pub deposit_cap: u64,            // Max deposits (0 = unlimited)
    pub paused: bool,                // Emergency stop
    pub initialized: bool,           // Has RegisterOnPercolator been called?
}
```

**PDA derivation:** `seeds = ["vault", collateral_mint, manager]`

## Instructions

### 1. init_vault

Creates the VaultState PDA account.

**Accounts:**
- `manager` (signer, payer) — will be the keeper
- `vault_state` (init, PDA) — created by Anchor
- `collateral_mint` — USDC or other SPL token
- `share_mint` — must be pre-created with vault PDA as mint authority
- `percolator_slab` — which market to trade on
- `percolator_program` — Percolator program ID
- `system_program`

**Params:** `performance_fee_bps`, `management_fee_bps`, `deposit_cap`

### 2. register_on_percolator

Calls Percolator `InitUser` via CPI. The vault PDA becomes the owner of a new trading account on the slab.

**CPI call:**
```
Percolator InitUser {
  accounts: [vault_pda(signer), slab(writable), vault_ata, perc_vault, token_program, clock],
  data: [tag=1, fee_payment]
}
```

The vault PDA signs via `invoke_signed` with seeds `["vault", mint, manager, bump]`.

### 3. set_percolator_idx

After registration, the manager reads the slab to find the assigned account index and stores it in vault state. This is needed for subsequent deposit/withdraw/trade calls that reference the account by index.

### 4. deposit

**Flow:**
1. Transfer collateral from user → vault's token account (standard SPL transfer)
2. CPI: Percolator `DepositCollateral` with vault PDA as signer
3. Mint shares to user: `new_shares = amount * total_shares / total_deposits`

### 5. withdraw

**Flow:**
1. Calculate: `withdraw_amount = shares * total_deposits / total_shares`
2. Burn user's share tokens
3. CPI: Percolator `WithdrawCollateral` with vault PDA as signer
4. Transfer collateral from vault → user

### 6. manager_trade

Only callable by the authorized manager. Executes a trade on Percolator.

**CPI call:**
```
Percolator TradeNoCpi {
  accounts: [vault_pda(signer), lp_owner(signer), slab(writable), clock, oracle],
  data: [tag=6, lp_idx, user_idx, size(i128)]
}
```

**Note:** Both vault PDA and LP owner must be signers. The LP owner signs the outer transaction; the vault PDA signs via `invoke_signed`.

### 7. manager_crank

Triggers Percolator funding settlement.

**CPI call:**
```
Percolator KeeperCrank {
  accounts: [vault_pda(signer), slab(writable), clock, oracle],
  data: [tag=5, caller_idx=0xFFFF(permissionless), format_version=0]
}
```

### 8. set_paused

Emergency toggle. When paused, deposit/withdraw/trade are blocked.

## CPI Security

Every CPI from Syntx to Percolator uses `invoke_signed` with the vault PDA seeds:

```rust
let vault_seeds: &[&[u8]] = &[
    b"vault",
    vault.collateral_mint.as_ref(),
    vault.manager.as_ref(),
    &[vault.bump],
];

solana_program::program::invoke_signed(&ix, &accounts, &[vault_seeds])?;
```

This ensures:
- Only the vault program can initiate trades/deposits/withdrawals
- The PDA cannot be forged — it's deterministically derived from the program ID + seeds
- The manager can call vault instructions, but the vault program controls what the PDA does

## Percolator Account Layout Reference

The slab parser needs these offsets (from `percolator-cli` latest):

```
Header:     0..72    (72 bytes)
Config:     72..584  (512 bytes)
Engine:     584..    (variable)
  vault:        +0   (U128, 16 bytes)
  insurance:    +16  (U128, 16 bytes)
  num_used:     +1120 (u16)
  accounts:     +9336 (array of Account, each 280 bytes)

Account (280 bytes):
  capital:      +8   (U128)
  kind:         +24  (u8: 0=User, 1=LP)
  pnl:          +32  (i128)
  position:     +88  (i128)
  entry_price:  +104 (u64)
  owner:        +208 ([u8; 32])
```

## Build

```bash
# Requires platform-tools v1.53+ for edition2024 support
cargo-build-sbf --tools-version v1.53 -- --manifest-path programs/syntx-vault/Cargo.toml
```

Output: `target/deploy/syntx_vault.so` (342 KB)

## Test

```bash
# Requires percolator_prog.so in ~/src/percolator-prog/target/deploy/
cargo test -p syntx-vault --test integration
```

6 tests:
1. `test_syntx_vault_loads` — binary loads in LiteSVM
2. `test_percolator_loads` — Percolator binary loads
3. `test_percolator_init_market` — market creation works
4. `test_percolator_init_market_and_lp` — LP creation works
5. `test_syntx_init_vault` — vault PDA created
6. `test_syntx_full_lifecycle` — init → register → deposit → trade → withdraw
