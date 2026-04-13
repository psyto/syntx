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

### Section 1: The Problem (20s)

"I run funding rate vaults on Drift and Hyperliquid — live, profitable. Drift was the only place on Solana where I could compose perps with lending and yield. When Drift was exploited, I lost access to the whole stack overnight. Composable perps can't depend on one protocol."

### Section 2: What Users Get (30s)

"Deposit USDC. Earn eight to fifteen percent APY from funding rate yield. That's it."

"Underneath, Syntx routes your capital across three completely different DEX architectures — Percolator, Phoenix, Jupiter Perps — and picks whichever has the best funding rate. If one venue goes down, your money routes to the next one. Vault shares are SPL tokens — they work as collateral everywhere on Solana automatically."

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

### Section 5: Close (20s)

"I lost my composable perp stack when Drift was exploited. So I built one that can't die with a single venue. Fifteen instructions, twenty-nine tests, four venue adapters, three architectures. Syntx — composable exchange-agnostic vaults on Solana."

"Fifteen instructions. Twenty-nine tests. Four venue adapters across three architectures. 48-hour timelock. Immutable circuit breaker floor. Full SDK. Live on devnet. Syntx — composable exchange-agnostic vaults on Solana."

---

## Pitch Video Script (3 min, for final submission)

*Note: Lead with personal pain, then user benefit, then defensibility.*

### My Story (40s)

"I run funding rate vaults. Yogi on Drift — live on Solana mainnet, plus one point six percent in a single week while BTC dropped seven percent. Kodiak on Hyperliquid — live, delta-neutral, profitable."

"Drift was the only place on Solana where I could compose perps with lending, spot, and yield strategies in one stack. When Drift was exploited in April, I lost access to my entire vault infrastructure overnight. Not just the positions — the whole composable stack disappeared."

"That's when I realized: composable perps can't depend on one protocol. The composable layer needs to survive any single venue failing. So I built Syntx."

### What Syntx Does (30s)

"Deposit USDC. Earn eight to fifteen percent APY from funding rate yield. That's what the user sees."

"What happens underneath: Syntx routes your capital across Percolator, Phoenix, and Jupiter Perps — three completely different DEX architectures — and picks whichever venue has the best funding rate right now. If one venue goes down, your money routes to the next one. Your yield doesn't stop."

"Vault shares are SPL tokens. They work as collateral on Kamino, Marginfi, anywhere — automatically. No bridges, no partnerships needed. That's Solana's composability doing what Hyperliquid structurally can never do."

### Why This Is a Business (30s)

"Hyperliquid proved perps generate six hundred million dollars in fees. But Hyperliquid is a product for traders. You can't build on top of it."

"Syntx is an ecosystem for developers. Any Solana program calls cpi_trade in one transaction. Each protocol that integrates brings its own users. That's distribution through composability — the same way Jupiter grew by aggregating every DEX, not by acquiring users directly."

"Two percent management, twenty percent performance fees — enforced on-chain. In traditional markets, Robinhood is worth more than Nasdaq. Value accrues to the infrastructure layer above exchanges."

### What We Built (20s)

"Live on devnet. Fifteen Anchor instructions. Twenty-nine tests. Four venue adapters across three architectures. Forty-eight hour timelock on manager transfer — we studied the Drift exploit and hardened before anyone asked. Immutable circuit breaker floor. Complete SDK. Five frontend pages."

### The Ask (15s)

"We need an audit — fifty to a hundred thousand dollars — to unlock mainnet. Colosseum already invested in Reflect, the delta-neutral stablecoin. Syntx is the vault infrastructure that makes protocols like Reflect possible. We're building the layer underneath."

### Close (5s)

"I lost my composable perp stack once. I built one that can't die with a single venue. That's Syntx."
