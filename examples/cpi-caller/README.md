# CPI Caller Example

Minimal Anchor program demonstrating how to call Syntx's `cpi_trade` instruction from another Solana program.

## What This Shows

A lending protocol (or any Solana program) can atomically trade through a Syntx vault in the same transaction as its own operations. For example:

1. User borrows SOL on your lending protocol
2. Your protocol CPI calls Syntx to open a matching short
3. Both operations succeed or fail atomically

## How It Works

```
Your Program ──CPI──→ Syntx (cpi_trade) ──CPI──→ Percolator (TradeNoCpi)
                         │
                    Vault PDA signs
                    the Percolator trade
```

The vault PDA is the authority — no private key needed. Syntx checks:
- CPI whitelist (vault manager configures which programs can call)
- Trade size limit (per-vault configurable max)
- Circuit breaker (rejects if vault drawdown exceeds limit)

## Key Files

- `lib.rs` — The example program with `hedge_via_syntx` instruction
- `client.ts` — TypeScript client showing how to build the transaction

## Prerequisites

The vault manager must whitelist your program via `set_circuit_breaker`:

```typescript
const ix = syntx.setCircuitBreaker({
  maxDrawdownBps: 500,          // 5% max drawdown
  cpiWhitelist: YOUR_PROGRAM_ID, // whitelist your program
  maxCpiTradeSize: 1_000_000,   // max 1 USDC per trade
});
```

## Integration Steps

1. Add Syntx vault program as a dependency
2. Build the `cpi_trade` instruction accounts
3. Use `invoke_signed` (if your program has a PDA) or `invoke` (if using a signer)
4. Handle errors (vault paused, circuit breaker, whitelist rejection)
