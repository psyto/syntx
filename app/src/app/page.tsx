"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((mod) => mod.WalletMultiButton),
  { ssr: false },
);

export default function Home() {
  const { connected } = useWallet();

  return (
    <div>
      {/* Hero */}
      <section className="grid-bg border-b">
        <div className="max-w-[1100px] mx-auto px-6 py-24 md:py-32 flex flex-col items-center text-center">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight leading-tight mb-6">
            Composable
            <br />
            Exchange-Agnostic Vaults
            <br />
            <span className="text-[var(--text-muted)]">on Solana</span>
          </h1>
          <p className="text-[var(--text-muted)] text-lg md:text-xl max-w-2xl mb-10">
            Strategy vaults that route across any perp venue — Percolator, Phoenix, Jupiter Perps.
            One vault, best execution, full CPI composability.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href="/earn"
              className="h-12 px-8 flex items-center justify-center bg-[var(--primary)] hover:bg-[var(--primary-hover)] rounded-lg font-medium transition"
            >
              Start Earning
            </Link>
            <Link
              href="/vaults"
              className="h-12 px-8 flex items-center justify-center bg-[var(--bg-card)] border border-[var(--border)] hover:border-[var(--border-hover)] rounded-lg font-medium transition"
            >
              Explore Vaults
            </Link>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-b">
        <div className="max-w-[1100px] mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-[1px] bg-[var(--border)]">
            <StatCard label="Venues" value="Multi-DEX" sub="Percolator · Phoenix · Jupiter" />
            <StatCard label="Risk Engine" value="H Ratio" sub="Formally verified by Kani" />
            <StatCard label="Composability" value="Full CPI" sub="Any Solana program" />
            <StatCard label="Vaults" value="Permissionless" sub="Anyone can create" />
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20">
        <div className="max-w-[1100px] mx-auto px-6">
          <h2 className="text-2xl font-bold mb-3 text-center">The vault layer Solana needs</h2>
          <p className="text-[var(--text-muted)] text-center mb-12 max-w-xl mx-auto">
            Every perp venue builds in isolation. Syntx sits on top — composable vaults that
            route to the best execution across any DEX.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-[1px] bg-[var(--border)] rounded-xl overflow-hidden">
            <FeatureCard
              title="Exchange-Agnostic"
              description="Vaults route trades across Percolator, Phoenix, and Jupiter Perps. Same strategy, best execution. Add new venues with one adapter."
              icon="1"
            />
            <FeatureCard
              title="Composable"
              description="CPI-native vaults compose with Jupiter, Kamino, Marginfi. Atomic hedging, leveraged yield, protocol treasury management — one transaction."
              icon="2"
            />
            <FeatureCard
              title="Vault-Native"
              description="On-chain PDA vaults with no private keys. SPL share tokens usable as collateral across DeFi. Performance fees enforced on-chain."
              icon="3"
            />
          </div>
        </div>
      </section>

      {/* Venue Architecture */}
      <section className="border-t py-20">
        <div className="max-w-[1100px] mx-auto px-6">
          <h2 className="text-2xl font-bold mb-3 text-center">Route to best execution</h2>
          <p className="text-[var(--text-muted)] text-center mb-12 max-w-xl mx-auto">
            Three architectures — slab-based, CLOB, oracle-AMM — unified behind one interface.
            The VenueRouter scores each DEX and routes to the best venue.
          </p>

          <div className="panel p-8">
            <div className="flex flex-col md:flex-row items-center justify-center gap-4 md:gap-6 text-sm font-mono">
              <div className="px-4 py-3 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg text-center">
                <div className="text-[9px] uppercase tracking-wider text-[var(--text-dim)] mb-1">Depositors</div>
                <div className="text-[var(--primary)]">USDC → Vault</div>
              </div>
              <Arrow />
              <div className="px-6 py-4 bg-[var(--primary)]/10 border border-[var(--primary)]/30 rounded-lg text-center">
                <div className="text-[9px] uppercase tracking-wider text-[var(--primary)] mb-1">Syntx Vault</div>
                <div>VenueRouter</div>
              </div>
              <Arrow />
              <div className="flex flex-col gap-2">
                <VenueTag name="Percolator" type="perp" />
                <VenueTag name="Phoenix" type="spot" />
                <VenueTag name="Jupiter Perps" type="perp" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Composability Grid */}
      <section className="border-t py-20">
        <div className="max-w-[1100px] mx-auto px-6">
          <h2 className="text-2xl font-bold mb-3 text-center">Compose with everything</h2>
          <p className="text-[var(--text-muted)] text-center mb-12 max-w-xl mx-auto">
            Purpose-built chains like Hyperliquid can never offer this.
            Syntx lives on Solana — the composability layer.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-[1px] bg-[var(--border)] rounded-xl overflow-hidden">
            <ComposeCard
              protocol="Jupiter"
              action="Swap any token → deposit"
              description="Users deposit SOL, BONK, or any token. Jupiter routes to vault collateral automatically."
            />
            <ComposeCard
              protocol="Kamino / Marginfi"
              action="Vault shares as collateral"
              description="Borrow against your vault shares. Leverage your yield. Composable lending."
            />
            <ComposeCard
              protocol="Phoenix"
              action="Spot + perp arbitrage"
              description="Buy spot on Phoenix, short perp on Syntx in one atomic transaction. Capture basis spread."
            />
            <ComposeCard
              protocol="Protocol Treasuries"
              action="Managed hedging"
              description="DAOs deposit treasury into vaults that hedge SOL exposure via perp shorts. No CEX needed."
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t grid-bg">
        <div className="max-w-[1100px] mx-auto px-6 py-20 text-center">
          <h2 className="text-3xl font-bold mb-4">Composable exchange-agnostic vaults</h2>
          <p className="text-[var(--text-muted)] mb-8 max-w-lg mx-auto">
            One vault layer across every Solana perp venue.
            CPI-native. Formally verified. Live on devnet.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/vaults"
              className="h-12 px-8 flex items-center justify-center bg-[var(--primary)] hover:bg-[var(--primary-hover)] rounded-lg font-medium transition"
            >
              Explore Vaults
            </Link>
            {!connected && <WalletMultiButton />}
          </div>
        </div>
      </section>
    </div>
  );
}

