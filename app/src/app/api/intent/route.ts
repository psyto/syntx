import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/intent — Submit a perp trading intent
 *
 * In production, the intent would be encrypted and sent to the privacy solver.
 * For the hackathon demo, we accept plaintext intents and simulate the routing.
 *
 * Body: { size: number (USDC), side: "long" | "short", slippageBps: number }
 */

// Simulated venue data (matches keeper's VenueRouter scoring)
const VENUES = [
  { name: "Jupiter Perps", type: "perp", fundingBps: 12, depth: 45, insured: true },
  { name: "Percolator", type: "perp", fundingBps: 8, depth: 20, insured: false },
  { name: "Drift", type: "perp", fundingBps: 9, depth: 35, insured: true },
];

function scoreVenue(v: typeof VENUES[0]): number {
  let score = Math.abs(v.fundingBps) * 10;
  score += Math.min(v.depth, 50);
  if (v.insured) score += 20;
  return score;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { size, side, slippageBps } = body;

    if (!size || !side) {
      return NextResponse.json({ error: "Missing size or side" }, { status: 400 });
    }

    const absSize = Math.abs(size);
    const signedSize = side === "short" ? -absSize : absSize;

    // Score and allocate across venues
    const scored = VENUES.map(v => ({
      ...v,
      score: scoreVenue(v),
    })).sort((a, b) => b.score - a.score);

    const totalScore = scored.reduce((s, v) => s + v.score, 0);

    const allocations = scored.map((v, i) => {
      const pct = v.score / totalScore;
      const allocation = i === scored.length - 1
        ? absSize - scored.slice(0, i).reduce((s, _, j) => s + Math.floor(absSize * scored[j].score / totalScore), 0)
        : Math.floor(absSize * pct);

      return {
        venue: v.name,
        score: v.score,
        allocation: side === "short" ? -allocation : allocation,
        allocationPct: (pct * 100).toFixed(1),
        // Simulated fill
        fillPrice: 138.42 * (1 + (Math.random() - 0.5) * 0.001), // ±0.05% around $138.42
        status: "filled" as const,
      };
    });

    const result = {
      intentId: `intent-${Date.now()}`,
      side,
      totalSize: signedSize,
      slippageBps: slippageBps || 50,
      shielded: true,
      venues: allocations,
      status: "filled",
      timestamp: new Date().toISOString(),
      blendedPrice: allocations.reduce((s, a) => s + a.fillPrice * Math.abs(a.allocation), 0) / absSize,
    };

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}
