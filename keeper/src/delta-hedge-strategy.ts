/**
 * Delta Hedge Strategy — Synthetic Option Replication via Perps
 *
 * Replicates a call option payoff by continuously adjusting a perp position
 * according to Black-Scholes delta. Combined with Kamino lending for principal
 * protection, this creates a principal-protected option vault.
 *
 * The lending yield pays for rebalancing costs. The perp position captures
 * asymmetric upside — like owning a call option without buying one.
 *
 * Why this works now:
 * - Jupiter Perps has deep liquidity and low fees
 * - Pyth oracles are reliable on Solana
 * - Solana is fast enough for frequent rebalancing (~400ms slots)
 */

// =============================================================================
// Types
// =============================================================================

export interface DeltaHedgeConfig {
  /** Strike price in USD (set at vault creation, typically ATM) */
  strikePrice: number;

  /** Annualized implied volatility (e.g., 0.80 = 80%) */
  impliedVol: number;

  /** Time to expiry in days (decrements each tick) */
  expiryDays: number;

  /** Leverage on the perp position (e.g., 5 = 5x) */
  leverage: number;

  /** Only rebalance if delta drift exceeds this (e.g., 0.05 = 5%) */
  rebalanceThreshold: number;

  /** Minimum time between rebalances in seconds (prevents overtrading) */
  minRebalanceIntervalSec: number;
}

export const DEFAULT_DELTA_CONFIG: DeltaHedgeConfig = {
  strikePrice: 0,           // Set at first tick from current SOL price (ATM)
  impliedVol: 0.80,         // 80% — typical SOL annualized vol
  expiryDays: 30,           // Matches lending protection horizon
  leverage: 5,              // 5x leverage on perp margin
  rebalanceThreshold: 0.05, // Rebalance when delta drifts 5%+
  minRebalanceIntervalSec: 60, // At most once per minute
};

export interface HedgeState {
  solPrice: number;
  strikePrice: number;
  impliedVol: number;
  timeRemainingYears: number;
  marginCapital: bigint;       // USDC allocated to perp margin
  currentPerpSize: bigint;     // Current perp position size (raw units)
  lastRebalanceTime: number;   // Unix timestamp of last rebalance
}

export interface HedgeDecision {
  action: "rebalance" | "hold" | "close";
  targetDelta: number;
  currentDelta: number;
  targetSize: bigint;
  sizeDelta: bigint;          // Positive = increase long, negative = decrease
  reason: string;
}

// =============================================================================
// Black-Scholes Math
// =============================================================================

/** Standard normal CDF approximation (Abramowitz & Stegun) */
function normalCDF(x: number): number {
  if (x < -8) return 0;
  if (x > 8) return 1;

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Black-Scholes delta for a European call option.
 *
 * delta = N(d1)
 * d1 = [ln(S/K) + (r + σ²/2)T] / (σ√T)
 *
 * We use r=0 (DeFi has no risk-free rate in the traditional sense;
 * the lending yield is already captured separately).
 */
export function bsDelta(
  spot: number,
  strike: number,
  vol: number,
  timeYears: number,
): number {
  if (timeYears <= 0) {
    // At expiry: delta is 1 if ITM, 0 if OTM
    return spot >= strike ? 1.0 : 0.0;
  }

  if (strike <= 0 || vol <= 0) return 0;

  const sqrtT = Math.sqrt(timeYears);
  const d1 = (Math.log(spot / strike) + 0.5 * vol * vol * timeYears) / (vol * sqrtT);

  return normalCDF(d1);
}

/**
 * Black-Scholes gamma (rate of delta change).
 * Used to estimate rebalancing costs.
 *
 * gamma = N'(d1) / (S * σ * √T)
 */
export function bsGamma(
  spot: number,
  strike: number,
  vol: number,
  timeYears: number,
): number {
  if (timeYears <= 0 || strike <= 0 || vol <= 0) return 0;

  const sqrtT = Math.sqrt(timeYears);
  const d1 = (Math.log(spot / strike) + 0.5 * vol * vol * timeYears) / (vol * sqrtT);
  const nPrime = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);

  return nPrime / (spot * vol * sqrtT);
}

