"use client";

import dynamic from "next/dynamic";

const VaultList = dynamic(() => import("../components/VaultList"), { ssr: false });

export default function VaultsPage() {
  return (
    <div className="max-w-[1100px] mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-2">Vault Marketplace</h1>
        <p className="text-[var(--text-muted)]">
          Browse strategy vaults. Click to view details, deposit, or withdraw.
          Each vault is managed by an independent keeper with its own strategy.
        </p>
      </div>
      <VaultList />
    </div>
  );
}
