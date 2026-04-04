# Syntx — Colosseum Frontier Hackathon Updates

## Week 1 Update Script (1 minute)

### Video: screen recording of frontend + talking over it

---

**[0:00 - 0:10] Hook**

"Drift got exploited for $285 million three days ago. Twenty protocols lost their composable perps layer overnight. We built a replacement in one session."

**[0:10 - 0:25] What is Syntx**

"Syntx is a composable perp vault protocol on Solana. It's built on Percolator — the formally verified risk engine by Solana co-founder Anatoly Yakovenko."

*(Show: landing page hero)*

"Anyone can create a strategy vault. Users deposit. A keeper trades perps on their behalf. Profits are shared through share tokens."

**[0:25 - 0:40] Live demo**

*(Show: /vaults page, click vault, show stats)*

"This is live on devnet right now. The vault has real positions. The keeper is running — pushing oracle prices, cranking funding, executing trades based on funding rate signals."

*(Show: deposit flow — enter amount, click deposit, wallet confirms)*

"Deposit works from the browser. Withdraw works. Share tokens are standard SPL tokens."

**[0:40 - 0:55] Composability — the differentiator**

*(Show: /compose page)*

"But here's what makes Syntx different from every other perp DEX. Composability. Other protocols can CPI into Syntx — atomic hedging, leveraged yield, treasury management. This is something Hyperliquid can structurally never offer."

**[0:55 - 1:00] Close**

"Fifteen on-chain instructions. Twenty passing tests. Six frontend pages. Live keeper. All built on the Solana founder's own risk engine. Syntx — the composable perp layer Solana needs."

---

## Week 2 Update Script (draft — refine based on progress)

**Focus: Keeper strategy + composability in action**

- Show keeper logs: funding rate detection, position decisions
- Show a Jupiter swap → deposit flow
- Show vault share price moving with PnL
- "This week we ported our Yogi keeper strategy — funding rate harvest with vol regime detection"

## Week 3 Update Script (draft)

**Focus: Security + permissionless vaults**

- Show circuit breaker configuration
- Show CPI whitelist
- Show someone creating a new vault from /create
- "This week we hardened security — automatic circuit breakers, CPI whitelist, drawdown limits"

## Week 4 Update Script (draft)

**Focus: Ready for users**

- Clean frontend demo end-to-end
- Show /earn portfolio view
- Show documentation
- "Syntx is ready for devnet users. Audit is the next step before mainnet."

---

## Demo Video Script (2-3 min, for final submission)

### Section 1: Problem (30s)

"On April 1st, Drift Protocol was exploited for $285 million. The largest Solana DeFi exploit on record. Twenty protocols lost their composable perps layer overnight. Jupiter's oracle-AMM can't serve programmatic strategies. Phoenix, Bulk, and Bullet aren't live yet. There is no composable perp layer on Solana right now."

### Section 2: Solution (45s)

"Syntx is a permissionless vault protocol for perpetual futures. Built on Percolator — the formally verified risk engine by Anatoly Yakovenko, Solana's co-founder."

"Three actors: vault managers create vaults and set fees. Users deposit and receive share tokens. Keepers run automated strategies — funding rate harvest, delta-neutral, market making."

"The key innovation is the vault PDA pattern. A program-derived address owns the Percolator trading account. No human holds the private key. Only the vault program can sign trades. The manager can trade but cannot steal."

### Section 3: Live Demo (60s)

*(Screen recording of frontend)*

1. Show landing page — hero, stats
2. Navigate to /vaults — show vault list
3. Click vault — show stats, position, funding rate
4. Deposit — enter amount, wallet signs, shares minted
5. Show /earn — portfolio view
6. Withdraw — burn shares, USDC returned
7. Show /compose — composability recipes

### Section 4: Composability (30s)

"What makes Syntx unique is composability. Any Solana program can CPI into Syntx."

"Jupiter swap → deposit: any token accepted."
"Kamino auto-hedge: atomic hedging in one transaction."
"Vault shares as collateral: borrow against your position."

"This is what purpose-built chains like Hyperliquid can never offer."

### Section 5: Tech + Close (15s)

"Fifteen on-chain instructions. Twenty tests. Funding rate harvest keeper running live. All open source, Apache 2.0, built on the Solana founder's own stack."

"Syntx — the composable perp layer Solana needs."

---

## Pitch Video Script (3 min, for final submission)

### Who we are (20s)

"I'm Hiro from Fabrknt. I've built vault strategies on Drift, Hyperliquid, and GRVT — Yogi, Kodiak, and Polar. Five custom Percolator matchers. I know the perps stack inside out."

### Problem (30s)

"Drift is dead. $285M exploit. The composable perps layer on Solana is gone. Jupiter can't serve builders — it's oracle-AMM with a 1:1 OI cap. The incoming protocols — Phoenix, Bulk, Bullet — are months away."

"Twenty protocols lost their hedging infrastructure overnight. Vault builders, DN strategies, lending protocol integrations — all broken."

### Solution (40s)

"Syntx fills this gap. A permissionless vault protocol for perp trading, built on Anatoly Yakovenko's Percolator — the only formally verified perp risk engine on Solana."

"Anyone can create a vault. Set their fees. Run their keeper. Users deposit and earn yield. The vault PDA pattern ensures the manager can trade but cannot steal."

### Why composable (30s)

"The real moat is composability. Syntx vaults are CPI-accessible. Kamino can auto-hedge via cpi_trade. Vault shares are standard SPL tokens — usable as collateral on Marginfi. Jupiter routes any token into vault deposits."

"Hyperliquid has better execution, but it can never compose. That's the bet — Solana's infrastructure catches up on execution while composability is an unforkable advantage."

### Traction (20s)

"Live on devnet. Fifteen instructions, twenty tests. Keeper running with funding rate strategy. Six-page frontend — deposit, withdraw, compose, create — all from the browser."

"Built in one session. Forty-four commits."

### Ask (20s)

"We need an audit — fifty to a hundred thousand dollars. The code is spec-aligned with Percolator v12.1.0. The vault program is small — fifteen instructions. An audit unlocks mainnet."

"Syntx is the composable perp layer Solana needs. We built it. Now we need to secure it."

### Close (10s)

"Syntx. Composable perp vaults on Solana. Built on Percolator. Open source."
