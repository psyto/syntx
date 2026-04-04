"use client";

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import dynamic from "next/dynamic";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((mod) => mod.WalletMultiButton),
  { ssr: false },
);

const SYNTX_PROGRAM_ID = new PublicKey("53r6bg7JBFqf5Jfs7fe4kHDtwXwUgDWoLarYrsWcoF1V");

const steps = [
  { num: 1, title: "Market" },
  { num: 2, title: "Fees" },
  { num: 3, title: "Strategy" },
  { num: 4, title: "Deploy" },
];

export default function CreatePage() {
  const { publicKey } = useWallet();
  const [step, setStep] = useState(1);
  const [config, setConfig] = useState({
    slab: "",
    percolatorProgram: "Edq18N2pdT3Sz9EukbZe4YsQkvmxvmmkUL1KHpv96xJF",
    collateralMint: "",
    perfFeeBps: "20",
    mgmtFeeBps: "2",
    depositCap: "0",
    strategy: "funding-rate",
  });

  const updateConfig = (key: string, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const vaultPda = publicKey && config.collateralMint
    ? (() => {
        try {
          const [pda] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), new PublicKey(config.collateralMint).toBuffer(), publicKey.toBuffer()],
            SYNTX_PROGRAM_ID,
          );
          return pda.toBase58();
        } catch { return null; }
      })()
    : null;

  return (
    <div className="max-w-[800px] mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-2">Create Vault</h1>
        <p className="text-[var(--text-muted)]">
          Launch a composable strategy vault on Percolator. Anyone can deposit into your vault.
          You run the keeper and earn performance + management fees.
        </p>
      </div>

      {!publicKey ? (
        <div className="panel p-12 text-center">
          <p className="text-[var(--text-muted)] mb-4">Connect wallet to create a vault</p>
          <WalletMultiButton />
        </div>
      ) : (
        <>
          {/* Step Progress */}
          <div className="flex items-center justify-between mb-10">
            {steps.map((s) => (
              <button
                key={s.num}
                onClick={() => setStep(s.num)}
                className="flex items-center gap-2"
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-mono border transition ${
                  step === s.num
                    ? "bg-[var(--primary)] border-[var(--primary)] text-white"
                    : step > s.num
                    ? "bg-[var(--bg-card)] border-[var(--green)] text-[var(--green)]"
                    : "bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-dim)]"
                }`}>
                  {step > s.num ? "✓" : s.num}
                </div>
                <span className={`text-xs hidden sm:block ${
                  step === s.num ? "text-white" : "text-[var(--text-dim)]"
                }`}>
                  {s.title}
                </span>
              </button>
            ))}
          </div>

          {/* Step Content */}
          <div className="panel p-6 space-y-5">
            {step === 1 && (
              <>
                <h3 className="font-semibold">Select Market</h3>
                <p className="text-sm text-[var(--text-muted)]">
                  Choose the Percolator slab (market) your vault will trade on.
                </p>
                <div className="space-y-4">
                  <Field
                    label="Percolator Slab Address"
                    value={config.slab}
                    onChange={(v) => updateConfig("slab", v)}
                    placeholder="e.g., J55KavPouZg8ZeWnTY77ZBL2DdQskzKpkFvuTtbUNzYC"
                    help="The slab account for the perp market (SOL-PERP, BTC-PERP, etc.)"
                  />
                  <Field
                    label="Collateral Mint"
                    value={config.collateralMint}
                    onChange={(v) => updateConfig("collateralMint", v)}
                    placeholder="e.g., So11111111111111111111111111111111111111112"
                    help="The token used as collateral (must match the slab's collateral)"
                  />
                  <Field
                    label="Percolator Program ID"
                    value={config.percolatorProgram}
                    onChange={(v) => updateConfig("percolatorProgram", v)}
                    help="Usually Edq18N...xJF on devnet"
                  />
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h3 className="font-semibold">Fee Structure</h3>
                <p className="text-sm text-[var(--text-muted)]">
                  Set your fees as the vault manager. Fees are collected via share dilution.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field
                    label="Performance Fee (%)"
                    value={config.perfFeeBps}
                    onChange={(v) => updateConfig("perfFeeBps", v)}
                    type="number"
                    help="% of profits above high-water mark (max 50%)"
                  />
                  <Field
                    label="Management Fee (%/year)"
                    value={config.mgmtFeeBps}
                    onChange={(v) => updateConfig("mgmtFeeBps", v)}
                    type="number"
                    help="Annual % of AUM, accrued per-second (max 10%)"
                  />
                  <Field
                    label="Deposit Cap"
                    value={config.depositCap}
                    onChange={(v) => updateConfig("depositCap", v)}
                    type="number"
                    help="Maximum total deposits in raw units (0 = unlimited)"
                  />
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <h3 className="font-semibold">Strategy Type</h3>
                <p className="text-sm text-[var(--text-muted)]">
                  Choose the strategy your keeper will run. This determines how the vault trades.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[
                    { id: "funding-rate", title: "Funding Rate Harvest", desc: "Collect funding payments by taking the paying side" },
                    { id: "delta-neutral", title: "Delta Neutral", desc: "Long spot + short perp = zero price risk, earn funding" },
                    { id: "market-making", title: "Market Making", desc: "Provide two-sided liquidity as LP, earn trading fees" },
                    { id: "custom", title: "Custom Strategy", desc: "Run your own keeper logic — full flexibility" },
                  ].map((s) => (
                    <button
                      key={s.id}
                      onClick={() => updateConfig("strategy", s.id)}
                      className={`p-4 rounded-lg text-left border transition ${
                        config.strategy === s.id
                          ? "border-[var(--primary)] bg-[var(--primary)]/10"
                          : "border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--border-hover)]"
                      }`}
                    >
                      <div className="text-sm font-medium mb-1">{s.title}</div>
                      <div className="text-xs text-[var(--text-muted)]">{s.desc}</div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {step === 4 && (
              <>
                <h3 className="font-semibold">Review & Deploy</h3>
                <p className="text-sm text-[var(--text-muted)]">
                  Review your vault configuration. Deployment requires 3 transactions.
                </p>

                <div className="space-y-2 text-sm">
                  <ReviewRow label="Slab" value={config.slab ? config.slab.slice(0, 8) + "..." : "Not set"} />
                  <ReviewRow label="Collateral" value={config.collateralMint ? config.collateralMint.slice(0, 8) + "..." : "Not set"} />
                  <ReviewRow label="Performance Fee" value={`${config.perfFeeBps}%`} />
                  <ReviewRow label="Management Fee" value={`${config.mgmtFeeBps}%/yr`} />
                  <ReviewRow label="Deposit Cap" value={config.depositCap === "0" ? "Unlimited" : config.depositCap} />
                  <ReviewRow label="Strategy" value={config.strategy} />
                  {vaultPda && <ReviewRow label="Vault PDA" value={vaultPda.slice(0, 12) + "..."} />}
                  <ReviewRow label="Manager" value={publicKey.toBase58().slice(0, 12) + "..."} />
                </div>

                <div className="bg-yellow-950 border border-yellow-800 rounded-lg p-4 text-xs text-yellow-300">
                  Vault creation requires CLI deployment (share mint creation + InitVault + RegisterOnPercolator).
                  <br /><br />
                  Run: <code className="bg-[var(--bg)] px-1.5 py-0.5 rounded">cd keeper && npx ts-node src/setup-devnet.ts</code>
                </div>
              </>
            )}

            {/* Navigation */}
            <div className="flex justify-between pt-4 border-t border-[var(--border)]">
              <button
                onClick={() => setStep(Math.max(1, step - 1))}
                disabled={step === 1}
                className="px-4 py-2 text-sm bg-[var(--bg-card)] border border-[var(--border)] rounded-lg disabled:text-[var(--text-dim)] hover:border-[var(--border-hover)] transition"
              >
                Back
              </button>
              {step < 4 ? (
                <button
                  onClick={() => setStep(step + 1)}
                  className="px-6 py-2 text-sm bg-[var(--primary)] hover:bg-[var(--primary-hover)] rounded-lg font-medium transition"
                >
                  Next
                </button>
              ) : (
                <button
                  disabled
                  className="px-6 py-2 text-sm bg-[var(--primary)] rounded-lg font-medium opacity-50"
                >
                  Deploy (CLI required)
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, help, type }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; help?: string; type?: string;
}) {
  return (
    <div>
      <label className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-dim)] block mb-1.5">{label}</label>
      <input
        type={type || "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-[var(--primary)] transition"
      />
      {help && <p className="text-[10px] text-[var(--text-dim)] mt-1">{help}</p>}
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-[var(--border)]">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
