# Week 2 Voiceover Script (60 seconds)

## [Slide 1 — Title, 0:00–0:08]

"Hi, I'm Hiro. Week 2 of Syntx at Solana Frontier. We integrated Phoenix as a second venue, built multi-venue routing, and hardened security with a 48-hour timelock and immutable circuit breaker floor."

## [Slide 2 — Phoenix adapter, 0:08–0:16]

"Phoenix V1 is now live as a second execution venue. The PhoenixAdapter implements the same VenueAdapter interface — reads the orderbook, executes swaps, tracks positions. All through the Ellipsis Labs SDK."

## [Slide 3 — VenueRouter, 0:16–0:24]

"The VenueRouter manages multiple venues and implements VenueAdapter itself. The keeper treats it as a single venue — routing is transparent. Score all venues, route to the best one."

## [Slide 4 — Timelock, 0:24–0:32]

"After studying the Drift exploit report, we identified the same single-manager-key risk in our own design. So we implemented a 48-hour timelock. Manager transfers now require propose, wait, then execute. If a key is compromised, depositors have time to withdraw."

## [Slide 5 — Immutable floor, 0:32–0:39]

"We also added an immutable circuit breaker floor. The minimum drawdown limit is set at vault creation and can never be reduced — not even by the manager. Protection that cannot be disabled."

## [Slide 6 — Stats, 0:39–0:46]

"The numbers: seventeen Anchor instructions, twenty-seven passing tests, three venue adapters, forty-eight hour timelock, two live vaults on devnet, five frontend pages."

## [Slide 7 — Also this week, 0:46–0:53]

"Also shipped: frontend reframed as composable exchange-agnostic vaults, SDK complete with buildDepositTx and buildWithdrawTx, CPI examples, venue adapter skeleton, business plan, and CONTRIBUTING guide."

## [Slide 8 — Closing, 0:53–1:00]

"Next week: demo video, pitch video, final polish, and submit on Colosseum. Thanks for watching."