// =============================================================================
// Implied Volatility Estimation
// =============================================================================

/**
 * Estimate annualized volatility from a price history.
 * Uses log returns with standard deviation.
 *
 * @param prices - Array of prices (newest last)
 * @param intervalHours - Time between each price sample
 */
export function estimateVol(prices: number[], intervalHours: number): number {
  if (prices.length < 3) return 0.80; // fallback

  const logReturns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) {
      logReturns.push(Math.log(prices[i] / prices[i - 1]));
    }
  }

  if (logReturns.length === 0) return 0.80;

  const mean = logReturns.reduce((s, r) => s + r, 0) / logReturns.length;
  const variance = logReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / logReturns.length;
  const stdDev = Math.sqrt(variance);

  // Annualize: multiply by sqrt(periods per year)
  const periodsPerYear = (365 * 24) / intervalHours;
  return stdDev * Math.sqrt(periodsPerYear);
}

// =============================================================================
// Hedge Decision
// =============================================================================

/**
 * Compute the delta hedge rebalance decision.
 */
export function computeHedgeDecision(
  state: HedgeState,
  config: DeltaHedgeConfig,
): HedgeDecision {
  const now = Math.floor(Date.now() / 1000);

  // Compute current delta
  const targetDelta = bsDelta(
    state.solPrice,
    state.strikePrice,
    state.impliedVol,
    state.timeRemainingYears,
  );

  // Notional exposure = margin * leverage
  const marginUsd = Number(state.marginCapital) / 1_000_000;
  const notional = marginUsd * config.leverage;

  // Target perp size in USD
  const targetSizeUsd = notional * targetDelta;
  // Convert to raw units (6 decimals)
  const targetSize = BigInt(Math.floor(targetSizeUsd * 1_000_000));

  // Current delta (reverse from position size)
  const currentSizeUsd = Number(state.currentPerpSize) / 1_000_000;
  const currentDelta = notional > 0 ? currentSizeUsd / notional : 0;

  const sizeDelta = targetSize - state.currentPerpSize;
  const deltaDrift = Math.abs(targetDelta - currentDelta);

  // Check if expired
  if (state.timeRemainingYears <= 0) {
    if (state.currentPerpSize !== 0n) {
      return {
        action: "close",
        targetDelta,
        currentDelta,
        targetSize: 0n,
        sizeDelta: -state.currentPerpSize,
        reason: `Expired — closing perp position`,
      };
    }
    return {
      action: "hold", targetDelta, currentDelta, targetSize, sizeDelta: 0n,
      reason: "Expired — no position to close",
    };
  }

  // Check minimum rebalance interval
  if (now - state.lastRebalanceTime < config.minRebalanceIntervalSec) {
    return {
      action: "hold", targetDelta, currentDelta, targetSize, sizeDelta: 0n,
      reason: `Cooldown (${config.minRebalanceIntervalSec - (now - state.lastRebalanceTime)}s remaining)`,
    };
  }

  // Check if drift exceeds threshold
  if (deltaDrift < config.rebalanceThreshold) {
    return {
      action: "hold", targetDelta, currentDelta, targetSize, sizeDelta: 0n,
      reason: `Delta drift ${(deltaDrift * 100).toFixed(1)}% < threshold ${(config.rebalanceThreshold * 100).toFixed(0)}%`,
    };
  }

  return {
    action: "rebalance",
    targetDelta,
    currentDelta,
    targetSize,
    sizeDelta,
    reason: `Delta ${currentDelta.toFixed(3)} → ${targetDelta.toFixed(3)} (drift ${(deltaDrift * 100).toFixed(1)}%), size ${currentSizeUsd.toFixed(0)} → ${targetSizeUsd.toFixed(0)} USD`,
  };
}
