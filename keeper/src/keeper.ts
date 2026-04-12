import { VenueAdapter } from "./venues";
import { computeTradeDecision, decisionToTradeSize, MarketState } from "./strategy";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ts(): string {
  return new Date().toISOString();
}

export interface KeeperConfig {
  crankIntervalMs: number;
}

/**
 * Venue-agnostic keeper loop.
 *
 * The keeper doesn't know whether it's trading on Percolator, Phoenix,
 * or any other venue. It calls the VenueAdapter interface and lets the
 * strategy decide what to do based on market state.
 */
export async function runKeeper(venue: VenueAdapter, config: KeeperConfig): Promise<void> {
  console.log(`[${ts()}] Syntx Keeper starting...`);
  console.log(`  Venue:    ${venue.name} (${venue.type})`);
  console.log(`  Interval: ${config.crankIntervalMs}ms`);
  console.log(`  Strategy: Funding Rate Harvest\n`);

  await venue.initialize();

  let loopCount = 0;

  while (true) {
    loopCount++;
    console.log(`[${ts()}] === Tick #${loopCount} [${venue.name}] ===`);

    try {
      await tick(venue);
    } catch (err) {
      console.error(`[${ts()}] Error:`, err instanceof Error ? err.message : err);
    }

    await sleep(config.crankIntervalMs);
  }
}

async function tick(venue: VenueAdapter): Promise<void> {
  // 1. Read position
  const position = await venue.getPosition();
  if (!position) {
    console.log("  [!] Vault not found on venue");
    return;
  }

  const equity = position.capital + position.pnl;
  const sharePrice = equity > 0n ? Number(equity) / 1_000_000 : 0;

  console.log(`  Vault: capital=${position.capital} pnl=${position.pnl} pos=${position.size} equity=${equity}`);
  console.log(`  Share price: $${sharePrice.toFixed(6)}`);

  // 2. Read venue state
  const venueState = await venue.getVenueState();
  console.log(`  Market: funding=${venueState.fundingRateBpsPerSlot} bps/slot | accounts=${venueState.numAccounts} | insurance=${venueState.insuranceBalance}`);

  // 3. Run venue maintenance (oracle push, crank, etc.)
  await venue.crank();

  // 4. Strategy decision (venue-agnostic)
  const marketState: MarketState = {
    fundingRateBpsPerSlot: venueState.fundingRateBpsPerSlot,
    vaultCapital: position.capital,
    vaultPosition: position.size,
    insuranceBalance: venueState.insuranceBalance,
    numAccounts: venueState.numAccounts,
  };

  const decision = computeTradeDecision(marketState);
  console.log(`  [strategy] ${decision.action}: ${decision.reason}`);

  // 5. Execute trade if needed
  if (decision.action === "hold") return;

  let tradeSize: bigint;
  if (decision.action === "close") {
    tradeSize = -position.size;
  } else {
    const size = decisionToTradeSize(decision);
    if (!size) return;
    tradeSize = size;
  }

  if (tradeSize === 0n) return;

  await venue.trade(tradeSize);
}
