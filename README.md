# Syntx — Composable Exchange-Agnostic Vaults on Solana

> **Built for the [Solana Frontier Hackathon](https://www.colosseum.org/frontier) (Apr 6 – May 11, 2026)**

Strategy vaults that route across any perp execution venue — Percolator, Phoenix, Jupiter Perps. One vault, best execution, full CPI composability.

**Live on devnet:** [fabrknt.com/vaults](https://fabrknt.com/vaults)  
**GitHub:** [github.com/psyto/syntx](https://github.com/psyto/syntx)

---

## The Problem

Every Solana perp venue builds in isolation. Drift vaults only trade on Drift. Jupiter vaults only trade on Jupiter. Strategy managers rebuild identical infrastructure for each DEX. When a venue goes down, single-venue vaults lose access entirely.

Solana now has multiple high-quality perp venues — Phoenix, Jupiter Perps, Percolator, Drift — but no shared vault infrastructure to compose across them.

## What Syntx Does

Syntx separates **vault management** from **trade execution**:

```
Depositors ──→ Syntx Vault (PDA) ──→ VenueRouter ──→ Percolator (perp)
                    │                      │      ──→ Phoenix (spot)
               SPL Shares                  │      ──→ Jupiter Perps (perp)
               Fee accounting              │      ──→ + any new venue
               Circuit breakers            │
                    │                      └── Scores by: funding rate,
DeFi Protocols ────CPI────→ cpi_trade          liquidity, cost
(Kamino, Marginfi)
```

1. **Vault managers** create vaults, set fees, run keeper strategies
2. **Depositors** deposit USDC, receive SPL share tokens (usable as collateral elsewhere)
3. **VenueRouter** scores each DEX and routes trades to best execution
4. **Other protocols** compose via CPI — atomic hedging, leveraged yield, treasury management

## Exchange-Agnostic Architecture

The core innovation is the **VenueAdapter** interface. Adding a new DEX means implementing 6 methods — the strategy code never changes:

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

**Implemented adapters:**

| Adapter | Venue | Type | Status |
|---|---|---|---|
| `PercolatorAdapter` | Percolator (Anatoly Yakovenko) | perp (slab-based) | Live on devnet |
| `PhoenixAdapter` | Phoenix V1 (Ellipsis Labs) | spot (CLOB) | Integrated |
| `JupiterPerpsAdapter` | Jupiter Perps | perp (oracle-based AMM) | Integrated |
| `VenueRouter` | Multi-venue scoring | hybrid | Live |

Switch venues with one env var: `VENUE=percolator`, `VENUE=phoenix`, `VENUE=jupiter`, or `VENUE=router` (multi-venue).

## Why Composable Matters

| Purpose-built chains (Hyperliquid) | Syntx on Solana |
|---|---|
| Perp position is isolated | Perp position composes with lending, spot, LSTs |
| Need bridges for cross-protocol | Atomic in one transaction via CPI |
| Can't use position as collateral | Vault shares are SPL tokens — usable anywhere |
| Locked to one venue | VenueRouter picks best execution across DEXes |

## Vault Program (17 Instructions)

| Instruction | Who | Purpose |
|---|---|---|
| `init_vault` | Anyone | Create a new vault (sets immutable min_drawdown_bps floor) |
| `register_on_percolator` | Manager | Register vault on Percolator market |
| `set_percolator_idx` | Manager | Store account index |
| `deposit` | Any user | Deposit collateral, receive shares |
| `withdraw` | Any user | Burn shares, get collateral back |
| `manager_trade` | Manager | Execute trades via vault PDA |
| `manager_crank` | Manager | Settle funding payments |
| `collect_fees` | Manager | Performance + management fees |
| `propose_manager` | Manager | Propose manager transfer (48h timelock) |
| `execute_manager_transfer` | Manager/Pending | Execute transfer after 48h timelock |
| `cancel_manager_transfer` | Manager | Cancel pending manager transfer |
| `set_paused` | Manager | Emergency stop |
| `set_circuit_breaker` | Manager | Configure drawdown limit (cannot go below floor), CPI whitelist, trade size caps |
| `get_share_price` | Anyone | On-chain share price oracle |
| `cpi_trade` | Whitelisted program | Public CPI trading interface |

## Security Model

| Threat | Protection |
|---|---|
| Manager key compromised | **48h timelock** on manager transfer — propose → wait → execute. Cancel if detected. |
| Manager disables protection | **Immutable circuit breaker floor** — min_drawdown_bps set at vault creation, cannot be reduced |
| Manager drains via bad trades | Circuit breaker auto-rejects trades beyond max drawdown from peak equity |
| Exchange insolvency | Percolator H ratio — mathematically proven fair exits |
| Malicious CPI callers | CPI whitelist — vault manager restricts which programs can trade |
| Oversized CPI trades | Configurable per-vault max trade size |
| Direct fund theft | Vault PDA has no private key — only the program can sign |

**The double-risk question:** Users bear Syntx contract risk on top of DEX risk. But single-venue vaults have 100% concentration risk — when that DEX goes down, the strategy dies. Syntx adds one audit-mitigable layer but removes unmitigable venue concentration. Net risk is lower for any vault managing meaningful capital. See [SECURITY-ASSESSMENT.md](docs/SECURITY-ASSESSMENT.md) for the full analysis.

**Honest assessment:** Syntx is unaudited. 29 tests pass but tests != audit. Security audit (~$50-100K) is required before mainnet.

## Composability Recipes

| Recipe | Protocols | Status |
|---|---|---|
| Any Token → Vault | Jupiter + Syntx | Live |
| Spot + Perp Arbitrage | Phoenix + Syntx + Percolator | Architecture ready |
| One-Click Delta Neutral | Jupiter + Syntx + Percolator | Coming soon |
| Leveraged Vault Yield | Syntx + Kamino | Coming soon |
| Protocol Treasury Hedge | Squads + Syntx | Coming soon |
| Lending Auto-Hedge | Kamino CPI → Syntx | Coming soon |

## Quick Start

```bash
# Clone
git clone https://github.com/psyto/syntx.git && cd syntx

# Run tests (requires Percolator binary)
cargo test -p syntx-vault --test integration

# Run keeper (devnet, Percolator venue)
cd keeper && npm install && npx ts-node src/index.ts

# Run keeper (multi-venue router mode)
VENUE=router PHOENIX_MARKET=4DoNfFBfF7UokCC2FQzriy7yHK6DY6NVdYpuekQ5pRgg \
  npx ts-node src/index.ts

# Run frontend (local dev)
cd app && npm install && npx next dev

# Deploy new vault to devnet
cd keeper && npx ts-node src/setup-devnet.ts
```

## Devnet Deployment

| Component | Address |
|---|---|
| Syntx Vault Program | `53r6bg7JBFqf5Jfs7fe4kHDtwXwUgDWoLarYrsWcoF1V` |
| Percolator Program | `Edq18N2pdT3Sz9EukbZe4YsQkvmxvmmkUL1KHpv96xJF` |
| SOL Funding Rate Vault | `4pL2aQawAbc2XwjRE9ptrH4yxihn4BL2uVMavgZrtYUK` |
| SOL Delta Neutral Vault | `9g39fL79XnwHBLCPT1GqixEmJp7z5LLzjWWiaMpcKDhK` |
| Phoenix SOL/USDC Market | `4DoNfFBfF7UokCC2FQzriy7yHK6DY6NVdYpuekQ5pRgg` |
| Jupiter Perps Program | `PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu` |
| Jupiter SOL Custody | `7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz` |

## Project Structure

```
syntx/
├── programs/syntx-vault/
│   ├── src/lib.rs              # Vault program (15 instructions, timelock, immutable floor)
│   └── tests/integration.rs    # 27 LiteSVM tests
├── keeper/
│   └── src/
│       ├── venues/
│       │   ├── types.ts        # VenueAdapter interface
│       │   ├── percolator.ts   # PercolatorAdapter (slab-based)
│       │   ├── phoenix.ts      # PhoenixAdapter (Phoenix V1 SDK, CLOB)
│       │   ├── jupiter.ts      # JupiterPerpsAdapter (oracle-based AMM)
│       │   └── router.ts       # VenueRouter (multi-venue scoring)
│       ├── keeper.ts           # Venue-agnostic keeper loop
│       ├── strategy.ts         # Funding Rate Harvest strategy
│       ├── slab.ts             # Percolator slab parser
│       └── config.ts           # VENUE=percolator|phoenix|jupiter|router
├── sdk/
│   └── src/
│       ├── client.ts           # SyntxClient (buildDepositTx, buildWithdrawTx)
│       ├── instructions.ts     # All 15 instruction builders with JSDoc
│       ├── accounts.ts         # On-chain parsers + vault discovery
│       └── constants.ts        # PDA derivation
├── app/                        # Next.js 16 frontend (5 pages, mobile-responsive)
│   └── src/app/
│       ├── page.tsx            # Landing — composable exchange-agnostic vaults
│       ├── vaults/page.tsx     # Vault marketplace (named vaults, venue badges)
│       ├── compose/page.tsx    # Architecture diagram, CPI snippets, recipes
│       ├── earn/page.tsx       # Portfolio view
│       ├── create/page.tsx     # Vault creation wizard
│       └── components/
│           ├── ErrorBoundary.tsx # Graceful RPC failure handling
│           ├── VaultList.tsx     # Named vaults with venue badges
│           └── VaultDashboard.tsx # Deposit/withdraw with Max, toasts
├── examples/
│   ├── cpi-caller/             # Anchor program + TS client for CPI into Syntx
│   │   ├── lib.rs              # hedge_via_syntx instruction
│   │   └── client.ts           # Transaction builder
│   └── venue-adapter/          # How to add a new DEX
│       └── drift-adapter.ts    # DriftAdapter skeleton (6 methods)
└── docs/
    ├── BUILD-PLAN.md
    ├── HOW-IT-WORKS.md
    ├── VAULT-ARCHITECTURE.md
    ├── SECURITY-ASSESSMENT.md
    ├── BUSINESS-PLAN.md
    └── HACKATHON-UPDATES.md
```

## Tech Stack

| Component | Tech |
|---|---|
| Vault Program | Anchor 0.30.1, Rust, Solana SDK 1.18 |
| Tests | LiteSVM (in-memory Solana emulator) |
| Keeper | TypeScript, @solana/web3.js, @ellipsis-labs/phoenix-sdk |
| Frontend | Next.js 16, React 19, Tailwind CSS 4, Vercel Analytics |
| SDK | TypeScript, @solana/spl-token |

## Built on

| Dependency | What |
|---|---|
| [Percolator](https://github.com/aeyakovenko/percolator) | Formally verified perp risk engine by Anatoly Yakovenko |
| [Phoenix](https://www.phoenix.trade/) | Composable spot orderbook by Ellipsis Labs |
| [Jupiter Perps](https://www.jup.ag/perps) | Oracle-based AMM perpetuals |
| [percolator-fabrknt](https://github.com/psyto/percolator-fabrknt) | 5 custom matching strategies by Fabrknt |

## Track Record

Syntx's strategy logic is battle-tested on production vaults:

| Vault | Protocol | Chain | Status |
|---|---|---|---|
| [Yogi](https://github.com/psyto/yogi) | Drift | Solana mainnet | Live, +1.61% through -7.4% BTC week |
| [Kodiak](https://github.com/psyto/kodiak) | Hyperliquid | Hyperliquid mainnet | Live, delta-neutral |

29 published [@fabrknt/*](https://www.npmjs.com/org/fabrknt) infrastructure packages power the stack.

## Roadmap

| Phase | Status |
|---|---|
| Vault program + tests | Done |
| Keeper + devnet deployment | Done |
| Venue adapter pattern | Done |
| Phoenix V1 integration | Done |
| Jupiter Perps integration | Done |
| VenueRouter (multi-venue) | Done |
| Frontend (5 pages) | Done |
| CPI composability | Done |
| Circuit breakers | Done |
| 48h timelock on manager transfer | Done |
| Immutable circuit breaker floor | Done |
| Security audit | Pending (~$50-100K) |
| Multisig via Squads | Post-audit |
| Mainnet launch | After audit |

## License

Apache 2.0

---

Built by [@psyto](https://x.com/psyto) / [Fabrknt](https://fabrknt.com)
