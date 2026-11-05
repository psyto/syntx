# Syntx Security Assessment — Drift Exploit Comparison

## Context

On April 1, 2026, Drift Protocol was exploited for $285M through multisig governance compromise via durable nonce exploitation. Drift was the only place on Solana where perps composed with lending, spot, and yield strategies. When it went down, every vault built on Drift lost access to its entire composable stack.

This event is why Syntx exists — and why we proactively studied the exploit to harden our own design before launch. This document assesses whether Syntx has similar vulnerabilities and what mitigations are implemented.

## Attack Vector Comparison

| Drift attack vector | How it worked | Syntx exposure |
|---|---|---|
| 2-of-5 multisig, zero timelock | Attacker pre-signed with 2 signers, executed instantly | **Different** — single manager key, no multisig |
| Durable nonce exploitation | Pre-signed TX held indefinitely until optimal moment | **Not exposed** — no multisig approval pipeline |
| Fake collateral (CVT) creation | Admin created worthless token as collateral | **Not exposed** — vault trades on existing Percolator slabs |
| Oracle manipulation | Admin switched to attacker-controlled oracle | **Mitigated** — Percolator requires admin to SetOracleAuthority + PushOraclePrice; price is clamped by circuit breaker |
| Withdrawal limit relaxation | Admin raised limits before draining | **Mitigated** — `min_drawdown_bps` is immutable floor, manager cannot disable |
| Admin transfer | Ownership transferred with no delay | **Mitigated** — 48h timelock on `propose_manager` → `execute_manager_transfer` |
| Staged multi-week operation | Attacker prepared over weeks undetected | **Partially mitigated** — 48h timelock gives detection window; monitoring TBD |

## Syntx-Specific Vulnerabilities

### ~~Critical~~ Mitigated: Single manager key = single point of failure

Drift required compromising 2 of 5 signers. Syntx requires compromising 1 key.

If the manager key is compromised, the attacker can:
1. `manager_trade` — make adverse trades to drain vault value (**bounded by circuit breaker floor**)
2. `propose_manager` — propose transfer to attacker's address (**but 48h delay gives time to detect and cancel**)
3. `set_circuit_breaker` — ~~disable all protections~~ **cannot reduce below `min_drawdown_bps` floor**
4. `set_paused(false)` — unpause if someone detects and pauses
5. `collect_fees` — collect the management fee (the fee base is read on-chain; no equity input)

**Remaining gap:** Squads multisig not yet implemented. Single key + timelock is better than single key alone, but multisig is the full solution. Planned post-audit.

### ~~Critical~~ Implemented: Timelock on administrative actions

`propose_manager` starts a 48-hour timelock. `execute_manager_transfer` can only succeed after the timelock elapses. Either the current or pending manager can execute. The current manager can `cancel_manager_transfer` at any time.

### ~~Medium~~ Implemented: Immutable circuit breaker floor

`min_drawdown_bps` is set at vault creation and **cannot be reduced** — ever. The manager can call `set_circuit_breaker` to strengthen protections (raise the limit) but cannot weaken them below the floor. Depositors can verify this value on-chain before depositing.

### ~~Medium~~ Implemented: `collect_fees` computes equity on-chain

`collect_fees` takes no equity argument. The fee base is `total_deposits` (the amount withdrawals are priced against), capped by the vault's own collateral token balance for standalone vaults. The high-water mark is kept as a per-share price (1e6 fixed point), so deposits are not counted as profit. Unrealized PnL in the Percolator slab is not counted, since holders cannot redeem it either.

The performance fee is not charged at all (management fee only). Trading gains live in the Percolator slab, which cannot be read reliably on-chain yet: the slab layout is not a Rust dependency (only TS offset copies in keeper/ and app/), the slab `pnl` field is realized PnL only (unrealized needs the position basis, ADL coefficients and an oracle price), and `percolator_program` is chosen by the manager at init. A manager-supplied equity value is not accepted.

## What Syntx Gets Right (vs Drift)

### Vault PDA pattern eliminates direct fund extraction

