"use client";

import { useEffect, useState, useCallback } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

// Venue addresses on devnet
const VENUES = [
  {
    name: "Kamino",
    type: "lending" as const,
    description: "USDC lending — earns yield for principal protection",
    role: "Protection leg",
    color: "var(--primary)",
    // Kamino Main Market (mainnet address — simulated on devnet)
    address: "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
    simulated: true,
  },
  {
    name: "Jupiter Perps",
    type: "perp" as const,
    description: "Oracle-based AMM — delta hedge execution",
    role: "Delta hedge leg",
    color: "var(--green)",
    address: "PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu",
    simulated: false,
  },
  {
    name: "Phoenix",
    type: "spot" as const,
    description: "CLOB orderbook — spot SOL execution",
    role: "Spot execution",
    color: "var(--orange)",
    address: "4DoNfFBfF7UokCC2FQzriy7yHK6DY6NVdYpuekQ5pRgg",
    simulated: false,
  },
  {
    name: "Percolator",
    type: "perp" as const,
    description: "Slab-based risk engine — funding rate trading",
    role: "Funding rate leg",
    color: "#a78bfa",
    address: "Edq18N2pdT3Sz9EukbZe4YsQkvmxvmmkUL1KHpv96xJF",
    simulated: false,
  },
];

// Router scoring logic (mirrors keeper/src/venues/router.ts)
function computeScore(venue: typeof VENUES[0], state: { fundingRate: number; depth: number; insured: boolean }): number {
  let score = 0;
  if (venue.type === "perp") {
    score += Math.abs(state.fundingRate) * 10;
    if (state.insured) score += 20;
  }
  if (venue.type === "spot") score += 5;
  if (venue.type === "lending") score += state.fundingRate * 100; // APY as pseudo score
  score += Math.min(state.depth, 50);
  return Math.round(score);
}

function short(addr: string): string {
  return addr.slice(0, 4) + "..." + addr.slice(-4);
}

