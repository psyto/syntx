# Week 2 Voiceover Script (60 seconds)

## [Slide 1 — Title, 0:00–0:07]

"Hi, I'm Hiro. Week 2 of Syntx at Solana Frontier. This week we proved the exchange-agnostic thesis — three venue adapters across three fundamentally different architectures."

## [Slide 2 — Phoenix adapter, 0:07–0:14]

"Phoenix V1 is our second venue — a CLOB orderbook. The PhoenixAdapter reads the orderbook, executes swaps, tracks positions. All behind the same VenueAdapter interface."

## [Slide 3 — Jupiter adapter, 0:14–0:21]

"Jupiter Perps is our third venue — an oracle-based AMM. Completely different architecture from Percolator's slab or Phoenix's CLOB. Same six methods. Same keeper. That's the point."

## [Slide 4 — VenueRouter, 0:21–0:28]

"The VenueRouter scores all three venues by funding rate, liquidity, and insurance — then routes to the best one. The keeper doesn't know or care which DEX it's trading on."

## [Slide 5 — Timelock, 0:28–0:34]

"After studying the Drift exploit report, we identified the same single-manager-key risk. So we added a 48-hour timelock on manager transfers. Propose, wait, then execute."

## [Slide 6 — Immutable floor, 0:34–0:40]

"We also added an immutable circuit breaker floor. Set at vault creation, can never be reduced. Protection that the manager cannot disable."

## [Slide 7 — Stats, 0:40–0:46]

"Three architectures. Four venue adapters. Thirty-two tests. Forty-eight hour timelock. Fifteen Anchor instructions. Five frontend pages."

## [Slide 8 — Also this week, 0:46–0:53]

"Also shipped: frontend reframed with three-architecture venue diagram, complete SDK, CPI examples, venue adapter skeleton, business plan, and CONTRIBUTING guide."

## [Slide 9 — Closing, 0:53–0:60]

"Next week: demo video, pitch video, final polish, and submit on Colosseum. Thanks for watching."
