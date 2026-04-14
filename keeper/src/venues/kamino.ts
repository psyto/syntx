import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { VenueAdapter, Position, OrderResult, VenueState } from "./types";

// =============================================================================
// KaminoAdapter — USDC lending via Kamino Finance (klend)
//
// Treats Kamino lending as a "spot" venue for the structured product strategy:
//   - deposit(positive size) = supply USDC to earn yield
//   - withdraw(negative size) = remove USDC from lending pool
//   - supply APY reported as pseudo funding rate for router scoring
// =============================================================================

// Kamino Main Market (USDC reserve)
const MAIN_MARKET = new PublicKey("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF");
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const KAMINO_PROGRAM_ID = new PublicKey("KLend2g3cP87ber41GFZvMihghXaoeBHgAieTUiMJ5aU");

// Slots per year for APY → bps/slot conversion
// ~2.5 slots/sec × 86400 sec/day × 365 days
const SLOTS_PER_YEAR = 78_840_000n;

export interface KaminoConfig {
  connection: Connection;
  manager: Keypair;
  vaultPda: PublicKey;
  marketAddress?: PublicKey; // defaults to Main Market
  reserveMint?: PublicKey;   // defaults to USDC
}

export class KaminoAdapter implements VenueAdapter {
  readonly name = "Kamino";
  readonly type = "spot" as const;

  private config: KaminoConfig;
  private market: any | null = null; // KaminoMarket from SDK
  private sdk: any | null = null;    // lazy-loaded klend-sdk module

  // Track position locally (deposit/withdraw deltas)
  // In production, read from on-chain obligation
  private depositedAmount = 0n;
  private accruedYield = 0n;
  private lastSupplyApy = 0;

  constructor(config: KaminoConfig) {
    this.config = {
      ...config,
      marketAddress: config.marketAddress ?? MAIN_MARKET,
      reserveMint: config.reserveMint ?? USDC_MINT,
    };
  }

  async initialize(): Promise<void> {
    // Lazy-load klend-sdk to avoid hard dependency at import time
    try {
      // @ts-ignore — optional dependency, graceful fallback to simulation mode
      this.sdk = await import("@kamino-finance/klend-sdk");
    } catch {
      console.warn(`  [${this.name}] klend-sdk not installed — running in simulation mode`);
      console.warn(`  [${this.name}] Install: pnpm add @kamino-finance/klend-sdk`);
      this.sdk = null;
    }

    if (this.sdk) {
      this.market = await this.sdk.KaminoMarket.load(
        this.config.connection,
        this.config.marketAddress!,
        400, // slot duration ms
      );
      if (!this.market) {
        throw new Error(`Failed to load Kamino market: ${this.config.marketAddress!.toBase58()}`);
      }
      await this.market.loadReserves();

      // Read current supply APY
      const reserve = this.market.getReserveByMint(this.config.reserveMint!);
      if (reserve) {
        this.lastSupplyApy = reserve.stats?.supplyInterestAPY ?? 0;
      }
    }

    console.log(`  [${this.name}] Initialized — market ${this.config.marketAddress!.toBase58().slice(0, 8)}...`);
    console.log(`  [${this.name}] Supply APY: ${(this.lastSupplyApy * 100).toFixed(2)}%`);
  }

  async getPrice(_market: string): Promise<number> {
    // USDC lending — price is always $1.00
    return 1.0;
  }

  async getPosition(): Promise<Position | null> {
    // Try to read on-chain obligation if SDK is available
    if (this.sdk && this.market) {
      try {
        const obligation = await this.market.getObligationByWallet(
          this.config.vaultPda,
          new this.sdk.VanillaObligation(KAMINO_PROGRAM_ID),
        );

        if (obligation) {
          const deposits = obligation.deposits;
          let totalDeposited = 0n;
          for (const [, info] of deposits.entries()) {
            const amt = info.amount ?? 0;
            totalDeposited += BigInt(Math.floor(amt * 1_000_000));
          }

          return {
            size: totalDeposited,
            entryPrice: 1_000_000n, // $1.00 in 6 decimals
            pnl: 0n, // yield is reflected in size growth
            capital: totalDeposited,
          };
        }
      } catch {
        // Fall through to local tracking
      }
    }

    // Local tracking fallback
    if (this.depositedAmount === 0n) return null;

    return {
      size: this.depositedAmount,
      entryPrice: 1_000_000n, // $1.00
      pnl: this.accruedYield,
      capital: this.depositedAmount,
    };
  }

