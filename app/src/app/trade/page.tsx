"use client";

import { useState } from "react";

// --- Types ---

interface IntentResult {
  intentId: string;
  side: string;
  totalSize: number;
  shielded: boolean;
  venues: { venue: string; score: number; allocation: number; allocationPct: string; fillPrice: number; status: string }[];
  status: string;
  blendedPrice: number;
}

// --- Component ---

export default function TradePage() {
  const [intentSize, setIntentSize] = useState("1000");
  const [intentSide, setIntentSide] = useState<"long" | "short">("long");
  const [intentSlippage, setIntentSlippage] = useState("50");
  const [intentLoading, setIntentLoading] = useState(false);
  const [intentResult, setIntentResult] = useState<IntentResult | null>(null);

  const submitIntent = async () => {
    setIntentLoading(true);
    setIntentResult(null);
    try {
      const res = await fetch("/vaults/api/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          size: parseFloat(intentSize),
          side: intentSide,
          slippageBps: parseInt(intentSlippage),
        }),
      });
      const data = await res.json();
      setIntentResult(data);
    } catch (e: any) {
      console.error("Intent error:", e);
    } finally {
      setIntentLoading(false);
    }
  };

  return (
    <div>
      {/* Hero */}
      <section className="grid-bg border-b border-[var(--border)]">
        <div className="max-w-[1100px] mx-auto px-6 py-12 md:py-20 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--primary)]/10 border border-[var(--primary)]/20 text-[var(--primary)] text-xs font-medium mb-4">
            Shielded Execution
          </div>
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight leading-tight mb-4">
            Cross-Venue Perp
            <br />
            <span className="text-[var(--text-muted)]">Intent Routing</span>
          </h1>
          <p className="text-[var(--text-muted)] max-w-xl mx-auto mb-8">
            Your trade is encrypted. The solver routes it across Jupiter Perps, Percolator, and Drift
            for best execution. No one sees your order until it fills.
          </p>
        </div>
      </section>

      {/* Intent Form + Result */}
      <div className="max-w-[1100px] mx-auto px-6 py-10">
        <div className="grid md:grid-cols-2 gap-6">

          {/* Left: Form */}
          <div className="panel p-6 space-y-5">
            <h2 className="text-sm font-semibold">Submit Intent</h2>

            <div>
              <label className="text-xs text-[var(--text-muted)] block mb-1">Size (USDC)</label>
              <input
                type="number"
                value={intentSize}
                onChange={(e) => setIntentSize(e.target.value)}
                className="w-full h-11 px-3 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>

            <div>
              <label className="text-xs text-[var(--text-muted)] block mb-1">Max Slippage (bps)</label>
              <input
                type="number"
                value={intentSlippage}
                onChange={(e) => setIntentSlippage(e.target.value)}
                className="w-full h-11 px-3 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setIntentSide("long")}
                className={`flex-1 h-10 rounded-lg text-sm font-medium transition ${
                  intentSide === "long"
                    ? "bg-[var(--green)]/20 text-[var(--green)] border border-[var(--green)]/30"
                    : "bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)]"
                }`}
              >
                Long SOL
              </button>
              <button
                onClick={() => setIntentSide("short")}
                className={`flex-1 h-10 rounded-lg text-sm font-medium transition ${
                  intentSide === "short"
                    ? "bg-[var(--red)]/20 text-[var(--red)] border border-[var(--red)]/30"
                    : "bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)]"
                }`}
              >
                Short SOL
              </button>
            </div>

            <button
              onClick={submitIntent}
              disabled={intentLoading || !intentSize}
              className="w-full h-11 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-sm font-medium disabled:opacity-40 transition"
            >
              {intentLoading ? "Routing..." : "Submit Shielded Intent"}
            </button>
          </div>

          {/* Right: Result */}
          <div className="panel p-6">
            {!intentResult ? (
              <div className="flex flex-col items-center justify-center h-full py-12 gap-4">
                <div className="text-4xl">🔒</div>
                <div className="text-center">
                  <p className="text-sm font-medium mb-1">Encrypted Intent Routing</p>
                  <p className="text-xs text-[var(--text-muted)] max-w-xs">
                    Submit an intent to see how the solver splits your trade across venues for best execution
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className={`text-lg font-bold ${intentResult.side === "long" ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
                      {intentResult.side.toUpperCase()}
                    </span>
                    <span className="text-sm text-[var(--text-muted)] ml-2">${Math.abs(intentResult.totalSize).toLocaleString()}</span>
                  </div>
                  <span className="text-[9px] px-2 py-1 rounded bg-green-950 text-[var(--green)] font-mono">
                    {intentResult.status.toUpperCase()}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="stat-card p-3">
                    <div className="text-xs text-[var(--text-muted)]">Blended Price</div>
                    <div className="text-sm font-mono font-semibold mt-0.5">${intentResult.blendedPrice.toFixed(4)}</div>
                  </div>
                  <div className="stat-card p-3">
                    <div className="text-xs text-[var(--text-muted)]">Venues Used</div>
                    <div className="text-sm font-semibold mt-0.5">{intentResult.venues.length}</div>
                  </div>
                </div>

                {/* Venue fills */}
                <div>
                  <div className="text-xs text-[var(--text-muted)] mb-2">Venue Allocation</div>
                  <div className="space-y-2">
                    {intentResult.venues.map((v, i) => {
                      const maxAlloc = Math.max(...intentResult.venues.map(x => Math.abs(x.allocation)));
                      const pct = maxAlloc > 0 ? Math.abs(v.allocation) / maxAlloc * 100 : 0;
                      return (
                        <div key={i}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium">{v.venue}</span>
                              <span className="text-[9px] font-mono text-[var(--text-muted)]">score {v.score}</span>
                            </div>
                            <span className="text-xs font-mono">
                              ${Math.abs(v.allocation).toFixed(2)} <span className="text-[var(--text-muted)]">({v.allocationPct}%)</span>
                            </span>
                          </div>
                          <div className="h-2 bg-[var(--bg)] rounded overflow-hidden">
                            <div
                              className="h-full rounded bg-[var(--primary)]/40"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2 text-[10px] text-[var(--text-muted)]">
                  <span className="w-2 h-2 rounded-full bg-[var(--green)]" />
                  Shielded — encrypted end-to-end, no MEV, no frontrunning
                </div>

                <button
                  onClick={() => setIntentResult(null)}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
                >
                  Submit another intent
                </button>
              </div>
            )}
          </div>
        </div>

        {/* How it works */}
        <div className="mt-10 grid md:grid-cols-4 gap-3">
          {[
            { step: "01", title: "Encrypt", desc: "Your intent (size, slippage, deadline) is encrypted with the solver's public key using NaCl box" },
            { step: "02", title: "Decrypt", desc: "Only the solver can decrypt. No one else — not validators, not MEV bots — sees your order" },
            { step: "03", title: "Route", desc: "Solver scores all venues (funding rate, depth, insurance) and splits your order proportionally" },
            { step: "04", title: "Fill", desc: "Trades execute across venues. You get the blended fill at the best available price" },
          ].map((s) => (
            <div key={s.step} className="stat-card p-4">
              <div className="text-xs font-mono text-[var(--primary)] mb-1">{s.step}</div>
              <div className="text-sm font-medium mb-1">{s.title}</div>
              <div className="text-[10px] text-[var(--text-muted)] leading-relaxed">{s.desc}</div>
            </div>
          ))}
        </div>

        {/* Technical detail */}
        <div className="mt-8 panel p-5">
          <h3 className="text-xs font-mono uppercase tracking-wider text-[var(--text-muted)] mb-3">Under the Hood</h3>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <div className="text-sm font-medium mb-2">Encryption</div>
              <div className="text-xs text-[var(--text-muted)] space-y-1">
                <div>Curve25519-XSalsa20-Poly1305 (NaCl box)</div>
                <div>Ephemeral X25519 keypair per intent</div>
                <div>Only solver holds decryption key</div>
              </div>
            </div>
            <div>
              <div className="text-sm font-medium mb-2">Routing</div>
              <div className="text-xs text-[var(--text-muted)] space-y-1">
                <div>VenueAdapter interface — same for all venues</div>
                <div>Score: |funding| × 10 + depth + insurance bonus</div>
                <div>Proportional split by score — no single-venue risk</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