The vault PDA has no private key. Funds can only move through the vault program's instructions. Unlike Drift where admin could directly transfer assets, the Syntx manager can only:
- Trade (PnL risk, not direct theft)
- Collect fees (bounded by share dilution math)
- Pause/unpause (no fund movement)

**The manager cannot directly withdraw vault funds.** Only share holders can withdraw, proportional to their shares.

### No fake collateral attack surface

Syntx doesn't create collateral markets. It trades on existing Percolator slabs. The slab admin (who controls oracle and collateral) is separate from the Syntx vault manager.

### Percolator's H ratio protects against exchange-level insolvency

Even if a trade goes badly, Percolator's formally verified risk engine ensures no user withdraws more than exists. This is a fundamentally different architecture than Drift's.

## Mitigations — Status

### Priority 1: Timelock on admin actions — IMPLEMENTED

```
propose_manager(new_manager)        → starts 48h timelock
execute_manager_transfer()          → succeeds only after 48h
cancel_manager_transfer()           → cancels pending transfer
```

Implemented with `pending_manager`, `pending_manager_timestamp` in VaultState. Tested: propose → fail before timelock → warp 49h → succeed. Cancel test: propose → cancel → warp → fail.

### Priority 2: Immutable circuit breaker floor — IMPLEMENTED

```
init_vault(..., min_drawdown_bps=500)   → 5% floor set at creation
set_circuit_breaker(200, ...)           → REJECTED (below floor)
set_circuit_breaker(1000, ...)          → OK (above floor)
```

`min_drawdown_bps` in VaultState cannot be modified after creation. Depositors verify on-chain before depositing.

### Priority 3: Multisig via Squads — PLANNED (post-audit)

Replace single EOA manager with a Squads multisig:
- 2-of-3 or 3-of-5 for trades
- 3-of-5 for admin actions
- Squads + timelock = full protection

### Priority 4: On-chain equity for `collect_fees` — DONE (capped)

Equity is taken from on-chain state instead of caller input. Reading true equity (capital + PnL) from the Percolator slab remains future work (needs a pinned Percolator program id and a versioned slab layout); until then only the management fee is charged, on the redeemable `total_deposits`, and the performance fee is not charged.

### Priority 5: On-chain monitoring — PLANNED

Emit events for admin actions so off-chain monitoring can detect anomalies.

## The Double-Risk Question

A fair critique of Syntx: users bear **Syntx smart contract risk on top of DEX risk** — two risk layers instead of one. Why would a user accept this?

**The counter-argument: concentration risk vs. diversified risk.**

| Single-venue vault | Syntx multi-venue vault |
|---|---|
| 1 smart contract risk layer | 2 risk layers (Syntx + DEX) |
| 100% concentration on one DEX | Diversified across venues |
| DEX downtime = total strategy loss | DEX downtime = route to another venue |
| DEX exploit = 100% exposure | Exposure limited to capital on that venue |
| No choice when liquidity dries up | Router picks best liquidity |

When Drift was exploited in April 2026, single-venue Drift vaults lost access to their entire strategy overnight. A Syntx vault would have routed to Percolator or Jupiter Perps in the next tick.

**The net risk calculation:** Syntx adds one smart contract layer (~audit-mitigable) but removes 100% venue concentration risk (~unmitigable). For any vault managing meaningful capital, diversified venue risk is strictly better than concentrated venue risk — as long as the Syntx contract itself is sound. This is why the audit is non-negotiable.

## Summary

Syntx is NOT vulnerable to the specific Drift exploit (multisig + durable nonce). The two most critical governance risks identified — instant manager transfer and disableable circuit breakers — are now mitigated:

1. **48h timelock** on manager transfer gives depositors a detection window
2. **Immutable circuit breaker floor** prevents the manager from disabling protections

Remaining gaps (multisig, on-chain equity for fees, monitoring) are planned for post-audit implementation. The vault PDA pattern provides strong protection against direct fund theft, and the timelock + immutable floor significantly reduce the damage a compromised manager key can cause.

**The audit must specifically review:** timelock implementation, min_drawdown_bps enforcement, CPI boundary with Percolator, share price rounding vectors, and CPI reentrancy at the Percolator boundary.
