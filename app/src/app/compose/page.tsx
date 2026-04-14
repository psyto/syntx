"use client";

import { useState } from "react";
import Link from "next/link";

// --- Strategy definitions ---

interface Strategy {
  id: string;
  name: string;
  description: string;
  requiredVenueTypes: string[]; // which venue types are needed
  params: { label: string; key: string; default: string; unit: string }[];
}

const STRATEGIES: Strategy[] = [
  {
    id: "principal-protected",
    name: "Principal Protected",
    description: "Delta-hedged SOL exposure with lending yield protecting your principal. Pseudo call option.",
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
    description: "Collect perpetual funding rate payments. Goes long or short based on funding direction.",
    requiredVenueTypes: ["perp"],
    params: [
      { label: "Max Deploy", key: "maxDeploy", default: "50", unit: "%" },
      { label: "Circuit Breaker", key: "circuitBreaker", default: "5", unit: "%" },
    ],
  },
  {
    id: "delta-neutral",
    name: "Delta Neutral",
    description: "Long spot + short perp. Zero price risk, earn funding rate on the short leg.",
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
  {
    id: "kamino",
    name: "Kamino",
    type: "lending",
    description: "USDC lending — earns supply APY",
    metrics: [{ label: "APY", value: "8.2%" }, { label: "TVL", value: "$1.2B" }],
  },
  {
    id: "jupiter",
    name: "Jupiter Perps",
    type: "perp",
    description: "Oracle-based AMM perps",
    metrics: [{ label: "Funding", value: "+12 bps" }, { label: "OI", value: "$340M" }],
  },
  {
    id: "phoenix",
    name: "Phoenix",
    type: "spot",
    description: "CLOB spot orderbook",
    metrics: [{ label: "Spread", value: "0.02%" }, { label: "Vol", value: "$45M" }],
  },
  {
    id: "percolator",
    name: "Percolator",
    type: "perp",
    description: "Slab-based risk engine",
    metrics: [{ label: "Funding", value: "+8 bps" }, { label: "Fee", value: "0 bps" }],
  },
  {
    id: "marginfi",
    name: "Marginfi",
    type: "lending",
    description: "Lending & borrowing protocol",
    metrics: [{ label: "APY", value: "6.5%" }, { label: "TVL", value: "$800M" }],
  },
  {
    id: "drift",
    name: "Drift",
    type: "perp",
    description: "Cross-margin perp DEX",
    metrics: [{ label: "Funding", value: "+9 bps" }, { label: "OI", value: "$180M" }],
  },
];

// --- Yield / scoring logic ---

function estimateYield(strategy: Strategy, selectedVenues: Venue[], params: Record<string, string>): { apy: number; breakdown: string[] } {
  const breakdown: string[] = [];

  if (strategy.id === "principal-protected") {
    const lending = selectedVenues.find(v => v.type === "lending");
    const perp = selectedVenues.find(v => v.type === "perp");
    const lendApy = lending?.name === "Kamino" ? 8.2 : 6.5;
    const leverage = parseFloat(params.leverage || "5");
    const spotPct = lendApy * (parseFloat(params.horizon || "30") / 365) / (1 + lendApy / 100 * parseFloat(params.horizon || "30") / 365) * 100;
    breakdown.push(`${lending?.name || "?"}: ${lendApy}% APY on ${(100 - spotPct).toFixed(0)}% capital`);
    breakdown.push(`${perp?.name || "?"}: Delta hedge on ${spotPct.toFixed(1)}% capital at ${leverage}x`);
    breakdown.push(`Min yield: ${(lendApy * (100 - spotPct) / 100).toFixed(1)}% (lending only)`);
    return { apy: lendApy * (100 - spotPct) / 100, breakdown };
  }

  if (strategy.id === "funding-rate") {
    const perp = selectedVenues.find(v => v.type === "perp");
    const maxDeploy = parseFloat(params.maxDeploy || "50");
    const fundingBps = perp?.name === "Jupiter Perps" ? 12 : perp?.name === "Drift" ? 9 : 8;
    const annualized = fundingBps * 0.5 * 365 * maxDeploy / 100;
    breakdown.push(`${perp?.name || "?"}: ${fundingBps} bps/slot funding rate`);
    breakdown.push(`${maxDeploy}% capital deployed`);
    breakdown.push(`Est. ${annualized.toFixed(0)}% APY (if funding persists)`);
    return { apy: annualized, breakdown };
  }

  if (strategy.id === "delta-neutral") {
    const spot = selectedVenues.find(v => v.type === "spot");
    const perp = selectedVenues.find(v => v.type === "perp");
    const fundingBps = perp?.name === "Jupiter Perps" ? 12 : perp?.name === "Drift" ? 9 : 8;
    const annualized = fundingBps * 0.5 * 365 * 0.5;
    breakdown.push(`${spot?.name || "?"}: Long SOL spot`);
    breakdown.push(`${perp?.name || "?"}: Short SOL perp (${fundingBps} bps/slot)`);
    breakdown.push(`Zero price risk, est. ${annualized.toFixed(0)}% APY`);
    return { apy: annualized, breakdown };
  }

  return { apy: 0, breakdown: ["Select a strategy"] };
}

// --- Component ---

export default function ComposePage() {
  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null);
  const [selectedVenueIds, setSelectedVenueIds] = useState<Set<string>>(new Set());
  const [params, setParams] = useState<Record<string, string>>({});

  const strategy = STRATEGIES.find(s => s.id === selectedStrategy);
  const selectedVenues = VENUES.filter(v => selectedVenueIds.has(v.id));

  // Check which venue types are satisfied
  const satisfiedTypes = new Set(selectedVenues.map(v => v.type as string));
  const missingTypes = strategy ? strategy.requiredVenueTypes.filter(t => !satisfiedTypes.has(t)) : [];
  const isComplete = strategy && missingTypes.length === 0;

  // Compute yield estimate
  const estimate = isComplete ? estimateYield(strategy!, selectedVenues, params) : null;

  // Toggle venue selection
  const toggleVenue = (id: string) => {
    const next = new Set(selectedVenueIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedVenueIds(next);
  };

  // Init params when strategy changes
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
        <h1 className="text-2xl font-bold mb-2">Compose</h1>
        <p className="text-[var(--text-muted)] max-w-2xl">
          Build a vault strategy by picking a strategy and venues. Syntx routes across
          any combination through the VenueAdapter interface.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Left column: Strategy + Venues */}
        <div className="md:col-span-2 space-y-6">

          {/* Step 1: Pick Strategy */}
          <section>
            <h2 className="text-xs font-mono uppercase tracking-wider text-[var(--text-muted)] mb-3">
              <span className="text-[var(--primary)] mr-2">01</span>Pick a Strategy
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {STRATEGIES.map(s => (
                <button
                  key={s.id}
                  onClick={() => selectStrategy(s.id)}
                  className={`panel p-4 text-left transition ${
                    selectedStrategy === s.id ? "border-[var(--primary)]/50" : "hover:border-[var(--border-hover)]"
                  }`}
                >
                  <div className="text-sm font-medium mb-1">{s.name}</div>
                  <div className="text-[10px] text-[var(--text-muted)] leading-relaxed">{s.description}</div>
                  <div className="flex gap-1 mt-2">
                    {s.requiredVenueTypes.map(t => (
                      <span key={t} className={`text-[8px] font-mono uppercase px-1.5 py-0.5 rounded ${
                        t === "perp" ? "bg-blue-950 text-blue-400" :
                        t === "spot" ? "bg-green-950 text-[var(--green)]" :
                        "bg-cyan-950 text-[var(--primary)]"
                      }`}>{t}</span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* Step 2: Pick Venues */}
          {strategy && (
            <section>
              <h2 className="text-xs font-mono uppercase tracking-wider text-[var(--text-muted)] mb-3">
                <span className="text-[var(--primary)] mr-2">02</span>Pick Venues
                {missingTypes.length > 0 && (
                  <span className="ml-2 text-[var(--orange)]">
                    (need: {missingTypes.join(", ")})
                  </span>
                )}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {VENUES.map(v => {
                  const isNeeded = strategy.requiredVenueTypes.includes(v.type);
                  const isSelected = selectedVenueIds.has(v.id);
                  return (
                    <button
                      key={v.id}
                      onClick={() => toggleVenue(v.id)}
                      className={`panel p-3 text-left transition ${
                        isSelected ? "border-[var(--primary)]/50" :
                        isNeeded ? "hover:border-[var(--border-hover)]" :
                        "opacity-40"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">{v.name}</span>
                        <span className={`text-[8px] font-mono uppercase px-1.5 py-0.5 rounded ${
                          v.type === "perp" ? "bg-blue-950 text-blue-400" :
                          v.type === "spot" ? "bg-green-950 text-[var(--green)]" :
                          "bg-cyan-950 text-[var(--primary)]"
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
                      {isSelected && (
                        <div className="mt-2 text-[9px] text-[var(--primary)]">Selected</div>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Step 3: Configure Parameters */}
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
        </div>

        {/* Right column: Preview */}
        <div>
          <div className="sticky top-32">
            <h2 className="text-xs font-mono uppercase tracking-wider text-[var(--text-muted)] mb-3">Preview</h2>
            <div className="panel p-5 space-y-4">
              {!strategy ? (
                <p className="text-xs text-[var(--text-muted)] py-8 text-center">Select a strategy to start</p>
              ) : !isComplete ? (
                <div className="py-4">
                  <p className="text-sm font-medium mb-2">{strategy.name}</p>
                  <p className="text-xs text-[var(--orange)]">
                    Missing venues: {missingTypes.map(t => (
                      <span key={t} className="font-mono">{t}</span>
                    )).reduce((a, b) => <>{a}, {b}</>)}
                  </p>
                </div>
              ) : (
                <>
                  <div>
                    <div className="text-sm font-medium">{strategy.name}</div>
                    <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                      {selectedVenues.map(v => v.name).join(" + ")}
                    </div>
                  </div>

                  {/* Estimated yield */}
                  {estimate && (
                    <div>
                      <div className="text-2xl font-bold text-[var(--green)]">
                        {estimate.apy.toFixed(1)}%
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)]">Estimated min APY</div>
                    </div>
                  )}

                  {/* Breakdown */}
                  {estimate && (
                    <div className="space-y-1">
                      {estimate.breakdown.map((line, i) => (
                        <div key={i} className="text-xs text-[var(--text-muted)] flex gap-2">
                          <span className="text-[var(--primary)]">{i + 1}.</span>
                          {line}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Keeper config preview */}
                  <div className="bg-[var(--bg)] rounded-lg border border-[var(--border)] p-3 font-mono text-[10px] text-[var(--text-muted)] space-y-0.5">
                    <div className="text-[var(--primary)]"># keeper .env</div>
                    <div>STRATEGY={strategy.id}</div>
                    {selectedVenues.map(v => (
                      <div key={v.id}>VENUE_{v.type.toUpperCase()}={v.id}</div>
                    ))}
                    {strategy.params.map(p => (
                      <div key={p.key}>{p.key.toUpperCase()}={params[p.key] || p.default}</div>
                    ))}
                  </div>

                  {/* Deploy button */}
                  <div className="space-y-2">
                    <Link
                      href="/earn"
                      className="w-full h-10 flex items-center justify-center rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-sm font-medium transition"
                    >
                      Try Pre-built Vault →
                    </Link>
                    <div className="text-[10px] text-[var(--text-muted)] text-center">
                      Custom vault deployment coming soon
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Roadmap */}
            <div className="mt-4 panel p-4">
              <h3 className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] mb-3">Roadmap</h3>
              <div className="space-y-2">
                {[
                  { label: "Pre-built vaults", status: "live", detail: "Principal Protected + Funding Rate" },
                  { label: "Custom strategy builder", status: "next", detail: "Pick strategy × venues × params → deploy" },
                  { label: "More venues", status: "next", detail: "Drift, Marginfi, Meteora, Raydium" },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
                      item.status === "live" ? "bg-[var(--green)]" :
                      item.status === "next" ? "bg-[var(--primary)]" :
                      "bg-[var(--text-muted)]"
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
