# Syntx — Shielded Cross-Venue Perp Execution on Solana

> **Built for the [Solana Frontier Hackathon](https://www.colosseum.org/frontier) (Apr 6 – May 11, 2026)**

Your perp trade is encrypted. The solver routes it across Jupiter Perps, Percolator, and Drift for best execution. No one sees your order until it fills.

The same VenueAdapter infrastructure powers structured product vaults — a principal-protected SOL vault (delta hedge + Kamino lending) and a funding rate harvest vault.

**Live:** [fabrknt.com/vaults](https://fabrknt.com/vaults)
**GitHub:** [github.com/psyto/syntx](https://github.com/psyto/syntx)

---

## What Syntx Does

### 1. Shielded Perp Intents
Submit an encrypted trading intent. The solver decrypts, scores venues, splits the order, and fills at the best blended price. NaCl box encryption (Curve25519-XSalsa20-Poly1305). On-chain privacy matcher. Real TradeCpi execution.

### 2. Structured Product Vaults
- **Principal Protected SOL** — Kamino lending (yield for protection) + delta-hedged Jupiter Perps position (Black-Scholes option replication). After 30 days, you get back at least your deposit.
- **SOL Funding Rate** — Collects perpetual funding rate payments across any venue.

### 3. Composable Vault Layer
VenueAdapter interface — implement 6 methods to add any DEX. The strategy and routing code stays unchanged. Five adapters: Percolator, Jupiter Perps, Phoenix, Kamino, VenueRouter.

### Vault fees: known limitation
`collect_fees` charges the **management fee only**. The performance fee (`performance_fee_bps`) is stored but **not charged**: it needs the vault's trading gains, which sit in the Percolator slab, and the program cannot read them reliably yet (the slab layout is not a Rust dependency of this repo, the slab `pnl` field is realized PnL only, and `percolator_program` is chosen by the manager at init). The fee base is computed on-chain from `total_deposits` (capped by the vault's own collateral balance for standalone vaults); the manager cannot pass an equity value. Charging a performance fee needs a pinned Percolator program and a versioned slab layout first.

### Upgrading an existing deployment
`VaultState` keeps its layout, so existing vaults stay readable. For clients and existing vaults:
- `collect_fees` takes no argument and needs the vault's collateral token account after the manager share account (`createCollectFeesIx({ manager, vaultPda, shareMint, managerShares, vaultCollateral })`). Rebuild keepers and scripts that called it with an equity value.
- `high_water_mark` is now a per-share price (1e6 fixed point). Vaults created by an earlier build hold a value in the old unit; it is informational only while the performance fee is not charged.
- `init_vault` / `init_vault_standalone` require the share mint to have supply 0, the vault PDA as mint authority and no freeze authority.

## Architecture

```
User Intent (encrypted)
  → Solver (decrypt + validate)
    → IntentRouter (score venues + split order)
      → VenueAdapter (execute on each venue)
        ├── Percolator (slab-based risk engine)
        ├── Jupiter Perps (oracle-based AMM)
        ├── Phoenix (CLOB orderbook)
        ├── Kamino (USDC lending)
        └── + any new venue

Structured Product Vault
  → Keeper (strategy loop)
    ├── KaminoAdapter → deposit USDC (lending yield)
    └── JupiterPerpsAdapter → delta hedge (Black-Scholes)
```

## Running Locally

```bash
# 1. Start local validator with all programs
solana-test-validator \
  --bpf-program AHS7CyMJwSbt6P2oRJxxuG3f2rKETbJjgsiWXCchpkrL percolator-prog/target/deploy/percolator_prog.so \
  --bpf-program B2GB1aku91TAm2eRs3AAYiC9d5Xo35TdnbdA1mtqYuTG percolator-fabrknt/target/deploy/privacy_matcher.so \
  --bpf-program 53r6bg7JBFqf5Jfs7fe4kHDtwXwUgDWoLarYrsWcoF1V syntx/target/deploy/syntx_vault.so \
  --reset

# 2. Setup intent pipeline (creates slab, LP, user, matcher, oracle)
cd keeper && SOLANA_RPC_URL=http://localhost:8899 npx ts-node src/setup-intent.ts

# 3. Start frontend
cd app && npm run dev

# 4. Open http://localhost:3000/vaults/trade and submit an intent
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Vault Program | Anchor 0.30.1, Rust, Solana SDK 1.18 |
| Privacy Matcher | Solana native, NaCl box, Blake3 |
| Risk Engine | Percolator (formally verified) |
| Keeper | TypeScript, 3 strategies (funding rate, structured, intent) |
| Frontend | Next.js 16, React 19, Tailwind CSS 4 |
| SDK | TypeScript, @solana/web3.js |
| Tests | LiteSVM, 32+ integration tests |

## Key Files

| File | What it does |
|------|-------------|
| `programs/syntx-vault/src/lib.rs` | 18 Anchor instructions (standalone + Percolator modes) |
| `keeper/src/venues/types.ts` | VenueAdapter interface (6 methods) |
| `keeper/src/intent-router.ts` | Cross-venue scoring + order splitting |
| `keeper/src/delta-hedge-strategy.ts` | Black-Scholes delta/gamma + rebalance logic |
| `keeper/src/structured-keeper.ts` | Dual-venue keeper (Kamino + Jupiter Perps) |
| `keeper/src/setup-intent.ts` | Full intent pipeline setup (8 steps) |
| `app/src/app/trade/page.tsx` | Shielded intent submission UI |
| `app/src/app/earn/page.tsx` | Tabbed vault deposit/withdraw |
| `app/src/app/build/page.tsx` | Strategy configurator |

## Why This Exists

Cross-venue spot routing exists (Jupiter, 1inch). Cross-venue perp routing with privacy does not exist anywhere.

We run funding rate vaults on Drift (Yogi, mainnet) and Hyperliquid (Kodiak, mainnet). When Drift was exploited, single-venue vaults lost everything overnight. Syntx is the architecture we wished existed.

## Built by

[@psyto](https://x.com/psyto) — Tokyo, Japan

AI pair programmer: Claude Code (Opus 4.6)
