import { PublicKey } from "@solana/web3.js";

/** On-chain VaultState account data */
export interface VaultState {
  bump: number;
  manager: PublicKey;
  collateralMint: PublicKey;
  shareMint: PublicKey;
  percolatorProgram: PublicKey;
  percolatorSlab: PublicKey;
  percolatorUserIdx: number;
  totalShares: bigint;
  totalDeposits: bigint;
  performanceFeeBps: number;
  managementFeeBps: number;
  highWaterMark: bigint;
  lastFeeCollection: bigint;
  depositCap: bigint;
  paused: boolean;
  initialized: boolean;
}

/** Vault health summary (derived from on-chain state) */
export interface VaultHealth {
  /** Total collateral in Percolator account */
  capital: bigint;
  /** Realized PnL */
  pnl: bigint;
  /** Current position size (positive=long, negative=short) */
  positionSize: bigint;
  /** Entry price in e6 format */
  entryPrice: bigint;
  /** Account index in Percolator slab */
  accountIndex: number;
}

/** Share price and vault equity info */
export interface VaultInfo {
  /** Current share price (collateral per share, in raw units) */
  sharePrice: number;
  /** Total vault equity (capital + PnL) */
  totalEquity: bigint;
  /** Total shares outstanding */
  totalShares: bigint;
  /** Total collateral deposited */
  totalDeposits: bigint;
  /** Is the vault paused? */
  paused: boolean;
  /** Deposit cap (0 = unlimited) */
  depositCap: bigint;
  /** Performance fee in basis points */
  performanceFeeBps: number;
  /** Management fee in basis points */
  managementFeeBps: number;
}
