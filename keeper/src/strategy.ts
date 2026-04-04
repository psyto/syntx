/**
 * Syntx Keeper Strategy — Funding Rate Harvest
 *
 * Ported from Yogi's strategy logic. Monitors Percolator's funding rate
 * and positions the vault to collect funding payments.
 *
 * Funding rate > 0 → longs pay shorts → go SHORT to collect
 * Funding rate < 0 → shorts pay longs → go LONG to collect
 * Funding rate ≈ 0 → no edge → close position
 */

// =============================================================================
// Types
// =============================================================================

export type VolRegime = "low" | "normal" | "high" | "extreme";
export type Signal = "none" | "low" | "medium" | "high";

export interface MarketState {
  fundingRateBpsPerSlot: bigint;
  vaultCapital: bigint;
  vaultPosition: bigint;
  insuranceBalance: bigint;
  numAccounts: number;
}

export interface TradeDecision {
  action: "open-long" | "open-short" | "close" | "hold";
  size: bigint;
  reason: string;
}

// =============================================================================
// Strategy Config
// =============================================================================

export const STRATEGY_CONFIG = {
  // Minimum funding rate to enter a position (bps per slot)
  // ~1 bps/slot ≈ 0.5% per hour ≈ 12% per day ≈ 4380% annualized
  // In practice, 0 means any non-zero funding triggers entry
  minFundingRateBps: 0n,

  // Maximum position size as % of capital (in basis points)
  maxPositionPctBps: 5000n, // 50% of capital

  // Minimum capital to trade (raw units)
  minCapitalToTrade: 100n,

  // Close position when funding flips against us (rate crosses zero)
  closeOnFlip: true,

  // Deployment matrix: vol regime × signal → % of capital to deploy
  deploymentMatrix: {
    low:     { none: 80, low: 60, medium: 40, high: 0 },
    normal:  { none: 60, low: 45, medium: 25, high: 0 },
    high:    { none: 30, low: 20, medium: 10, high: 0 },
    extreme: { none: 0,  low: 0,  medium: 0,  high: 0 },
  } as Record<VolRegime, Record<Signal, number>>,
};

// =============================================================================
// Regime Detection
// =============================================================================

/**
 * Simple vol regime from funding rate magnitude.
 * In production, use actual price volatility from oracle history.
 */
export function detectVolRegime(fundingRate: bigint): VolRegime {
  const abs = fundingRate < 0n ? -fundingRate : fundingRate;
  if (abs > 100n) return "extreme";
  if (abs > 50n) return "high";
  if (abs > 10n) return "normal";
  return "low";
}

/**
 * Simple signal detection from insurance fund health.
 * In production, use anomaly detection (OI spikes, spread blowouts, etc.)
 */
export function detectSignal(state: MarketState): Signal {
  // If insurance is very low relative to vault, something's wrong
  if (state.insuranceBalance === 0n && state.numAccounts > 2) return "high";
  if (state.numAccounts > 50) return "medium"; // crowded market
  return "none";
}

// =============================================================================
// Trade Decision
// =============================================================================

/**
 * Core strategy logic: decide what to do based on current state.
 */
export function computeTradeDecision(state: MarketState): TradeDecision {
  const { fundingRateBpsPerSlot, vaultCapital, vaultPosition } = state;

  // Not enough capital to trade
  if (vaultCapital < STRATEGY_CONFIG.minCapitalToTrade) {
    return { action: "hold", size: 0n, reason: `Capital too low (${vaultCapital})` };
  }

  // Compute regime
  const volRegime = detectVolRegime(fundingRateBpsPerSlot);
  const signal = detectSignal(state);
  const deploymentPct = STRATEGY_CONFIG.deploymentMatrix[volRegime][signal];

  // Zero deployment = full defense
  if (deploymentPct === 0) {
    if (vaultPosition !== 0n) {
      return { action: "close", size: vaultPosition < 0n ? -vaultPosition : vaultPosition,
        reason: `Defensive: ${volRegime}/${signal} → close all` };
    }
    return { action: "hold", size: 0n, reason: `Defensive: ${volRegime}/${signal}` };
  }

  // Calculate target position size
  const maxSize = (vaultCapital * STRATEGY_CONFIG.maxPositionPctBps) / 10000n;
  const targetSize = (maxSize * BigInt(deploymentPct)) / 100n;

  if (targetSize === 0n) {
    return { action: "hold", size: 0n, reason: "Target size too small" };
  }

  // Determine direction based on funding rate
  const fundingPositive = fundingRateBpsPerSlot > STRATEGY_CONFIG.minFundingRateBps;
  const fundingNegative = fundingRateBpsPerSlot < -STRATEGY_CONFIG.minFundingRateBps;

  // No edge — close if open, otherwise hold
  if (!fundingPositive && !fundingNegative) {
    if (vaultPosition !== 0n) {
      return { action: "close", size: vaultPosition < 0n ? -vaultPosition : vaultPosition,
        reason: "Funding near zero — closing" };
    }
    return { action: "hold", size: 0n, reason: "Funding near zero — no edge" };
  }

  // Funding is positive → longs pay shorts → go SHORT to collect
  if (fundingPositive) {
    if (vaultPosition > 0n && STRATEGY_CONFIG.closeOnFlip) {
      // We're long but should be short — close first
      return { action: "close", size: vaultPosition,
        reason: "Funding flipped positive — closing long before shorting" };
    }
    if (vaultPosition <= 0n) {
      // Already short or flat — adjust to target
      const currentShort = vaultPosition < 0n ? -vaultPosition : 0n;
      if (currentShort >= targetSize) {
        return { action: "hold", size: 0n,
          reason: `Already short ${currentShort}, target ${targetSize}` };
      }
      const delta = targetSize - currentShort;
      return { action: "open-short", size: delta,
        reason: `Funding +${fundingRateBpsPerSlot} bps/slot, ${volRegime}/${signal} → short ${delta} (${deploymentPct}%)` };
    }
  }

  // Funding is negative → shorts pay longs → go LONG to collect
  if (fundingNegative) {
    if (vaultPosition < 0n && STRATEGY_CONFIG.closeOnFlip) {
      return { action: "close", size: -vaultPosition,
        reason: "Funding flipped negative — closing short before longing" };
    }
    if (vaultPosition >= 0n) {
      const currentLong = vaultPosition > 0n ? vaultPosition : 0n;
      if (currentLong >= targetSize) {
        return { action: "hold", size: 0n,
          reason: `Already long ${currentLong}, target ${targetSize}` };
      }
      const delta = targetSize - currentLong;
      return { action: "open-long", size: delta,
        reason: `Funding ${fundingRateBpsPerSlot} bps/slot, ${volRegime}/${signal} → long ${delta} (${deploymentPct}%)` };
    }
  }

  return { action: "hold", size: 0n, reason: "Unexpected state" };
}

/**
 * Convert a TradeDecision to a Percolator trade size (i128).
 * Positive = long, negative = short.
 */
export function decisionToTradeSize(decision: TradeDecision): bigint | null {
  switch (decision.action) {
    case "open-long": return decision.size;
    case "open-short": return -decision.size;
    case "close": return 0n; // close by opening opposite — caller needs current position
    case "hold": return null;
  }
}
