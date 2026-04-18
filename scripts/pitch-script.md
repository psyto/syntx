# Syntx Pitch Video Script (2 minutes)

> Record yourself talking to camera. No slides needed — just you, clear audio, natural delivery.

## [0:00–0:25] Who I am + the problem

"Hi, I'm Hiro. I run funding rate vaults — Yogi on Drift mainnet and Kodiak on Hyperliquid mainnet. Both profitable, both live.

When Drift was exploited in April, I lost access to my entire composable stack overnight. Every vault that depended on one venue — dead.

That's when I realized: every large perp trade on Solana has two problems. It's visible on-chain — so MEV bots frontrun it. And it's stuck on one venue — so you get worse execution than you should."

## [0:25–0:55] What Syntx does

"Syntx solves both.

First — shielded intents. Your trade is encrypted with NaCl box encryption. A solver decrypts it, scores every venue by funding rate and liquidity, splits the order across Jupiter Perps, Percolator, and Drift, and fills at the best blended price. No one sees your order before it fills. Zero MEV.

Second — structured products. A principal-protected SOL vault uses Kamino lending for protection and delta-hedged perps for upside. Black-Scholes option replication — the first on Solana since Friktion.

Both use the same VenueAdapter interface. Five adapters, four architectures. Same keeper, different strategies."

## [0:55–1:25] Why this is real

"This isn't theoretical. I submitted a shielded intent from the Trade page — the privacy matcher executed a real TradeCpi on-chain. Real transaction signature. Not simulated.

Cross-venue spot routing exists — Jupiter does it. Cross-venue perp routing with privacy does not exist anywhere. This is the first on Solana.

The business model: bps on every routed trade. One billion a month in volume times two basis points is two point four million a year. It scales with volume, not capital."

## [1:25–1:50] Why me

"I've been building vault infrastructure for four months across three protocols and two chains. Twenty-nine published packages. Five custom Percolator matchers. I know what breaks, because I've been broken by it.

Syntx is the architecture I wished existed. The VenueAdapter pattern isn't extracted from theory — it's extracted from the pain of rebuilding the same keeper for every new venue."

## [1:50–2:00] Close

"Syntx — shielded cross-venue perp execution on Solana. Check it at fabrknt dot com slash vaults, or github dot com slash psyto slash syntx. Thanks."
