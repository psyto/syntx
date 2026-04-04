# Syntx Build Plan

## Vision

Syntx is the composable perpetual futures layer Solana is missing. Built on Anatoly Yakovenko's formally-verified Percolator risk engine, designed vault-first for programmatic strategies.

## Current Status (April 4, 2026)

**40 commits, fully operational on devnet.**

| Phase | Status | What was built |
|---|---|---|
| 0. Foundation | Done | Anchor scaffold, Percolator CPI integration |
| 1. Core Vault | Done | 15 instructions, 20 tests passing |
| 2. Keeper | Done | Funding rate strategy, running live on devnet |
| 3. Fees | Done | Performance + management fees via share dilution |
| 4. SDK + Frontend | Done | TypeScript SDK, 6-page Next.js app |
| 5. Composability | Done | Jupiter swap, share price oracle, CPI trade interface |
| 6. Multi-vault | Done | Permissionless vault creation, marketplace UI |
| 7. Security Hardening | Done | Circuit breakers, CPI whitelist, drawdown limits |
| 8. Security Audit | **Pending** | ~$50-100K, non-negotiable before mainnet |
| 9. SNTX Token | **Pending** | Needs legal counsel |
| 10. Mainnet | **Pending** | After audit |

## What's Built

### Vault Program (15 instructions)

Core vault:
- init_vault, register_on_percolator, set_percolator_idx
- deposit, withdraw

Manager operations:
- manager_trade, manager_crank
- collect_fees, update_manager, set_paused

Composability:
- get_share_price (on-chain oracle for lending protocols)
- cpi_trade (public trading interface for other programs)

Security:
- set_circuit_breaker (drawdown limit, CPI whitelist, trade size caps)

### Tests (20 passing)

Positive:
- Full lifecycle (init → register → deposit → trade → withdraw)
- Fee collection with performance + management fees
- Pause/unpause, update manager, share price oracle
- Multi-user deposit with share price verification

Negative (access control + input validation):
- Unauthorized trade, pause, fees, manager update (4 tests)
- Deposit when paused, deposit over cap, zero deposit (3 tests)
- Insufficient shares on withdraw (1 test)
- Double init rejected (1 test)

### Keeper Bot
- Funding Rate Harvest strategy (ported from Yogi)
- Vol regime × signal severity → deployment matrix
- Oracle push with 3-attempt retry + exponential backoff
- Running live on devnet, cranking every 30 seconds

### Frontend (6 pages)
- `/` — Landing: hero, stats, features, composability showcase
- `/vaults` — Vault marketplace with accordion detail view
- `/compose` — 6 composability recipes with interactive flows
- `/earn` — Portfolio view across all vaults
- `/create` — 4-step vault creation wizard (fully on-chain)

### SDK
- SyntxClient class, instruction builders, account parsers
- PDA derivation, vault discovery (fetchAllVaults)

### Security Hardening
- Automatic circuit breaker (drawdown limit — no governance needed)
- CPI whitelist (restrict which programs can call cpi_trade)
- Configurable CPI trade size limits per vault
- Oracle push retry with backoff

## Known Risks (Honest Assessment)

| Risk | Status | Mitigation |
|---|---|---|
| Vault program unaudited | **Critical** | Tests pass but tests != audit. Must audit before mainnet. |
| Composability = vulnerability propagation | Partially addressed | CPI whitelist + size limits reduce surface, don't eliminate it |
| Keeper single point of failure | Known | Retry logic added, but no redundancy or Clockwork automation |
| Oracle centralization (devnet) | Known | Push oracle is devnet-only. Mainnet uses Pyth. |
| Audit funding gap | **Critical** | Need $50-100K. Solana Foundation grant or community funding. |

## Remaining Work

### Phase 8: Security Audit (~$50-100K)
- Scope: syntx-vault program (15 instructions)
- Firms: OtterSec, Neodyme, Offside Labs
- Focus areas:
  - CPI boundary between Syntx and Percolator
  - Circuit breaker bypass vectors
  - Share price manipulation via deposit/withdraw timing
  - Fee calculation edge cases
- Pre-audit: chaos testing (liquidation cascades, oracle failures)

### Phase 9: SNTX Token
- Utility: fee discounts, staking, governance, vault boost
- Distribution: Hyperliquid model (no VC, community airdrop)
- Legal: entity outside Japan, token opinion letter
- Budget: legal counsel ~$30-50K

### Phase 10: Mainnet Launch
- Guarded launch: $100K deposit cap, 3 markets
- Progressive decap over 8 weeks
- Multi-market: SOL, BTC, ETH slabs
- External market maker recruitment

## Devnet Addresses

| Component | Address |
|---|---|
| Syntx Vault Program | `53r6bg7JBFqf5Jfs7fe4kHDtwXwUgDWoLarYrsWcoF1V` |
| Percolator Program | `Edq18N2pdT3Sz9EukbZe4YsQkvmxvmmkUL1KHpv96xJF` |
| Vault PDA | `4pL2aQawAbc2XwjRE9ptrH4yxihn4BL2uVMavgZrtYUK` |
| Percolator Slab | `J55KavPouZg8ZeWnTY77ZBL2DdQskzKpkFvuTtbUNzYC` |
