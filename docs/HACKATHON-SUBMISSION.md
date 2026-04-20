# Syntx — Colosseum Hackathon Submission Form

> Last updated: 2026-04-18
> Character limits noted per field. Keep within limits when editing.

---

## Project name (public)

Syntx

## Brief description (500 char, public)

Syntx — Shielded Cross-Venue Perp Execution on Solana

Syntx encrypts your perp trading intent and routes it across multiple venues (Jupiter Perps, Percolator, Phoenix) for best execution — no MEV, no frontrunning. The same VenueAdapter infrastructure powers structured product vaults: a principal-protected SOL vault and a funding rate harvest vault. Privacy matcher on-chain, NaCl box encryption, real TradeCpi execution. 5 venue adapters, standalone vault mode, live on devnet.

## Project website (public)

https://fabrknt.com/vaults

## What are you building, and who is it for? (1000 char)

Syntx is a shielded cross-venue perp execution layer on Solana. Users submit encrypted trading intents — the solver decrypts, scores venues by funding rate and liquidity, splits the order across Jupiter Perps, Percolator, and Phoenix, and fills at the best blended price. No one sees the order before execution. NaCl box encryption (Curve25519-XSalsa20-Poly1305), on-chain privacy matcher, real TradeCpi through Percolator's risk engine.

The same VenueAdapter interface powers structured product vaults. A principal-protected SOL vault splits capital between Kamino lending and a delta-hedged Jupiter Perps position (Black-Scholes replication). A funding rate harvest vault collects payments across any venue. Both use standalone vault mode — pure SPL transfers, no venue lock-in.

Built for: every perp trader who loses to MEV, strategy managers who want venue-agnostic vault infrastructure, and DeFi protocols that need composable perp access via CPI — all in atomic Solana transactions.

## Why did you decide to build this, and why build it now? (1000 char)

Cross-venue spot routing exists (Jupiter, 1inch). Cross-venue perp routing with privacy does not exist anywhere. Every large perp trade on Solana gets worse execution than it should — visible on-chain, frontrun by MEV bots, stuck on a single venue.

We run funding rate vaults on Drift (Yogi, mainnet) and Hyperliquid (Kodiak, mainnet). When Drift was exploited, single-venue vaults lost everything overnight. That proved venue lock-in is an existential risk, not a convenience problem.

Why now: Jupiter Perps has deep liquidity and low fees — the execution quality problem that killed Friktion's structured products is solved. Solana is fast enough for delta hedging (400ms slots). The privacy matcher enables encrypted intents without trusted intermediaries. And Solana's perp landscape is fragmenting — Phoenix, Jupiter, Percolator, Drift — creating the market for cross-venue infrastructure.

## What technologies are you using or integrating with? 

Anchor (0.30.1), Percolator risk engine, Privacy matcher (NaCl box / Curve25519-XSalsa20-Poly1305), Phoenix V1 SDK, Jupiter Perps SDK, Kamino klend-sdk, Solana Web3.js, SPL Token, Black-Scholes delta hedging, Next.js 16, React 19, Tailwind CSS 4, TypeScript, LiteSVM, Claude Code (Opus 4.6), Cargo-build-sbf

## Category (public)

DeFi

## GitHub link (public)

https://github.com/psyto/syntx

## Important context about your repo (500 char)

Complete product: Anchor vault program (standalone + Percolator modes), privacy matcher integration, TypeScript SDK, keeper bot (funding rate + structured product + intent strategies), and Next.js frontend (Trade | Earn | Build).

Core innovation: IntentRouter + VenueAdapter pattern — same interface routes shielded intents and vault strategies across any venue. Delta hedge strategy (Black-Scholes) for principal-protected vaults. Privacy matcher executes real TradeCpi on-chain.

## Demo video

https://

## Live product link

https://fabrknt.com/vaults

## Pitch video (public)

https://

## Team location (public)

Japan

## Is there anything else judges should know? (500 char)

This isn't our first vault. Yogi runs live on Drift. Kodiak runs live on Hyperliquid. We built 5 custom Percolator matchers and maintain 29 @fabrknt/* infrastructure packages.

The shielded intent angle is genuinely novel, cross-venue perp routing with privacy doesn't exist anywhere. The privacy matcher is deployed and TradeCpi executes on-chain. The delta hedge strategy (Black-Scholes option replication via perps) is the first on Solana since Friktion — enabled by Jupiter Perps maturity.

## How do you know people need this? (1000 char)

