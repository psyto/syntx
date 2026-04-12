# Syntx Security Assessment — Drift Exploit Comparison

## Context

On April 1, 2026, Drift Protocol was exploited for $285M through multisig governance compromise via durable nonce exploitation. This document assesses whether Syntx has similar vulnerabilities and what mitigations are needed.

## Attack Vector Comparison

| Drift attack vector | How it worked | Syntx exposure |
|---|---|---|
| 2-of-5 multisig, zero timelock | Attacker pre-signed with 2 signers, executed instantly | **Different** — single manager key, no multisig |
| Durable nonce exploitation | Pre-signed TX held indefinitely until optimal moment | **Not exposed** — no multisig approval pipeline |
| Fake collateral (CVT) creation | Admin created worthless token as collateral | **Not exposed** — vault trades on existing Percolator slabs |
| Oracle manipulation | Admin switched to attacker-controlled oracle | **Partially exposed** — Percolator slab admin controls oracle |
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
5. `collect_fees` — mint excess fee shares with inflated equity input

**Remaining gap:** Squads multisig not yet implemented. Single key + timelock is better than single key alone, but multisig is the full solution. Planned post-audit.

### ~~Critical~~ Implemented: Timelock on administrative actions

`propose_manager` starts a 48-hour timelock. `execute_manager_transfer` can only succeed after the timelock elapses. Either the current or pending manager can execute. The current manager can `cancel_manager_transfer` at any time.

### ~~Medium~~ Implemented: Immutable circuit breaker floor

`min_drawdown_bps` is set at vault creation and **cannot be reduced** — ever. The manager can call `set_circuit_breaker` to strengthen protections (raise the limit) but cannot weaken them below the floor. Depositors can verify this value on-chain before depositing.

### Medium: `collect_fees` accepts off-chain equity input

The `vault_equity` parameter is passed by the manager, not read from on-chain state. A compromised manager could pass an inflated equity to mint excess fee shares.

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

### Priority 4: On-chain equity for `collect_fees` — PLANNED

Read equity from Percolator slab instead of accepting off-chain input.

### Priority 5: On-chain monitoring — PLANNED

Emit events for admin actions so off-chain monitoring can detect anomalies.

## Summary

Syntx is NOT vulnerable to the specific Drift exploit (multisig + durable nonce). The two most critical governance risks identified — instant manager transfer and disableable circuit breakers — are now mitigated:

1. **48h timelock** on manager transfer gives depositors a detection window
2. **Immutable circuit breaker floor** prevents the manager from disabling protections

Remaining gaps (multisig, on-chain equity for fees, monitoring) are planned for post-audit implementation. The vault PDA pattern provides strong protection against direct fund theft, and the timelock + immutable floor significantly reduce the damage a compromised manager key can cause.

**The audit must specifically review:** timelock implementation, min_drawdown_bps enforcement, CPI boundary with Percolator, and share price manipulation vectors.