  async getVenueState(): Promise<VenueState> {
    if (this.sdk && this.market) {
      try {
        await this.market.loadReserves();
        const reserve = this.market.getReserveByMint(this.config.reserveMint!);
        if (reserve) {
          this.lastSupplyApy = reserve.stats?.supplyInterestAPY ?? 0;
        }
      } catch {
        // Use cached APY
      }
    }

    // Convert APY to bps/slot so the VenueRouter can compare with perp funding rates
    // APY 0.08 (8%) → 800 bps/year → 800 / 78_840_000 ≈ 0.00001 bps/slot
    // This is tiny compared to perp funding, so we scale differently:
    // Report APY as bps × 100 to make it comparable in router scoring
    const apyBps = BigInt(Math.floor(this.lastSupplyApy * 10000));

    return {
      fundingRateBpsPerSlot: apyBps, // pseudo: APY in bps (not per-slot) for router comparison
      insuranceBalance: 0n,           // Kamino has protocol reserves, not insurance per se
      numAccounts: 100,               // placeholder — Kamino markets are deep
    };
  }

  async trade(size: bigint): Promise<OrderResult> {
    const isDeposit = size > 0n;
    const absSize = isDeposit ? size : -size;
    const action = isDeposit ? "deposit" : "withdraw";

    if (this.sdk && this.market) {
      const sig = isDeposit
        ? await this.executeDeposit(absSize)
        : await this.executeWithdraw(absSize);

      // Update local tracking
      if (isDeposit) {
        this.depositedAmount += absSize;
      } else {
        this.depositedAmount -= absSize > this.depositedAmount ? this.depositedAmount : absSize;
      }

      const uiAmount = Number(absSize) / 1_000_000;
      console.log(`  [${this.name}] ${action.toUpperCase()} ${uiAmount} USDC → ${sig.slice(0, 16)}...`);

      return {
        signature: sig,
        side: isDeposit ? "long" : "short", // deposit = "long" yield, withdraw = "short"
        size: absSize,
      };
    }

    // Simulation mode — no SDK
    if (isDeposit) {
      this.depositedAmount += absSize;
    } else {
      this.depositedAmount -= absSize > this.depositedAmount ? this.depositedAmount : absSize;
    }

    const uiAmount = Number(absSize) / 1_000_000;
    console.log(`  [${this.name}] [SIM] ${action.toUpperCase()} ${uiAmount} USDC`);

    return {
      signature: `sim-${Date.now()}`,
      side: isDeposit ? "long" : "short",
      size: absSize,
    };
  }

  async crank(): Promise<void> {
    // Refresh market data and update cached APY
    if (this.sdk && this.market) {
      try {
        await this.market.loadReserves();
        const reserve = this.market.getReserveByMint(this.config.reserveMint!);
        if (reserve) {
          const newApy = reserve.stats?.supplyInterestAPY ?? 0;
          if (newApy !== this.lastSupplyApy) {
            console.log(`  [${this.name}] APY updated: ${(this.lastSupplyApy * 100).toFixed(2)}% → ${(newApy * 100).toFixed(2)}%`);
            this.lastSupplyApy = newApy;
          }
        }
      } catch {
        // Non-critical
      }
    }
    console.log(`  [${this.name}] Market refreshed — APY: ${(this.lastSupplyApy * 100).toFixed(2)}%`);
  }

  // --- Private helpers ---

  private async executeDeposit(amount: bigint): Promise<string> {
    const BN = (await import("bn.js")).default;
    const action = await this.sdk.KaminoAction.buildDepositTxns(
      this.market,
      new BN(amount.toString()),
      this.config.reserveMint!,
      this.config.manager.publicKey,
      new this.sdk.VanillaObligation(KAMINO_PROGRAM_ID),
      true,       // includeAtaIxs
      undefined,  // referrer
      1_000_000,  // priority fee
      true,       // addComputeBudget
      false,      // addLookupTableIxs
    );

    const instructions = [
      ...action.setupIxs,
      ...action.lendingIxs,
      ...action.cleanupIxs,
    ];

    const tx = new Transaction().add(...instructions);
    return sendAndConfirmTransaction(
      this.config.connection,
      tx,
      [this.config.manager],
    );
  }

  private async executeWithdraw(amount: bigint): Promise<string> {
    const BN = (await import("bn.js")).default;
    const action = await this.sdk.KaminoAction.buildWithdrawTxns(
      this.market,
      new BN(amount.toString()),
      this.config.reserveMint!,
      this.config.manager.publicKey,
      new this.sdk.VanillaObligation(KAMINO_PROGRAM_ID),
      true,
      undefined,
      1_000_000,
      true,
      false,
    );

    const instructions = [
      ...action.setupIxs,
      ...action.lendingIxs,
      ...action.cleanupIxs,
    ];

    const tx = new Transaction().add(...instructions);
    return sendAndConfirmTransaction(
      this.config.connection,
      tx,
      [this.config.manager],
    );
  }

  // --- Public getters for strategy use ---

  /** Current supply APY as a decimal (e.g., 0.08 = 8%) */
  get supplyApy(): number {
    return this.lastSupplyApy;
  }
}
