# Syntx — Composable Perp DEX on Solana

## Build Plan

### Vision

Syntx is the composable perpetual futures layer Solana is missing. Built on Anatoly Yakovenko's formally-verified Percolator risk engine, with battle-tested execution from Drift's matching engine, designed vault-first for programmatic strategies.

### Why Now

- Drift exploited for $285M (Apr 1, 2026) — TVL collapsed from $550M to $7.8M
- 20+ protocols lost their composable perps layer overnight
- Phoenix Perps, Bulk, Percolator Launch are months from maturity
- Jupiter perps is architecturally unsuitable for vault strategies (oracle-AMM, OI capped 1:1)
- Jito BAM is live (cancel-before-take for MMs), Alpenglow shipping (150ms finality)
- Zero composable, USDC-margined perp DEX exists on Solana right now

### Architecture

```
┌─────────────────────────────────────────────────┐
│                   Syntx Protocol                 │
│                                                  │
│  ┌───────────┐  ┌───────────┐  ┌──────────────┐ │
│  │ Matching   │  │ Percolator│  │ Vault        │ │
│  │ Engine     │  │ Risk      │  │ Program      │ │
│  │ (from Drift│  │ Engine    │  │ (native)     │ │
│  │  DLOB+AMM) │  │ (H + A/K)│  │              │ │
│  └─────┬──────┘  └─────┬────┘  └──────┬───────┘ │
│        │               │              │          │
│  ┌─────┴───────────────┴──────────────┴───────┐  │
│  │           Syntx Core Program               │  │
│  │  - Margin (isolated → cross in v2)         │  │
│  │  - Funding rate (continuous)               │  │
│  │  - Liquidation (Percolator-fair)           │  │
│  │  - Oracle (Pyth + confidence checks)       │  │
│  │  - Delegate system (for vaults)            │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  │
│  │ Keeper:    │  │ Keeper:    │  │ Keeper:     │  │
│  │ Filler     │  │ Liquidator │  │ Funding     │  │
│  └────────────┘  └────────────┘  └────────────┘  │
└─────────────────────────────────────────────────┘
         │                    │
         ▼                    ▼
   ┌──────────┐        ┌──────────────┐
   │ Kamino   │        │ Marginfi     │
   │ (lending)│        │ (lending)    │
   └──────────┘        └──────────────┘
```

### Fork Strategy

| Component | Source | License | What to take |
|-----------|--------|---------|-------------|
| Matching engine | Drift v2 | Apache 2.0 | DLOB + AMM hybrid, order types, auction mechanism |
| Risk engine | Percolator | Apache 2.0 | H (haircut ratio), A/K (lazy ADL), formal verification |
| Integration patterns | Percolator Launch | Reference | How to wire Percolator into a working product |
| Funding rate math | Drift v2 | Apache 2.0 | Continuous funding, TWAP, clamping |
| Margin calculations | Drift v2 | Apache 2.0 | Weighted collateral, maintenance margin |
| Oracle integration | Drift v2 | Apache 2.0 | Pyth pull oracle, confidence intervals |
| Keeper bots | Drift v2 | Apache 2.0 | Filler, liquidator, funding updater, oracle cranker |

---

## Phase 0: Foundation (Weeks 1-2)

### Goal
Fork Drift v2, strip to core perps, get it compiling.

### Tasks

1. **Fork drift-labs/protocol-v2**
   - Clone repo
   - Set up local Solana validator + Anchor build environment
   - Verify the unmodified program compiles and tests pass

2. **Strip non-essential modules**
   Remove:
   - Spot markets (`spot_market.rs`, `spot_balance.rs`, all spot controllers)
   - LP Pool system (`lp_pool.rs`, constituent management)
   - Insurance fund staking (`insurance_fund_stake.rs`)
   - Serum/Phoenix/OpenBook spot integrations
   - Fuel/points system
   - Signed message user system
   - Pyth Lazer oracle (keep standard Pyth)
   - High-leverage mode
   - Prediction market contract type
   - Revenue sharing system

   Keep:
   - `state/`: `user.rs`, `perp_market.rs`, `state.rs`, `oracle.rs`, `order_params.rs`
   - `controller/`: `orders.rs`, `funding.rs`, `position.rs`, `liquidation.rs`, `amm.rs`, `pnl.rs`
   - `math/`: `margin.rs`, `matching.rs`, `auction.rs`, `funding.rs`, `amm.rs`, `fees.rs`, `oracle.rs`, `orders.rs`, `liquidation.rs`
   - `validation/`: `order.rs`, `margin.rs`
   - `instructions/`: `user.rs`, `keeper.rs`, `admin.rs` (simplified)

