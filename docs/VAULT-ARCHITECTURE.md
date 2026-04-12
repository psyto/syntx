# Syntx Vault Program — Technical Architecture

## Program Overview

The Syntx vault program (`programs/syntx-vault/src/lib.rs`) is an Anchor-based Solana program that provides a composable exchange-agnostic vault layer on Solana. It has 15 instructions and one state account. Vaults route trades across execution venues (Percolator, Phoenix, Jupiter Perps) through a VenueAdapter interface in the off-chain keeper.

## State: VaultState

```rust
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

    // Circuit breakers
    pub max_drawdown_bps: u16,      // Auto-reject trades beyond this drawdown
    pub peak_equity: u64,            // Highest recorded equity
    pub cpi_whitelist: Pubkey,       // Only this program can call cpi_trade
    pub max_cpi_trade_size: u64,     // Max single CPI trade size
}
```

**PDA derivation:** `seeds = ["vault", collateral_mint, manager]`

## Instructions

### Core Vault

**init_vault** — Creates the VaultState PDA.

**register_on_percolator** — CPI to Percolator InitUser. The vault PDA becomes the owner of a trading account.

**set_percolator_idx** — Stores the assigned account index from Percolator.

**deposit** — User sends collateral, CPI deposits to Percolator, mints shares.

**withdraw** — Burns shares, CPI withdraws from Percolator, returns collateral.

### Manager Operations

**manager_trade** — Keeper executes trades via vault PDA. Includes circuit breaker check (drawdown from peak equity).

**manager_crank** — CPI to Percolator KeeperCrank (funding settlement).

**collect_fees** — Performance fee (% of profits above HWM) + management fee (% of AUM, pro-rated). Fees paid via share dilution.

**update_manager** — Transfer management to a new keeper.

**set_paused** — Emergency stop for deposits/withdrawals/trades.

### Security

**set_circuit_breaker** — Configure automatic protection:
- `max_drawdown_bps`: reject trades when equity drops this much from peak (0 = disabled)
- `cpi_whitelist`: restrict cpi_trade to a specific program (Pubkey::default() = any)
- `max_cpi_trade_size`: cap per-trade size for CPI callers (0 = default 1M)

### Composability

**get_share_price** — Returns total_shares, total_deposits, share_price_e6 via `set_return_data`. Other programs read this to value Syntx shares as collateral.

**cpi_trade** — Public trading interface for other Solana programs. Subject to:
- CPI whitelist check (if configured)
- Size limit check (configurable per vault)
- Circuit breaker check (drawdown limit)
- Vault pause check

## Security Model

### Circuit Breaker Flow

```
Trade request arrives (manager_trade or cpi_trade)
  → Check: vault paused? → reject
  → Check: vault initialized? → reject
  → Check: cpi_trade caller whitelisted? → reject
  → Check: cpi_trade size within limit? → reject
  → Check: drawdown from peak > max_drawdown_bps? → reject
  → All checks pass → execute trade via Percolator CPI
```

The circuit breaker is **automatic** — no governance vote or manual intervention needed. When equity drops beyond the configured threshold, all trades are rejected until equity recovers.

### CPI Security

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

The vault PDA has no private key — only the vault program can sign for it.

### Known Attack Vectors (for auditor)

1. **Share price manipulation**: Deposit large amount → trade → withdraw before price settles. Mitigated by Percolator's warmup period but untested at edge cases.
2. **CPI reentrancy**: A malicious matcher could re-enter Syntx during a TradeCpi flow. Percolator's ABI validation should prevent this but needs verification.
3. **Circuit breaker bypass**: If peak_equity is never set (manager doesn't call set_circuit_breaker), the drawdown check is skipped. This is by design but should be documented.
4. **Fee calculation overflow**: Large equity values × large fee percentages × long time periods could overflow. Uses checked math but edge cases need review.

## Percolator Account Layout Reference

```
Header:     0..72    (72 bytes)
Config:     72..584  (512 bytes)
Engine:     584..    (variable)
  vault:        +0   (U128, 16 bytes)
  insurance:    +16  (U128, 16 bytes)
  funding_rate: +200 (i64, 8 bytes)
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

## Exchange-Agnostic Venue Layer (Off-Chain)

The on-chain vault program is venue-agnostic in design — it CPI calls into whatever Percolator program is configured. The off-chain keeper extends this with a multi-venue routing layer:

```
Keeper (TypeScript)
  └── VenueRouter (implements VenueAdapter)
       ├── PercolatorAdapter → Percolator (on-chain perp)
       ├── PhoenixAdapter    → Phoenix V1 (on-chain spot)
       └── [future]          → Jupiter Perps, Drift, etc.
```

### VenueAdapter Interface

```typescript
interface VenueAdapter {
  readonly name: string;
  readonly type: "perp" | "spot" | "hybrid";
  initialize(): Promise<void>;
  getPrice(market: string): Promise<number>;
  getPosition(): Promise<Position | null>;
  getVenueState(): Promise<VenueState>;
  trade(size: bigint): Promise<OrderResult>;
  crank(): Promise<void>;
}
```

### VenueRouter Scoring

Each tick, the router scores all venues:
- **Perp venues**: funding rate magnitude (higher = more yield)
- **All venues**: orderbook depth / account count (liquidity proxy)
- **Perp venues**: insurance balance bonus (safety)
- **Spot venues**: baseline score

Highest-scoring venue receives the trade. All venues are cranked regardless.

## Build & Test

```bash
# Build (requires platform-tools v1.53+)
cargo-build-sbf --tools-version v1.53 -- --manifest-path programs/syntx-vault/Cargo.toml

# Test (requires percolator_prog.so)
cargo test -p syntx-vault --test integration

# 25 tests: lifecycle, fees, access control, circuit breakers, multi-user
```
