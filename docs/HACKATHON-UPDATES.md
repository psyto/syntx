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

### The Shift (30s)

"Perpetual futures did eighty-six trillion dollars in centralized exchange volume last year. Decentralized perps grew three hundred and forty-six percent to six point seven trillion. Real-world asset perps are now forty-four percent of Hyperliquid's volume. This isn't a niche crypto instrument anymore — perps are rewriting global trading."

"But Solana's Napster era is ending. The infrastructure is world-class. Coinbase and Robinhood are bringing hundreds of millions of users on-chain. The question isn't whether perps will scale — it's who builds the most valuable infrastructure around them as they do."

### The Problem (20s)

"Every Solana perp venue builds in isolation. Drift vaults only work on Drift. Jupiter vaults only on Jupiter. When a venue goes down, your strategy dies. Strategy managers rebuild identical infrastructure for each DEX. That's the Napster-era approach — fast, fragmented, not built to last."

### The Solution (30s)

"Syntx is a composable exchange-agnostic vault layer. One vault, any venue. We route trades across Percolator, Phoenix, and Jupiter Perps — three fundamentally different architectures — through a single VenueAdapter interface."

"The vault is a PDA. No private key. Forty-eight hour timelock on manager transfer. Immutable circuit breaker floor. Other protocols compose via CPI — atomic hedging, leveraged yield, treasury management. This is what post-Napster infrastructure looks like."

### Who we are (15s)

"I'm Hiro from Fabrknt. I run production vaults on Drift mainnet and Hyperliquid mainnet — Yogi and Kodiak. Twenty-nine published infrastructure packages. Five Percolator matchers. Syntx is the architecture I wished existed while building those."

### Traction (20s)

"Live on devnet. Fifteen Anchor instructions. Twenty-nine tests. Four venue adapters across three architectures. Complete TypeScript SDK. Five frontend pages. Mobile-responsive. CPI examples. Business plan."

"This isn't a prototype — it's a submission-ready product waiting for an audit to unlock mainnet."

### Business Model (15s)

"In traditional markets, Robinhood commands a higher market cap than Nasdaq — value accrues to the infrastructure layer above exchanges, not the exchanges themselves. Syntx is that layer for Solana perps. Two percent management, twenty percent performance fees — enforced on-chain."

### Ask (15s)

"We need audit funding — fifty to a hundred thousand dollars. Fifteen instructions, clean code, twenty-nine tests. An audit unlocks mainnet. We're applying to the Colosseum accelerator for funding and distribution."

### Close (15s)

"Solana's infrastructure grew up. It's time for the applications on top to catch up. Syntx is built for the next era — serious vault infrastructure for serious capital. Composable. Exchange-agnostic. Built to last."