3. **Simplify margin to isolated-only**
   - Remove cross-margin logic from `calculate_margin_requirement`
   - Each position has dedicated collateral
   - Simpler to audit, faster to ship

4. **Rename and rebrand**
   - Program name: `syntx`
   - New program ID (generate keypair)
   - Update all references

### Deliverable
Stripped Drift fork that compiles, ~40-50K LOC, perps-only, isolated margin, deploys to localnet.

---

## Phase 1: Percolator Integration (Weeks 3-5)

### Goal
Replace Drift's ADL and loss socialization with Percolator's formally-verified risk engine.

### Tasks

1. **Study Percolator internals**
   - Read spec.md and all source in aeyakovenko/percolator
   - Study dcccrypto/percolator-launch for integration patterns
   - Understand H ratio (haircut), A/K indices (lazy ADL), warmup reserves

2. **Integrate H (Haircut Ratio)**
   - Add global `h` state to Syntx program
   - `h = min(Residual, PNL_matured_pos_tot) / PNL_matured_pos_tot`
   - Apply haircut on withdrawal: `effective_pnl = floor(released_pnl * h)`
   - Replace Drift's insurance fund loss socialization
   - No user can ever withdraw more than exists on the balance sheet

3. **Integrate A/K (Lazy Side Indices)**
   - Replace Drift's ADL queue with Percolator's deterministic A/K system
   - `effective_pos(i) = floor(basis_i * A / a_basis_i)`
   - Three-phase recovery: DrainOnly → ResetPending → Normal
   - Settlement order-independent (no ranking needed)

4. **Port formal verification**
   - Set up Kani verifier in CI
   - Verify H and A/K invariants hold in Syntx's context
   - Add verification for new integration points

5. **Harden governance**
   - Timelock on all admin operations (48h minimum)
   - Reject durable nonce transactions for admin instructions
   - Strict oracle whitelist (prevent fake collateral attack vector)
   - Multisig with higher threshold (3-of-5 minimum)

### Deliverable
Syntx with formally-verified risk engine. Deploys to devnet. Core invariant: no user withdraws more than exists.

---

## Phase 2: Vault-Native Layer (Weeks 5-7)

### Goal
Build the vault/strategy infrastructure that makes Syntx composable.

### Tasks

1. **Delegate system**
   - Keep Drift's delegate mechanism (allows vault keepers to trade on behalf of depositors)
   - Clean up and simplify for vault-specific use cases
   - Vault keeper can: open/close positions, adjust collateral, rebalance
   - Vault keeper cannot: withdraw to external addresses

2. **Vault program (separate Solana program)**
   - Deposit/withdraw USDC
   - Share-based accounting (like Voltr/Ranger)
   - Vault manager (your keeper) operates as delegate
   - Performance fee + management fee structure
   - Withdrawal queue for large redemptions

3. **CPI interface for composability**
   - Clean CPI (Cross-Program Invocation) interface so external protocols can:
     - Open hedging positions programmatically
     - Query position state
     - Compose perps with lending (Kamino, Marginfi)
   - This is the KEY differentiator — what makes Syntx composable

4. **First vault strategy: Funding Rate Harvester**
   - Port your Yogi keeper logic
   - Long spot + short perp = collect funding
   - This runs on day one — Syntx is its own first customer

### Deliverable
Vault program deployed to devnet. Your funding rate strategy running as the first vault. CPI interface documented.

---

## Phase 3: Keeper Infrastructure (Weeks 7-8)

### Goal
Production-grade off-chain infrastructure.

### Tasks

