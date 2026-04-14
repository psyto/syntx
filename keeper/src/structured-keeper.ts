/**
 * Structured Product Keeper — Principal-Protected Option via Delta Hedging
 *
 * Orchestrates two venues:
 *   - Lending venue (Kamino): earns yield for principal protection
 *   - Perp venue (Jupiter Perps): delta-hedged position replicating a call option
 *
 * The strategy maintains the invariant that lending yield covers
 * the max possible loss on the perp margin over the protection horizon.
 *
 * Unlike a simple spot allocation, the delta hedge gives asymmetric upside:
 * the perp position grows when SOL goes up, shrinks when SOL goes down.
 */

import { VenueAdapter } from "./venues";
import { KaminoAdapter } from "./venues/kamino";
import {
  StructuredProductConfig,
  DEFAULT_CONFIG,
  computeAllocation,
  computeRebalance,
} from "./structured-strategy";
import {
  DeltaHedgeConfig,
  DEFAULT_DELTA_CONFIG,
  HedgeState,
  computeHedgeDecision,
  bsDelta,
  bsGamma,
} from "./delta-hedge-strategy";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ts(): string {
  return new Date().toISOString();
}

function usdcFmt(raw: bigint): string {
  return `$${(Number(raw) / 1_000_000).toFixed(2)}`;
}

export interface StructuredKeeperConfig {
  crankIntervalMs: number;
  strategy: StructuredProductConfig;
  deltaHedge: DeltaHedgeConfig;
}

/**
 * Run the structured product keeper loop.
 */
export async function runStructuredKeeper(
  lendingVenue: KaminoAdapter,
  perpVenue: VenueAdapter,
  totalCapitalFn: () => Promise<bigint>,
  config: StructuredKeeperConfig,
): Promise<void> {
  console.log(`[${ts()}] Structured Product Keeper (Delta Hedge) starting...`);
  console.log(`  Lending venue: ${lendingVenue.name}`);
  console.log(`  Perp venue:    ${perpVenue.name} (${perpVenue.type})`);
  console.log(`  Horizon:       ${config.strategy.protectionHorizonDays} days`);
  console.log(`  Leverage:      ${config.deltaHedge.leverage}x`);
  console.log(`  Impl vol:      ${(config.deltaHedge.impliedVol * 100).toFixed(0)}%`);
  console.log(`  Rebal thresh:  ${(config.deltaHedge.rebalanceThreshold * 100).toFixed(0)}%`);
  console.log(`  Interval:      ${config.crankIntervalMs}ms\n`);

  await lendingVenue.initialize();
  await perpVenue.initialize();

  // Track state across ticks
  let strikePrice = config.deltaHedge.strikePrice;
  let startTime = Math.floor(Date.now() / 1000);
  let lastRebalanceTime = 0;
  let initialized = false;

  let loopCount = 0;

  while (true) {
    loopCount++;
    console.log(`\n[${ts()}] === Structured Tick #${loopCount} ===`);

    try {
      const result = await structuredTick(
        lendingVenue,
        perpVenue,
        totalCapitalFn,
        config,
        { strikePrice, startTime, lastRebalanceTime, initialized },
      );

      // Update state from tick
      if (result.strikePrice) strikePrice = result.strikePrice;
      if (result.startTime) startTime = result.startTime;
      if (result.lastRebalanceTime) lastRebalanceTime = result.lastRebalanceTime;
      if (result.initialized) initialized = true;
    } catch (err) {
      console.error(`[${ts()}] Error:`, err instanceof Error ? err.message : err);
    }

    await sleep(config.crankIntervalMs);
  }
}

interface TickState {
  strikePrice: number;
  startTime: number;
  lastRebalanceTime: number;
  initialized: boolean;
}

interface TickResult {
  strikePrice?: number;
  startTime?: number;
  lastRebalanceTime?: number;
  initialized?: boolean;
}

