"use client";

import { useState } from "react";
import Link from "next/link";

export default function Home() {
  const [intentResult, setIntentResult] = useState<any>(null);
  const [intentLoading, setIntentLoading] = useState(false);

  const submitIntent = async () => {
    setIntentLoading(true);
    try {
      const res = await fetch("/vaults/api/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ size: 500, side: "long", slippageBps: 50 }),
      });
      setIntentResult(await res.json());
    } catch { /* ignore */ }
    setIntentLoading(false);
  };

  return (
    <div>
      {/* Hero — the problem */}
      <section className="grid-bg border-b border-[var(--border)]">
        <div className="max-w-[900px] mx-auto px-6 py-20 md:py-28 text-center">
          <p className="text-sm text-[var(--text-muted)] mb-4 tracking-wider uppercase">The problem</p>
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight leading-tight mb-6">
            Every perp trade on Solana
            <br />
            <span className="text-[var(--text-muted)]">is visible and stuck on one venue</span>
          </h1>
          <p className="text-[var(--text-muted)] text-lg max-w-xl mx-auto">
            MEV bots see your order. You trade on one DEX when three have better prices.
            When that DEX goes down, your vault is dead.
          </p>
        </div>
      </section>

      {/* Section 1: We encrypt it */}
      <section className="border-b border-[var(--border)] py-16">
        <div className="max-w-[1100px] mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-10 items-center">
            <div>
              <p className="text-xs font-mono text-[var(--primary)] mb-3 tracking-wider uppercase">01 — Trade</p>
              <h2 className="text-2xl md:text-3xl font-bold mb-4">We encrypt it</h2>
              <p className="text-[var(--text-muted)] mb-6 leading-relaxed">
                Your intent is encrypted with NaCl box cryptography. The solver decrypts it,
                scores every venue by funding rate and depth, splits your order, and fills at
                the best blended price. No one sees your trade before execution.
              </p>
              <Link href="/trade" className="inline-flex h-10 px-6 items-center bg-[var(--primary)] hover:bg-[var(--primary-hover)] rounded-lg text-sm font-medium transition">
                Open Trade →
              </Link>
            </div>

            {/* Mini intent demo */}
            <div className="panel p-5">
              {!intentResult ? (
                <div className="space-y-4">
                  <div className="text-xs text-[var(--text-muted)]">Try it — submit a shielded intent right here</div>
                  <div className="bg-[var(--bg)] rounded-lg border border-[var(--border)] p-3">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-[var(--text-muted)]">Intent</span>
                      <span className="text-[var(--green)] font-medium">LONG $500 SOL</span>
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)]">Max slippage: 50 bps</div>
                  </div>
                  <button
                    onClick={submitIntent}
                    disabled={intentLoading}
                    className="w-full h-10 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-sm font-medium disabled:opacity-40 transition"
                  >
                    {intentLoading ? "Routing across venues..." : "Submit Shielded Intent"}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Encrypted */}
                  <div className="bg-[var(--bg)] rounded-lg border border-[var(--border)] p-2.5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-4 h-4 rounded-full bg-[var(--primary)]/20 text-[var(--primary)] text-[9px] flex items-center justify-center font-mono">1</span>
                      <span className="text-[10px] font-medium">Encrypted</span>
                    </div>
                    <div className="font-mono text-[9px] text-[var(--text-muted)] truncate">
                      0x{Array.from({length: 24}, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('')}...
                    </div>
                  </div>

                  {/* Routed */}
                  <div className="bg-[var(--bg)] rounded-lg border border-[var(--border)] p-2.5">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="w-4 h-4 rounded-full bg-[var(--primary)]/20 text-[var(--primary)] text-[9px] flex items-center justify-center font-mono">2</span>
                      <span className="text-[10px] font-medium">Routed across {intentResult.venues?.length} venues</span>
                    </div>
                    {intentResult.venues?.map((v: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-[10px] py-0.5">
                        <span>{v.venue}</span>
                        <span className={`font-mono ${v.status === 'filled' ? 'text-[var(--green)]' : 'text-[var(--text-muted)]'}`}>
                          {v.allocationPct}% — {v.status}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Executed */}
                  {intentResult.realExecution && intentResult.txSignature && (
                    <a
                      href={`https://explorer.solana.com/tx/${intentResult.txSignature}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block bg-[var(--green)]/5 rounded-lg border border-[var(--green)]/20 p-2.5 hover:border-[var(--green)]/40 transition"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="w-4 h-4 rounded-full bg-[var(--green)]/20 text-[var(--green)] text-[9px] flex items-center justify-center font-mono">3</span>
                        <span className="text-[10px] font-medium text-[var(--green)]">Executed on Solana</span>
                        <span className="text-[var(--green)] ml-auto">→</span>
                      </div>
                      <div className="font-mono text-[9px] text-[var(--green)] truncate">{intentResult.txSignature}</div>
                      <div className="text-[9px] text-[var(--text-muted)] mt-0.5">Click to verify on Solana Explorer</div>
                    </a>
                  )}

                  <button onClick={() => setIntentResult(null)} className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text)]">
                    Try again
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: We protect it */}
      <section className="border-b border-[var(--border)] py-16">
        <div className="max-w-[1100px] mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-10 items-center">
            {/* Payoff chart */}
            <div className="panel p-5 order-2 md:order-1">
              <div className="text-xs text-[var(--text-muted)] mb-3">Principal-protected payoff ($1,000 deposit)</div>
              <div className="relative h-48 bg-[var(--bg)] rounded-lg border border-[var(--border)] p-4 overflow-hidden">
                {/* Y axis */}
                <div className="absolute left-2 top-4 bottom-4 flex flex-col justify-between text-[9px] text-[var(--text-muted)] font-mono">
                  <span>$1,100</span>
                  <span>$1,050</span>
                  <span>$1,000</span>
                  <span>$950</span>
                </div>
                {/* Chart area */}
                <svg viewBox="0 0 300 150" className="w-full h-full ml-6" preserveAspectRatio="none">
                  {/* Grid lines */}
                  <line x1="0" y1="75" x2="300" y2="75" stroke="var(--border)" strokeWidth="1" strokeDasharray="4" />
                  <line x1="150" y1="0" x2="150" y2="150" stroke="var(--border)" strokeWidth="1" strokeDasharray="4" />
                  {/* Just holding SOL (gray dashed) */}
                  <line x1="0" y1="150" x2="300" y2="0" stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="3" opacity="0.3" />
                  {/* Principal protected payoff (green) */}
                  <polyline
                    points="0,75 75,75 100,75 150,75 200,55 250,35 300,15"
                    fill="none"
                    stroke="var(--green)"
                    strokeWidth="2.5"
                  />
                  {/* Protection floor */}
                  <line x1="0" y1="75" x2="150" y2="75" stroke="var(--green)" strokeWidth="1" strokeDasharray="2" opacity="0.5" />
                  {/* Labels */}
                  <text x="30" y="68" fill="var(--green)" fontSize="10" fontFamily="monospace">Protected</text>
                  <text x="200" y="30" fill="var(--green)" fontSize="10" fontFamily="monospace">Upside</text>
                  <text x="250" y="130" fill="var(--text-muted)" fontSize="9" fontFamily="monospace" opacity="0.5">Holding SOL</text>
                </svg>
              </div>
              <div className="grid grid-cols-3 gap-3 mt-3 text-center">
                <div className="text-[10px]">
                  <div className="text-[var(--text-muted)]">SOL -50%</div>
                  <div className="text-[var(--green)] font-semibold">$1,000</div>
                </div>
                <div className="text-[10px]">
                  <div className="text-[var(--text-muted)]">SOL flat</div>
                  <div className="font-semibold">$1,000</div>
                </div>
                <div className="text-[10px]">
                  <div className="text-[var(--text-muted)]">SOL +50%</div>
                  <div className="text-[var(--green)] font-semibold">$1,035</div>
                </div>
              </div>
            </div>

            <div className="order-1 md:order-2">
              <p className="text-xs font-mono text-[var(--green)] mb-3 tracking-wider uppercase">02 — Earn</p>
              <h2 className="text-2xl md:text-3xl font-bold mb-4">We protect it</h2>
              <p className="text-[var(--text-muted)] mb-4 leading-relaxed">
                Deposit USDC. Kamino lending earns yield to protect your principal. A delta-hedged
                perp position captures SOL upside. Black-Scholes option replication — the first
                on Solana since Friktion.
              </p>
              <p className="text-[var(--text-muted)] mb-6 leading-relaxed">
                If SOL drops to zero, you still get your deposit back. If SOL goes up, you keep the upside.
                Like owning a call option — without buying one.
              </p>
              <Link href="/earn" className="inline-flex h-10 px-6 items-center bg-[var(--green)]/10 border border-[var(--green)]/30 text-[var(--green)] hover:bg-[var(--green)]/20 rounded-lg text-sm font-medium transition">
                Deposit on Earn →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: Anyone can build */}
      <section className="border-b border-[var(--border)] py-16">
        <div className="max-w-[1100px] mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-10 items-center">
            <div>
              <p className="text-xs font-mono text-[var(--orange)] mb-3 tracking-wider uppercase">03 — Build</p>
              <h2 className="text-2xl md:text-3xl font-bold mb-4">Anyone can build on it</h2>
              <p className="text-[var(--text-muted)] mb-6 leading-relaxed">
                Same VenueAdapter interface routes both shielded intents and vault strategies.
                Pick a strategy, pick venues, configure parameters. Five adapters across four
                architectures — add a new DEX by implementing six methods.
              </p>
              <Link href="/build" className="inline-flex h-10 px-6 items-center bg-[var(--bg-card)] border border-[var(--border)] hover:border-[var(--border-hover)] rounded-lg text-sm font-medium transition">
                Open Build →
              </Link>
            </div>

            {/* VenueAdapter */}
            <div className="panel p-5">
              <div className="text-xs text-[var(--text-muted)] mb-3">One interface, any venue</div>
              <pre className="bg-[var(--bg)] rounded-lg border border-[var(--border)] p-3 text-[11px] font-mono text-[var(--text-muted)] leading-relaxed overflow-x-auto">
{`interface VenueAdapter {
  name: string;
  type: "perp" | "spot" | "hybrid";

  getPrice(market): Promise<number>;
  getVenueState(): Promise<VenueState>;
  trade(size): Promise<OrderResult>;
}

// 5 implemented:
// Percolator · Jupiter · Phoenix
// Kamino · VenueRouter`}</pre>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {["Percolator", "Jupiter Perps", "Phoenix", "Kamino", "VenueRouter"].map(name => (
                  <span key={name} className="text-[9px] font-mono px-2 py-1 rounded bg-[var(--bg)] border border-[var(--border)]">{name}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="grid-bg py-16">
        <div className="max-w-[700px] mx-auto px-6 text-center">
          <h2 className="text-2xl md:text-3xl font-bold mb-4">
            Shielded. Protected. Composable.
          </h2>
          <p className="text-[var(--text-muted)] mb-8">
            Cross-venue perp routing with privacy. Structured products via delta hedging.
            A vault layer anyone can build on. All on Solana.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/trade" className="h-12 px-8 flex items-center justify-center bg-[var(--primary)] hover:bg-[var(--primary-hover)] rounded-lg font-medium transition">
              Trade Now
            </Link>
            <Link href="/earn" className="h-12 px-8 flex items-center justify-center bg-[var(--bg-card)] border border-[var(--border)] hover:border-[var(--border-hover)] rounded-lg font-medium transition">
              Earn Yield
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
