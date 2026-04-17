"use client";

import { useState } from "react";
import Link from "next/link";

// --- Strategy definitions ---

interface Strategy {
  id: string;
  name: string;
  description: string;
  requiredVenueTypes: string[];
  params: { label: string; key: string; default: string; unit: string }[];
}

const STRATEGIES: Strategy[] = [
  {
    id: "principal-protected",
    name: "Principal Protected",
    description: "Delta-hedged SOL exposure with lending yield protecting your principal.",
    requiredVenueTypes: ["lending", "perp"],
    params: [
      { label: "Protection Horizon", key: "horizon", default: "30", unit: "days" },
      { label: "Implied Volatility", key: "vol", default: "80", unit: "%" },
      { label: "Leverage", key: "leverage", default: "5", unit: "x" },
    ],
  },
  {
    id: "funding-rate",
    name: "Funding Rate Harvest",
    description: "Collect perpetual funding rate payments across any venue.",
    requiredVenueTypes: ["perp"],
    params: [
      { label: "Max Deploy", key: "maxDeploy", default: "50", unit: "%" },
      { label: "Circuit Breaker", key: "circuitBreaker", default: "5", unit: "%" },
    ],
  },
  {
    id: "delta-neutral",
    name: "Delta Neutral",
    description: "Long spot + short perp. Zero price risk, earn funding.",
    requiredVenueTypes: ["spot", "perp"],
    params: [
      { label: "Hedge Ratio", key: "hedgeRatio", default: "100", unit: "%" },
      { label: "Rebalance Threshold", key: "rebalThresh", default: "2", unit: "%" },
    ],
  },
];

// --- Venue definitions ---

interface Venue {
  id: string;
  name: string;
  type: "lending" | "perp" | "spot";
  description: string;
  metrics: { label: string; value: string }[];
}

const VENUES: Venue[] = [
  { id: "kamino", name: "Kamino", type: "lending", description: "USDC lending", metrics: [{ label: "APY", value: "8.2%" }, { label: "TVL", value: "$1.2B" }] },
  { id: "jupiter", name: "Jupiter Perps", type: "perp", description: "Oracle-based AMM", metrics: [{ label: "Funding", value: "+12 bps" }, { label: "OI", value: "$340M" }] },
  { id: "phoenix", name: "Phoenix", type: "spot", description: "CLOB orderbook", metrics: [{ label: "Spread", value: "0.02%" }, { label: "Vol", value: "$45M" }] },
  { id: "percolator", name: "Percolator", type: "perp", description: "Slab-based risk engine", metrics: [{ label: "Funding", value: "+8 bps" }, { label: "Fee", value: "0 bps" }] },
  { id: "marginfi", name: "Marginfi", type: "lending", description: "Lending protocol", metrics: [{ label: "APY", value: "6.5%" }, { label: "TVL", value: "$800M" }] },
  { id: "drift", name: "Drift", type: "perp", description: "Cross-margin perp DEX", metrics: [{ label: "Funding", value: "+9 bps" }, { label: "OI", value: "$180M" }] },
];

function estimateYield(strategy: Strategy, selectedVenues: Venue[], params: Record<string, string>): { apy: number; breakdown: string[] } {
  const breakdown: string[] = [];
  if (strategy.id === "principal-protected") {
    const lending = selectedVenues.find(v => v.type === "lending");
    const perp = selectedVenues.find(v => v.type === "perp");
    const lendApy = lending?.name === "Kamino" ? 8.2 : 6.5;
    const leverage = parseFloat(params.leverage || "5");
    const spotPct = lendApy * (parseFloat(params.horizon || "30") / 365) / (1 + lendApy / 100 * parseFloat(params.horizon || "30") / 365) * 100;
    breakdown.push(`${lending?.name || "?"}: ${lendApy}% APY on ${(100 - spotPct).toFixed(0)}% capital`);
    breakdown.push(`${perp?.name || "?"}: Delta hedge at ${leverage}x on ${spotPct.toFixed(1)}%`);
    return { apy: lendApy * (100 - spotPct) / 100, breakdown };
  }
  if (strategy.id === "funding-rate") {
    const perp = selectedVenues.find(v => v.type === "perp");
    const maxDeploy = parseFloat(params.maxDeploy || "50");
    const fundingBps = perp?.name === "Jupiter Perps" ? 12 : perp?.name === "Drift" ? 9 : 8;
    const annualized = fundingBps * 0.5 * 365 * maxDeploy / 100;
    breakdown.push(`${perp?.name || "?"}: ${fundingBps} bps/slot, ${maxDeploy}% deployed`);
    return { apy: annualized, breakdown };
  }
  if (strategy.id === "delta-neutral") {
    const spot = selectedVenues.find(v => v.type === "spot");
    const perp = selectedVenues.find(v => v.type === "perp");
    const fundingBps = perp?.name === "Jupiter Perps" ? 12 : perp?.name === "Drift" ? 9 : 8;
    const annualized = fundingBps * 0.5 * 365 * 0.5;
    breakdown.push(`${spot?.name || "?"}: Long spot + ${perp?.name || "?"}: Short perp`);
    return { apy: annualized, breakdown };
  }
  return { apy: 0, breakdown: [] };
}

