# Week 2 Voiceover Script (60 seconds)

## [Title slide, 0:00–0:08]

"Hi, I'm Hiro. Week 2 of Syntx at Solana Frontier. The big shift: we're not just a vault protocol anymore. Syntx now does shielded cross-venue perp execution."

## [Trade page — intent form, 0:08–0:18]

"Submit an encrypted trading intent. The solver scores Jupiter Perps, Percolator, and Drift by funding rate and depth, splits the order across venues, and fills at the best blended price. No one sees your order until it fills. Zero MEV."

## [Earn page — tabbed vaults, 0:18–0:28]

"We also built structured products. The principal-protected SOL vault splits capital between Kamino lending and a delta-hedged perp position — Black-Scholes option replication, on-chain. Plus the original funding rate harvest vault."

## [Build page — strategy configurator, 0:28–0:38]

"The Build page lets you compose: pick a strategy, pick venues, configure parameters. Same VenueAdapter interface powers both intents and vaults. Five adapters — Percolator, Jupiter, Phoenix, Kamino, and the VenueRouter."

## [Terminal — TradeCpi success, 0:38–0:52]

"And it's real. This is the privacy matcher executing a TradeCpi on localnet. Eight steps — init market, init LP with matcher, push oracle, execute trade. All on-chain. Not simulated."

## [Closing slide, 0:52–0:60]

"Next week: connect the Trade page to real on-chain execution, deploy to devnet, and submit the demo and pitch videos. Thanks for watching."
