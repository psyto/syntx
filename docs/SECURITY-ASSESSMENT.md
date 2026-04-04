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
| Withdrawal limit relaxation | Admin raised limits before draining | **Exposed** — manager can call `set_circuit_breaker` to remove limits |
| Admin transfer | Ownership transferred with no delay | **Exposed** — `update_manager` is instant, no timelock |
| Staged multi-week operation | Attacker prepared over weeks undetected | **Exposed** — no on-chain monitoring or anomaly detection |

## Syntx-Specific Vulnerabilities

### Critical: Single manager key = single point of failure

Drift required compromising 2 of 5 signers. Syntx requires compromising 1 key.

If the manager key is compromised, the attacker can:
1. `manager_trade` — make adverse trades to drain vault value
2. `update_manager` — transfer management to attacker's address
3. `set_circuit_breaker(0, default, 0)` — disable all protections
4. `set_paused(false)` — unpause if someone detects and pauses
5. `collect_fees` — mint excess fee shares with inflated equity input

### Critical: No timelock on administrative actions

`update_manager` and `set_circuit_breaker` execute instantly. No delay for detection or intervention.

### Medium: Circuit breakers are manager-configurable

The manager can disable their own circuit breakers at any time. This means circuit breakers protect against market risk but NOT against manager compromise.

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

## Recommended Mitigations (Pre-Mainnet)

### Priority 1: Timelock on admin actions

```
update_manager → 48-hour delay, publicly visible pending change
set_circuit_breaker → 24-hour delay when reducing protections
                      (increasing protections = immediate)
```

Implementation: add `pending_manager`, `pending_manager_slot`, and require a second `finalize_update_manager` call after the delay.

### Priority 2: Multisig or Squads integration for manager

Replace single EOA manager with a Squads multisig:
- 2-of-3 or 3-of-5 for trades
- 3-of-5 for admin actions
- Higher threshold than Drift's 2-of-5

Note: Squads itself was not the vulnerability in Drift. The vulnerability was zero timelock + durable nonce exploitation. Squads with timelocks is still the right pattern.

### Priority 3: On-chain equity for `collect_fees`

Read equity from Percolator slab instead of accepting off-chain input. This prevents a compromised manager from inflating fee collection.

### Priority 4: Immutable circuit breaker floor

Add a minimum circuit breaker that cannot be disabled:
```
min_drawdown_bps: u16  // set at vault creation, immutable
                       // manager's max_drawdown_bps must be >= this
```

### Priority 5: On-chain monitoring

Emit events for all admin actions so off-chain monitoring can detect anomalies:
- `update_manager` called → alert
- `set_circuit_breaker` protections reduced → alert
- Large position change (> 50% of capital) → alert
- Multiple trades in rapid succession → alert

## Summary

Syntx is NOT vulnerable to the specific Drift exploit (multisig + durable nonce). But it has its own governance risk: single manager key with no timelock. The vault PDA pattern provides strong protection against direct fund theft, but a compromised manager can still cause significant damage through adverse trading and admin changes.

**The audit must specifically review the manager privilege surface.** The mitigations above should be implemented before mainnet.