export default function BuildPage() {
  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null);
  const [selectedVenueIds, setSelectedVenueIds] = useState<Set<string>>(new Set());
  const [params, setParams] = useState<Record<string, string>>({});

  const strategy = STRATEGIES.find(s => s.id === selectedStrategy);
  const selectedVenues = VENUES.filter(v => selectedVenueIds.has(v.id));
  const satisfiedTypes = new Set(selectedVenues.map(v => v.type as string));
  const missingTypes = strategy ? strategy.requiredVenueTypes.filter(t => !satisfiedTypes.has(t)) : [];
  const isComplete = strategy && missingTypes.length === 0;
  const estimate = isComplete ? estimateYield(strategy!, selectedVenues, params) : null;

  const toggleVenue = (id: string) => {
    const next = new Set(selectedVenueIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedVenueIds(next);
  };

  const selectStrategy = (id: string) => {
    setSelectedStrategy(id);
    const s = STRATEGIES.find(s => s.id === id)!;
    const defaults: Record<string, string> = {};
    s.params.forEach(p => { defaults[p.key] = p.default; });
    setParams(defaults);
    setSelectedVenueIds(new Set());
  };

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-2">Build</h1>
        <p className="text-[var(--text-muted)] max-w-2xl">
          Configure vault strategies by combining any strategy with any venues.
          Same VenueAdapter interface powers both intent routing and vault strategies.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">

          {/* Step 1: Strategy */}
          <section>
            <h2 className="text-xs font-mono uppercase tracking-wider text-[var(--text-muted)] mb-3">
              <span className="text-[var(--primary)] mr-2">01</span>Pick a Strategy
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {STRATEGIES.map(s => (
                <button
                  key={s.id}
                  onClick={() => selectStrategy(s.id)}
                  className={`panel p-4 text-left transition ${selectedStrategy === s.id ? "border-[var(--primary)]/50" : "hover:border-[var(--border-hover)]"}`}
                >
                  <div className="text-sm font-medium mb-1">{s.name}</div>
                  <div className="text-[10px] text-[var(--text-muted)] leading-relaxed">{s.description}</div>
                  <div className="flex gap-1 mt-2">
                    {s.requiredVenueTypes.map(t => (
                      <span key={t} className={`text-[8px] font-mono uppercase px-1.5 py-0.5 rounded ${
                        t === "perp" ? "bg-blue-950 text-blue-400" : t === "spot" ? "bg-green-950 text-[var(--green)]" : "bg-cyan-950 text-[var(--primary)]"
                      }`}>{t}</span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* Step 2: Venues */}
          {strategy && (
            <section>
              <h2 className="text-xs font-mono uppercase tracking-wider text-[var(--text-muted)] mb-3">
                <span className="text-[var(--primary)] mr-2">02</span>Pick Venues
                {missingTypes.length > 0 && <span className="ml-2 text-[var(--orange)]">(need: {missingTypes.join(", ")})</span>}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {VENUES.map(v => {
                  const isNeeded = strategy.requiredVenueTypes.includes(v.type);
                  const isSelected = selectedVenueIds.has(v.id);
                  return (
                    <button
                      key={v.id}
                      onClick={() => isNeeded && toggleVenue(v.id)}
                      disabled={!isNeeded}
                      className={`panel p-3 text-left transition ${isSelected ? "border-[var(--primary)]/50" : isNeeded ? "hover:border-[var(--border-hover)] cursor-pointer" : "opacity-30 cursor-not-allowed"}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">{v.name}</span>
                        <span className={`text-[8px] font-mono uppercase px-1.5 py-0.5 rounded ${
                          v.type === "perp" ? "bg-blue-950 text-blue-400" : v.type === "spot" ? "bg-green-950 text-[var(--green)]" : "bg-cyan-950 text-[var(--primary)]"
                        }`}>{v.type}</span>
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)] mb-2">{v.description}</div>
                      <div className="flex gap-3">
                        {v.metrics.map(m => (
                          <div key={m.label} className="text-[10px]">
                            <span className="text-[var(--text-muted)]">{m.label}: </span>
                            <span className="font-mono">{m.value}</span>
                          </div>
                        ))}
                      </div>
                      {isSelected && <div className="mt-2 text-[9px] text-[var(--primary)]">Selected</div>}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Step 3: Configure */}
          {isComplete && (
            <section>
              <h2 className="text-xs font-mono uppercase tracking-wider text-[var(--text-muted)] mb-3">
                <span className="text-[var(--primary)] mr-2">03</span>Configure
              </h2>
              <div className="panel p-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {strategy!.params.map(p => (
                    <div key={p.key}>
                      <label className="text-[10px] text-[var(--text-muted)] block mb-1">{p.label}</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          value={params[p.key] || p.default}
                          onChange={(e) => setParams({ ...params, [p.key]: e.target.value })}
                          className="w-full h-9 px-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--primary)]"
                        />
                        <span className="text-xs text-[var(--text-muted)] w-8">{p.unit}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* VenueAdapter */}
          <section>
            <h2 className="text-xs font-mono uppercase tracking-wider text-[var(--text-muted)] mb-3">VenueAdapter Interface</h2>
            <div className="panel p-5">
              <p className="text-xs text-[var(--text-muted)] mb-4">
                Implement 6 methods to add any DEX. Strategy and routing code stays unchanged.
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
        </div>

        {/* Right: Preview + Roadmap */}
        <div>
          <div className="sticky top-32 space-y-4">
            <div className="panel p-5">
              <h2 className="text-xs font-mono uppercase tracking-wider text-[var(--text-muted)] mb-3">Preview</h2>
              {!strategy ? (
                <p className="text-xs text-[var(--text-muted)] py-8 text-center">Select a strategy to start</p>
              ) : !isComplete ? (
                <div className="py-4">
                  <p className="text-sm font-medium mb-2">{strategy.name}</p>
                  <p className="text-xs text-[var(--orange)]">Missing: {missingTypes.join(", ")}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <div className="text-sm font-medium">{strategy.name}</div>
                    <div className="text-[10px] text-[var(--text-muted)]">{selectedVenues.map(v => v.name).join(" + ")}</div>
                    {(() => {
                      const typeCounts: Record<string, number> = {};
                      selectedVenues.forEach(v => { typeCounts[v.type] = (typeCounts[v.type] || 0) + 1; });
                      const multiples = Object.entries(typeCounts).filter(([, c]) => c > 1);
                      if (multiples.length > 0) return (
                        <div className="text-[10px] text-[var(--primary)] mt-1">
                          VenueRouter picks the best {multiples.map(([t]) => t).join(", ")} venue at each tick
                        </div>
                      );
                      return null;
                    })()}
                  </div>
                  {estimate && (
                    <>
                      <div>
                        <div className="text-2xl font-bold text-[var(--green)]">{estimate.apy.toFixed(1)}%</div>
                        <div className="text-[10px] text-[var(--text-muted)]">Estimated min APY</div>
                      </div>
                      <div className="space-y-1">
                        {estimate.breakdown.map((line, i) => (
                          <div key={i} className="text-xs text-[var(--text-muted)]">
                            <span className="text-[var(--primary)]">{i + 1}.</span> {line}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  <Link href="/earn" className="w-full h-9 flex items-center justify-center rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-sm font-medium transition">
                    Try Pre-built Vault →
                  </Link>
                  <div className="text-[10px] text-[var(--text-muted)] text-center">Custom deployment coming soon</div>
                </div>
              )}
            </div>

            <div className="panel p-4">
              <h3 className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] mb-3">Roadmap</h3>
              <div className="space-y-2">
                {[
                  { label: "Pre-built vaults", status: "live", detail: "Principal Protected + Funding Rate" },
                  { label: "Shielded intents", status: "live", detail: "Cross-venue encrypted routing" },
                  { label: "Custom strategy builder", status: "next", detail: "Pick strategy × venues → deploy" },
                  { label: "More venues", status: "next", detail: "Drift, Marginfi, Meteora" },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
                      item.status === "live" ? "bg-[var(--green)]" : "bg-[var(--primary)]"
                    }`} />
                    <div>
                      <div className="text-xs font-medium">{item.label}</div>
                      <div className="text-[10px] text-[var(--text-muted)]">{item.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
