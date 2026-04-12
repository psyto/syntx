import { Connection, Keypair, PublicKey } from "@solana/web3.js";

// =============================================================================
// Venue Adapter — exchange-agnostic interface for execution venues
// =============================================================================

export interface Position {
  size: bigint;       // Signed: positive = long, negative = short, 0 = flat
  entryPrice: bigint; // In venue-native units
  pnl: bigint;        // Unrealized PnL
  capital: bigint;    // Deposited collateral
}

export interface OrderResult {
  signature: string;
  side: "long" | "short";
  size: bigint;
}

export interface VenueState {
  fundingRateBpsPerSlot: bigint;
  insuranceBalance: bigint;
  numAccounts: number;
}

export interface VenueConfig {
  connection: Connection;
  manager: Keypair;
  vaultPda: PublicKey;
}

/**
 * VenueAdapter — the interface every execution venue must implement.
 *
 * Syntx is exchange-agnostic: the keeper strategy calls these methods
 * instead of venue-specific code. Adding a new venue (Phoenix, Jupiter Perps,
 * Drift, etc.) means implementing this interface.
 */
export interface VenueAdapter {
  /** Human-readable venue name (e.g. "Percolator", "Phoenix") */
  readonly name: string;

  /** Venue type for routing decisions */
  readonly type: "perp" | "spot" | "hybrid";

  /** Initialize connection and validate venue is reachable */
  initialize(): Promise<void>;

  /** Get current price for the market (in USD, 6 decimals) */
  getPrice(market: string): Promise<number>;

  /** Get current position for the vault */
  getPosition(): Promise<Position | null>;

  /** Get venue-level state (funding rate, insurance, etc.) */
  getVenueState(): Promise<VenueState>;

  /** Execute a trade. Positive size = long, negative = short */
  trade(size: bigint): Promise<OrderResult>;

  /** Run venue-specific maintenance (crank funding, push oracle, etc.) */
  crank(): Promise<void>;
}
