# Syntx — Solana Frontier Hackathon Updates

## Weekly Progress Videos

### Week 1: Venue Adapter Pattern
- VenueAdapter interface (6 methods any DEX implements)
- PercolatorAdapter (slab parsing, oracle, crank, trade)
- Venue-agnostic keeper loop
- Factory pattern: VENUE=percolator|phoenix

### Week 2: Phoenix + Jupiter + Router + Frontend + Security
- PhoenixAdapter (Phoenix V1 spot SDK, CLOB architecture)
- JupiterPerpsAdapter (oracle-based AMM, SOL/BTC/ETH markets)
- VenueRouter (multi-venue scoring and routing)
- 3 venue architectures covered: slab-based, CLOB, oracle-based AMM
- Frontend reframed: "Composable Exchange-Agnostic Vaults"
- Vault UX: named vaults, Max button, dollar withdraw, toasts
- 2 live vaults on devnet
- SDK completed (buildDepositTx, buildWithdrawTx)
- 48h timelock on manager transfer (propose → wait → execute)
- Immutable circuit breaker floor (min_drawdown_bps)
- 29 tests passing
- SDK + keeper abi synced with all 15 on-chain instructions
- Mobile-responsive verified (iPhone, iPad, desktop)
- README rewrite + business plan
- CPI examples + venue adapter skeleton
- CONTRIBUTING.md, JSDoc, error boundaries

---

## Demo Video Script (2-3 min, for final submission)

### Section 1: Problem (20s)

"Solana has world-class infrastructure and multiple high-quality perp venues — Phoenix, Jupiter Perps, Percolator, Drift. But every vault is locked to one DEX. When that venue goes down, your strategy dies. There's no shared vault layer. That's a Napster-era problem."

### Section 2: Solution (30s)

"Syntx is a composable exchange-agnostic vault layer. Vaults route trades across any venue through a VenueAdapter interface — Percolator for slab-based perps, Phoenix for CLOB spot, Jupiter Perps for oracle-based AMM perps. Three architectures, same strategy, best execution."

"The vault is a Program-Derived Address. No private key. A 48-hour timelock prevents instant manager takeover. An immutable circuit breaker floor ensures protections can never be disabled. The VenueRouter scores each DEX by funding rate, liquidity, and cost — then routes to the best one."

### Section 3: Live Demo (60s)

*(Screen recording of fabrknt.com/vaults)*

1. Landing page — "Composable Exchange-Agnostic Vaults on Solana", venue architecture diagram
2. Vault marketplace — 2 named vaults (SOL Funding Rate, SOL Delta Neutral) with Percolator badges
3. Click vault — share price, equity, position, funding rate
4. Deposit — enter amount, Max button, wallet confirms, toast with Explorer link
5. Compose page — architecture diagram (Users → Syntx → [Percolator | Phoenix | Jupiter])
6. CPI code snippets — cpi_trade, get_share_price, deposit
7. VenueAdapter interface — "add a new DEX in 6 methods"

### Section 4: Composability + Multi-Venue (30s)

"Two layers of composability. First, any program can CPI into Syntx — atomic hedging, leveraged yield, treasury management. Second, vaults route across multiple DEXes — exchange-agnostic by design."

*(Show: VenueAdapter code, Phoenix scoring in router)*

"This is something no purpose-built chain can offer — and no single-venue vault provides."

### Section 5: Track Record + Close (20s)

"This isn't our first vault. Yogi runs live on Drift mainnet. Kodiak runs live on Hyperliquid. Syntx is the architecture we wished existed — exchange-agnostic from day one."

"Fifteen instructions. Twenty-nine tests. Four venue adapters across three architectures. 48-hour timelock. Immutable circuit breaker floor. Full SDK. Live on devnet. Syntx — composable exchange-agnostic vaults on Solana."

---

## Pitch Video Script (3 min, for final submission)

*Note: Pitch video is the gate — judges decide whether to deep-dive based on this. Lead with market, not tech. Frame as market creation.*

### The Market (30s)

"Perpetual futures are an eighty-six trillion dollar market. Decentralized perps grew three hundred and forty-six percent last year to six point seven trillion — and they're still only eight percent of centralized volume. Real-world asset perps are now forty-four percent of Hyperliquid's volume. This market is massive and accelerating."

"On Solana, we now have Percolator, Phoenix, Jupiter Perps, Drift — multiple world-class perp venues. But there's a missing layer."

### The Problem (20s)

"Every vault is locked to one DEX. When Drift was exploited, single-venue vaults lost access overnight. Strategy managers rebuild identical infrastructure for each new venue — deposit logic, share accounting, risk management — all from scratch. There's no shared vault layer across venues."

### Who I Am (15s)

"I'm Hiro. I've been building vaults full-time across Solana and Hyperliquid — Yogi on Drift mainnet, Kodiak on Hyperliquid mainnet. Both live, both profitable. Syntx is the architecture I wished existed while rebuilding the same vault infrastructure on every new DEX."

### The Solution (30s)

"Syntx is a composable exchange-agnostic vault layer. A new category — not another DEX, not another vault protocol. The infrastructure layer that sits above all of them."

"One VenueAdapter interface. Any DEX plugs in with six methods. Today we route across three fundamentally different architectures — Percolator's slab engine, Phoenix's orderbook, Jupiter's oracle AMM. Same strategy, best execution."

"Other protocols compose via CPI. A lending protocol auto-hedges through a vault in one atomic transaction. Vault shares are SPL tokens — usable as collateral across DeFi."

### Traction (20s)

"Live on devnet. Two vaults with deposits. Four venue adapters. Twenty-nine passing tests. Complete SDK and frontend at fabrknt.com/vaults."

"We studied the Drift exploit and proactively added a forty-eight hour timelock on manager transfers and an immutable circuit breaker floor. Security isn't an afterthought."

### Business Model (15s)

"In traditional markets, Robinhood commands a higher market cap than Nasdaq. Value accrues to the infrastructure layer above exchanges. Syntx is that layer for Solana perps. Two percent management, twenty percent performance fees — enforced on-chain."

### The Ask (20s)

"We need an audit — fifty to a hundred thousand dollars. Fifteen instructions, clean code. An audit unlocks mainnet."

"Colosseum is the right partner because you've already invested in the perps ecosystem — Reflect, the delta-neutral stablecoin, won the Radar grand prize. Syntx is the vault infrastructure that protocols like Reflect need to exist on top of. We're building the layer underneath."

### Close (10s)

"Syntx. Composable exchange-agnostic vaults. A new category for Solana DeFi. Built to last."
