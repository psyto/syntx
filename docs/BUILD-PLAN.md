# Syntx Build Plan

## Vision

Syntx is the composable perpetual futures layer Solana is missing. Built on Anatoly Yakovenko's formally-verified Percolator risk engine, designed vault-first for programmatic strategies.

## Current Status (April 4, 2026)

**35+ commits, fully operational on devnet.**

| Phase | Status | What was built |
|---|---|---|
| 0. Foundation | Done | Anchor scaffold, Percolator CPI integration |
| 1. Core Vault | Done | 13 instructions, 20 tests passing |
| 2. Keeper | Done | Funding rate strategy, live on devnet |
| 3. Fees | Done | Performance + management fees via share dilution |
| 4. SDK + Frontend | Done | TypeScript SDK, 6-page Next.js app |
| 5. Composability | Done | Jupiter swap, share price oracle, CPI trade interface |
| 6. Multi-vault | Done | Permissionless vault creation, marketplace |
| 7. Security audit | Pending | ~$50-100K |
| 8. SNTX token | Pending | Needs legal counsel |
| 9. Mainnet | Pending | After audit |

## What's Built

### Vault Program (13 instructions)
- init_vault, register_on_percolator, set_percolator_idx
- deposit, withdraw
- manager_trade, manager_crank
- collect_fees, update_manager, set_paused
- get_share_price (on-chain oracle)
- cpi_trade (public composability interface)

### Tests (20 passing)
- Full lifecycle: init → register → deposit → trade → withdraw
- Fee collection with performance + management fees
- Access control: 5 negative tests (unauthorized trade/pause/fees/manager)
- Input validation: deposit cap, zero amount, insufficient shares
- Multi-user deposit + share price verification

### Keeper Bot
- Funding Rate Harvest strategy (ported from Yogi)
- Vol regime detection × signal severity → deployment matrix
- Oracle push with retry, permissionless crank
- Running live on devnet

### Frontend (6 pages)
- / — Hero, stats, features, composability showcase
- /vaults — Vault marketplace with accordion detail view
- /compose — 6 composability recipes (Jupiter, Kamino, Phoenix)
- /earn — Portfolio view across all vaults
- /create — 4-step vault creation wizard (fully on-chain)

### SDK
- SyntxClient, instruction builders, account parsers
- PDA derivation, vault discovery

## Remaining Work

### Phase 7: Security Audit (~$50-100K)
- Scope: syntx-vault program only (Percolator has Kani proofs)
- Firms: OtterSec, Neodyme, Offside Labs
- Focus: CPI security, margin edge cases, fee math

### Phase 8: SNTX Token
- Utility: fee discounts, staking, governance, vault boost
- Distribution: Hyperliquid model (no VC, community airdrop)
- Legal: entity outside Japan, token opinion letter

### Phase 9: Mainnet Launch
- Guarded launch: $100K deposit cap, 3 markets
- Progressive decap over 8 weeks
- External market maker recruitment

## Devnet Addresses

| Component | Address |
|---|---|
| Syntx Vault Program | `53r6bg7JBFqf5Jfs7fe4kHDtwXwUgDWoLarYrsWcoF1V` |
| Percolator Program | `Edq18N2pdT3Sz9EukbZe4YsQkvmxvmmkUL1KHpv96xJF` |
| Vault PDA | `4pL2aQawAbc2XwjRE9ptrH4yxihn4BL2uVMavgZrtYUK` |
| Percolator Slab | `J55KavPouZg8ZeWnTY77ZBL2DdQskzKpkFvuTtbUNzYC` |