async function structuredTick(
  lendingVenue: KaminoAdapter,
  perpVenue: VenueAdapter,
  totalCapitalFn: () => Promise<bigint>,
  config: StructuredKeeperConfig,
  state: TickState,
): Promise<TickResult> {
  const result: TickResult = {};

  // 1. Read current state from both venues
  const [lendingPos, perpPos] = await Promise.all([
    lendingVenue.getPosition(),
    perpVenue.getPosition(),
  ]);

  const currentLending = lendingPos?.capital ?? 0n;
  const currentPerpSize = perpPos?.size ?? 0n;
  const perpMargin = perpPos?.capital ?? 0n;
  const totalCapital = await totalCapitalFn();

  // Get SOL price
  const solPrice = await perpVenue.getPrice("SOL");
  const supplyApy = lendingVenue.supplyApy;

  console.log(`  Capital: ${usdcFmt(totalCapital)} | Lending: ${usdcFmt(currentLending)} | Perp margin: ${usdcFmt(perpMargin)}`);
  console.log(`  SOL: $${solPrice.toFixed(2)} | Kamino APY: ${(supplyApy * 100).toFixed(2)}%`);

  // 2. Crank both venues
  await Promise.all([
    lendingVenue.crank(),
    perpVenue.crank(),
  ]);

  // 3. Initial allocation (first tick only)
  if (!state.initialized && totalCapital > 0n) {
    const alloc = computeAllocation(totalCapital, supplyApy, config.strategy);
    console.log(`  [init] Allocating: ${alloc.lendingPct.toFixed(1)}% lending / ${alloc.spotPct.toFixed(1)}% perp margin`);

    if (alloc.lendingTarget > 0n) {
      console.log(`  [init] Lending: DEPOSIT ${usdcFmt(alloc.lendingTarget)}`);
      await lendingVenue.trade(alloc.lendingTarget);
    }

    // Set strike price ATM
    const strike = state.strikePrice > 0 ? state.strikePrice : solPrice;
    result.strikePrice = strike;
    result.startTime = Math.floor(Date.now() / 1000);
    result.initialized = true;

    console.log(`  [init] Strike: $${strike.toFixed(2)} (ATM) | Expiry: ${config.deltaHedge.expiryDays}d`);
    return result;
  }

  if (!state.initialized) {
    console.log(`  [wait] No capital deposited yet`);
    return result;
  }

  // 4. Compute time remaining
  const now = Math.floor(Date.now() / 1000);
  const elapsed = now - state.startTime;
  const expirySeconds = config.deltaHedge.expiryDays * 86400;
  const timeRemainingYears = Math.max(0, (expirySeconds - elapsed) / (365 * 86400));

  // 5. Delta hedge decision
  const hedgeState: HedgeState = {
    solPrice,
    strikePrice: state.strikePrice,
    impliedVol: config.deltaHedge.impliedVol,
    timeRemainingYears,
    marginCapital: perpMargin > 0n ? perpMargin : computeAllocation(totalCapital, supplyApy, config.strategy).spotTarget,
    currentPerpSize: currentPerpSize,
    lastRebalanceTime: state.lastRebalanceTime,
  };

  const delta = bsDelta(solPrice, state.strikePrice, config.deltaHedge.impliedVol, timeRemainingYears);
  const gamma = bsGamma(solPrice, state.strikePrice, config.deltaHedge.impliedVol, timeRemainingYears);

  console.log(`  Delta: ${delta.toFixed(3)} | Gamma: ${gamma.toFixed(5)} | Time: ${(timeRemainingYears * 365).toFixed(1)}d`);

  const decision = computeHedgeDecision(hedgeState, config.deltaHedge);
  console.log(`  [hedge] ${decision.action}: ${decision.reason}`);

  // 6. Execute rebalance
  if (decision.action === "rebalance" || decision.action === "close") {
    if (decision.sizeDelta !== 0n) {
      console.log(`  [execute] Perp: ${decision.sizeDelta > 0n ? "INCREASE" : "DECREASE"} ${usdcFmt(decision.sizeDelta > 0n ? decision.sizeDelta : -decision.sizeDelta)}`);
      await perpVenue.trade(decision.sizeDelta);
      result.lastRebalanceTime = now;
    }
  }

  return result;
}