function Arrow() {
  return (
    <div className="text-[var(--text-dim)] text-lg md:rotate-0 rotate-90">→</div>
  );
}

function VenueTag({ name, type }: { name: string; type: "perp" | "spot" }) {
  return (
    <div className="px-4 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg flex items-center gap-2">
      <span className={`text-[8px] font-mono uppercase px-1.5 py-0.5 rounded ${
        type === "perp" ? "bg-blue-950 text-blue-400" : "bg-green-950 text-[var(--green)]"
      }`}>
        {type}
      </span>
      <span className="text-sm">{name}</span>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-[var(--bg-panel)] p-6">
      <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-dim)] mb-2">{label}</div>
      <div className="text-xl font-semibold mb-1">{value}</div>
      <div className="text-xs text-[var(--text-muted)]">{sub}</div>
    </div>
  );
}

function FeatureCard({ title, description, icon }: { title: string; description: string; icon: string }) {
  return (
    <div className="bg-[var(--bg-panel)] p-6">
      <div className="w-8 h-8 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] flex items-center justify-center text-xs font-mono text-[var(--primary)] mb-4">
        {icon}
      </div>
      <h3 className="font-semibold mb-2">{title}</h3>
      <p className="text-sm text-[var(--text-muted)] leading-relaxed">{description}</p>
    </div>
  );
}

function ComposeCard({ protocol, action, description }: { protocol: string; action: string; description: string }) {
  return (
    <div className="bg-[var(--bg-panel)] p-6">
      <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--primary)] mb-2">{protocol}</div>
      <h3 className="font-semibold mb-2">{action}</h3>
      <p className="text-sm text-[var(--text-muted)] leading-relaxed">{description}</p>
    </div>
  );
}
