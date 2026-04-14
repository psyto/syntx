/**
 * Structured Product Keeper — orchestrates lending + spot venues
 *
 * Unlike the single-venue funding rate keeper, this keeper manages
 * two venues simultaneously:
 *   - Lending venue (Kamino): earns yield for principal protection
 *   - Spot venue (Jupiter/Phoenix): SOL exposure for upside
 *
 * The strategy maintains the invariant that lending yield covers
 * the max possible loss on the spot allocation over the protection horizon.
 */

import { VenueAdapter } from "./venues";
import { KaminoAdapter } from "./venues/kamino";
import {
  StructuredProductConfig,
  DEFAULT_CONFIG,
  computeAllocation,
  computeRebalance,
} from "./structured-strategy";

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
}

/**
 * Run the structured product keeper loop.
 *
 * @param lendingVenue - Kamino adapter for USDC lending
 * @param spotVenue - Phoenix or Jupiter adapter for SOL spot exposure
 * @param totalCapitalFn - Function that returns the vault's total USDC capital
 * @param config - Keeper and strategy configuration
 */
export async function runStructuredKeeper(
  lendingVenue: KaminoAdapter,
  spotVenue: VenueAdapter,
  totalCapitalFn: () => Promise<bigint>,
  config: StructuredKeeperConfig,
): Promise<void> {
  console.log(`[${ts()}] Structured Product Keeper starting...`);
  console.log(`  Lending venue: ${lendingVenue.name}`);
  console.log(`  Spot venue:    ${spotVenue.name} (${spotVenue.type})`);
  console.log(`  Horizon:       ${config.strategy.protectionHorizonDays} days`);
  console.log(`  Lending floor: ${config.strategy.minLendingPct}%`);
  console.log(`  Spot cap:      ${config.strategy.maxSpotPct}%`);
  console.log(`  Rebalance at:  ${config.strategy.rebalanceThresholdPct}% drift`);
  console.log(`  Interval:      ${config.crankIntervalMs}ms\n`);

  await lendingVenue.initialize();
  await spotVenue.initialize();

  let loopCount = 0;

  while (true) {
    loopCount++;
    console.log(`\n[${ts()}] === Structured Tick #${loopCount} ===`);

    try {
      await structuredTick(lendingVenue, spotVenue, totalCapitalFn, config.strategy);
    } catch (err) {
      console.error(`[${ts()}] Error:`, err instanceof Error ? err.message : err);
    }

    await sleep(config.crankIntervalMs);
  }
}

async function structuredTick(
  lendingVenue: KaminoAdapter,
  spotVenue: VenueAdapter,
  totalCapitalFn: () => Promise<bigint>,
  config: StructuredProductConfig,
): Promise<void> {
  // 1. Read current state from both venues
  const [lendingPos, spotPos, lendingState, spotState] = await Promise.all([
    lendingVenue.getPosition(),
    spotVenue.getPosition(),
    lendingVenue.getVenueState(),
    spotVenue.getVenueState(),
  ]);

  const currentLending = lendingPos?.capital ?? 0n;
  const currentSpot = spotPos?.capital ?? 0n;
  const totalCapital = await totalCapitalFn();

  const supplyApy = lendingVenue.supplyApy;
  const spotPrice = await spotVenue.getPrice("SOL");

  console.log(`  Vault capital: ${usdcFmt(totalCapital)}`);
  console.log(`  Lending: ${usdcFmt(currentLending)} | Spot: ${usdcFmt(currentSpot)}`);
  console.log(`  Kamino APY: ${(supplyApy * 100).toFixed(2)}% | SOL: $${spotPrice.toFixed(2)}`);

  // 2. Crank both venues
  await Promise.all([
    lendingVenue.crank(),
    spotVenue.crank(),
  ]);

  // 3. Compute allocation and rebalance decision
  const allocation = computeAllocation(totalCapital, supplyApy, config);
  console.log(`  Target: ${allocation.lendingPct.toFixed(1)}% lending / ${allocation.spotPct.toFixed(1)}% spot`);
  console.log(`  Max drawdown at maturity: ${allocation.maxDrawdown.toFixed(2)}% (covered by yield)`);

  const decision = computeRebalance(
    totalCapital,
    currentLending,
    currentSpot,
    supplyApy,
    config,
  );

  console.log(`  [strategy] ${decision.action}: ${decision.reason}`);

  // 4. Execute rebalance if needed
  if (decision.action === "hold") return;

  if (decision.action === "initialize" || decision.action === "rebalance") {
    // Execute lending side first (safer — USDC stays in lending)
    if (decision.lendingDelta !== 0n) {
      const lendingAction = decision.lendingDelta > 0n ? "DEPOSIT" : "WITHDRAW";
      const lendingAbs = decision.lendingDelta > 0n ? decision.lendingDelta : -decision.lendingDelta;
      console.log(`  [execute] Lending: ${lendingAction} ${usdcFmt(lendingAbs)}`);
      await lendingVenue.trade(decision.lendingDelta);
    }

    // Then execute spot side
    if (decision.spotDelta !== 0n) {
      const spotAction = decision.spotDelta > 0n ? "BUY" : "SELL";
      const spotAbs = decision.spotDelta > 0n ? decision.spotDelta : -decision.spotDelta;
      console.log(`  [execute] Spot: ${spotAction} ${usdcFmt(spotAbs)} SOL`);
      await spotVenue.trade(decision.spotDelta);
    }

    // Log final state
    const newLending = currentLending + decision.lendingDelta;
    const newSpot = currentSpot + decision.spotDelta;
    console.log(`  [done] Lending: ${usdcFmt(newLending)} | Spot: ${usdcFmt(newSpot)}`);
  }
}
