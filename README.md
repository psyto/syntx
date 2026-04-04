# Syntx — Composable Perp Vaults on Solana

Syntx is a permissionless vault protocol for perpetual futures on Solana. It adds a composable vault layer on top of [Percolator](https://github.com/aeyakovenko/percolator), the formally-verified perp risk engine built by Solana co-founder Anatoly Yakovenko.

**Live on devnet. Keeper running. Deposit and withdraw from the browser.**

## The Problem

After the Drift Protocol exploit (April 1, 2026, $285M lost), Solana has no composable perpetual futures layer. Jupiter's perps are oracle-AMM (unsuitable for programmatic strategies). Phoenix, Bulk, and Bullet are months from launch. 20+ protocols that depended on Drift have nowhere to go.

## What Syntx Does

Anyone can create a **strategy vault** that trades perps on Percolator:

1. **Vault managers** create vaults, set fees, run keeper strategies
2. **Users** deposit collateral, receive share tokens proportional to vault equity
3. **Keepers** trade on Percolator using the vault's capital (funding rate harvest, delta-neutral, market making)
4. **Other protocols** compose with Syntx via CPI — atomic hedging, leveraged yield, treasury management

Think of it as a **composable hedge fund infrastructure** — Percolator is the exchange, Syntx is the vault layer.

## Why Composable Matters

Syntx creates composable strategy vaults that interact with the entire Solana DeFi stack — not isolated perp markets.

| Purpose-built chains (Hyperliquid) | Syntx on Solana |
|---|---|
| Perp position is isolated | Perp position composes with lending, spot, LSTs |
| Need bridges for cross-protocol | Atomic in one transaction via CPI |
| Can't use position as collateral | Vault shares are SPL tokens — usable anywhere |
| Integration needs bridges + time | Any program calls `cpi_trade` in the same block |

## Architecture

```
Users deposit → Syntx Vault Program → CPI → Percolator Program
                      │                          │
                 Share tokens              Risk engine (H/A/K)
                 Fee accounting            Funding rate
                 Circuit breakers          Liquidation
                 CPI interface             Oracle (Pyth)
                      │
                 Keeper Bot            Composability:
                 (strategies)          Jupiter, Kamino,
                      │                Marginfi, Phoenix
                      ▼
                 Trading PnL →
                 Share price moves
```

## Vault Program (15 Instructions)

| Instruction | Who | Purpose |
|---|---|---|
| `init_vault` | Anyone | Create a new vault |
| `register_on_percolator` | Manager | Register vault on Percolator market |
| `set_percolator_idx` | Manager | Store account index |
| `deposit` | Any user | Deposit collateral, receive shares |
| `withdraw` | Any user | Burn shares, get collateral back |
| `manager_trade` | Manager | Execute trades via vault PDA |
| `manager_crank` | Manager | Settle funding payments |
| `collect_fees` | Manager | Performance + management fees |
| `update_manager` | Manager | Transfer management |
| `set_paused` | Manager | Emergency stop |
| `set_circuit_breaker` | Manager | Configure drawdown limit, CPI whitelist, trade size caps |
| `get_share_price` | Anyone | On-chain share price oracle |
| `cpi_trade` | Whitelisted program | Public CPI trading interface |

## Security Model

### What protects users

| Threat | Protection |
|---|---|
| Manager steals funds | Vault PDA has no private key — withdrawals go to share holders |
| Exchange insolvency | Percolator H ratio — capital is senior, profit is junior. No user withdraws more than exists. |
| Excessive drawdown | **Circuit breaker** — auto-rejects trades beyond max drawdown from peak |
| Malicious CPI callers | **CPI whitelist** — vault manager restricts which programs can trade |
| Oversized CPI trades | **Configurable size limit** — per-vault max trade size |
| Bad trades | Performance fee aligns manager incentives with depositors |

### What does NOT protect users (honest assessment)

| Risk | Status |
|---|---|
| Smart contract bugs in Syntx | **Unaudited.** 20 tests pass but tests != audit. Audit required before mainnet. |
| Keeper failure during volatility | Keeper has retry logic but no redundancy. Single point of failure. |
| Oracle manipulation | Depends on Percolator's oracle checks. Authority mode (devnet) is centralized. |
| Composability risk propagation | CPI whitelist + size limits reduce but don't eliminate cross-program risk. |

## Composability Recipes

| Recipe | Protocols | Status |
|---|---|---|
| Any Token → Vault | Jupiter + Syntx | Live |
| One-Click Delta Neutral | Jupiter + Syntx + Percolator | Coming soon |
| Leveraged Vault Yield | Syntx + Kamino | Coming soon |
| Protocol Treasury Hedge | Squads + Syntx | Coming soon |
| Lending Auto-Hedge | Kamino CPI → Syntx | Coming soon |
| Spot + Perp Arbitrage | Phoenix + Syntx | Coming soon |

## Frontend (6 Pages)

| Page | What |
|---|---|
| `/` | Hero, stats, features, composability showcase |
| `/vaults` | Vault marketplace — browse, click to expand, deposit/withdraw |
| `/compose` | 6 composability recipes with step-by-step flows |
| `/earn` | Your positions across all vaults |
| `/create` | 4-step vault creation wizard (fully on-chain) |

## Keeper Bot

Funding Rate Harvest strategy (ported from Yogi):

```
Every 30 seconds:
  1. Read slab state (position, PnL, funding rate)
  2. Push oracle price (with retry, 3 attempts)
  3. Crank funding settlement
  4. Strategy decision:
     - Funding > 0 → SHORT (collect from longs)
     - Funding < 0 → LONG (collect from shorts)
     - Funding ≈ 0 → hold (no edge)
  5. Scale by: vol regime × signal severity → deployment %
     - low/none: 80%, normal/none: 60%, high/none: 30%, extreme: 0%
```

## Tests (20/20 Passing)

**Positive tests:** full lifecycle, fees, pause, update manager, share price oracle, multi-user deposits, get_share_price.

**Negative tests:** unauthorized trade, unauthorized pause, unauthorized fees, unauthorized manager update, deposit when paused, deposit over cap, zero deposit, insufficient shares, double init.

## Project Structure

```
syntx/
├── programs/syntx-vault/
│   ├── src/lib.rs              # Vault program (15 instructions)
│   └── tests/integration.rs    # 20 LiteSVM tests
├── keeper/
│   ├── src/
│   │   ├── keeper.ts           # Main loop (oracle, crank, trade)
│   │   ├── strategy.ts         # Funding Rate Harvest strategy
│   │   ├── slab.ts             # Percolator slab parser
│   │   ├── abi.ts              # Instruction encoders
│   │   ├── setup-devnet.ts     # Devnet deployment
│   │   └── setup-multi-market.ts # BTC/ETH market deployment
│   └── devnet-vault.json       # Deployed addresses
├── sdk/
│   └── src/
│       ├── client.ts           # SyntxClient class
│       ├── instructions.ts     # TX builders
│       ├── accounts.ts         # On-chain parsers + vault discovery
│       └── constants.ts        # PDA derivation
├── app/
│   └── src/app/
│       ├── page.tsx            # Landing page
│       ├── vaults/page.tsx     # Vault marketplace
│       ├── compose/page.tsx    # Composability recipes
│       ├── earn/page.tsx       # Portfolio view
│       ├── create/page.tsx     # Vault creation wizard
│       └── components/         # Nav, Footer, VaultDashboard, VaultList, SwapDeposit
└── docs/
    ├── BUILD-PLAN.md           # Roadmap + current status
    ├── HOW-IT-WORKS.md         # Complete guide
    └── VAULT-ARCHITECTURE.md   # Technical spec
```

## Devnet Deployment

| Component | Address |
|---|---|
| Syntx Vault Program | `53r6bg7JBFqf5Jfs7fe4kHDtwXwUgDWoLarYrsWcoF1V` |
| Percolator Program | `Edq18N2pdT3Sz9EukbZe4YsQkvmxvmmkUL1KHpv96xJF` |
| Vault PDA | `4pL2aQawAbc2XwjRE9ptrH4yxihn4BL2uVMavgZrtYUK` |
| Percolator Slab (SOL-PERP) | `J55KavPouZg8ZeWnTY77ZBL2DdQskzKpkFvuTtbUNzYC` |

## Dependencies

All Apache 2.0, by Anatoly Yakovenko:

| Repo | What |
|---|---|
| [percolator](https://github.com/aeyakovenko/percolator) | Risk engine — H (fair exits via pro-rata profit haircut) + A/K (fair overhang clearing via lazy side indices) |
| [percolator-prog](https://github.com/aeyakovenko/percolator-prog) | Solana program (6.3K LOC) |
| [percolator-cli](https://github.com/aeyakovenko/percolator-cli) | CLI tools + slab parser |
| [percolator-match](https://github.com/aeyakovenko/percolator-match) | Reference passive matcher |
| [percolator-meta](https://github.com/aeyakovenko/percolator-meta) | Staking rewards (MetaDAO futarchy) |

Custom matchers by Fabrknt: [percolator-fabrknt](https://github.com/psyto/percolator-fabrknt)

## Development

```bash
# Build vault program
cargo-build-sbf --tools-version v1.53 -- --manifest-path programs/syntx-vault/Cargo.toml

# Run tests (requires percolator-prog binary)
cargo test -p syntx-vault --test integration

# Run keeper
cd keeper && npm install && cp .env.example .env && npx ts-node src/index.ts

# Run frontend
cd app && npm install && npx next dev

# Deploy to devnet
cd keeper && npx ts-node src/setup-devnet.ts
```

## Roadmap

| Phase | Status |
|---|---|
| Foundation + Core Vault | Done |
| Keeper + Devnet | Done |
| Fees + Multi-vault | Done |
| SDK + Frontend (6 pages) | Done |
| Composability (CPI, Jupiter) | Done |
| Circuit Breakers + Security Hardening | Done |
| Security Audit | Pending (~$50-100K, non-negotiable before mainnet) |
| SNTX Token | Pending (needs legal counsel) |
| Mainnet Launch | Pending (after audit) |

See [BUILD-PLAN.md](docs/BUILD-PLAN.md) for details, [HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md) for the complete guide, and [PERCOLATOR-SPEC-REFERENCE.md](docs/PERCOLATOR-SPEC-REFERENCE.md) for Percolator's risk engine mechanics.

## License

Apache 2.0