1. **Strip Drift keeper bots to essentials**
   From Drift's 17 bot types, keep 4:
   - **Filler** — match and execute crossing orders
   - **Liquidator** — liquidate underwater accounts
   - **Funding rate updater** — hourly funding calculations
   - **Oracle cranker** — push Pyth prices on-chain

2. **Protocol-owned market making (HLP equivalent)**
   - Your vault IS the initial market maker
   - Keeper provides two-sided quotes on SOL-PERP, BTC-PERP, ETH-PERP
   - Funded by your own capital initially ($500-$1K)
   - Dynamic spread based on volatility regime (you've built this logic 3 times)

3. **Monitoring and alerting**
   - Health dashboard for all keeper processes
   - Dead man's switch (auto-close if keeper goes down)
   - Position tracking and PnL reporting
   - Deploy on AWS EC2 (same as Yogi)

4. **BAM plugin integration**
   - Leverage Jito BAM's cancel-before-take
   - Your market making keeper can cancel stale quotes before adverse fills
   - This is a material execution quality improvement

### Deliverable
4 keeper bots running on devnet. Protocol-owned MM vault providing liquidity. Monitoring live.

---

## Phase 4: Testnet + Security (Weeks 8-10)

### Goal
Battle-test on devnet, get audited, prepare for mainnet.

### Tasks

1. **Devnet stress testing**
   - 3 markets: SOL-PERP, BTC-PERP, ETH-PERP
   - Simulate liquidation cascades
   - Test Percolator's H ratio under extreme conditions
   - Test A/K recovery phases (DrainOnly → Normal)
   - Fuzz testing on all instruction handlers

2. **Invite displaced Drift builders**
   - Reach out to the 20+ protocols that lost their perps layer
   - Offer devnet access for integration testing
   - Key targets: vault builders, DN strategy teams, lending protocol integrators

3. **Security audit**
   - Minimum: 1 audit from a reputable firm (OtterSec, Neodyme, or Offside Labs)
   - Focus areas: margin calculations, liquidation logic, Percolator integration, admin controls
   - Budget: $100-200K (this is non-negotiable for a protocol holding user funds)
   - Consider: Percolator's formal verification reduces (but doesn't eliminate) audit surface

4. **Bug bounty program**
   - Launch on Immunefi
   - Critical: $50K+ (scale with TVL)
   - Start pre-mainnet to catch issues early

### Deliverable
Battle-tested devnet deployment. Audit report. Bug bounty live. Early integration partners testing.

---

## Phase 5: Token + Liquidity Bootstrap (Weeks 10-12)

### Goal
Launch SNTX token and bootstrap liquidity via the Hyperliquid playbook.

### Tasks

1. **SNTX token design**
   - SPL token on Solana
   - Total supply: TBD (deflationary via fee burns)
   - Utility:
     - Trading fee discounts (hold SNTX → reduced fees)
     - Staking → share of protocol revenue
     - Governance over market parameters
     - Vault boost (stake SNTX → higher vault yields)
   - NOT a security — utility token with real fee capture from day one

2. **Distribution strategy (Hyperliquid model)**
   - No VC raise initially — self-funded like Hyperliquid
   - Community airdrop to:
     - Displaced Drift users (wallet snapshot pre-exploit)
     - Early devnet testers
     - Vault depositors
   - Protocol-owned liquidity (your vault capital)
   - Team allocation with 2-year vesting

3. **Liquidity mining program**
   - Maker rewards in SNTX (incentivize tight quotes)
   - Trading rewards (volume-based, with anti-wash-trade measures)
   - Vault deposit rewards (TVL growth)
   - Time-limited: aggressive in month 1-3, tapering after

4. **Legal structure**
   - Entity outside Japan for token issuance (Japan crypto regulations are strict)
   - Terms of service excluding restricted jurisdictions
   - Token opinion letter (not a security)
   - This is critical and needs legal counsel — do not skip

### Deliverable
SNTX token launched. Airdrop distributed. Liquidity mining live. Legal structure in place.

---

## Phase 6: Mainnet Launch (Weeks 12-14)

### Goal
Go live on Solana mainnet.

### Tasks

