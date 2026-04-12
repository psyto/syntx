# Syntx Business Plan

## Positioning

Syntx is the vault management layer for Solana perps — like Stripe for payments, but for perp execution. Works WITH venues (Phoenix, Percolator, Jupiter Perps), not against them. Strategy managers deploy once, route everywhere.

## Revenue Model

**Protocol-managed vaults:**
- 2% annual management fee on AUM
- 20% performance fee above high-water mark
- Enforced on-chain — no off-chain trust required

**Third-party vault creators:**
- Set their own fee structure
- Syntx takes 0.5% protocol fee on all vaults

**Future:**
- Institutional CPI access fees for protocols integrating vault infrastructure
- Premium analytics for vault managers (strategy performance, venue comparison)

## Total Addressable Market

- Solana daily perp volume: $1-3B across Drift, Jupiter Perps, and growing
- Hyperliquid vault TVL: $36M+ (Liminal $30M, Harmonix $6M) — proves demand
- Structured DeFi products on Solana: nascent but growing with JLP ($500M+)
- Protocol treasury hedging: every Solana protocol with SOL treasury exposure needs this

Even 1% of Solana perp TVL at 2% management fee = meaningful revenue at scale.

## Competitive Advantage

1. **Exchange-agnostic** — only vault layer that routes across multiple venues. Competitors are venue-locked.
2. **Infrastructure moat** — 29 published @fabrknt/* packages, 5 Percolator matchers, proven strategy logic
3. **Battle-tested** — same strategy code runs on Drift mainnet (Yogi) and Hyperliquid mainnet (Kodiak)
4. **CPI-native** — other protocols compose atomically, not through bridges or oracles
5. **Formally verified execution** — Percolator's H ratio mathematically prevents insolvency

## Go-to-Market

| Phase | Timeline | Milestone |
|---|---|---|
| Devnet launch | Done | 2 vaults, keeper live, frontend deployed |
| Security audit | Q3 2026 | Fund via hackathon/grant ($50-100K) |
| Guarded mainnet | Q3 2026 | $100K deposit cap, invited managers only |
| Progressive decap | Q4 2026 | Open to all managers, raise cap |
| Multi-venue expansion | Q4 2026 | Add Jupiter Perps, Drift as venue adapters |

## Team

**Hiroyuki Saito** — Solo founder, Tokyo

- 15 years at Shinsei Bank (now SBI Shinsei) — PM and engineer for retail banking systems
- Head of Business Promotion at SBI R3 Japan (enterprise blockchain)
- Built and operates Yogi (Drift mainnet) and Kodiak (Hyperliquid mainnet)
- 29 published npm packages, 5 custom Percolator matchers
- Waseda University (Econometrics), Stanford Online (Blockchain), AWS Certified

## What We Need

- **Security audit funding** ($50-100K) — non-negotiable before mainnet
- **Accelerator support** — Colosseum network for distribution, hiring, fundraising
- **First institutional integrators** — lending protocol or treasury management partner for CPI validation

## Why Now

Solana's Napster era is ending. The infrastructure is world-class — but the application layer doesn't match. Coinbase and Robinhood are bringing hundreds of millions of users on-chain. Hyperliquid proved that serious trading infrastructure generates $600M+ annualized fees on its own L1, without Solana's composability advantage.

Solana's perp landscape is fragmenting: Phoenix Perps launching Q2 2026, Jupiter Perps live, Percolator composable, Drift established. For the first time, there are multiple high-quality venues — but no shared vault layer. The next wave of users expects institutional-grade experiences, not fragmented single-venue tools.

The window for establishing the standard vault infrastructure is open now. Syntx is positioned to be that layer — composable, exchange-agnostic, built to last.
