# Hackathon Submission Descriptions

Updated for Solana Frontier Hackathon (Apr 6 – May 11, 2026).

---

## Brief description (500 chars)

Syntx — Composable Exchange-Agnostic Vaults on Solana

Deposit USDC, earn 8-15% APY from funding rate yield. Capital routes across Percolator, Phoenix, and Jupiter Perps — 3 DEX architectures, best execution. If one venue goes down, your yield doesn't stop.

Born from frustration: Drift was the only composable perp venue on Solana. When it was exploited, single-venue vaults lost everything. Syntx is the vault layer that survives any single DEX failing.

15 instructions, 29 tests, live on devnet.

(497 chars)

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

Drift was the only place on Solana where I could compose perps with lending, spot, and yield strategies. I built Yogi there — a funding rate vault, live on mainnet, profitable. When Drift was exploited in April 2026, I lost access to my entire composable stack overnight. Not just positions — the whole infrastructure disappeared.

That's when I realized: composable perps can't depend on one protocol. I had already rebuilt the same vault infrastructure on Hyperliquid (Kodiak) — deposit logic, share accounting, keeper loops, risk management — all from scratch. Three times building the same thing on three different venues.

Why now: Solana has Percolator, Phoenix, Jupiter Perps, and eventually Drift again. For the first time, there are multiple high-quality perp venues. But without a shared vault layer, every strategy manager rebuilds for each DEX, and every vault dies when its single venue goes down.

Syntx exists so that never happens again. One vault layer, any venue. Your yield doesn't stop.

(985 chars)

---

## What technologies are you using?

Anchor (0.30.1), Percolator, Phoenix V1 SDK, Jupiter Perps, Solana Web3.js, SPL Token, Next.js 16, React 19, Tailwind CSS 4, TypeScript, Vercel Analytics, Claude Code (Opus), Cargo-build-sbf

---

## Access instructions

1. Switch Phantom wallet to **Devnet** (Settings → Developer Settings → Change Network → Devnet)
2. Visit **fabrknt.com/vaults**
3. Connect wallet — Phantom may show "This dApp could be malicious." This is normal for devnet apps. Click **"Proceed Anyway"** to continue.
4. Click **"Vaults"** in the nav
5. Click **"Get Test USDC"** — mints 100 test USDC + 0.05 SOL for gas to your wallet (one click, no setup needed)
6. Click a vault (e.g., **SOL Funding Rate**) to expand
7. Enter an amount and click **Deposit** — approve in Phantom
8. See your shares appear, toast notification with Explorer link
9. Try **Withdraw** with a dollar amount — auto-converts to shares
10. Visit **Compose** to see the architecture diagram and CPI interface

Note: Devnet RPC can be slow. If a page shows an error, click Retry. The faucet is rate-limited to once per 5 minutes per wallet.

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
