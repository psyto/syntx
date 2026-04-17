/**
 * Intent Keeper — Shielded Cross-Venue Perp Intent Service
 *
 * Listens for encrypted intents, decrypts them, routes across
 * multiple perp venues via IntentRouter, and executes fills.
 *
 * This is the user-facing entry point for shielded perp trading.
 * The privacy solver handles encryption; this handles routing.
 */

import { VenueAdapter } from "./venues";
import { IntentRouter, Intent, IntentExecution } from "./intent-router";

function ts(): string {
  return new Date().toISOString();
}

export interface IntentKeeperConfig {
  pollIntervalMs: number;
  minVenueScore: number;
}

/**
 * Run the intent keeper loop.
 *
 * In production, intents arrive via WebSocket from the privacy solver.
 * For the hackathon demo, intents are submitted directly via the API.
 */
export async function runIntentKeeper(
  venues: VenueAdapter[],
  config: IntentKeeperConfig,
): Promise<void> {
  console.log(`[${ts()}] Intent Keeper starting...`);
  console.log(`  Venues: ${venues.map(v => v.name).join(", ")}`);
  console.log(`  Min score: ${config.minVenueScore}`);
  console.log(`  Poll: ${config.pollIntervalMs}ms\n`);

  // Initialize all venues
  for (const v of venues) {
    await v.initialize();
  }

  const router = new IntentRouter(venues, config.minVenueScore);

  // Intent queue — in production, populated by WebSocket from privacy solver
  const queue: Intent[] = [];

  // Expose queue for external submission (used by API route)
  (globalThis as any).__intentQueue = queue;
  (globalThis as any).__intentRouter = router;

  console.log(`[${ts()}] Intent Keeper ready — waiting for intents\n`);

  while (true) {
    if (queue.length > 0) {
      const intent = queue.shift()!;
      console.log(`\n[${ts()}] === Processing Intent ${intent.id} ===`);

      try {
        const result = await router.routeIntent(intent);
        logExecution(result);
      } catch (err) {
        console.error(`[${ts()}] Intent ${intent.id} failed:`, err);
      }
    }

    await sleep(config.pollIntervalMs);
  }
}

function logExecution(exec: IntentExecution): void {
  const sizeUsd = Number(exec.totalSize < 0n ? -exec.totalSize : exec.totalSize) / 1_000_000;
  const side = exec.totalSize > 0n ? "LONG" : "SHORT";
  const filledCount = exec.fills.filter(f => f.success).length;
  const totalCount = exec.fills.length;

  console.log(`[intent] ${exec.status.toUpperCase()}: ${side} $${sizeUsd.toFixed(2)} across ${filledCount}/${totalCount} venues`);

  for (const fill of exec.fills) {
    const fillUsd = Number(fill.size < 0n ? -fill.size : fill.size) / 1_000_000;
    const icon = fill.success ? "+" : "x";
    console.log(`  ${icon} ${fill.venue}: $${fillUsd.toFixed(2)} ${fill.success ? fill.signature.slice(0, 16) + "..." : fill.error}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
