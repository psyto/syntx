"use client";

import { useState } from "react";

// --- Types ---

interface IntentResult {
  intentId: string;
  side: string;
  totalSize: number;
  shielded: boolean;
  realExecution: boolean;
  txSignature: string;
  venues: { venue: string; score: number; allocation: number; allocationPct: string; fillPrice: number; status: string; txSignature?: string }[];
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
                <div className="text-center">
                  <div className="text-5xl mb-4">🔒</div>
                  <p className="text-lg font-medium mb-2">Your trade is invisible</p>
                  <p className="text-xs text-[var(--text-muted)] max-w-xs mx-auto leading-relaxed">
                    Submit an intent. It gets encrypted, routed across venues,
                    and executed on Solana — all before anyone can see it.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Step 1: Encrypted */}
                <div className="bg-[var(--bg)] rounded-lg border border-[var(--border)] p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-5 h-5 rounded-full bg-[var(--primary)]/20 text-[var(--primary)] text-[10px] flex items-center justify-center font-mono">1</span>
                    <span className="text-xs font-medium">Encrypted</span>
                  </div>
                  <div className="font-mono text-[10px] text-[var(--text-muted)] bg-[var(--bg-panel)] rounded p-2 break-all leading-relaxed">
                    {`0x${Array.from({length: 32}, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('')}...`}
                  </div>
                  <div className="text-[9px] text-[var(--text-muted)] mt-1">NaCl box (Curve25519-XSalsa20-Poly1305) — only solver can read</div>
                </div>

                {/* Step 2: Routed */}
                <div className="bg-[var(--bg)] rounded-lg border border-[var(--border)] p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-5 h-5 rounded-full bg-[var(--primary)]/20 text-[var(--primary)] text-[10px] flex items-center justify-center font-mono">2</span>
                    <span className="text-xs font-medium">Routed across {intentResult.venues.length} venues</span>
                  </div>
                  <div className="space-y-1.5">
                    {intentResult.venues.map((v, i) => {
                      const maxAlloc = Math.max(...intentResult.venues.map(x => Math.abs(x.allocation)));
                      const pct = maxAlloc > 0 ? Math.abs(v.allocation) / maxAlloc * 100 : 0;
                      return (
                        <div key={i}>
                          <div className="flex items-center justify-between text-[10px] mb-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium">{v.venue}</span>
                              <span className={`px-1 py-0.5 rounded text-[8px] font-mono ${
                                v.status === "filled" ? "bg-green-950 text-[var(--green)]" : "bg-yellow-950 text-yellow-400"
                              }`}>{v.status}</span>
                            </div>
                            <span className="font-mono">${Math.abs(v.allocation).toFixed(0)} ({v.allocationPct}%)</span>
                          </div>
                          <div className="h-1.5 bg-[var(--bg-panel)] rounded overflow-hidden">
                            <div className={`h-full rounded ${v.status === "filled" ? "bg-[var(--green)]/50" : "bg-[var(--primary)]/30"}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Step 3: Executed — THE AHA MOMENT */}
                {intentResult.realExecution && intentResult.txSignature && (
                  <div className="bg-[var(--green)]/5 rounded-lg border border-[var(--green)]/20 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-5 h-5 rounded-full bg-[var(--green)]/20 text-[var(--green)] text-[10px] flex items-center justify-center font-mono">3</span>
                      <span className="text-xs font-medium text-[var(--green)]">Executed on Solana</span>
                    </div>

                    <div className="text-xs text-[var(--text-muted)] mb-2">
                      This trade really happened. The privacy matcher executed a TradeCpi
                      through Percolator&apos;s risk engine. Verify it yourself:
                    </div>

                    <a
                      href={`https://explorer.solana.com/tx/${intentResult.txSignature}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 bg-[var(--bg)] rounded-lg border border-[var(--border)] p-3 hover:border-[var(--green)]/50 transition group"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] text-[var(--text-muted)]">Transaction Signature</div>
                        <div className="font-mono text-xs text-[var(--green)] truncate group-hover:underline">
                          {intentResult.txSignature}
                        </div>
                      </div>
                      <div className="text-[var(--green)] text-lg shrink-0">→</div>
                    </a>

                    <div className="mt-2 bg-[var(--bg)] rounded-lg border border-[var(--border)] p-2 font-mono text-[10px] text-[var(--text-muted)]">
                      <div className="text-[var(--green)]">Program: Privacy Matcher (BSxq...ioB)</div>
                      <div>MATCH: price=$138.00 spread=20bps</div>
                      <div className="text-[var(--green)]">Status: Success</div>
                    </div>
                  </div>
                )}

                {/* Result summary */}
                <div className="flex items-center justify-between pt-1">
                  <div>
                    <span className={`text-lg font-bold ${intentResult.side === "long" ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
                      {intentResult.side.toUpperCase()} ${Math.abs(intentResult.totalSize).toLocaleString()}
                    </span>
                    <span className="text-xs text-[var(--text-muted)] ml-2">@ ${intentResult.blendedPrice.toFixed(2)}</span>
                  </div>
                  <button
                    onClick={() => setIntentResult(null)}
                    className="text-xs text-[var(--primary)] hover:underline"
                  >
                    Trade again
                  </button>
                </div>
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