export default function ComposePage() {
  const { connection } = useConnection();
  const [venueStates, setVenueStates] = useState<Record<string, { live: boolean; accounts: number }>>({});
  const [selectedVenue, setSelectedVenue] = useState<string | null>(null);

  // Check which venues are live on-chain
  const checkVenues = useCallback(async () => {
    const states: Record<string, { live: boolean; accounts: number }> = {};
    for (const v of VENUES) {
      try {
        if (v.simulated) {
          states[v.name] = { live: true, accounts: 0 };
        } else {
          const info = await connection.getAccountInfo(new PublicKey(v.address));
          states[v.name] = { live: !!info, accounts: info ? info.data.length : 0 };
        }
      } catch {
        states[v.name] = { live: false, accounts: 0 };
      }
    }
    setVenueStates(states);
  }, [connection]);

  useEffect(() => { checkVenues(); }, [checkVenues]);

  // Simulated venue states for scoring demo
  const scoringData = [
    { venue: "Kamino", fundingRate: 0.082, depth: 100, insured: false, label: "8.2% APY" },
    { venue: "Jupiter Perps", fundingRate: 12, depth: 45, insured: true, label: "+12 bps/slot" },
    { venue: "Phoenix", fundingRate: 0, depth: 30, insured: false, label: "Spot" },
    { venue: "Percolator", fundingRate: 8, depth: 20, insured: false, label: "+8 bps/slot" },
  ];

  const scores = scoringData.map((s) => {
    const venue = VENUES.find((v) => v.name === s.venue)!;
    return { ...s, score: computeScore(venue, s), venue: venue };
  }).sort((a, b) => b.score - a.score);

  const bestVenue = scores[0];

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-2">Compose</h1>
        <p className="text-[var(--text-muted)] max-w-2xl">
          Syntx vaults route across any execution venue through a unified VenueAdapter interface.
          The keeper scores venues in real-time and routes to the best one. Adding a new DEX means
          implementing 6 methods — the strategy code never changes.
        </p>
      </div>

      {/* Live Venue Status */}
      <section className="mb-8">
        <h2 className="text-xs font-mono uppercase tracking-wider text-[var(--text-muted)] mb-3">Connected Venues</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {VENUES.map((v) => {
            const state = venueStates[v.name];
            const isLive = state?.live;
            const isSelected = selectedVenue === v.name;
            return (
              <button
                key={v.name}
                onClick={() => setSelectedVenue(isSelected ? null : v.name)}
                className={`panel p-4 text-left transition hover:border-[var(--border-hover)] ${isSelected ? "border-[var(--primary)]/50" : ""}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">{v.name}</span>
                  <span className={`w-2 h-2 rounded-full ${isLive ? "bg-[var(--green)]" : "bg-[var(--red)]"}`} />
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[8px] font-mono uppercase px-1.5 py-0.5 rounded ${
                    v.type === "perp" ? "bg-blue-950 text-blue-400" :
                    v.type === "spot" ? "bg-green-950 text-[var(--green)]" :
                    "bg-cyan-950 text-[var(--primary)]"
                  }`}>{v.type}</span>
                  {v.simulated && <span className="text-[8px] text-[var(--text-muted)]">sim</span>}
                </div>
                <div className="text-[10px] text-[var(--text-muted)]">{v.role}</div>
              </button>
            );
          })}
        </div>

        {/* Expanded venue detail */}
        {selectedVenue && (
          <div className="mt-3 panel p-4">
            {(() => {
              const v = VENUES.find((v) => v.name === selectedVenue)!;
              const state = venueStates[v.name];
              return (
                <div className="space-y-2">
                  <div className="text-sm font-medium">{v.name}</div>
                  <div className="text-xs text-[var(--text-muted)]">{v.description}</div>
                  <div className="grid grid-cols-2 gap-4 text-xs mt-2">
                    <div>
                      <span className="text-[var(--text-muted)]">Address</span>
                      <div className="font-mono mt-0.5">{short(v.address)}</div>
                    </div>
                    <div>
                      <span className="text-[var(--text-muted)]">Status</span>
                      <div className="mt-0.5">{state?.live ? "Live on devnet" : "Not found"}</div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </section>

      {/* VenueRouter Scoring */}
      <section className="mb-8">
        <h2 className="text-xs font-mono uppercase tracking-wider text-[var(--text-muted)] mb-3">VenueRouter Scoring</h2>
        <div className="panel p-5">
          <p className="text-xs text-[var(--text-muted)] mb-4">
            The keeper scores each venue based on funding rate, liquidity depth, and insurance.
            The highest-scoring venue gets the trade.
          </p>
          <div className="space-y-2">
            {scores.map((s, i) => {
              const maxScore = scores[0].score;
              const pct = maxScore > 0 ? (s.score / maxScore) * 100 : 0;
              const isBest = i === 0;
              return (
                <div key={s.venue.name} className="flex items-center gap-3">
                  <span className="text-xs font-medium w-28 shrink-0">{s.venue.name}</span>
                  <div className="flex-1 h-6 bg-[var(--bg)] rounded overflow-hidden">
                    <div
                      className="h-full rounded flex items-center px-2 text-[10px] font-mono transition-all"
                      style={{
                        width: `${Math.max(pct, 10)}%`,
                        backgroundColor: isBest ? `${s.venue.color}33` : "var(--bg-card)",
                        borderLeft: isBest ? `3px solid ${s.venue.color}` : "3px solid var(--border)",
                      }}
                    >
                      {s.score}
                    </div>
                  </div>
                  <span className="text-[10px] text-[var(--text-muted)] w-24 text-right">{s.label}</span>
                  {isBest && <span className="text-[8px] px-1.5 py-0.5 rounded bg-green-950 text-[var(--green)]">SELECTED</span>}
                </div>
              );
            })}
          </div>
          <div className="mt-3 pt-3 border-t border-[var(--border)] text-xs text-[var(--text-muted)]">
            Best venue: <span className="text-[var(--text)] font-medium">{bestVenue.venue.name}</span> (score {bestVenue.score}) — {bestVenue.venue.description}
          </div>
        </div>
      </section>

      {/* Strategy Composition */}
      <section className="mb-8">
        <h2 className="text-xs font-mono uppercase tracking-wider text-[var(--text-muted)] mb-3">Strategy Composition</h2>
        <div className="panel p-5">
          <div className="text-xs text-[var(--text-muted)] mb-4">
            The Principal Protected SOL vault composes two venues in a single keeper loop:
          </div>
          <div className="bg-[var(--bg)] rounded-lg border border-[var(--border)] p-4 font-mono text-xs space-y-1">
            <div className="text-[var(--text-muted)]">{"// structured-keeper.ts — each tick:"}</div>
            <div><span className="text-[var(--primary)]">1.</span> Read Kamino APY → compute allocation split</div>
            <div><span className="text-[var(--primary)]">2.</span> Read SOL price → compute Black-Scholes delta</div>
            <div><span className="text-[var(--primary)]">3.</span> If delta drift {">"} 5% → rebalance Jupiter Perps position</div>
            <div><span className="text-[var(--primary)]">4.</span> Sleep 30s → repeat</div>
            <div className="mt-2 text-[var(--text-muted)]">{"// Same VenueAdapter interface for both venues"}</div>
            <div className="text-[var(--text-muted)]">{"// Swap Jupiter for Drift or Phoenix — zero strategy code changes"}</div>
          </div>
        </div>
      </section>

      {/* VenueAdapter Interface */}
      <section className="mb-8">
        <h2 className="text-xs font-mono uppercase tracking-wider text-[var(--text-muted)] mb-3">VenueAdapter Interface</h2>
        <div className="panel p-5">
          <p className="text-xs text-[var(--text-muted)] mb-4">
            Implement 6 methods to add any DEX. The keeper and strategy code stays unchanged.
          </p>
          <pre className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3 text-[11px] font-mono text-[var(--text-muted)] leading-relaxed overflow-x-auto">
{`interface VenueAdapter {
  readonly name: string;
  readonly type: "perp" | "spot" | "hybrid";

  initialize(): Promise<void>;
  getPrice(market: string): Promise<number>;
  getPosition(): Promise<Position | null>;
  getVenueState(): Promise<VenueState>;
  trade(size: bigint): Promise<OrderResult>;
  crank(): Promise<void>;
}

// Implemented: Percolator, Phoenix, Jupiter Perps, Kamino
// Add yours: Drift, Marginfi, Meteora, ...`}</pre>
        </div>
      </section>

      {/* CPI Interface */}
      <section className="pb-6">
        <h2 className="text-xs font-mono uppercase tracking-wider text-[var(--text-muted)] mb-3">CPI Composability</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="panel p-4">
            <div className="text-[var(--primary)] font-mono text-sm mb-2">cpi_trade</div>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
              Any whitelisted program can open/close positions through the vault. Atomic — fails together.
            </p>
          </div>
          <div className="panel p-4">
            <div className="text-[var(--primary)] font-mono text-sm mb-2">get_share_price</div>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
              On-chain oracle. Lending protocols can value Syntx shares as collateral without external oracles.
            </p>
          </div>
          <div className="panel p-4">
            <div className="text-[var(--primary)] font-mono text-sm mb-2">deposit_standalone</div>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
              Vault operates without Percolator. Pure SPL transfers + share minting. 7 accounts, no oracle needed.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
