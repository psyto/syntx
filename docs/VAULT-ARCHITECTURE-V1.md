# Syntx Vault Program — Architecture

## How It Works With Percolator

Percolator's account model is simple:
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
│  - total_shares: u64                              │
│  - total_deposits: u64                            │
│  - manager: Pubkey (keeper)                       │
│  - vault_pda: Pubkey (owns Percolator account)    │
│  - percolator_slab: Pubkey                        │
│  - percolator_user_idx: u16                       │
│  - performance_fee_bps: u16                       │
│  - management_fee_bps: u16                        │
│  - high_water_mark: u64                           │
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

## Account Structure

### VaultState (PDA: seeds = ["vault", mint, manager])

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
    pub percolator_lp_idx: u16,    // LP index (if acting as LP)

    // Share accounting
    pub total_shares: u64,
    pub total_deposits: u64,       // Base deposits (before PnL)

    // Fee structure
    pub performance_fee_bps: u16,  // e.g., 2000 = 20%
    pub management_fee_bps: u16,   // e.g., 200 = 2% annual
    pub high_water_mark: u64,      // For performance fee calculation
    pub last_fee_collection: i64,  // Unix timestamp

    // Safety
    pub deposit_cap: u64,          // Max total deposits (0 = unlimited)
    pub withdrawal_queue: bool,    // If true, large withdrawals are queued
    pub paused: bool,              // Emergency pause
}
```

### Share Token
- Standard SPL token
- Mint authority = vault PDA
- 1 share = proportional claim on vault's Percolator position value
- Share price = (vault_equity) / total_shares
- vault_equity = capital + realized_pnl + unrealized_mark_pnl (from Percolator account)

## Instructions

### 1. InitVault
```
Signer: manager
Creates: VaultState PDA, share mint, USDC token account
Then CPI: Percolator InitUser (vault PDA as owner)
```
- Manager deploys vault specifying which Percolator slab (market)
- Vault PDA becomes the owner of a Percolator user account
- Share mint is created with vault PDA as mint authority

### 2. Deposit
```
Signer: user
Input: amount (USDC)
Output: share tokens minted to user
```
1. Calculate share price: `price = vault_equity / total_shares` (or 1:1 if first deposit)
2. Transfer USDC from user to vault's token account
3. CPI: Percolator `DepositCollateral` (vault PDA signs, deposits to Percolator account)
4. Mint shares: `new_shares = amount / share_price`
5. Update total_shares, total_deposits

### 3. Withdraw
```
Signer: user
Input: shares to burn
Output: USDC returned to user
```
1. Calculate withdrawal amount: `amount = shares * share_price`
2. CPI: Percolator `WithdrawCollateral` (vault PDA signs)
3. Transfer USDC from vault to user
4. Burn share tokens
5. Update total_shares, total_deposits

**Note:** Withdrawal requires Percolator account to have enough free collateral (no open position or position closed first). For a vault with active strategy, the keeper may need to close positions before users can withdraw. This is handled via withdrawal queue.

### 4. ManagerTrade
```
Signer: manager (keeper)
Input: lp_idx, size (trade parameters)
```
1. Verify signer is vault's manager
2. CPI: Percolator `TradeNoCpi` or `TradeCpi` (vault PDA signs as user)
3. The vault PDA is the owner of the Percolator account, so vault program `invoke_signed` with PDA seeds

**This is the key instruction** — it lets your keeper execute strategy trades (funding rate harvesting, DN, tilt) through the vault, using depositor capital on Percolator.

### 5. ManagerCrank
```
Signer: manager (or permissionless)
```
CPI: Percolator `KeeperCrank` — settle funding, update state.

### 6. CollectFees
```
Signer: manager
```
1. Calculate vault equity vs high water mark
2. If equity > HWM: performance fee on the gain
3. Management fee based on time elapsed
4. Mint fee shares to manager (dilutive fee collection)
5. Update high_water_mark

### 7. UpdateManager
```
Signer: current manager
Input: new_manager pubkey
```
Transfer management to a new keeper address.

## Composability — CPI Interface for External Protocols

Other Solana programs can CPI into Syntx vault:

```rust
// External protocol (e.g., Kamino) can:
pub fn hedge_via_syntx(
    syntx_vault: &AccountInfo,
    percolator_slab: &AccountInfo,
    // ...
) -> ProgramResult {
    // CPI: Syntx ManagerTrade to open a hedge position
    // This enables lending protocols to atomically hedge
}
```

**Key CPI endpoints for composability:**
- `cpi_deposit` — protocols deposit on behalf of users
- `cpi_get_share_price` — read current NAV
- `cpi_get_position` — read vault's Percolator position (size, entry, PnL)

## Vault Types

### Type 1: Strategy Vault (your keeper)
- Manager = your keeper bot (EC2)
- Executes funding rate / DN / tilt strategies
- Users deposit, keeper trades, profits shared
- Like Yogi/Kodiak but on Percolator

### Type 2: LP Vault
- Vault PDA is registered as an LP on Percolator (via `InitLP`)
- Depositors provide liquidity to the perp market
- Earns trading fees via matcher
- Your vol-matcher / event-matcher plugs in here

### Type 3: Protocol-Owned Market Making
- HLP equivalent — Syntx treasury vault
- Bootstraps initial liquidity
- Funded by protocol fees + SNTX token

## Security Considerations

1. **Manager cannot withdraw to themselves** — Withdraw always goes to share holder. Manager only earns via fee shares.
2. **Vault PDA owns Percolator account** — no single EOA can drain. PDA can only sign through the vault program's logic.
3. **Percolator's H ratio protects against insolvency** — even if manager makes bad trades, the risk engine prevents withdrawals > vault balance.
4. **Emergency pause** — manager or governance can pause deposits/withdrawals.
5. **Deposit cap** — prevents vault from growing beyond manageable size.

## Implementation Plan

### Phase 1: Minimal Vault (Week 1-2)
- VaultState account
- InitVault + Deposit + Withdraw
- ManagerTrade (TradeNoCpi path only)
- Share token mint/burn
- No fees yet, no queue

### Phase 2: Strategy Integration (Week 2-3)
- Port Yogi keeper logic to trade via ManagerTrade
- ManagerCrank for funding settlement
- CollectFees (performance + management)
- High water mark tracking

### Phase 3: LP Vault (Week 3-4)
- InitLP path (vault as LP provider)
- Integrate with your vol-matcher
- LP fee tracking and distribution to share holders

### Phase 4: Composability (Week 4-5)
- CPI interface for external protocols
- Position read helpers
- Share price oracle for lending protocols

## Tech Stack

- **Program:** Anchor (or native Solana program to match Percolator's style)
- **Language:** Rust
- **Dependencies:** percolator-prog (CPI), spl-token
- **Tests:** LiteSVM (same as percolator-prog uses)
- **Keeper:** TypeScript (reuse your Yogi/Kodiak patterns)
