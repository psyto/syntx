# Syntx Build Plan

## Vision

Syntx is a composable exchange-agnostic vault layer for Solana perps. Vaults route trades across any execution venue — Percolator, Phoenix, Jupiter Perps — through a VenueAdapter interface. Built vault-first for programmatic strategies.

## Current Status (April 12, 2026)

**Built for the Solana Frontier Hackathon (Apr 6 – May 11, 2026).**

| Phase | Status | What was built |
|---|---|---|
| 0. Foundation | Done | Anchor scaffold, Percolator CPI integration |
| 1. Core Vault | Done | 15 instructions, 29 tests passing |
| 2. Keeper | Done | Funding rate strategy, running live on devnet |
| 3. Fees | Done | Performance + management fees via share dilution |
| 4. SDK + Frontend | Done | TypeScript SDK (complete), 5-page Next.js app |
| 5. Composability | Done | Jupiter swap, share price oracle, CPI trade interface |
| 6. Multi-vault | Done | Permissionless vault creation, marketplace UI |
| 7. Security Hardening | Done | Circuit breakers, CPI whitelist, drawdown limits |
| 8. Venue Adapters | Done | VenueAdapter interface, PercolatorAdapter, PhoenixAdapter, JupiterPerpsAdapter |
| 9. VenueRouter | Done | Multi-venue scoring and routing |
| 10. Frontend Reframe | Done | Exchange-agnostic positioning, vault UX polish, error boundaries |
| 11. Documentation | Done | README, business plan, CPI examples, CONTRIBUTING.md |
| 12. Timelock + Immutable Floor | Done | 48h manager transfer delay, immutable min_drawdown_bps |
| 13. Security Audit | **Pending** | ~$50-100K, non-negotiable before mainnet |
| 14. Multisig (Squads) | **Pending** | Post-audit, replace single manager key |
| 15. SNTX Token | **Pending** | Needs legal counsel |
| 16. Mainnet | **Pending** | After audit + multisig |

## What's Built

### Vault Program (15 instructions, 29 tests)

Core vault:
- init_vault, register_on_percolator, set_percolator_idx
- deposit, withdraw

Manager operations:
- manager_trade, manager_crank
- collect_fees, set_paused
- propose_manager, execute_manager_transfer, cancel_manager_transfer (48h timelock)

Composability:
- get_share_price (on-chain oracle for lending protocols)
- cpi_trade (public trading interface for other programs)

Security:
- set_circuit_breaker (drawdown limit with immutable floor, CPI whitelist, trade size caps)

### Venue Adapter Pattern (exchange-agnostic)

- VenueAdapter interface — 6 methods any DEX implements
- PercolatorAdapter — slab-based perp, oracle push, funding crank, trade execution
- PhoenixAdapter — CLOB spot orderbook via @ellipsis-labs/phoenix-sdk
- JupiterPerpsAdapter — oracle-based AMM perp, SOL/BTC/ETH markets (JUPITER_MARKET env var)
- VenueRouter — scores venues by funding rate, liquidity, insurance; routes to best
- 3 architectures covered: slab-based (Percolator), CLOB (Phoenix), oracle-based AMM (Jupiter Perps)

### Tests (29 passing)

Positive (16):
- Full lifecycle (init → register → deposit → trade → withdraw)
- Fee collection with performance + management fees
- Pause/unpause, share price oracle
- Manager transfer with 48h timelock (propose → warp → execute)
- Cancel manager transfer
- Manager crank (funding settlement)
- Multi-user deposit with share price verification
- Circuit breaker configuration (above minimum floor)
- Share price on fresh vault
- Deposit after unpause cycle

Negative (13):
- Unauthorized trade, pause, fees, manager proposal, circuit breaker (5 tests)
- Deposit when paused, deposit over cap, zero deposit (3 tests)
- Insufficient shares, withdraw over balance (2 tests)
- Double init rejected (1 test)
- Circuit breaker below immutable minimum rejected (1 test)
- CPI trade rejected when caller not whitelisted (1 test)

