# Syntx — Composable Perp DEX on Solana

Syntx is a vault-native perpetual futures protocol on Solana. It adds a composable vault layer on top of [Percolator](https://github.com/aeyakovenko/percolator), the formally-verified perp risk engine built by Solana co-founder Anatoly Yakovenko.

## The Problem

After the Drift Protocol exploit (April 1, 2026, $285M lost), Solana has no composable perpetual futures layer. Jupiter's perps are oracle-AMM (unsuitable for programmatic strategies). Phoenix, Bulk, and Bullet are months from launch. 20+ protocols that depended on Drift for hedging, delta-neutral strategies, and vault composability have nowhere to go.

## What Syntx Does

Syntx is a **vault program** that sits on top of Percolator. It enables:

1. **Users** deposit collateral (USDC) into a vault and receive share tokens
2. A **keeper** (strategy manager) trades on Percolator using the vault's capital
3. Users withdraw by burning shares — they get back their proportional share of vault equity (capital + PnL)

Think of it as a hedge fund structure: users are LPs, the keeper is the fund manager, and Percolator is the exchange.

## How It Works

### The Two Programs

There are two Solana programs involved:

**Percolator** (by Anatoly Yakovenko) — the perp exchange engine:
- Manages trading accounts, positions, collateral
- Executes trades between users and LPs
- Handles funding rates, liquidations, insurance
- Formally verified risk engine (no user can withdraw more than exists)

**Syntx Vault** (this repo) — the vault layer on top:
- Manages deposits, withdrawals, share tokens
- Authorizes the keeper to trade using vault capital
- Tracks fees (performance + management)

### The Vault PDA Pattern

This is the key architectural concept:

```
┌─────────────────────────────────┐
│       Syntx Vault Program       │
│                                 │
│  VaultState PDA                 │
│  ├── manager: keeper's pubkey   │
│  ├── share_mint: share token    │
│  ├── collateral_mint: USDC      │
│  ├── percolator_slab: market    │
│  └── percolator_user_idx: 0     │
│                                 │
│  This PDA "owns" a Percolator   │
│  account. Only the vault        │
│  program can sign for it.       │
└──────────────┬──────────────────┘
               │
               │  CPI (Cross-Program Invocation)
               │  vault PDA signs via invoke_signed
               │
┌──────────────▼──────────────────┐
│      Percolator Program         │
│                                 │
│  Account[0]                     │
│  ├── owner: vault PDA           │
│  ├── capital: 999               │
│  ├── position: +1               │
│  └── pnl: 0                    │
│                                 │
│  The vault PDA is the "user"    │
│  on Percolator. It can trade,   │
│  deposit, and withdraw.         │
└─────────────────────────────────┘
```

**Why this matters:** The vault PDA is a program-derived address. No single person holds its private key. Only the Syntx vault program can sign transactions on its behalf (via `invoke_signed`). This means:

- The keeper (manager) can trade, but cannot steal funds — withdrawals go to share holders
- Users can deposit/withdraw, but cannot trade — only the keeper can
- The Percolator risk engine protects against insolvency — the H ratio ensures no one withdraws more than exists

### Transaction Flow

**Deposit:**
```
User sends USDC → Syntx Vault Program
  → transfers USDC to vault token account
  → CPI: Percolator DepositCollateral (vault PDA signs)
  → mints share tokens to user
```

**Trade (keeper):**
```
Keeper calls manager_trade → Syntx Vault Program
  → verifies keeper is the authorized manager
  → CPI: Percolator TradeNoCpi (vault PDA signs as user)
  → Percolator executes trade against LP
  → position updated on-chain
```

**Withdraw:**
```
User burns share tokens → Syntx Vault Program
  → CPI: Percolator WithdrawCollateral (vault PDA signs)
  → transfers USDC back to user
```

## Vault Instructions

The Syntx vault program has 8 instructions:

| Instruction | Who calls it | What it does |
|---|---|---|
| `init_vault` | Manager | Creates vault state PDA, records config |
| `register_on_percolator` | Manager | CPI to Percolator InitUser — creates the vault's trading account |
| `set_percolator_idx` | Manager | Stores the assigned account index from Percolator |
| `deposit` | Any user | Accept USDC, CPI deposit to Percolator, mint shares |
| `withdraw` | Any user | Burn shares, CPI withdraw from Percolator, return USDC |
| `manager_trade` | Manager only | CPI to Percolator TradeNoCpi — open/close positions |
| `manager_crank` | Manager only | CPI to Percolator KeeperCrank — settle funding |
| `set_paused` | Manager only | Emergency pause deposits/withdrawals |

## Percolator Concepts

To understand Syntx, you need to understand a few Percolator concepts:

### Slab
A **slab** is a single Percolator market. It's a large on-chain account (~1.1MB) that contains:
- Market configuration (collateral mint, oracle, fee parameters)
- Risk engine state (funding rate, insurance fund, aggregates)
- Up to 4096 trading accounts (users + LPs)

Each slab is one market (e.g., SOL-PERP).

### Accounts (Users and LPs)
Inside a slab, there are **accounts**:
- **User accounts** — hold collateral, can have positions (long or short)
- **LP accounts** — provide liquidity, take the other side of user trades

The Syntx vault PDA is registered as a **User account** on the slab.

### H Ratio (Haircut)
The H ratio is Percolator's key safety mechanism. It ensures:
```
No user can ever withdraw more value than actually exists on the exchange
```
If the exchange is underfunded (e.g., after liquidation losses), the H ratio scales down withdrawals proportionally. This is formally verified with the Kani theorem prover.

### Funding Rate
Like all perp exchanges, Percolator has a funding rate that keeps the perp price close to the spot price:
- When longs > shorts: longs pay shorts (positive funding)
- When shorts > longs: shorts pay longs (negative funding)

The keeper cranks funding settlement periodically.

### Oracle
Each market needs a price oracle. Percolator supports:
- **Pyth** — production oracle from Pyth Network
- **Oracle Authority** — admin can push prices directly (used for devnet testing)

## Keeper Bot

The keeper (`keeper/`) is a TypeScript process that:

1. **Reads slab state** — account balances, positions, funding rate
2. **Pushes oracle price** — in authority mode (devnet), or reads from Pyth (production)
3. **Cranks funding** — calls Percolator KeeperCrank to settle funding payments
4. **Executes trades** — calls Syntx `manager_trade` to open/close positions

### Keeper Loop
```
Every 30 seconds:
  1. Fetch slab from RPC
  2. Parse vault health (capital, PnL, position)
  3. Push oracle price
  4. Crank funding settlement
  5. Evaluate strategy → trade if conditions met
```

### Strategy (Placeholder)
Currently the keeper opens a small long position when flat. In production, it would port strategies from Yogi/Kodiak:
- **Funding rate harvesting** — go long/short to collect funding payments
- **Delta-neutral** — hedge spot exposure with perp shorts
- **Signal-based** — use anomaly detection to time entries/exits

## Project Structure

```
syntx/
├── programs/
│   └── syntx-vault/
│       ├── src/lib.rs              # Vault program (8 instructions)
│       └── tests/integration.rs    # LiteSVM tests (6 passing)
├── keeper/
│   ├── src/
│   │   ├── index.ts                # Entry point
│   │   ├── config.ts               # Environment config loader
│   │   ├── keeper.ts               # Main loop (read, crank, trade)
│   │   ├── slab.ts                 # Percolator slab parser
│   │   ├── abi.ts                  # Instruction encoders
│   │   ├── setup-devnet.ts         # Devnet deployment script
│   │   └── test-tick.ts            # Single-tick test
│   ├── devnet-vault.json           # Deployed addresses
│   └── .env                        # Keeper config (not committed)
├── docs/
│   ├── BUILD-PLAN.md               # 8-phase roadmap
│   ├── VAULT-ARCHITECTURE.md       # Vault PDA design
│   └── HOW-IT-WORKS.md             # This explanation, expanded
└── Anchor.toml                     # Solana program config
```

## Devnet Deployment

Syntx is live on Solana devnet:

| Component | Address |
|---|---|
| Syntx Vault Program | `53r6bg7JBFqf5Jfs7fe4kHDtwXwUgDWoLarYrsWcoF1V` |
| Percolator Program | `Edq18N2pdT3Sz9EukbZe4YsQkvmxvmmkUL1KHpv96xJF` |
| Vault PDA | `4pL2aQawAbc2XwjRE9ptrH4yxihn4BL2uVMavgZrtYUK` |
| Percolator Slab | `J55KavPouZg8ZeWnTY77ZBL2DdQskzKpkFvuTtbUNzYC` |
| Collateral Mint | `2uGTCDSfisKCTN2Yd8umXiWJzfRpWe8mhZM6WCK2vj8D` |
| Share Mint | `6KMkX75jzL4jEDo9TXAr9NvCWefLnnv5vWLTtHtcmJqS` |

Current on-chain state:
```
Vault [0]: Capital=999, Position=+1 (long), PnL=0
LP    [1]: Capital=599999, Position=-1 (short)
```

## Dependencies

Syntx builds on Anatoly Yakovenko's Percolator stack (all Apache 2.0):

| Repo | What | By |
|---|---|---|
| [percolator](https://github.com/aeyakovenko/percolator) | Core risk engine (H ratio, A/K ADL, formal proofs) | Anatoly |
| [percolator-prog](https://github.com/aeyakovenko/percolator-prog) | Solana program (6.3K LOC Rust) | Anatoly |
| [percolator-cli](https://github.com/aeyakovenko/percolator-cli) | CLI tools + slab parser | Anatoly |
| [percolator-match](https://github.com/aeyakovenko/percolator-match) | Reference passive matcher | Anatoly |
| [percolator-meta](https://github.com/aeyakovenko/percolator-meta) | Staking rewards (MetaDAO futarchy) | Anatoly |
| [percolator-fabrknt](https://github.com/psyto/percolator-fabrknt) | 5 custom matchers (vol, event, macro, jpy, privacy) | Fabrknt |

## Development

### Build the vault program
```bash
cargo-build-sbf --tools-version v1.53 -- --manifest-path programs/syntx-vault/Cargo.toml
```

### Run tests (requires percolator-prog binary)
```bash
# First build percolator-prog (production, not --features test)
cd ../percolator-prog && cargo-build-sbf --tools-version v1.53

# Then run Syntx tests
cd ../syntx && cargo test -p syntx-vault --test integration
```

### Run keeper
```bash
cd keeper
npm install
cp .env.example .env  # fill in values from devnet-vault.json
npx ts-node src/index.ts
```

### Deploy to devnet
```bash
cd keeper
npx ts-node src/setup-devnet.ts
```

## Roadmap

| Phase | Status | Timeline |
|---|---|---|
| 0. Foundation | Done | Week 1 |
| 1. Core vault + tests | Done | Week 2-3 |
| 2. Keeper + devnet | Done | Week 3-4 |
| 3. Fees + multi-market | Next | Week 4-5 |
| 4. SDK + frontend | Planned | Week 5-7 |
| 5. Security audit | Planned | Week 7-8 |
| 6. SNTX token | Planned | Week 8-10 |
| 7. Mainnet launch | Planned | Week 10-12 |

See [BUILD-PLAN.md](docs/BUILD-PLAN.md) for details.

## License

Apache 2.0
