"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((mod) => mod.WalletMultiButton),
  { ssr: false },
);

const VaultDashboard = dynamic(() => import("./components/VaultDashboard"), {
  ssr: false,
  loading: () => (
    <div className="space-y-4">
      <div className="shimmer h-48 rounded-xl" />
      <div className="shimmer h-32 rounded-xl" />
      <div className="shimmer h-40 rounded-xl" />
    </div>
  ),
});

const SwapDeposit = dynamic(() => import("./components/SwapDeposit"), {
  ssr: false,
});

const VaultList = dynamic(() => import("./components/VaultList"), {
  ssr: false,
});

export default function Home() {
  const { connected } = useWallet();
  const [selectedVault, setSelectedVault] = useState<string | null>(
    "4pL2aQawAbc2XwjRE9ptrH4yxihn4BL2uVMavgZrtYUK" // default to our devnet vault
  );

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-[var(--bg)]/80 backdrop-blur-md">
        <div className="max-w-[1100px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold tracking-tight">syntx</h1>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded border text-[var(--text-dim)]">
              DEVNET
            </span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/psyto/syntx"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[var(--text-muted)] hover:text-white transition"
            >
              Docs
            </a>
            <WalletMultiButton />
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="grid-bg border-b">
        <div className="max-w-[1100px] mx-auto px-6 py-20">
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight leading-tight mb-4">
            Composable Perp Vaults
            <br />
            <span className="text-[var(--text-muted)]">on Solana</span>
          </h2>
          <p className="text-[var(--text-muted)] text-lg max-w-xl mb-8">
            Deposit into strategy vaults that trade perpetual futures on Percolator.
            Vault-native. Formally verified. Protocol-owned liquidity.
          </p>
          {!connected && (
            <div className="flex gap-3">
              <WalletMultiButton />
            </div>
          )}
        </div>
      </section>

      {/* Main */}
      <main className="flex-1">
        <div className="max-w-[1100px] mx-auto px-6 py-10">
          {/* Vault Marketplace */}
          <VaultList onSelectVault={setSelectedVault} />

          {/* Selected Vault Dashboard */}
          {selectedVault && (
            <div className="mt-6">
              <VaultDashboard />
            </div>
          )}

          {/* Swap & Deposit */}
          {connected && selectedVault && (
            <div className="mt-6">
              <SwapDeposit onSuccess={() => {}} />
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t">
        <div className="max-w-[1100px] mx-auto px-6 py-6 flex items-center justify-between text-xs text-[var(--text-dim)]">
          <span>
            Built on{" "}
            <a href="https://github.com/aeyakovenko/percolator" className="text-[var(--text-muted)] hover:text-white transition">
              Percolator
            </a>
          </span>
          <a href="https://github.com/psyto/syntx" className="text-[var(--text-muted)] hover:text-white transition">
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