### Keeper Bot
- Venue-agnostic: calls VenueAdapter methods, not venue-specific code
- Funding Rate Harvest strategy (ported from Yogi)
- Vol regime x signal severity → deployment matrix
- VENUE=percolator|phoenix|jupiter|router via env var
- Running live on devnet, cranking every 30 seconds

### Frontend (5 pages, mobile-responsive verified)
- `/` — Landing: composable exchange-agnostic vaults, 3-architecture venue diagram
- `/vaults` — Vault marketplace with named vaults, venue badges, deposit/withdraw
- `/compose` — Architecture diagram, CPI code snippets, 6 composability recipes
- `/earn` — Portfolio view across all vaults
- `/create` — 4-step vault creation wizard
- Verified at iPhone (375px), iPad (768px), desktop (1440px) — no layout issues

### SDK (complete)
- SyntxClient class with buildDepositTx, buildWithdrawTx, buildWithdrawByAmountTx
- Instruction builders with JSDoc:
  - createInitVaultIx (includes minDrawdownBps for immutable floor)
  - createDepositIx, createWithdrawIx, createCollectFeesIx
  - createProposeManagerIx, createExecuteManagerTransferIx, createCancelManagerTransferIx
- Account parsers, PDA derivation, vault discovery (fetchAllVaults)
- Keeper abi.ts synced with all 15 on-chain instructions

### Examples
- `examples/cpi-caller/` — Anchor program + TypeScript client for CPI into Syntx
- `examples/venue-adapter/` — DriftAdapter skeleton showing how to add a new venue

## Known Risks (Honest Assessment)

| Risk | Status | Mitigation |
|---|---|---|
| Vault program unaudited | **Critical** | 29 tests pass but tests != audit. Must audit before mainnet. |
| Single manager key (SPOF) | **Mitigated** | 48h timelock on manager transfer, immutable circuit breaker floor. Squads multisig planned post-audit. |
| Manager disables protections | **Mitigated** | min_drawdown_bps set at vault creation, cannot be reduced — ever. |
| Composability = vulnerability propagation | Partially addressed | CPI whitelist + size limits reduce surface, don't eliminate it |
| Keeper single point of failure | Known | Retry logic added, but no redundancy |
| Oracle centralization (devnet) | Known | Push oracle is devnet-only. Mainnet uses Pyth. |
| Audit funding gap | **Critical** | Need $50-100K. Hackathon prize or Solana Foundation grant. |

## Remaining Work

### Phase 12: Security Audit (~$50-100K)
- Scope: syntx-vault program (15 instructions)
- Firms: OtterSec, Neodyme, Offside Labs
- Focus: CPI boundary, circuit breaker bypass, share price manipulation, fee edge cases

### Phase 13: SNTX Token
- Utility: fee discounts, staking, governance
- Distribution: community-first (no VC)
- Legal: entity outside Japan, token opinion letter

### Phase 14: Mainnet Launch
- Guarded launch: $100K deposit cap
- Progressive decap over 8 weeks
- Multi-venue: Percolator + Phoenix + Jupiter Perps

## Devnet Addresses

| Component | Address |
|---|---|
| Syntx Vault Program | `53r6bg7JBFqf5Jfs7fe4kHDtwXwUgDWoLarYrsWcoF1V` |
| Percolator Program | `Edq18N2pdT3Sz9EukbZe4YsQkvmxvmmkUL1KHpv96xJF` |
| SOL Funding Rate Vault | `4pL2aQawAbc2XwjRE9ptrH4yxihn4BL2uVMavgZrtYUK` |
| SOL Delta Neutral Vault | `9g39fL79XnwHBLCPT1GqixEmJp7z5LLzjWWiaMpcKDhK` |
| Phoenix SOL/USDC Market | `4DoNfFBfF7UokCC2FQzriy7yHK6DY6NVdYpuekQ5pRgg` |
| Jupiter Perps Program | `PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu` |
| Jupiter SOL Custody | `7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz` |
