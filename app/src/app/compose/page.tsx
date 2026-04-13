"use client";

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import dynamic from "next/dynamic";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((mod) => mod.WalletMultiButton),
  { ssr: false },
);

const SwapDeposit = dynamic(() => import("../components/SwapDeposit"), { ssr: false });

interface Recipe {
  id: string;
  title: string;
  description: string;
  steps: string[];
  protocols: string[];
  status: "live" | "coming-soon";
  apy?: string;
}

const recipes: Recipe[] = [
  {
    id: "swap-deposit",
    title: "One-Click Deposit",
    description: "Get test USDC from faucet and deposit into a vault — all in one click. On mainnet, this would swap any token via Jupiter first.",
    steps: [
      "Click the button below",
      "Faucet mints 100 test USDC + SOL for gas",
      "Syntx deposits 10 USDC into SOL Funding Rate vault",
      "Receive share tokens (check Earn page)",
    ],
    protocols: ["Faucet", "Syntx"],
    status: "live",
  },
  {
    id: "dn-oneclick",
    title: "One-Click Delta Neutral",
    description: "Swap half your SOL to USDC, deposit into vault, keeper automatically shorts SOL-PERP. Zero price risk, earn funding rate.",
    steps: [
      "Deposit SOL",
      "Jupiter swaps 50% to USDC",
      "Syntx deposits to DN vault",
      "Keeper opens matching short",
      "Earn funding rate (neutral to price)",
    ],
    protocols: ["Jupiter", "Syntx", "Percolator"],
    status: "coming-soon",
    apy: "~8-15%",
  },
  {
    id: "leveraged-yield",
    title: "Leveraged Vault Yield",
    description: "Deposit into vault, use shares as collateral on Kamino, borrow more, deposit again. 1.7x leveraged yield.",
    steps: [
      "Deposit 100 USDC → get 100 shares",
      "Deposit shares as collateral on Kamino",
      "Borrow 70 USDC against shares",
      "Deposit 70 USDC → get 70 more shares",
      "Total: 170 USDC exposure on 100 capital",
    ],
    protocols: ["Syntx", "Kamino"],
    status: "coming-soon",
    apy: "~17% (1.7x)",
  },
  {
    id: "treasury-hedge",
    title: "Protocol Treasury Hedge",
    description: "DAOs deposit treasury SOL into a vault that automatically hedges via perp shorts. Protect revenue from downside.",
    steps: [
      "DAO approves via Squads multisig",
      "Treasury SOL deposited to hedge vault",
      "Keeper shorts SOL-PERP for 50% hedge",
      "Treasury protected from SOL downside",
      "Earn funding when shorts are paid",
    ],
    protocols: ["Squads", "Syntx", "Percolator"],
    status: "coming-soon",
  },
  {
    id: "atomic-hedge",
    title: "Lending Protocol Auto-Hedge",
    description: "Kamino or Marginfi CPI into Syntx to automatically hedge lending exposure. Atomic — same transaction as the loan.",
    steps: [
      "User borrows SOL on Kamino",
      "Kamino CPI calls Syntx cpi_trade",
      "Syntx opens matching short on Percolator",
      "Hedge is atomic with the loan",
      "If loan fails, hedge reverts too",
    ],
    protocols: ["Kamino", "Syntx", "Percolator"],
    status: "coming-soon",
  },
  {
    id: "spot-perp-arb",
    title: "Spot + Perp Arbitrage",
    description: "Buy spot on Phoenix, short perp on Syntx in one transaction. Capture basis spread with zero directional risk.",
    steps: [
      "Detect basis spread (spot vs perp price)",
      "Phoenix: buy spot SOL",
      "Syntx: short SOL-PERP",
      "Both in one atomic transaction",
      "Earn basis convergence + funding",
    ],
    protocols: ["Phoenix", "Syntx", "Percolator"],
    status: "coming-soon",
  },
];

