# Syntx — Composable Perp DEX on Solana

Syntx is the composable perpetual futures layer Solana needs. Built on [Percolator](https://github.com/aeyakovenko/percolator) — the formally-verified risk engine by Solana co-founder Anatoly Yakovenko.

## What is Syntx?

A vault-native perp DEX where strategies are first-class citizens, not afterthoughts.

- **Percolator-powered**: Formally verified risk engine (H ratio + A/K lazy ADL). No user can ever withdraw more than exists on the balance sheet.
- **Vault-native**: Strategy vaults (funding rate, delta-neutral, market making) are built into the protocol, not bolted on.
- **Composable**: CPI interface for Solana DeFi protocols (Kamino, Marginfi) to compose with perps.
- **SNTX token**: Liquidity bootstrapped via the Hyperliquid playbook — protocol-owned market making from day one.

## Architecture

```
Users ──deposit──▶ Syntx Vault Program ──CPI──▶ Percolator Program
                        │                            │
                   Share tokens              Risk engine (H/A/K)
                   Fee accounting            Funding rate
                   Manager auth              Liquidation
                        │                    Oracle (Pyth)
                        ▼                    Insurance fund
                   Keeper Bot                     │
                   (strategies)                   ▼
                        │                    Matcher Programs
                        ▼                    (vol, vAMM, etc.)
                   Composability
                   (Kamino, Marginfi CPI)
```

## Project Structure

```
syntx/
├── programs/
│   └── syntx-vault/        # Solana program — vault + composability layer
├── sdk/                     # TypeScript SDK
├── keeper/                  # Keeper bot (crank, liquidator, strategy)
├── app/                     # Frontend (Next.js)
└── docs/                    # Architecture docs + build plan
```

## Dependencies

- [percolator](https://github.com/aeyakovenko/percolator) — Core risk engine (Apache 2.0)
- [percolator-prog](https://github.com/aeyakovenko/percolator-prog) — Solana program (Apache 2.0)
- [percolator-cli](https://github.com/aeyakovenko/percolator-cli) — CLI/SDK reference
- [percolator-fabrknt](https://github.com/psyto/percolator-fabrknt) — Custom matchers (vol, event, macro, jpy, privacy)

## Status

Phase 0 — Foundation. See [BUILD-PLAN.md](docs/BUILD-PLAN.md) for roadmap.

## License

Apache 2.0
