# Syntx Build Plan

## Vision

Syntx is the composable perpetual futures layer Solana is missing. Built on Anatoly Yakovenko's formally-verified Percolator risk engine, designed vault-first for programmatic strategies.

## Why Now

- Drift exploited for $285M (Apr 1, 2026) — TVL collapsed from $550M to $7.8M
- 20+ protocols lost their composable perps layer overnight
- Phoenix Perps, Bulk, Percolator Launch are months from maturity
- Jupiter perps is architecturally unsuitable for vault strategies (oracle-AMM, OI capped 1:1)
- Jito BAM is live (cancel-before-take for MMs), Alpenglow shipping (150ms finality)
- Zero composable, USDC-margined perp DEX exists on Solana right now

## What Already Exists (Anatoly's Stack)

| Component | Repo | Status |
|-----------|------|--------|
| Risk engine (H ratio, A/K ADL) | aeyakovenko/percolator | Complete, formally verified (Kani) |
| Solana program (4.7K LOC) | aeyakovenko/percolator-prog | Complete, 41K LOC tests |
| CLI/SDK | aeyakovenko/percolator-cli | Complete |
| Reference matcher | aeyakovenko/percolator-match | Complete |
| Staking/rewards | aeyakovenko/percolator-meta | Complete |
| Stress testing | aeyakovenko/percolator-stress-test | Complete |

## What We Build (Syntx Layer)

| Component | Repo | Status |
|-----------|------|--------|
| Custom matchers (vol, event, macro, jpy, privacy) | psyto/percolator-fabrknt | Complete, 5 matchers on devnet |
| Vault program (share-based, manager trading) | syntx/programs/syntx-vault | **To build** |
| Keeper bots (crank, liquidator, strategy) | syntx/keeper | **To build** |
| TypeScript SDK | syntx/sdk | **To build** |
| Frontend | syntx/app | **To build** |
| SNTX token | TBD | **To build** |

---

## Phase 0: Foundation (Week 1)

### Goal
Project setup, Anchor scaffold, Percolator integration verified.

### Tasks
1. Initialize Anchor workspace with syntx-vault program
2. Add percolator and percolator-prog as dependencies
3. Define VaultState account structure
4. Implement InitVault instruction
   - Create vault PDA
   - Create share mint (vault PDA as mint authority)
   - Create USDC token account
   - CPI: Percolator `InitUser` (vault PDA as owner)
5. Write integration test: init vault → verify Percolator account created with vault PDA as owner
6. Deploy to localnet and verify

### Deliverable
Vault program deploys, creates Percolator account owned by vault PDA.

---

## Phase 1: Core Vault (Weeks 2-3)

### Goal
Users can deposit/withdraw. Keeper can trade.

### Tasks

**Deposit**
1. User sends USDC to vault
2. CPI: Percolator `DepositCollateral` (vault PDA signs)
3. Calculate share price from vault equity
4. Mint share tokens to user
5. Update vault state

**Withdraw**
1. User burns share tokens
2. CPI: Percolator `WithdrawCollateral` (vault PDA signs)
3. Transfer USDC to user
4. Update vault state

**ManagerTrade**
1. Verify signer is vault's manager
2. CPI: Percolator `TradeNoCpi` or `TradeCpi` (vault PDA signs as account owner)
3. Manager can open/close positions, adjust size

**ManagerCrank**
1. CPI: Percolator `KeeperCrank` — settle funding, update state

**Share Price Calculation**
- Read Percolator account: capital + pnl + mark_pnl (position * (oracle - entry))
- share_price = vault_equity / total_shares

### Tests
- Deposit → verify shares minted correctly
- Withdraw → verify USDC returned, shares burned
- ManagerTrade → verify Percolator position opens
- Share price accuracy after trades/funding

### Deliverable
Working vault on devnet. Users deposit, keeper trades, users withdraw with PnL.

---

## Phase 2: Keeper Bot (Weeks 3-4)

### Goal
24/7 keeper running strategy via vault.

### Tasks

1. **Wrap percolator-cli commands into continuous keeper**
   - Periodic crank (funding settlement)
   - Liquidation monitoring
   - Oracle price pushing

2. **Port Yogi strategy logic**
   - Funding rate monitoring across markets
   - Entry/exit signals (anomaly detection)
   - Position sizing based on vault equity
   - Regime-based deployment (vol regime → deployment %)

3. **Protocol-owned market making**
   - Register vault as LP on Percolator (via InitLP)
   - Use vol-matcher from percolator-fabrknt
   - Two-sided quotes at configurable spread
   - Dynamic spread based on volatility

4. **Monitoring**
   - Health dashboard
   - Dead man's switch
   - Position tracking and PnL reporting
   - Deploy on AWS EC2

### Deliverable
Keeper running 24/7 on devnet. Strategy vault + LP vault both active.

---

## Phase 3: Fees + Multi-Market (Weeks 4-5)

### Goal
Fee collection, multiple markets, vault management.

### Tasks

**Fee System**
1. Performance fee (e.g., 20% of profits above high water mark)
2. Management fee (e.g., 2% annual, accrued per-second)
3. Fee shares minted to manager (dilutive model)
4. High water mark tracking

**Multi-Market Support**
1. Deploy Percolator slabs for SOL-PERP, BTC-PERP, ETH-PERP
2. Each vault can target a specific market
3. Market registry in SDK for discovery

**Vault Management**
1. Deposit caps (guarded launch)
2. Emergency pause
3. Withdrawal queue for large redemptions
4. UpdateManager instruction

### Deliverable
Multiple markets live on devnet. Vault collecting fees. Deposit caps enforced.

---

## Phase 4: SDK + Frontend (Weeks 5-7)

### Goal
TypeScript SDK and trading frontend.

