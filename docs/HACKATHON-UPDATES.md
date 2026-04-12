# Syntx — Solana Frontier Hackathon Updates

## Weekly Progress Videos

### Week 1: Venue Adapter Pattern
- VenueAdapter interface (6 methods any DEX implements)
- PercolatorAdapter (slab parsing, oracle, crank, trade)
- Venue-agnostic keeper loop
- Factory pattern: VENUE=percolator|phoenix

### Week 2: Phoenix + Router + Frontend
- PhoenixAdapter (Phoenix V1 spot SDK)
- VenueRouter (multi-venue scoring and routing)
- Frontend reframed: "Composable Exchange-Agnostic Vaults"
- Vault UX: named vaults, Max button, dollar withdraw, toasts
- 2 live vaults on devnet
- SDK completed (buildDepositTx, buildWithdrawTx)
- 25 tests passing
- README rewrite + business plan
- CPI examples + venue adapter skeleton
- CONTRIBUTING.md, JSDoc, error boundaries

---

## Demo Video Script (2-3 min, for final submission)

### Section 1: Problem (20s)

"Every Solana perp venue builds in isolation. Your vault only works on one DEX. When that DEX goes down, your strategy dies. Solana now has Phoenix, Jupiter Perps, Drift, Percolator — but no shared vault infrastructure."

### Section 2: Solution (30s)

"Syntx is a composable exchange-agnostic vault layer. Vaults route trades across any venue through a VenueAdapter interface — Percolator for perps, Phoenix for spot, Jupiter Perps when available. Same strategy, best execution."

"The vault is a Program-Derived Address. No private key. The VenueRouter scores each DEX by funding rate, liquidity, and cost — then routes to the best one automatically."

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

"Fifteen instructions. Twenty-five tests. Three venue adapters. Full SDK. Live on devnet. Syntx — composable exchange-agnostic vaults on Solana."

---

## Pitch Video Script (3 min, for final submission)

### Who we are (20s)

"I'm Hiro from Fabrknt. I've built and operated production vaults on Drift and Hyperliquid — Yogi and Kodiak. Five custom Percolator matchers. Twenty-nine published infrastructure packages. I know the vault stack inside out."

### Problem (30s)

"Every Solana perp venue builds in isolation. Strategy managers rebuild identical vault infrastructure for each DEX — deposit logic, share accounting, keeper loops, risk management. When Drift was exploited, single-venue vaults lost access overnight."

"Solana now has multiple high-quality perp venues — but no shared vault layer to compose across them."

### Solution (40s)

"Syntx is a composable exchange-agnostic vault layer. Vaults route trades across any venue through a VenueAdapter interface. Today: Percolator and Phoenix. Tomorrow: Jupiter Perps, Drift, any new DEX."

"The VenueRouter scores each venue by funding rate, liquidity, and insurance — then routes to the best one. The vault is a PDA. No private key. Circuit breakers, CPI whitelist, configurable trade limits."

"Other protocols compose via CPI. A lending protocol can auto-hedge through a vault. A treasury can deploy idle capital. All in one atomic transaction."

### Traction (20s)

"Live on devnet. Two vaults with deposits. Fifteen Anchor instructions. Twenty-five tests. Three venue adapters. Complete TypeScript SDK. Five frontend pages at fabrknt.com/vaults."

"CPI examples and venue adapter skeletons in the repo. Business plan. CONTRIBUTING guide."

### Business Model (20s)

"Protocol-managed vaults charge two percent management and twenty percent performance fees — enforced on-chain. Third-party vault creators set their own fees. Syntx takes a half-percent protocol fee. Long-term: institutional CPI access fees."

### Ask (20s)

"We need audit funding — fifty to a hundred thousand dollars. The code is fifteen instructions. An audit unlocks mainnet. We're applying to the Colosseum accelerator for funding, distribution, and first institutional integrators."

### Close (10s)

"Syntx. Composable exchange-agnostic vaults on Solana. The vault layer every perp venue needs. Built by Fabrknt. Open source."
