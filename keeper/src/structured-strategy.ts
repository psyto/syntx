/**
 * Structured Product Strategy — Principal-Protected SOL Exposure
 *
 * Classic zero-coupon + call replication via synthetic construction:
 *   - Lending portion (Kamino): grows back to full principal over the horizon
 *   - Spot portion (Jupiter/Phoenix): captures SOL upside
 *
 * Invariant: at maturity, lending yield ≥ max loss on spot allocation.
 *   lending_alloc = total / (1 + apy * horizon)
 *   spot_alloc    = total - lending_alloc
 *
 * If SOL goes to zero, lending still returns the full principal.
 * If SOL goes up, user keeps the upside on the spot portion.
 */

import { VenueAdapter, Position } from "./venues";
import { KaminoAdapter } from "./venues/kamino";

// =============================================================================
// Types
// =============================================================================

export interface StructuredProductConfig {
  /** Protection horizon in days (e.g., 30 = 30-day principal protection) */
  protectionHorizonDays: number;

  /** Minimum lending allocation as % (safety floor, e.g., 80) */
  minLendingPct: number;

  /** Maximum spot allocation as % (cap, e.g., 15) */
  maxSpotPct: number;

  /** Only rebalance if allocation drifts by this % from target */
  rebalanceThresholdPct: number;

  /** Minimum capital to operate (in USDC raw units, 6 decimals) */
  minCapital: bigint;
}

export const DEFAULT_CONFIG: StructuredProductConfig = {
  protectionHorizonDays: 30,
  minLendingPct: 85,
  maxSpotPct: 15,
  rebalanceThresholdPct: 2,
  minCapital: 1_000_000n, // $1 USDC
};

export interface Allocation {
  lendingTarget: bigint;   // USDC to Kamino
  spotTarget: bigint;      // USDC to buy SOL
  lendingPct: number;      // 0-100
  spotPct: number;         // 0-100
  impliedApy: number;      // Kamino supply APY used
  maxDrawdown: number;     // worst case loss as % of total (should be ~0 at maturity)
}

export interface RebalanceDecision {
  action: "rebalance" | "hold" | "initialize";
  lendingDelta: bigint;    // positive = deposit more, negative = withdraw
  spotDelta: bigint;       // positive = buy more SOL, negative = sell
  reason: string;
}

// =============================================================================
// Allocation Math
// =============================================================================

/**
 * Compute the optimal split between lending and spot.
 *
 * Formula (continuous approximation):
 *   lending = total / (1 + apy * t)
 *   spot    = total - lending
 *
 * This ensures lending grows back to `total` over the horizon,
 * so even if spot goes to zero, user gets their principal back.
 */
export function computeAllocation(
  totalCapital: bigint,
  supplyApy: number,
  config: StructuredProductConfig,
): Allocation {
  const horizonYears = config.protectionHorizonDays / 365;
  const growthFactor = 1 + supplyApy * horizonYears;

  // Raw allocation from the protection formula
  let lendingPct = (1 / growthFactor) * 100;
  let spotPct = 100 - lendingPct;

  // Apply safety bounds
  lendingPct = Math.max(lendingPct, config.minLendingPct);
  spotPct = Math.min(spotPct, config.maxSpotPct);
  spotPct = Math.max(spotPct, 0);
  lendingPct = 100 - spotPct;

  const lendingTarget = (totalCapital * BigInt(Math.floor(lendingPct * 100))) / 10000n;
  const spotTarget = totalCapital - lendingTarget;

  // Max drawdown: if SOL goes to zero, lose the entire spot allocation
  // But lending yield covers it over the horizon
  const maxDrawdown = Number(spotTarget) / Number(totalCapital) * 100;

  return {
    lendingTarget,
    spotTarget,
    lendingPct,
    spotPct,
    impliedApy: supplyApy,
    maxDrawdown,
  };
}

/**
 * Decide whether to rebalance based on current vs target allocation.
 */
export function computeRebalance(
  totalCapital: bigint,
  currentLending: bigint,
  currentSpot: bigint,
  supplyApy: number,
  config: StructuredProductConfig,
): RebalanceDecision {
  if (totalCapital < config.minCapital) {
    return { action: "hold", lendingDelta: 0n, spotDelta: 0n, reason: "Capital below minimum" };
  }

  const target = computeAllocation(totalCapital, supplyApy, config);

  // First deployment — nothing allocated yet
  if (currentLending === 0n && currentSpot === 0n) {
    return {
      action: "initialize",
      lendingDelta: target.lendingTarget,
      spotDelta: target.spotTarget,
      reason: `Initial allocation: ${target.lendingPct.toFixed(1)}% lending / ${target.spotPct.toFixed(1)}% spot (APY ${(supplyApy * 100).toFixed(2)}%, horizon ${config.protectionHorizonDays}d)`,
    };
  }

  // Check if drift exceeds threshold
  const currentTotal = currentLending + currentSpot;
  if (currentTotal === 0n) {
    return { action: "hold", lendingDelta: 0n, spotDelta: 0n, reason: "No capital" };
  }

  const currentLendingPct = Number(currentLending * 10000n / currentTotal) / 100;
  const drift = Math.abs(currentLendingPct - target.lendingPct);

  if (drift < config.rebalanceThresholdPct) {
    return {
      action: "hold",
      lendingDelta: 0n,
      spotDelta: 0n,
      reason: `Drift ${drift.toFixed(1)}% < threshold ${config.rebalanceThresholdPct}% (lending ${currentLendingPct.toFixed(1)}% vs target ${target.lendingPct.toFixed(1)}%)`,
    };
  }

  // Rebalance needed
  const lendingDelta = target.lendingTarget - currentLending;
  const spotDelta = target.spotTarget - currentSpot;

  return {
    action: "rebalance",
    lendingDelta,
    spotDelta,
    reason: `Drift ${drift.toFixed(1)}%: lending ${currentLendingPct.toFixed(1)}% → ${target.lendingPct.toFixed(1)}%, spot ${(100 - currentLendingPct).toFixed(1)}% → ${target.spotPct.toFixed(1)}%`,
  };
}
