# Hackathon Submission Descriptions

Updated for Solana Frontier Hackathon (Apr 6 – May 11, 2026).

---

## Brief description (500 chars)

Syntx — Composable Exchange-Agnostic Vaults on Solana

Syntx is a developer ecosystem for perp vault infrastructure. Vaults route across any execution venue — Percolator, Phoenix, Jupiter Perps — through a VenueAdapter interface spanning 3 architectures (slab, CLOB, oracle-AMM). Other protocols compose via CPI: each integration is a distribution channel. 48h manager timelock, immutable circuit breaker floor. 15 Anchor instructions, 29 tests, live on devnet.

(487 chars)

---

## What are you building, and who is it for? (1000 chars)

Syntx is a composable exchange-agnostic vault layer — an ecosystem for developers, not just a product for traders.

Hyperliquid proved perps generate $600M+ in fees. But you can't build on top of it — positions are isolated, no CPI, bridges needed for everything. Syntx brings that level of vault infrastructure to Solana, where composability is the unforkable advantage.

Any Solana program calls cpi_trade in one atomic transaction. A lending protocol auto-hedges through a vault. A DAO treasury self-manages idle capital. Each developer who integrates brings their users into the vault ecosystem — distribution through composability, not marketing.

Vaults route across 3 fundamentally different DEX architectures through a single VenueAdapter interface. Depositors receive SPL share tokens usable as collateral across DeFi. 48-hour timelock on manager transfer. Immutable circuit breaker floor that can never be disabled.

Built for: developers who want composable perp access via CPI, strategy managers who want exchange-agnostic vault infrastructure, and protocols that need programmatic hedging.

(988 chars)

---

## Why did you decide to build this, and why build it now? (1000 chars)

Perpetual futures did $86 trillion in CEX volume last year. Decentralized perps grew 346% to $6.7 trillion. In traditional markets, Robinhood commands a higher market cap than Nasdaq — value accrues to the infrastructure layer above exchanges. Syntx is that layer for Solana perps.

We built this because we needed it ourselves. Running Yogi on Drift and Kodiak on Hyperliquid, we rebuilt identical vault infrastructure twice. When Drift was exploited, single-venue vaults lost access overnight. The vault layer should be separate from the execution layer.

Why now: Solana's Napster era is ending. The infrastructure is world-class — multiple perp venues, billions in volume. But every vault is locked to one DEX. Coinbase and Robinhood are bringing hundreds of millions of users on-chain. They need serious infrastructure, not fragmented single-venue tools.

The window for establishing the standard vault layer is open. Three high-quality venues exist. No one has built the shared infrastructure across them. We have.

(978 chars)

---

## What technologies are you using?

Anchor (0.30.1), Percolator, Phoenix V1 SDK, Jupiter Perps, Solana Web3.js, SPL Token, Next.js 16, React 19, Tailwind CSS 4, TypeScript, Vercel Analytics, Claude Code (Opus), Cargo-build-sbf

---

## Important GitHub repo context (500 chars)

The repo contains the complete Syntx product: Anchor vault program (15 instructions, 29 tests), keeper with 4 venue adapters (Percolator, Phoenix, Jupiter Perps, VenueRouter) spanning 3 architectures, TypeScript SDK, and Next.js frontend.

The VenueAdapter interface is the core innovation — adding a new DEX requires implementing 6 methods. See examples/cpi-caller for CPI integration and examples/venue-adapter for a DriftAdapter skeleton.

Devnet only. No token contracts.

(489 chars)

---

## Anything else judges should know? (500 chars)

This isn't our first vault. Yogi runs on Drift mainnet. Kodiak runs on Hyperliquid mainnet. We know the perps stack — both sides of the Solana vs appchain debate.

Hyperliquid is the best perp DEX. But it's a product for traders. Syntx is an ecosystem for developers — CPI is distribution, not just a feature. Each protocol that integrates brings its own users.

We studied the Drift exploit and proactively added 48h timelock + immutable circuit breaker floor before anyone asked.

(491 chars)

---

## How do you know people need this? (1000 chars)

Three signals:

First, we needed it ourselves. We rebuilt identical vault infrastructure on Drift and Hyperliquid — deposit logic, share accounting, keeper loops, risk management. Same patterns, from scratch each time. That's wasted engineering.

Second, the market proves demand. Hyperliquid vaults hold $36M+ (Liminal $30M, Harmonix $6M). Reflect won the Colosseum Radar grand prize building a delta-neutral stablecoin using the same funding rate yield source. Structured perp products are a validated category.

Third, a16z identifies "specialized liquidity provision / cross-venue inventory management" as a key emerging builder category in their perps thesis. That's literally what VenueRouter does — scoring venues by funding rate, liquidity, and cost, then routing to best execution.

The structural argument: as Solana's perp landscape fragments across more venues, the need for a shared vault layer grows with each new DEX. One venue means no problem. Three venues means every strategy manager rebuilds three times. Ten venues means the agnostic layer is inevitable.

(989 chars)

---

## How far along are you? (1000 chars)

Full stack deployed on Solana devnet with live keeper bot. End-to-end works: deposit USDC, receive SPL shares, keeper trades via venue adapters, withdraw with PnL.

Milestones:
- Anchor program: 15 instructions, 29 integration tests (LiteSVM)
- 4 venue adapters across 3 architectures: PercolatorAdapter (slab), PhoenixAdapter (CLOB), JupiterPerpsAdapter (oracle-AMM), VenueRouter (multi-venue scoring)
- Security: 48h timelock on manager transfer, immutable circuit breaker floor
- Frontend: 5 pages live at fabrknt.com/vaults, mobile-responsive
- SDK: complete (buildDepositTx, buildWithdrawTx, all 15 instruction builders)
- Examples: CPI caller (Anchor + TypeScript), venue adapter skeleton (Drift)

No external users yet — pre-mainnet. Strategy logic is battle-tested: Yogi (Drift mainnet) and Kodiak (Hyperliquid mainnet) run the same core logic in production.

Pre-mainnet blockers: security audit (~$50-100K), Squads multisig. Shipping unaudited to mainnet would be irresponsible.

(984 chars)

---

## Who else is building in this space? (1000 chars)

Hyperliquid ($600M+ fees): Best perp DEX, but a product for traders — not a developer ecosystem. No CPI, no composability with other protocols. Positions are isolated on their L1.

Venue-locked vault builders (Drift Vaults, Gauntlet): Great vaults but locked to one DEX. When that DEX has downtime, the strategy dies. Managers rebuild infrastructure per venue.

Reflect (Radar grand prize winner): Delta-neutral stablecoin using funding rates. Validated the yield source — but single-venue on its own infrastructure.

GLAM (Renaissance DeFi #2): On-chain asset management. Closest concept to Syntx but not exchange-agnostic.

What they all get wrong: treating the vault and the venue as one product. Syntx separates vault management from trade execution. The VenueAdapter interface means any new DEX is 6 methods away from integration — no strategy code changes. And CPI means every protocol that integrates becomes a distribution channel. That's an ecosystem, not a feature.

(985 chars)

---

## How do you make money? (500 chars)

Protocol-managed vaults: 2% annual management + 20% performance fee above high-water mark — enforced on-chain.

Third-party vault creators set their own fees. Syntx takes 0.5% protocol fee on all vaults.

Long-term: institutional CPI access fees. As more protocols integrate via cpi_trade, the vault layer becomes infrastructure — and infrastructure charges access fees.

Value accrues to the layer above exchanges (Robinhood > Nasdaq). Syntx is that layer.

(452 chars)
