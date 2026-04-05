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
            Composable Perp Vaults
            <br />
            <span className="text-[var(--text-muted)]">on Solana</span>
          </h1>
          <p className="text-[var(--text-muted)] text-lg md:text-xl max-w-2xl mb-10">
            Launch strategy vaults that trade perpetual futures on Percolator.
            Compose with Jupiter, Kamino, Marginfi — the entire Solana DeFi stack.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href="/vaults"
              className="h-12 px-8 flex items-center justify-center bg-[var(--primary)] hover:bg-[var(--primary-hover)] rounded-lg font-medium transition"
            >
              Explore Vaults
            </Link>
            <Link
              href="/create"
              className="h-12 px-8 flex items-center justify-center bg-[var(--bg-card)] border border-[var(--border)] hover:border-[var(--border-hover)] rounded-lg font-medium transition"
            >
              Create Vault
            </Link>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-b">
        <div className="max-w-[1100px] mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-[1px] bg-[var(--border)]">
            <StatCard label="Protocol" value="Percolator" sub="Formally Verified" />
            <StatCard label="Risk Engine" value="H Ratio" sub="No insolvency possible" />
            <StatCard label="Composability" value="Full CPI" sub="Any Solana program" />
            <StatCard label="Vaults" value="Permissionless" sub="Anyone can create" />
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20">
        <div className="max-w-[1100px] mx-auto px-6">
          <h2 className="text-2xl font-bold mb-3 text-center">Not just a perp DEX</h2>
          <p className="text-[var(--text-muted)] text-center mb-12 max-w-xl mx-auto">
            Fabrknt Vaults creates composable strategy vaults that interact with the entire Solana ecosystem —
            not isolated perp markets.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-[1px] bg-[var(--border)] rounded-xl overflow-hidden">
            <FeatureCard
              title="Vault-Native"
              description="Deposit into managed strategy vaults. Keepers trade on your behalf — funding rate harvesting, delta-neutral, market making."
              icon="1"
            />
            <FeatureCard
              title="Composable"
              description="Your vault composes with Jupiter, Kamino, Marginfi via CPI. Atomic hedging, leveraged yield, protocol treasury management."
              icon="2"
            />
            <FeatureCard
              title="Formally Verified"
              description="Built on Percolator's H ratio — mathematically proven that no user can withdraw more than exists. Kani theorem prover."
              icon="3"
            />
          </div>
        </div>
      </section>

      {/* Composability Grid */}
      <section className="border-t py-20">
        <div className="max-w-[1100px] mx-auto px-6">
          <h2 className="text-2xl font-bold mb-3 text-center">Compose with everything</h2>
          <p className="text-[var(--text-muted)] text-center mb-12 max-w-xl mx-auto">
            Purpose-built chains like Hyperliquid can never offer this.
            Fabrknt Vaults live on Solana — the composability layer.
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
              protocol="Kamino"
              action="Atomic hedging"
              description="Lending protocols CPI into Fabrknt Vaults to auto-hedge exposure. One transaction, zero basis risk."
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
          <h2 className="text-3xl font-bold mb-4">The composable perp layer Solana needs</h2>
          <p className="text-[var(--text-muted)] mb-8 max-w-lg mx-auto">
            Solana needs a composable perp layer. Fabrknt Vaults is building it on Percolator.
            Live on devnet.
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
