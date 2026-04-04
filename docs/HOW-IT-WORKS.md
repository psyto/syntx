# How Syntx Works — A Complete Guide

## Table of Contents

1. [What Is a Perpetual Future?](#1-what-is-a-perpetual-future)
2. [What Is Percolator?](#2-what-is-percolator)
3. [What Does Syntx Add?](#3-what-does-syntx-add)
4. [The Vault PDA — The Core Innovation](#4-the-vault-pda--the-core-innovation)
5. [Step-by-Step: How a Deposit Works](#5-step-by-step-how-a-deposit-works)
6. [Step-by-Step: How a Trade Works](#6-step-by-step-how-a-trade-works)
7. [Step-by-Step: How a Withdrawal Works](#7-step-by-step-how-a-withdrawal-works)
8. [The Keeper Bot](#8-the-keeper-bot)
9. [Share Token Economics](#9-share-token-economics)
10. [Security Model](#10-security-model)
11. [What Lives On-Chain vs Off-Chain](#11-what-lives-on-chain-vs-off-chain)
12. [Glossary](#12-glossary)

---

## 1. What Is a Perpetual Future?

A perpetual future (perp) is a contract that lets you bet on the price of an asset without holding it. Unlike traditional futures, perps never expire.

- **Long** = you profit when the price goes up
- **Short** = you profit when the price goes down
- **Leverage** = you put up 10% collateral but get 10x the exposure

Perps have a **funding rate** that keeps the perp price close to the spot price:
- If more people are long than short, longs pay shorts
- If more people are short than long, shorts pay longs

This funding rate is how vault strategies make money — by being on the side that receives payments.

---

## 2. What Is Percolator?

Percolator is a **perpetual futures exchange program** on Solana, created by Anatoly Yakovenko (Solana's co-founder). It is:

- **A Solana program** — runs on-chain, fully decentralized
- **Formally verified** — mathematically proven to be safe (using the Kani theorem prover)
- **Apache 2.0 licensed** — anyone can build on it

### Percolator's Key Components

**Slab** — A single market (e.g., SOL-PERP). One big on-chain account (~1.1MB) containing:
- Market config (what asset, what oracle, what fees)
- All trading accounts (up to 4096 users + LPs)
- Risk engine state

**Accounts** — Inside a slab, each participant has an account:
```
Account {
  owner: pubkey,        // who controls this account
  capital: u128,        // collateral deposited
  position_size: i128,  // positive = long, negative = short
  entry_price: u64,     // price when position was opened
  pnl: i128,           // realized profit/loss
}
```

**LPs (Liquidity Providers)** — Special accounts that take the other side of trades. When you go long, an LP goes short (and vice versa).

**H Ratio** — The safety valve. If the exchange loses money (e.g., from failed liquidations), the H ratio reduces how much winners can withdraw, ensuring the exchange never becomes insolvent. This is the key innovation — it's formally proven.

**Insurance Fund** — Collects trading fees to absorb losses before the H ratio kicks in.

### How a Trade Works on Percolator

```
User wants to go long 100 SOL:
  1. User's account: capital goes down (margin locked)
  2. User's account: position = +100
  3. LP's account: position = -100 (takes the other side)
  4. Oracle price recorded as entry_price

Later, SOL goes up $10:
  5. User's PnL = +100 * $10 = +$1,000
  6. LP's PnL = -100 * $10 = -$1,000
```

---

## 3. What Does Syntx Add?

Percolator is an exchange. Syntx is a **vault layer** on top.

**Without Syntx (raw Percolator):**
- Each user has their own account
- Each user trades manually
- No share-based pooling
- No managed strategies

**With Syntx:**
- Many users pool capital into a vault
- A keeper (automated bot) trades on behalf of all depositors
- Users hold share tokens representing their portion of the vault
- The keeper runs strategies (funding rate harvesting, delta-neutral, etc.)

**Analogy:** Percolator is like a stock exchange. Syntx is like a hedge fund that trades on that exchange on behalf of its investors.

---

## 4. The Vault PDA — The Core Innovation

### What Is a PDA?

A PDA (Program Derived Address) is a special Solana address that:
- Looks like a regular wallet address
- Has NO private key — no human can sign for it
- Can ONLY be "signed" by a specific program using `invoke_signed`

### How Syntx Uses a PDA

```
Vault PDA = hash("vault" + collateral_mint + manager_pubkey + program_id)
```

This PDA:
1. **Owns a Percolator trading account** — the PDA is set as the `owner` field
2. **Holds the share mint authority** — only the vault program can mint/burn shares
3. **Controls the vault's collateral** — USDC flows through the PDA's token account

### Why This Is Secure

| Action | Who can do it | How |
|---|---|---|
| Deposit USDC | Any user | Signs with their own wallet |
| Trade on Percolator | Only the vault program | PDA signs via `invoke_signed` |
| Withdraw USDC | Any share holder | Burns shares, PDA withdraws from Percolator |
| Steal funds | Nobody | PDA has no private key; vault program enforces rules |

The keeper (manager) calls `manager_trade`, which tells the vault program to sign a trade. But the vault program only lets the authorized manager do this, and the trade goes through Percolator (not directly to the keeper's wallet). The manager can trade, but cannot steal.

---

## 5. Step-by-Step: How a Deposit Works

```
User has 100 USDC and wants to invest in the vault.

Step 1: User calls Syntx "deposit" instruction with amount=100
Step 2: Syntx transfers 100 USDC from user's wallet to vault's token account
Step 3: Syntx calls Percolator "DepositCollateral" via CPI
        → vault PDA signs this transaction
        → Percolator adds 100 to the vault account's capital
Step 4: Syntx calculates share price:
        → If first deposit: 1 share = 1 USDC (100 shares minted)
        → If vault already has shares: shares = amount * total_shares / total_equity
Step 5: Syntx mints share tokens to user's wallet
Step 6: User now holds share tokens representing their portion of the vault
```

### Where Does the USDC Go?

```
User's USDC wallet
  → Syntx vault's USDC token account
    → Percolator's vault token account (via CPI DepositCollateral)
```

The USDC ends up in Percolator's vault, which is a PDA-controlled token account. It's used as collateral for trading.

---

## 6. Step-by-Step: How a Trade Works

```
Keeper decides to go long 1 unit of SOL at $138.

Step 1: Keeper calls Syntx "manager_trade" with lp_idx=1, size=+1
Step 2: Syntx verifies the keeper is the authorized manager
Step 3: Syntx builds a Percolator "TradeNoCpi" instruction
Step 4: Syntx calls invoke_signed with the vault PDA's seeds
        → The vault PDA becomes a "signer" for this transaction
Step 5: Percolator receives the trade:
        → Vault account (idx 0): position goes from 0 to +1
        → LP account (idx 1): position goes from 0 to -1
        → Oracle price (138,000,000 in e6 format) recorded as entry price
Step 6: Capital is adjusted for trading fees

Result on-chain:
  Vault: capital=999, position=+1, entry_price=138000000
  LP:    capital=599999, position=-1
```

### What Is CPI?

CPI (Cross-Program Invocation) is how one Solana program calls another. When Syntx calls Percolator:

```
Transaction signed by: [keeper's wallet]
  → Instruction 1: Syntx manager_trade
    → CPI Instruction: Percolator TradeNoCpi
      Signed by: [vault PDA via invoke_signed]
```

The keeper signs the outer transaction. The vault PDA signs the inner CPI call. Percolator sees the vault PDA as the signer and allows the trade.

---

## 7. Step-by-Step: How a Withdrawal Works

```
User wants to withdraw half their investment.

Step 1: User calls Syntx "withdraw" with shares_to_burn=50
Step 2: Syntx calculates withdrawal amount:
        → amount = 50 shares * total_deposits / total_shares
        → If vault has profited, amount > original deposit
        → If vault has lost, amount < original deposit
Step 3: Syntx burns the user's 50 share tokens
Step 4: Syntx calls Percolator "WithdrawCollateral" via CPI
        → vault PDA signs
        → Percolator removes capital from the vault account
        → Percolator transfers USDC from its vault to Syntx vault's token account
Step 5: Syntx transfers USDC from vault's token account to user's wallet

Note: If the vault has an open position, withdrawal requires enough
free collateral (capital not locked as margin). The keeper may need
to close positions before large withdrawals can be processed.
```

---

## 8. The Keeper Bot

The keeper is a TypeScript program that runs 24/7 (on EC2 or similar). It:

### Every 30 Seconds:

```
1. READ SLAB STATE
   → Fetch the slab account from Solana RPC
   → Parse: vault capital, position, PnL, funding rate, insurance balance

2. PUSH ORACLE PRICE
   → In devnet: push price directly (oracle authority mode)
   → In production: price comes from Pyth oracle
   → This ensures the slab has a fresh price for trading

3. CRANK FUNDING
   → Call Percolator KeeperCrank (permissionless)
   → This settles funding payments between longs and shorts
   → If vault is on the receiving side, PnL increases

4. EVALUATE STRATEGY
   → Check funding rate direction and magnitude
   → Check position health (margin utilization)
   → Decide: open position, close position, or hold

5. TRADE (if strategy says to)
   → Call Syntx manager_trade via the vault program
   → Vault PDA signs the Percolator trade
   → Position updated on-chain
```

### Keeper Config (.env)

```
SOLANA_RPC_URL=https://api.devnet.solana.com
MANAGER_KEYPAIR_PATH=~/.config/solana/id.json
SYNTX_PROGRAM_ID=53r6bg7JBFqf5Jfs7fe4kHDtwXwUgDWoLarYrsWcoF1V
PERCOLATOR_PROGRAM_ID=Edq18N2pdT3Sz9EukbZe4YsQkvmxvmmkUL1KHpv96xJF
PERCOLATOR_SLAB=J55KavPouZg8ZeWnTY77ZBL2DdQskzKpkFvuTtbUNzYC
VAULT_PDA=4pL2aQawAbc2XwjRE9ptrH4yxihn4BL2uVMavgZrtYUK
COLLATERAL_MINT=2uGTCDSfisKCTN2Yd8umXiWJzfRpWe8mhZM6WCK2vj8D
CRANK_INTERVAL_MS=30000
```

---

## 9. Share Token Economics

Share tokens represent a user's portion of the vault's total equity.

### Share Price Formula

```
share_price = vault_equity / total_shares

vault_equity = capital + realized_pnl + unrealized_pnl
```

### Example

```
Day 1: Alice deposits 100 USDC
  → total_shares = 100, total_equity = 100
  → share_price = 1.00

Day 2: Keeper makes a trade, vault profits 10 USDC
  → total_shares = 100, total_equity = 110
  → share_price = 1.10

Day 3: Bob deposits 100 USDC
  → Bob gets: 100 / 1.10 = 90.9 shares
  → total_shares = 190.9, total_equity = 210
  → share_price = 1.10 (unchanged — Bob entered at fair value)

Day 4: Alice withdraws all 100 shares
  → Alice gets: 100 * 1.10 = 110 USDC
  → Alice made $10 profit (10%)
```

### Fees

- **Performance fee (20%)** — taken on profits above the high-water mark
- **Management fee (2% annual)** — taken on AUM, accrued per-second
- Fees are collected by minting additional shares to the manager (dilutive)

---

## 10. Security Model

### What Protects Users

| Threat | Protection |
|---|---|
| Manager steals funds | Vault PDA has no private key — withdrawals go to share holders, not manager |
| Exchange insolvency | Percolator H ratio — formally verified, scales withdrawals if underfunded |
| Excessive drawdown | **Circuit breaker** — auto-rejects trades when equity drops beyond configured limit from peak |
| Malicious CPI callers | **CPI whitelist** — vault manager restricts which programs can call cpi_trade |
| Oversized CPI trades | **Configurable size limit** — per-vault max trade size for external callers |
| Bad trades | Performance fee aligns manager incentives with depositors |
| Oracle manipulation | Percolator has oracle confidence checks and price circuit breakers |
| Liquidation cascade | Percolator's A/K ADL (auto-deleverage) is deterministic and fair |

### Circuit Breakers (Automatic, No Governance Needed)

The vault manager configures protection via `set_circuit_breaker`:

```
max_drawdown_bps = 2000  (20% max drawdown from peak)
cpi_whitelist = KaminoProgramId  (only Kamino can CPI trade)
max_cpi_trade_size = 10000  (max 10K units per CPI trade)
```

When equity drops 20% from peak, ALL trades (manager and CPI) are automatically rejected. No governance vote, no manual intervention, no keeper action required.

### What Does NOT Protect Users (Honest Assessment)

- **Smart contract bugs in Syntx** — the vault program (15 instructions) is **unaudited**. 20 tests pass, but tests are not a substitute for a professional security audit. An audit is non-negotiable before mainnet.
- **Keeper failure during extreme volatility** — the keeper has retry logic but no redundancy. If the keeper goes down during a liquidation cascade, the vault cannot rebalance.
- **Composability risk propagation** — CPI whitelist and size limits reduce but do not eliminate cross-program risk. A vulnerability in a whitelisted program could propagate to Syntx.
- **Oracle failure** — if the oracle price is wrong, trades execute at wrong prices. Devnet uses centralized push oracle; mainnet would use Pyth.

### Trust Assumptions

1. **Percolator is correct** — formally verified with Kani theorem prover, but formal verification has limits
2. **The vault program is correct** — needs a security audit (~$50-100K)
3. **The keeper is honest** — can make bad trades, but cannot steal funds
4. **The oracle is accurate** — production uses Pyth decentralized price feeds
5. **Circuit breakers are configured** — if the manager doesn't set them, the protection doesn't activate

---

## 11. What Lives On-Chain vs Off-Chain

### On-Chain (Solana)

| What | Where | Size |
|---|---|---|
| Syntx Vault Program | BPF loader | 342 KB |
| Percolator Program | BPF loader | 320 KB |
| Vault State (PDA) | Syntx program | ~250 bytes |
| Percolator Slab | Percolator program | 1.15 MB |
| Share Mint | SPL Token | 82 bytes |
| Token Accounts | SPL Token | 165 bytes each |

### Off-Chain

| What | Where | Purpose |
|---|---|---|
| Keeper bot | EC2 / local machine | Reads state, submits TXs |
| Strategy logic | Inside keeper | Decides when to trade |
| Oracle prices | Pyth Network | Provides market prices |
| Frontend | Vercel (planned) | User deposit/withdraw UI |

---

## 12. Glossary

| Term | Definition |
|---|---|
| **CPI** | Cross-Program Invocation — one Solana program calling another |
| **PDA** | Program Derived Address — an address only a program can sign for |
| **Slab** | A Percolator market account containing all trading accounts |
| **LP** | Liquidity Provider — takes the other side of user trades |
| **H Ratio** | Percolator's withdrawal haircut — ensures solvency |
| **A/K ADL** | Auto-deleverage system — fairly reduces positions when insurance is depleted |
| **Funding Rate** | Periodic payment between longs and shorts to keep perp price near spot |
| **Crank** | An off-chain bot call that triggers on-chain state updates (funding, etc.) |
| **Share Token** | SPL token representing a user's portion of vault equity |
| **invoke_signed** | Solana function that lets a program sign as a PDA |
| **Anchor** | Solana development framework (used by Syntx vault program) |
| **Kani** | Formal verification tool used to prove Percolator's safety properties |