export default function ComposePage() {
  const { publicKey } = useWallet();
  const [selectedRecipe, setSelectedRecipe] = useState<string | null>(null);

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-2">Compose</h1>
        <p className="text-[var(--text-muted)] max-w-2xl">
          Build multi-protocol DeFi strategies in one flow. Syntx vaults route across
          Percolator, Phoenix, and Jupiter Perps — then compose with Kamino, Marginfi,
          and any Solana program via CPI. Exchange-agnostic composability.
        </p>
      </div>

      {/* Live vs Coming Soon filter */}
      <div className="flex gap-2 mb-6">
        <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-dim)] self-center mr-2">Filter:</span>
        <button
          onClick={() => setSelectedRecipe(null)}
          className={`text-xs px-3 py-1.5 rounded-lg transition ${
            !selectedRecipe ? "bg-[var(--primary)] text-white" : "bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-white"
          }`}
        >
          All
        </button>
      </div>

      {/* Recipe Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-[1px] bg-[var(--border)] rounded-xl overflow-hidden">
        {recipes.map((r) => {
          const isExpanded = selectedRecipe === r.id;
          return (
            <div key={r.id} className="bg-[var(--bg-panel)]">
              <button
                onClick={() => setSelectedRecipe(isExpanded ? null : r.id)}
                className="w-full p-6 text-left hover:bg-[var(--bg-card)] transition"
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold">{r.title}</h3>
                  <div className="flex items-center gap-2">
                    {r.apy && (
                      <span className="text-xs font-mono text-[var(--green)]">{r.apy}</span>
                    )}
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                      r.status === "live"
                        ? "bg-green-950 text-[var(--green)]"
                        : "bg-yellow-950 text-yellow-400"
                    }`}>
                      {r.status === "live" ? "LIVE" : "SOON"}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-[var(--text-muted)] mb-3 leading-relaxed">{r.description}</p>
                <div className="flex gap-1.5 flex-wrap">
                  {r.protocols.map((p) => (
                    <span key={p} className="text-[9px] font-mono px-2 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)] text-[var(--text-dim)]">
                      {p}
                    </span>
                  ))}
                </div>
              </button>

              {/* Expanded: Step-by-step */}
              {isExpanded && (
                <div className="px-6 pb-6 border-t border-[var(--border)]">
                  <div className="pt-4 space-y-2">
                    {r.steps.map((step, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <div className="w-5 h-5 rounded-full bg-[var(--bg-card)] border border-[var(--border)] flex items-center justify-center text-[9px] font-mono text-[var(--text-dim)] flex-shrink-0 mt-0.5">
                          {i + 1}
                        </div>
                        <span className="text-sm text-[var(--text-muted)]">{step}</span>
                      </div>
                    ))}
                  </div>

                  {r.status === "live" && r.id === "swap-deposit" ? (
                    <div className="mt-4">
                      <SwapDeposit onSuccess={() => {}} />
                    </div>
                  ) : r.status === "live" ? (
                    <a
                      href="/vaults"
                      className="mt-4 inline-flex h-9 px-5 items-center bg-[var(--primary)] hover:bg-[var(--primary-hover)] rounded-lg text-xs font-medium transition"
                    >
                      Try Now
                    </a>
                  ) : (
                    <div className="mt-4 text-xs text-[var(--text-dim)] font-mono">
                      Coming soon — CPI interface ready, needs frontend integration
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Multi-Venue Architecture */}
      <div className="mt-10 panel p-6">
        <h3 className="text-xs font-mono uppercase tracking-wider text-[var(--text-dim)] mb-2">
          Exchange-Agnostic Architecture
        </h3>
        <p className="text-xs text-[var(--text-muted)] mb-6">
          Vaults route trades through a VenueAdapter interface across 3 fundamentally different architectures.
          Adding a new DEX means implementing 6 methods — the strategy code never changes.
        </p>

        {/* Architecture Diagram */}
        <div className="bg-[var(--bg)] rounded-xl border border-[var(--border)] p-6 mb-6">
          <div className="flex flex-col md:flex-row items-center justify-center gap-3 md:gap-5 text-xs font-mono">
            {/* Left: Users */}
            <div className="flex flex-col gap-2 items-center">
              <ArchBox label="Depositors" sub="USDC" />
              <ArchBox label="DeFi Protocols" sub="CPI" accent />
            </div>

            <div className="text-[var(--text-dim)] text-lg md:rotate-0 rotate-90">→</div>

            {/* Center: Syntx */}
            <div className="flex flex-col items-center gap-2">
              <div className="px-6 py-4 bg-[var(--primary)]/10 border border-[var(--primary)]/30 rounded-lg text-center">
                <div className="text-[9px] uppercase tracking-wider text-[var(--primary)] mb-1">Syntx Vault (PDA)</div>
                <div className="text-sm font-semibold">VenueRouter</div>
                <div className="text-[9px] text-[var(--text-dim)] mt-1">Scores → Routes → Executes</div>
              </div>
              <div className="flex gap-2">
                <span className="text-[8px] px-2 py-0.5 rounded bg-green-950 text-[var(--green)]">SPL Shares</span>
                <span className="text-[8px] px-2 py-0.5 rounded bg-blue-950 text-blue-400">Circuit Breaker</span>
              </div>
            </div>

            <div className="text-[var(--text-dim)] text-lg md:rotate-0 rotate-90">→</div>

            {/* Right: Venues */}
            <div className="flex flex-col gap-2">
              <VenueBox name="Percolator" type="perp" sub="Slab-based risk engine" />
              <VenueBox name="Phoenix" type="spot" sub="CLOB orderbook" />
              <VenueBox name="Jupiter Perps" type="perp" sub="Oracle-based AMM" />
              <div className="px-4 py-2 border border-dashed border-[var(--border)] rounded-lg text-center text-[var(--text-dim)]">
                + Your DEX here
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CPI Interface */}
      <div className="mt-6 panel p-6">
        <h3 className="text-xs font-mono uppercase tracking-wider text-[var(--text-dim)] mb-2">
          CPI Interface
        </h3>
        <p className="text-xs text-[var(--text-muted)] mb-6">
          Any Solana program can trade through Syntx vaults. Atomic execution — if any step fails, everything reverts.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-[1px] bg-[var(--border)] rounded-xl overflow-hidden">
          <div className="bg-[var(--bg-panel)] p-5">
            <div className="text-[var(--primary)] font-mono text-sm mb-2">cpi_trade</div>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed mb-3">
              Public trading interface — any whitelisted program can open/close positions through the vault.
            </p>
            <CodeBlock code={`// Another program calls Syntx
invoke_signed(
  &cpi_trade_ix,
  &[vault, slab, percolator],
  &[&seeds],
)?;`} />
          </div>
          <div className="bg-[var(--bg-panel)] p-5">
            <div className="text-[var(--primary)] font-mono text-sm mb-2">get_share_price</div>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed mb-3">
              On-chain oracle. Lending protocols value Syntx shares as collateral without external oracles.
            </p>
            <CodeBlock code={`// Read share price on-chain
let vault = VaultState::load(
  &vault_account
)?;
let price = vault.equity()
  / vault.total_shares;`} />
          </div>
          <div className="bg-[var(--bg-panel)] p-5">
            <div className="text-[var(--primary)] font-mono text-sm mb-2">deposit / withdraw</div>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed mb-3">
              Standard vault operations. Deposit collateral, receive SPL share tokens. Withdraw burns shares.
            </p>
            <CodeBlock code={`// Deposit via SDK
const ix = syntx.deposit({
  amount: 1_000_000n,
  vault: vaultPda,
  userCollateral: ata,
});`} />
          </div>
        </div>
      </div>

      {/* Venue Adapter */}
      <div className="mt-6 panel p-6">
        <h3 className="text-xs font-mono uppercase tracking-wider text-[var(--text-dim)] mb-2">
          Add a new venue
        </h3>
        <p className="text-xs text-[var(--text-muted)] mb-4">
          Implement the VenueAdapter interface — 6 methods. The keeper and strategy code stays unchanged.
        </p>
        <CodeBlock code={`interface VenueAdapter {
  readonly name: string;
  readonly type: "perp" | "spot" | "hybrid";

  initialize(): Promise<void>;
  getPrice(market: string): Promise<number>;
  getPosition(): Promise<Position | null>;
  getVenueState(): Promise<VenueState>;
  trade(size: bigint): Promise<OrderResult>;
  crank(): Promise<void>;
}

// Example: add Drift as a venue
class DriftAdapter implements VenueAdapter {
  readonly name = "Drift";
  readonly type = "perp";
  // ... implement 6 methods
}`} />
      </div>
    </div>
  );
}

function ArchBox({ label, sub, accent }: { label: string; sub: string; accent?: boolean }) {
  return (
    <div className={`px-4 py-3 rounded-lg text-center border ${accent ? "border-[var(--primary)]/30 bg-[var(--primary)]/5" : "border-[var(--border)] bg-[var(--bg-card)]"}`}>
      <div className="text-xs font-medium">{label}</div>
      <div className="text-[9px] text-[var(--text-dim)]">{sub}</div>
    </div>
  );
}

function VenueBox({ name, type, sub }: { name: string; type: "perp" | "spot"; sub: string }) {
  return (
    <div className="px-4 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg flex items-center gap-2">
      <span className={`text-[8px] font-mono uppercase px-1.5 py-0.5 rounded ${
        type === "perp" ? "bg-blue-950 text-blue-400" : "bg-green-950 text-[var(--green)]"
      }`}>
        {type}
      </span>
      <div>
        <div className="text-xs font-medium">{name}</div>
        <div className="text-[9px] text-[var(--text-dim)]">{sub}</div>
      </div>
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3 text-[11px] font-mono text-[var(--text-muted)] leading-relaxed overflow-x-auto">
      {code}
    </pre>
  );
}
