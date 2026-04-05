# Syntx Frontend

Next.js frontend for [Syntx](https://fabrknt.com/vaults) — composable perp vaults on Solana.

## Platform

Part of [fabrknt.com](https://fabrknt.com):
- **Flow** — Capital flow intelligence (`/flow`)
- **Learn** — DeFi education (`/learn`)
- **Syntx** — Composable perp vaults (`/vaults`) ← this app

## Tech Stack

- Next.js 16, React 19, TypeScript
- Tailwind CSS 4 (Fabrknt dark theme)
- Solana Web3.js + Wallet Adapter (Phantom, Solflare)
- Devnet only (RPC: api.devnet.solana.com)

## Development

```bash
npm install
npm run dev
# Opens at http://localhost:3000/vaults (basePath: /vaults)
```

## Deployment

Deployed on Vercel as the `syntx` project.
- Public URL: `fabrknt.com/vaults` (via rewrite from main app)
- Backend URL: `syntx.fabrknt.com` (Vercel)
- basePath: `/vaults`

## Pages

- `/vaults` — Landing page + vault list
- `/vaults/compose` — Strategy composition
- `/vaults/earn` — Yield opportunities
- `/vaults/create` — Create new vault (4-step flow)