1. **Guarded launch**
   - Deposit caps: $100K total initially
   - 3 markets only: SOL-PERP, BTC-PERP, ETH-PERP
   - Max leverage: 10x (conservative, increase later)
   - Your vault as primary liquidity source

2. **Progressive decap**
   - Week 1: $100K cap, internal + invited users only
   - Week 2: $500K cap, open to public
   - Week 4: $2M cap
   - Week 8: Remove caps based on audit + operational confidence

3. **Integrations**
   - Jupiter routing (if applicable for spot leg of strategies)
   - Kamino/Marginfi CPI composability live
   - SDK + documentation for vault builders

4. **Monitoring**
   - Real-time risk dashboard
   - Percolator H ratio tracking (vault health)
   - Market-level metrics (OI, funding, spreads)
   - Alert system for anomalies

### Deliverable
Syntx live on Solana mainnet. 3 markets. Your vault running. SNTX trading. Composable with Solana DeFi.

---

## Phase 7: Growth (Months 4-6)

### Goal
Scale liquidity, expand markets, attract builders.

### Tasks

1. **Market expansion**
   - Add markets based on demand (HYPE, JUP, JTO, BONK, WIF)
   - Permissioned initially → permissionless market creation later
   - Each new market needs oracle + risk parameter review

2. **Cross-margin (v2)**
   - Upgrade from isolated to cross-margin
   - Portfolio-level risk calculations
   - Capital efficiency improvement for multi-position strategies

3. **Builder ecosystem**
   - SDK grants for teams building vaults/strategies on Syntx
   - Hackathon sponsorship
   - Documentation + examples

4. **Protocol-owned liquidity scaling**
   - Scale vault capital from $1K → $100K → $1M
   - Add more vault strategies (DN, tilt, momentum)
   - Each strategy deepens liquidity

5. **External market makers**
   - Once volume justifies it, recruit professional MMs
   - BAM plugin support makes Syntx MM-friendly
   - Fee rebates for makers

---

## Resource Requirements

### Solo builder (you) — what's realistic

| Phase | Can you do it solo? | Notes |
|-------|-------------------|-------|
| Phase 0: Strip Drift | Yes | Tedious but mechanical |
| Phase 1: Percolator integration | Yes | Deepest technical work |
| Phase 2: Vault layer | Yes | Your core strength |
| Phase 3: Keepers | Yes | You've done this 3 times |
| Phase 4: Testing + audit | Need help | Audit firm required, ~$100-200K |
| Phase 5: Token | Need help | Legal counsel required |
| Phase 6: Mainnet | Yes | Guarded launch is manageable solo |
| Phase 7: Growth | Need help eventually | BD, marketing, more engineers |

### Budget estimate

| Item | Cost |
|------|------|
| Audit (1 firm) | $100-200K |
| Legal (entity + token opinion) | $30-50K |
| Infrastructure (AWS, RPC) | $500/month |
| Initial vault capital | $500-5K (your own) |
| Bug bounty reserve | $50K |
| **Total to mainnet** | **~$200-300K** |

### Funding options
- Self-fund through mainnet (Hyperliquid model)
- Solana Foundation grant (composable infra = aligned with their priorities)
- Small angel round post-devnet (show working product first)
- Revenue from day one (trading fees + vault performance fees)

---

## Timeline Summary

```
Week  1-2:   Phase 0 — Fork + strip Drift v2
Week  3-5:   Phase 1 — Percolator risk engine integration
Week  5-7:   Phase 2 — Vault-native layer
Week  7-8:   Phase 3 — Keeper infrastructure
Week  8-10:  Phase 4 — Devnet testing + audit
Week 10-12:  Phase 5 — SNTX token + liquidity bootstrap
Week 12-14:  Phase 6 — Mainnet launch
Month 4-6:   Phase 7 — Growth + expansion
```

**Target: Mainnet in ~14 weeks (~3.5 months) from start.**

---

## The Narrative

"Drift is dead. Jupiter can't serve builders. Phoenix and Bulk aren't here yet.

Syntx is the composable perp layer Solana needs — built on the Solana founder's formally-verified risk engine, with battle-tested execution, designed vault-first.

The syntax of composable finance."
