# Percolator Risk Engine — Reference Notes for Syntx

Based on the official Percolator spec v12.1.0 by Anatoly Yakovenko.

**Full spec:** [aeyakovenko/percolator/spec.md](https://github.com/aeyakovenko/percolator/blob/master/spec.md)

## Key Concepts Syntx Vault Managers Must Understand

### 1. Capital Is Senior, Profit Is Junior

Your deposit (capital `C_i`) is protected. Trading profit (`PNL_i`) is a junior claim on the vault. When the exchange is stressed, the haircut ratio `h` reduces how much profit you can withdraw — but never touches your capital.

### 2. H Ratio — No One Withdraws More Than Exists

```
h = min(Residual, PNL_matured_pos_tot) / PNL_matured_pos_tot
```

- `h = 1` → fully backed, all profit is real
- `h < 1` → stressed, everyone takes the same proportional cut
- No rankings, no queue priority, no first-come advantage

### 3. Warmup — Oracle Manipulation Defense

Fresh positive PnL enters a reserve `R_i` and must mature through a warmup period `T` before it becomes withdrawable or counts toward initial margin. This prevents attackers from spiking oracle prices and immediately withdrawing inflated profits.

On the generating account, full local `PNL_i` supports maintenance margin (prevents liquidation), but reserved profit does NOT count for initial margin or withdrawals.

### 4. A/K Indices — Fair Overhang Clearing

When a position goes bankrupt:
- **A** scales everyone's effective position equally (quantity reduction)
- **K** distributes the deficit across all opposing positions (loss socialization)

Three-phase recovery: DrainOnly → ResetPending → Normal. No admin intervention needed.

### 5. Funding Rate

- Stored as `r_last` (basis points per slot), recomputed by the deployment wrapper after each instruction
- Positive = longs pay shorts
- Sub-stepped for overflow safety (`MAX_FUNDING_DT = 65535` slots per sub-step)
- Uses start-of-call funding price sample, not current oracle (anti-retroactivity)

### 6. Key Bounds

| Bound | Value | Meaning |
|---|---|---|
| MAX_VAULT_TVL | 10^16 | ~$10B at $1/unit |
| MAX_ORACLE_PRICE | 10^12 | ~$1M per base unit |
| MAX_POSITION_ABS_Q | 10^14 | Max position (in q-units, POS_SCALE=10^6) |
| MAX_ABS_FUNDING_BPS_PER_SLOT | 10,000 | 100% per slot cap |
| POS_SCALE | 1,000,000 | 6 decimal places of position precision |
| ADL_ONE | 1,000,000 | 6 decimal places of A-side decay accuracy |
| MIN_A_SIDE | 1,000 | Below this → DrainOnly mode |

### 7. Account State

Each account stores:
- `C_i` (u128) — protected principal
- `PNL_i` (i128) — realized PnL
- `R_i` (u128) — reserved positive PnL (warmup)
- `basis_pos_q_i` (i128) — signed position basis
- `a_basis_i`, `k_snap_i`, `epoch_snap_i` — A/K snapshots
- `fee_credits_i` (i128) — fee debt (always ≤ 0)
- `last_fee_slot_i` — recurring maintenance fee slot

### 8. External Instructions (What Syntx CPI Calls)

| Instruction | What Syntx uses it for |
|---|---|
| `deposit(i, amount, now_slot)` | Vault deposits collateral |
| `withdraw(i, amount, oracle_price, now_slot)` | Vault withdraws collateral |
| `execute_trade(a, b, oracle_price, now_slot, size_q, exec_price)` | Keeper trades via vault PDA |
| `settle_account(i, oracle_price, now_slot)` | Touch/settle account state |
| `liquidate(i, oracle_price, now_slot, policy)` | Liquidation |
| `keeper_crank(now_slot, oracle_price, candidates[], max)` | Batch settle + liquidate |
| `reclaim_empty_account(i, now_slot)` | Clean up dust accounts |
| `top_up_insurance_fund(amount, now_slot)` | Add to insurance |

### 9. Security Properties That Protect Syntx Vaults

1. Protected principal for flat accounts — deposit can't be taken by another's insolvency
2. Oracle manipulation safety — warmup prevents instant profit extraction
3. Profit-first haircuts — capital is senior
4. Conservation — can't create claims exceeding vault tokens
5. Liveness — no global scan needed, any user can settle independently
6. No hidden protocol MM — no secret order internalization
7. Deterministic overflow handling — no silent wrap or undefined behavior

### 10. What Syntx Must Be Careful About

- **Syntx vault PDA is an "account" on Percolator** — subject to all the same rules
- **Warmup affects vault equity** — fresh trading profits don't immediately increase share price for initial margin purposes
- **Recurring maintenance fees** — Percolator charges `maintenance_fee_per_slot * elapsed_slots` per account
- **Deposit must be ≥ MIN_INITIAL_DEPOSIT** — can't create accounts with dust
- **Fee debt** — unpaid fees become negative `fee_credits_i`, reducing equity
- **Configuration is immutable** — margin params, fees, warmup can't be changed after market init