### Tasks

**SDK (syntx/sdk)**
1. Vault instructions: deposit, withdraw, getSharePrice
2. Market data: positions, funding rates, oracle prices
3. Read helpers: vault equity, share price, PnL
4. Wrap percolator-cli patterns

**Frontend (syntx/app)**
1. Next.js app
2. Wallet connection (Solana wallet adapter)
3. Market overview (SOL, BTC, ETH perps)
4. Vault deposit/withdraw UI
5. Position tracking for strategy vaults
6. Share price chart
7. Reference: percolatorlaunch.com (dcccrypto/percolator-launch) for UI patterns

### Deliverable
Working frontend on devnet. Users can deposit/withdraw via browser.

---

## Phase 5: Security (Weeks 7-8)

### Goal
Audit, stress test, bug bounty.

### Tasks

1. **Internal review**
   - Fuzz testing on vault instructions
   - Edge cases: zero shares, max deposits, concurrent withdrawals
   - Verify CPI interactions with Percolator are safe

2. **Stress testing**
   - Use aeyakovenko/percolator-stress-test as reference
   - Simulate liquidation cascades through vault
   - Test H ratio behavior under extreme conditions

3. **Security audit**
   - Scope: syntx-vault program only (Percolator already has Kani proofs)
   - Target firms: OtterSec, Neodyme, Offside Labs
   - Budget: $50-100K (vault program is small — ~2-3K LOC)

4. **Bug bounty**
   - Launch on Immunefi pre-mainnet
   - Critical: $50K+ (scale with TVL)

5. **Invite Drift refugees**
   - Reach out to displaced protocols
   - Offer devnet access for integration testing

### Deliverable
Audit report. Bug bounty live. Early integration partners testing.

---

## Phase 6: SNTX Token + Liquidity Bootstrap (Weeks 8-10)

### Goal
Launch token, bootstrap liquidity via Hyperliquid playbook.

### Tasks

**SNTX Token Design**
- SPL token on Solana
- Utility:
  - Trading fee discounts (hold SNTX → reduced fees)
  - Staking → share of protocol revenue
  - Governance over market parameters
  - Vault boost (stake SNTX → higher vault yields)
- Fee burn mechanism (deflationary)
- Real fee capture from day one

**Distribution (Hyperliquid Model)**
- No VC raise initially — self-funded
- Community airdrop to:
  - Displaced Drift users (wallet snapshot pre-exploit)
  - Early devnet testers
  - Vault depositors
- Protocol-owned liquidity (keeper vault capital)
- Team allocation with 2-year vesting

**Liquidity Mining**
- Maker rewards in SNTX
- Trading rewards (volume-based, anti-wash-trade)
- Vault deposit rewards (TVL growth)
- Tapering schedule: aggressive month 1-3, declining after

**Legal**
- Entity outside Japan for token issuance
- Terms of service excluding restricted jurisdictions
- Token opinion letter
- Legal counsel required — do not skip

### Deliverable
SNTX token launched. Airdrop distributed. Liquidity mining live.

---

## Phase 7: Mainnet Launch (Weeks 10-12)

### Goal
Go live on Solana mainnet.

### Tasks

1. **Guarded launch**
   - Deposit caps: $100K total initially
   - 3 markets: SOL-PERP, BTC-PERP, ETH-PERP
   - Max leverage: 10x (conservative, increase later)
   - Keeper vault as primary liquidity source

2. **Progressive decap**
   - Week 1: $100K cap, invited users only
   - Week 2: $500K cap, open to public
   - Week 4: $2M cap
   - Week 8: Remove caps

3. **Integrations**
   - CPI composability with Kamino/Marginfi
   - SDK + documentation for vault builders
   - Percolator-meta staking integration

4. **Monitoring**
   - Real-time risk dashboard
   - Percolator H ratio tracking
   - Market metrics (OI, funding, spreads)

### Deliverable
Syntx live on Solana mainnet. 3 markets. Vaults running. SNTX trading.

---

## Phase 8: Growth (Months 4-6)

### Tasks
1. Market expansion (HYPE, JUP, JTO, BONK, WIF)
2. Cross-margin vault (portfolio netting across slabs)
3. Builder ecosystem (SDK grants, hackathon sponsorship)
4. Protocol-owned liquidity scaling ($1K → $100K → $1M)
5. External market maker recruitment
6. BAM plugin integration for cancel-before-take

---

## Timeline Summary

```
Week 1:      Phase 0 — Foundation (Anchor + Percolator integration)
Week 2-3:    Phase 1 — Core vault (deposit/withdraw/trade)
Week 3-4:    Phase 2 — Keeper bot (strategy + protocol-owned MM)
Week 4-5:    Phase 3 — Fees + multi-market
Week 5-7:    Phase 4 — SDK + frontend
Week 7-8:    Phase 5 — Security audit + stress test
Week 8-10:   Phase 6 — SNTX token + liquidity bootstrap
Week 10-12:  Phase 7 — Mainnet launch
Month 4-6:   Phase 8 — Growth + expansion
```

**Target: Mainnet in ~12 weeks (~3 months) from start.**

---

## Budget Estimate

| Item | Cost |
|------|------|
| Audit (vault program only) | $50-100K |
| Legal (entity + token opinion) | $30-50K |
| Infrastructure (AWS, RPC) | $500/month |
| Initial vault capital | $500-5K (own capital) |
| Bug bounty reserve | $50K |
| **Total to mainnet** | **~$150-250K** |

---

## The Narrative

Anatoly built the engine. We built the product.

Syntx is the composable perp layer Solana needs — powered by the Solana founder's formally-verified risk engine, designed vault-first, with protocol-owned liquidity from day one.

The syntax of composable finance.
