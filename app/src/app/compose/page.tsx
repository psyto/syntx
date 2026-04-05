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
    title: "Any Token → Vault",
    description: "Swap any Solana token into vault collateral via Jupiter, then deposit into a strategy vault. One flow.",
    steps: [
      "Select token (SOL, BONK, JTO, etc.)",
      "Jupiter swaps to vault collateral",
      "Fabrknt Vaults deposits into vault",
      "Receive share tokens",
    ],
    protocols: ["Jupiter", "Fabrknt Vaults"],
    status: "live",
  },
  {
    id: "dn-oneclick",
    title: "One-Click Delta Neutral",
    description: "Swap half your SOL to USDC, deposit into vault, keeper automatically shorts SOL-PERP. Zero price risk, earn funding rate.",
    steps: [
      "Deposit SOL",
      "Jupiter swaps 50% to USDC",
      "Fabrknt Vaults deposits to DN vault",
      "Keeper opens matching short",
      "Earn funding rate (neutral to price)",
    ],
    protocols: ["Jupiter", "Fabrknt Vaults", "Percolator"],
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
    protocols: ["Fabrknt Vaults", "Kamino"],
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
    protocols: ["Squads", "Fabrknt Vaults", "Percolator"],
    status: "coming-soon",
  },
  {
    id: "atomic-hedge",
    title: "Lending Protocol Auto-Hedge",
    description: "Kamino or Marginfi CPI into Fabrknt Vaults to automatically hedge lending exposure. Atomic — same transaction as the loan.",
    steps: [
      "User borrows SOL on Kamino",
      "Kamino CPI calls Fabrknt Vaults cpi_trade",
      "Fabrknt Vaults opens matching short on Percolator",
      "Hedge is atomic with the loan",
      "If loan fails, hedge reverts too",
    ],
    protocols: ["Kamino", "Fabrknt Vaults", "Percolator"],
    status: "coming-soon",
  },
  {
    id: "spot-perp-arb",
    title: "Spot + Perp Arbitrage",
    description: "Buy spot on Phoenix, short perp on Fabrknt Vaults in one transaction. Capture basis spread with zero directional risk.",
    steps: [
      "Detect basis spread (spot vs perp price)",
      "Phoenix: buy spot SOL",
      "Fabrknt Vaults: short SOL-PERP",
      "Both in one atomic transaction",
      "Earn basis convergence + funding",
    ],
    protocols: ["Phoenix", "Fabrknt Vaults", "Percolator"],
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
          Build multi-protocol DeFi strategies in one flow. Fabrknt Vaults compose with
          Jupiter, Kamino, Marginfi, Phoenix, and any Solana program via CPI.
          This is what purpose-built chains like Hyperliquid can never offer.
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

      {/* Architecture callout */}
      <div className="mt-10 panel p-6">
        <h3 className="text-xs font-mono uppercase tracking-wider text-[var(--text-dim)] mb-4">
          How composability works
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
          <div>
            <div className="font-medium mb-2">CPI (Cross-Program Invocation)</div>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
              Any Solana program can call Fabrknt Vaults in the same transaction. Atomic execution — if any step fails, everything reverts.
            </p>
          </div>
          <div>
            <div className="font-medium mb-2">get_share_price</div>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
              On-chain oracle returns vault share price. Lending protocols can value Fabrknt Vaults shares as collateral without external oracles.
            </p>
          </div>
          <div>
            <div className="font-medium mb-2">cpi_trade</div>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
              Public trading interface — any program can open/close positions through the vault. Size-limited for safety.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
