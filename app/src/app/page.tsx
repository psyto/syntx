"use client";

import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((mod) => mod.WalletMultiButton),
  { ssr: false },
);

const VaultDashboard = dynamic(() => import("./components/VaultDashboard"), {
  ssr: false,
});

export default function Home() {
  const { connected } = useWallet();

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Syntx</h1>
            <span className="text-xs bg-blue-900/50 text-blue-300 px-2 py-0.5 rounded-full">
              devnet
            </span>
          </div>
          <WalletMultiButton />
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Hero */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold mb-2">Composable Perp Vault</h2>
          <p className="text-gray-400 max-w-2xl">
            Deposit collateral into strategy vaults that trade perpetual futures on Percolator.
            Earn yield from funding rate harvesting, delta-neutral strategies, and market making.
          </p>
        </div>

        {/* Dashboard */}
        <VaultDashboard />

        {/* Footer */}
        <footer className="mt-12 pt-6 border-t border-gray-800 text-center text-xs text-gray-500">
          <p>
            Built on{" "}
            <a href="https://github.com/aeyakovenko/percolator" className="text-blue-400 hover:text-blue-300">
              Percolator
            </a>
            {" "}by Anatoly Yakovenko
          </p>
          <p className="mt-1">
            <a href="https://github.com/psyto/syntx" className="text-blue-400 hover:text-blue-300">
              github.com/psyto/syntx
            </a>
          </p>
        </footer>
      </div>
    </main>
  );
}
