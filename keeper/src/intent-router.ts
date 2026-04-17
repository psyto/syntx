/**
 * IntentRouter — Shielded Cross-Venue Perp Intent Execution
 *
 * Takes a decrypted intent (size, slippage, deadline) and splits it
 * across multiple perp venues for best execution. The user's intent
 * is encrypted end-to-end — only the solver sees the order before fill.
 *
 * This is the missing piece between:
 *   - Privacy Solver (decrypt + validate) → already built
 *   - VenueRouter (score + select) → already built
 *   - VenueAdapters (execute on each venue) → already built
 *
 * IntentRouter connects them: decrypt → score → split → execute across venues.
 *
 * Why this matters:
 *   - Cross-venue spot routing exists (Jupiter, 1inch)
 *   - Cross-venue perp routing with privacy does NOT exist anywhere
 *   - Every large perp trade on Solana gets worse execution than it should
 */

import { VenueAdapter, VenueState } from "./venues";

// =============================================================================
// Types
// =============================================================================

export interface Intent {
  id: string;
  size: bigint;           // Signed: positive = long, negative = short
  maxSlippageBps: number; // Max acceptable price deviation
  deadline: bigint;       // Unix timestamp, 0 = no deadline
}

export interface VenueScore {
  venue: VenueAdapter;
  score: number;
  state: VenueState;
  allocation: bigint;     // How much of the intent goes to this venue
  allocationPct: number;  // Percentage of total
}

export interface IntentExecution {
  intent: Intent;
  venues: VenueScore[];
  totalSize: bigint;
  fills: IntentFill[];
  status: "pending" | "partial" | "filled" | "failed";
}

export interface IntentFill {
  venue: string;
  size: bigint;
  signature: string;
  success: boolean;
  error?: string;
}

// =============================================================================
// IntentRouter
// =============================================================================

export class IntentRouter {
  private venues: VenueAdapter[];
  private minVenueScore: number;

  /**
   * @param venues - Available perp venues to route across
   * @param minVenueScore - Minimum score for a venue to receive allocation (default 10)
   */
  constructor(venues: VenueAdapter[], minVenueScore: number = 10) {
    this.venues = venues.filter(v => v.type === "perp" || v.type === "hybrid");
    this.minVenueScore = minVenueScore;

    if (this.venues.length === 0) {
      throw new Error("IntentRouter requires at least one perp venue");
    }
  }

