# Syntx Vault Program — Architecture

## How It Works With Percolator

Percolator's account model:
- Each account has an `owner: [u8; 32]` — the pubkey authorized to trade/withdraw
- `set_owner()` can change ownership
- Owner must be a signer on Trade, Deposit, Withdraw, CloseAccount instructions

**The vault pattern:** The vault PDA becomes the `owner` of a Percolator account. The vault program signs transactions on behalf of depositors, and the keeper (manager) is authorized to execute strategy trades via the vault program.

```
┌──────────────────────────────────────────────────┐
│                  User (depositor)                 │
│  deposit USDC → vault → receives share tokens     │
└──────────────┬───────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────┐
│              Syntx Vault Program                  │
│                                                   │
│  State:                                           │
│  - total_shares                                   │
│  - manager (keeper pubkey)                        │
│  - vault_pda (owns Percolator account)            │
│  - percolator_slab + user_idx                     │
│  - fee config (performance + management)          │
│                                                   │
│  Instructions:                                    │
│  - InitVault                                      │
│  - Deposit        (user → vault, mint shares)     │
│  - Withdraw       (burn shares → user)            │
│  - ManagerTrade   (manager signs, vault PDA acts)  │
│  - ManagerCrank   (manager triggers keeper crank)  │
│  - CollectFees    (performance + management)       │
│  - UpdateManager                                  │
└──────────────┬───────────────────────────────────┘
               │ CPI (vault PDA signs as owner)
               ▼
┌──────────────────────────────────────────────────┐
│          Percolator Program (Anatoly's)           │
│                                                   │
│  Account[user_idx].owner = vault_pda              │
│  TradeNoCpi / TradeCpi — vault PDA is signer      │
│  DepositCollateral — vault PDA is signer          │
│  WithdrawCollateral — vault PDA is signer         │
└──────────────────────────────────────────────────┘
```

## VaultState Account

PDA seeds: `["vault", collateral_mint, manager]`

```rust
pub struct VaultState {
    pub bump: u8,
    pub manager: Pubkey,           // Keeper address (can trade)
    pub collateral_mint: Pubkey,   // USDC mint
    pub share_mint: Pubkey,        // Vault share SPL token

    // Percolator integration
    pub percolator_program: Pubkey,
    pub percolator_slab: Pubkey,   // Which market slab
    pub percolator_user_idx: u16,  // Account index in the slab

    // Share accounting
    pub total_shares: u64,
    pub total_deposits: u64,

    // Fee structure
    pub performance_fee_bps: u16,  // e.g., 2000 = 20%
    pub management_fee_bps: u16,   // e.g., 200 = 2% annual
    pub high_water_mark: u64,
    pub last_fee_collection: i64,

    // Safety
    pub deposit_cap: u64,          // 0 = unlimited
    pub paused: bool,
}
```

## Instructions

### InitVault
Creates vault PDA, share mint, USDC token account. CPI: Percolator InitUser with vault PDA as owner.

### Deposit
User sends USDC → vault CPI deposits to Percolator → mint shares to user.
`new_shares = amount / share_price` where `share_price = vault_equity / total_shares`

### Withdraw
User burns shares → vault CPI withdraws from Percolator → transfer USDC to user.
`amount = shares * share_price`

### ManagerTrade
Manager (keeper) signs → vault CPI calls Percolator TradeNoCpi/TradeCpi with vault PDA as signer.

### ManagerCrank
CPI: Percolator KeeperCrank — settle funding, update state.

### CollectFees
Performance fee on gains above HWM + management fee on AUM. Paid via share dilution.

## Vault Types

1. **Strategy Vault** — keeper executes funding rate / DN strategies
2. **LP Vault** — vault PDA as LP on Percolator, earns trading fees via matchers
3. **Protocol-Owned MM** — HLP equivalent, SNTX treasury-funded

## Security

- Manager cannot withdraw to themselves — only share holders
- Vault PDA owns Percolator account — no EOA can drain
- Percolator H ratio prevents insolvency
- Emergency pause on deposits/withdrawals
- Deposit cap for guarded launch