We know because we needed it ourselves. Running Yogi on Drift and Kodiak on Hyperliquid, we rebuilt the same vault infrastructure twice — and every large trade got worse execution from MEV frontrunning on a single venue.

The April 2026 Drift exploit proved single-venue dependency is existential risk. Multi-venue routing isn't a nice-to-have; it's survival.

CoW Protocol (Ethereum spot) processes $2B/month through intent-based routing. UniswapX uses intents for MEV protection. Neither exists for perps. The perp market is 6-8x larger than spot — $7 trillion/month. Cross-venue perp routing with privacy is an unaddressed market.

Market signal for structured products: Friktion hit $300M TVL before shutting down — demand for on-chain structured products is proven. They failed because options infrastructure was broken. Jupiter Perps now provides the execution quality needed for delta hedging.

Syntx routes across venues AND adds structured products. Bigger market, better architecture.

## How far along are you? (1000 char)

Full stack working end-to-end on devnet and localnet:

On-chain programs:
- Syntx vault: 18 instructions (deposit/withdraw standalone + Percolator modes), 32+ tests
- Percolator risk engine: synced and rebuilt
- Privacy matcher: deployed, real TradeCpi executed on localnet

Keeper strategies:
- Funding rate harvest (venue-agnostic, production-tested)
- Structured product (Kamino lending + delta-hedged Jupiter Perps)
- Intent router (cross-venue scoring, proportional order splitting)

Venue adapters: Percolator, Jupiter Perps, Phoenix, Kamino, VenueRouter

Frontend (Trade | Earn | Build):
- Trade: shielded intent submission with venue allocation visualization
- Earn: tabbed vaults (Principal Protected SOL + Funding Rate), deposit/withdraw
- Build: interactive strategy configurator (pick strategy × venues × params)

No external users — pre-mainnet. Strategy logic battle-tested: Drift and Hyperliquid mainnet.

Pre-mainnet blockers: security audit (~$50-100K), multisig, legal entity.

## Who else is building, what are they getting wrong? (1000 char)

Intent-based trading (CoW Protocol, UniswapX): Spot only. No perps. No cross-venue execution for derivatives. $7T/month perp market is completely unaddressed by intent infrastructure.

Venue-specific vaults (Drift Vaults, Jupiter LP): Locked to one DEX. When that DEX has downtime or exploit, vaults are stuck. Strategy managers rebuild infrastructure per venue.

Yield vaults (Liminal, Harmonix on Hyperliquid): Simple funding rate strategies, no composability, no structured products. Other protocols can't CPI into their vaults.

Structured product protocols (Friktion — dead, Ribbon — declining): Sold covered calls using options. Failed because on-chain options infrastructure was broken. Syntx replicates option payoffs via delta hedging on perps.

Everyone treats the vault and the venue as one product. Syntx separates execution (which DEX) from management (deposits, shares, risk). The VenueAdapter pattern is the key — same interface routes shielded intents AND vault strategies.

## How do you make money? (500 char)

Two revenue streams:

1. Intent routing fees: bps on every routed trade volume. $1B/month × 2bps = $2.4M/year. Scales with volume, not capital.

2. Vault management fees: 2% annual management + 20% performance above high-water mark, enforced on-chain. Third-party vault creators set their own fees; Syntx takes 0.5% protocol fee.

Intent routing is the primary business — volume-based revenue with network effects (more venues + solvers = better fills = more traders). Vaults are the first customer.

## How long have you been working on this? (500 char)

Solo founder, part-time since January 2026.
Syntx specifically since March 2026 — preceded by 3 months building vault infrastructure across Drift (Yogi) and Hyperliquid (Kodiak), which directly informed the exchange-agnostic architecture.
The 29 @fabrknt/* packages represent 4+ months of accumulated infrastructure.
Shielded intent + structured product angle developed April 2026.

## Team location and work arrangement (500 char)

Solo founder based in Tokyo, Japan.
Working remotely part-time.
Open to relocating or establishing presence in Singapore, Hong Kong, or Dubai for regulatory clarity if funded.
No change to development workflow required — all infrastructure is cloud-based.

## Legal entity

No

## Investment taken

No

## Currently fundraising

No

## Live token

No

## Accelerator application

No

## Did anyone not listed do meaningful work?

Claude Code (Opus 4.6) was used extensively as an AI pair programmer for code generation, architecture decisions, and debugging. All design decisions and strategic direction are by the human founder.

## X profile (public)

psyto

## Telegram

(not applicable — founder does not use Telegram)