  /**
   * Score all venues and compute optimal allocation for an intent.
   * Does NOT execute — call executeIntent() to fill.
   */
  async planExecution(intent: Intent): Promise<IntentExecution> {
    console.log(`[intent-router] Planning: size=${intent.size}, slippage=${intent.maxSlippageBps}bps`);

    // Score each venue
    const scored: VenueScore[] = [];
    for (const venue of this.venues) {
      try {
        const state = await venue.getVenueState();
        const score = this.computeScore(venue, state);
        scored.push({ venue, score, state, allocation: 0n, allocationPct: 0 });
      } catch (err: any) {
        console.log(`[intent-router]   ${venue.name}: unreachable (${err?.message?.slice(0, 50)})`);
      }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Filter venues below minimum score
    const eligible = scored.filter(s => s.score >= this.minVenueScore);

    if (eligible.length === 0) {
      console.log(`[intent-router] No eligible venues (all below min score ${this.minVenueScore})`);
      return {
        intent,
        venues: scored,
        totalSize: intent.size,
        fills: [],
        status: "failed",
      };
    }

    // Allocate proportionally by score
    const totalScore = eligible.reduce((sum, s) => sum + s.score, 0);
    const absSize = intent.size < 0n ? -intent.size : intent.size;
    const sign = intent.size < 0n ? -1n : 1n;
    let allocated = 0n;

    for (let i = 0; i < eligible.length; i++) {
      const s = eligible[i];
      if (i === eligible.length - 1) {
        // Last venue gets the remainder (avoids rounding dust)
        s.allocation = (absSize - allocated) * sign;
      } else {
        const share = BigInt(Math.floor(Number(absSize) * s.score / totalScore));
        s.allocation = share * sign;
        allocated += share;
      }
      s.allocationPct = Number(s.allocation < 0n ? -s.allocation : s.allocation) / Number(absSize) * 100;
    }

    // Log plan
    for (const s of eligible) {
      const pct = s.allocationPct.toFixed(1);
      const alloc = Number(s.allocation) / 1_000_000;
      console.log(`[intent-router]   ${s.venue.name}: score=${s.score}, alloc=${alloc.toFixed(2)} (${pct}%)`);
    }

    return {
      intent,
      venues: scored,
      totalSize: intent.size,
      fills: [],
      status: "pending",
    };
  }

  /**
   * Execute an intent across multiple venues.
   * Fills are best-effort — partial fills are possible.
   */
  async executeIntent(plan: IntentExecution): Promise<IntentExecution> {
    const eligible = plan.venues.filter(s => s.allocation !== 0n);
    const fills: IntentFill[] = [];

    console.log(`[intent-router] Executing across ${eligible.length} venue(s)...`);

    for (const s of eligible) {
      try {
        const result = await s.venue.trade(s.allocation);
        fills.push({
          venue: s.venue.name,
          size: s.allocation,
          signature: result.signature,
          success: true,
        });
        console.log(`[intent-router]   ${s.venue.name}: FILLED ${Number(s.allocation) / 1_000_000} → ${result.signature.slice(0, 16)}...`);
      } catch (err: any) {
        fills.push({
          venue: s.venue.name,
          size: s.allocation,
          signature: "",
          success: false,
          error: err?.message?.slice(0, 100),
        });
        console.log(`[intent-router]   ${s.venue.name}: FAILED — ${err?.message?.slice(0, 80)}`);
      }
    }

    const filledSize = fills
      .filter(f => f.success)
      .reduce((sum, f) => sum + (f.size < 0n ? -f.size : f.size), 0n);
    const totalSize = plan.totalSize < 0n ? -plan.totalSize : plan.totalSize;

    const status = filledSize === 0n ? "failed"
      : filledSize >= totalSize ? "filled"
      : "partial";

    console.log(`[intent-router] Result: ${status} (${Number(filledSize) / 1_000_000} / ${Number(totalSize) / 1_000_000})`);

    return { ...plan, fills, status };
  }

  /**
   * Plan and execute in one call.
   */
  async routeIntent(intent: Intent): Promise<IntentExecution> {
    // Validate deadline
    if (intent.deadline > 0n) {
      const now = BigInt(Math.floor(Date.now() / 1000));
      if (now > intent.deadline) {
        console.log(`[intent-router] Intent ${intent.id} expired`);
        return {
          intent,
          venues: [],
          totalSize: intent.size,
          fills: [],
          status: "failed",
        };
      }
    }

    const plan = await this.planExecution(intent);
    if (plan.status === "failed") return plan;
    return this.executeIntent(plan);
  }

  // ---------------------------------------------------------------------------
  // Scoring
  // ---------------------------------------------------------------------------

  private computeScore(venue: VenueAdapter, state: VenueState): number {
    let score = 0;

    // Funding rate magnitude (higher = more opportunity)
    if (venue.type === "perp") {
      const absFunding = state.fundingRateBpsPerSlot < 0n
        ? -state.fundingRateBpsPerSlot
        : state.fundingRateBpsPerSlot;
      score += Number(absFunding) * 10;
    }

    // Liquidity depth
    score += Math.min(state.numAccounts, 50);

    // Insurance bonus
    if (state.insuranceBalance > 0n) {
      score += 20;
    }

    return score;
  }

  /**
   * Get scoring breakdown for all venues (for UI display).
   */
  async getVenueScores(): Promise<VenueScore[]> {
    const scores: VenueScore[] = [];
    for (const venue of this.venues) {
      try {
        const state = await venue.getVenueState();
        const score = this.computeScore(venue, state);
        scores.push({ venue, score, state, allocation: 0n, allocationPct: 0 });
      } catch {
        scores.push({
          venue,
          score: 0,
          state: { fundingRateBpsPerSlot: 0n, insuranceBalance: 0n, numAccounts: 0 },
          allocation: 0n,
          allocationPct: 0,
        });
      }
    }
    return scores.sort((a, b) => b.score - a.score);
  }
}
