import { VenueAdapter, Position, OrderResult, VenueState } from "./types";

// =============================================================================
// VenueRouter — routes trades to the best available execution venue
// =============================================================================

export interface RouteDecision {
  venue: VenueAdapter;
  reason: string;
}

/**
 * VenueRouter manages multiple execution venues and routes trades to the
 * best one based on price, liquidity, and funding rate.
 *
 * It implements VenueAdapter itself, so the keeper treats the router
 * as a single venue — the routing logic is transparent.
 */
export class VenueRouter implements VenueAdapter {
  readonly name = "Router";
  readonly type = "hybrid" as const;

  private venues: VenueAdapter[];
  private activeVenue: VenueAdapter | null = null;

  constructor(venues: VenueAdapter[]) {
    if (venues.length === 0) throw new Error("VenueRouter requires at least one venue");
    this.venues = venues;
  }

  async initialize(): Promise<void> {
    console.log(`  [${this.name}] Initializing ${this.venues.length} venue(s)...`);
    for (const venue of this.venues) {
      try {
        await venue.initialize();
      } catch (err: any) {
        console.log(`  [${this.name}] WARNING: ${venue.name} failed to initialize: ${err?.message?.slice(0, 100)}`);
      }
    }
    this.activeVenue = this.venues[0];
  }

  async getPrice(market: string): Promise<number> {
    // Return best price across all venues
    let bestPrice = 0;
    for (const venue of this.venues) {
      try {
        const price = await venue.getPrice(market);
        if (price > 0) bestPrice = bestPrice === 0 ? price : Math.min(bestPrice, price);
      } catch { /* skip unavailable venues */ }
    }
    return bestPrice;
  }

  async getPosition(): Promise<Position | null> {
    // Return position from the active venue (where we have a position)
    for (const venue of this.venues) {
      try {
        const pos = await venue.getPosition();
        if (pos && (pos.size !== 0n || pos.capital > 0n)) {
          this.activeVenue = venue;
          return pos;
        }
      } catch { /* skip */ }
    }
    // No position anywhere — return from first venue
    return this.venues[0].getPosition();
  }

  async getVenueState(): Promise<VenueState> {
    // Route to the venue with the best opportunity
    const route = await this.selectBestVenue();
    this.activeVenue = route.venue;
    const state = await route.venue.getVenueState();
    console.log(`  [${this.name}] Selected: ${route.venue.name} — ${route.reason}`);
    return state;
  }

  async trade(size: bigint): Promise<OrderResult> {
    if (!this.activeVenue) {
      const route = await this.selectBestVenue();
      this.activeVenue = route.venue;
    }
    console.log(`  [${this.name}] Routing trade to ${this.activeVenue.name}`);
    return this.activeVenue.trade(size);
  }

  async crank(): Promise<void> {
    // Crank all venues — maintenance should happen everywhere
    for (const venue of this.venues) {
      try {
        await venue.crank();
      } catch (err: any) {
        console.log(`  [${this.name}] ${venue.name} crank failed: ${err?.message?.slice(0, 80)}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Routing logic
  // ---------------------------------------------------------------------------

  private async selectBestVenue(): Promise<RouteDecision> {
    const scores: { venue: VenueAdapter; score: number; reason: string }[] = [];

    for (const venue of this.venues) {
      try {
        const state = await venue.getVenueState();
        let score = 0;
        const reasons: string[] = [];

        // Perp venues: score by funding rate magnitude (higher = more yield)
        if (venue.type === "perp") {
          const absFunding = state.fundingRateBpsPerSlot < 0n
            ? -state.fundingRateBpsPerSlot
            : state.fundingRateBpsPerSlot;
          score += Number(absFunding) * 10;
          reasons.push(`funding=${state.fundingRateBpsPerSlot}`);
        }

        // All venues: score by liquidity (more accounts/depth = safer)
        if (state.numAccounts > 0) {
          score += Math.min(state.numAccounts, 50); // cap at 50
          reasons.push(`depth=${state.numAccounts}`);
        }

        // Perp venues: bonus for having insurance
        if (state.insuranceBalance > 0n) {
          score += 20;
          reasons.push("insured");
        }

        // Spot venues: baseline score (useful for hedging, not yield)
        if (venue.type === "spot") {
          score += 5;
          reasons.push("spot");
        }

        scores.push({ venue, score, reason: reasons.join(", ") });
      } catch {
        scores.push({ venue, score: -1, reason: "unreachable" });
      }
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    // Log comparison
    for (const s of scores) {
      console.log(`  [${this.name}]   ${s.venue.name}: score=${s.score} (${s.reason})`);
    }

    const best = scores[0];
    return { venue: best.venue, reason: best.reason };
  }
}
