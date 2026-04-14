# Syntx — Composable Exchange-Agnostic Vaults on Solana

> **Built for the [Solana Frontier Hackathon](https://www.colosseum.org/frontier) (Apr 6 – May 11, 2026)**

Deposit USDC. Earn 8-15% APY from funding rate yield. Your capital routes across the best perp venue automatically. If one venue goes down, your yield doesn't stop.

**Live on devnet:** [fabrknt.com/vaults](https://fabrknt.com/vaults)  
**GitHub:** [github.com/psyto/syntx](https://github.com/psyto/syntx)

---

## Why This Exists

Drift was the only place on Solana where you could compose perps with lending, spot, and yield strategies in one stack. When Drift was exploited in April 2026, single-venue vaults lost access to their entire composable stack overnight.

Composable perps can't depend on one protocol. The composable layer needs to survive any single venue failing. That's why Syntx exists — a vault layer that routes across every venue, so your strategy never dies with a single DEX.

## What Users Get

**Deposit USDC → earn yield → withdraw anytime.** The vault keeper harvests funding rates across perp venues. Your shares are SPL tokens — usable as collateral across DeFi automatically.

## How It Works

```
Depositors ──→ Syntx Vault (PDA) ──→ VenueRouter ──→ Percolator (perp)
                    │                      │      ──→ Phoenix (spot)
               SPL Shares                  │      ──→ Jupiter Perps (perp)
               Fee accounting              │      ──→ + any new venue
               Circuit breakers            │
                    │                      └── Scores by: funding rate,
DeFi Protocols ────CPI────→ cpi_trade          liquidity, cost
```

1. **Depositors** deposit USDC, earn 8-15% APY from funding rate yield
2. **VenueRouter** scores each DEX and routes trades to best execution
3. **Vault shares** are SPL tokens — work as collateral on Kamino, Marginfi, anywhere
4. **Developers** compose via CPI — any Solana program calls `cpi_trade` in one atomic transaction

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

## Product vs Ecosystem

Hyperliquid is the best perp DEX — $600M+ fees, best execution. But it's a **product for traders**. You can't build on top of it. You can't CPI into a Hyperliquid vault. Your position can't be collateral on a lending protocol.

Syntx is an **ecosystem for developers**. If Solana can't compose its perp protocols with the rest of DeFi, it's just a faster Ethereum. The whole point of Solana is that the ecosystem is stronger than any single protocol.

| Product (Hyperliquid) | Ecosystem (Syntx on Solana) |
|---|---|
| Best execution, isolated positions | Exchange-agnostic routing across venues |
| Developers can deploy markets | Developers can build on top of vaults via CPI |
| Users come to the DEX directly | Users come through every protocol that integrates |
| Can't use position as collateral | Vault shares are SPL tokens — usable across DeFi |
| Bridges needed for cross-protocol | Atomic in one transaction |
| One venue goes down = strategy dies | Routes to next venue automatically |

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

**Status:** Full end-to-end working on devnet — faucet, create vault, deposit, withdraw, one-click compose. All from the browser.

**Honest assessment:** Syntx is unaudited. 32 tests pass but tests != audit. Security audit (~$50-100K) is required before mainnet.

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
│   └── tests/integration.rs    # 32 LiteSVM tests
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
