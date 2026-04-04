"use client";

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  Keypair,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createInitializeMintInstruction,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import dynamic from "next/dynamic";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((mod) => mod.WalletMultiButton),
  { ssr: false },
);

const SYNTX_PROGRAM_ID = new PublicKey("53r6bg7JBFqf5Jfs7fe4kHDtwXwUgDWoLarYrsWcoF1V");

// Known markets on devnet
const KNOWN_MARKETS = [
  {
    name: "SOL-PERP",
    slab: "J55KavPouZg8ZeWnTY77ZBL2DdQskzKpkFvuTtbUNzYC",
    mint: "2uGTCDSfisKCTN2Yd8umXiWJzfRpWe8mhZM6WCK2vj8D",
    percolatorProgram: "Edq18N2pdT3Sz9EukbZe4YsQkvmxvmmkUL1KHpv96xJF",
  },
  // BTC-PERP and ETH-PERP will be added after deployment
];

const steps = [
  { num: 1, title: "Market" },
  { num: 2, title: "Fees" },
  { num: 3, title: "Strategy" },
  { num: 4, title: "Deploy" },
];

// Anchor discriminator
function discCreate(name: string): Uint8Array {
  const crypto = require("crypto");
  const hash = crypto.createHash("sha256").update(`global:${name}`).digest();
  return new Uint8Array(hash.subarray(0, 8));
}

export default function CreatePage() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const { sendTransaction } = useWallet();
  const [step, setStep] = useState(1);
  const [deploying, setDeploying] = useState(false);
  const [deployStatus, setDeployStatus] = useState<string | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deployedVault, setDeployedVault] = useState<string | null>(null);
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

  const handleDeploy = async () => {
    if (!publicKey || !sendTransaction || !config.slab || !config.collateralMint) return;
    setDeploying(true); setDeployError(null); setDeployStatus(null);

    try {
      const mint = new PublicKey(config.collateralMint);
      const slabPk = new PublicKey(config.slab);
      const percPk = new PublicKey(config.percolatorProgram);

      const [vaultPdaPk] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), mint.toBuffer(), publicKey.toBuffer()],
        SYNTX_PROGRAM_ID,
      );

      // TX 1: Create share mint with vault PDA as authority
      setDeployStatus("Creating share mint (TX 1/3)...");
      const shareMintKeypair = Keypair.generate();
      const lamports = await getMinimumBalanceForRentExemptMint(connection);

      const tx1 = new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: publicKey,
          newAccountPubkey: shareMintKeypair.publicKey,
          space: MINT_SIZE,
          lamports,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          shareMintKeypair.publicKey,
          6, // decimals
          vaultPdaPk, // mint authority = vault PDA
          null, // no freeze authority
        ),
      );
      const sig1 = await sendTransaction(tx1, connection, { signers: [shareMintKeypair] });
      await connection.confirmTransaction(sig1, "confirmed");

      // Create vault collateral ATA
      const vaultColAta = await getAssociatedTokenAddress(mint, vaultPdaPk, true);
      const tx1b = new Transaction().add(
        createAssociatedTokenAccountInstruction(publicKey, vaultColAta, vaultPdaPk, mint),
      );
      try {
        const sig1b = await sendTransaction(tx1b, connection);
        await connection.confirmTransaction(sig1b, "confirmed");
      } catch { /* ATA may already exist */ }

      // TX 2: InitVault
      setDeployStatus("Initializing vault (TX 2/3)...");
      const perfBps = Math.floor(parseFloat(config.perfFeeBps) * 100);
      const mgmtBps = Math.floor(parseFloat(config.mgmtFeeBps) * 100);
      const cap = BigInt(config.depositCap || "0");

      const initData = new Uint8Array(8 + 2 + 2 + 8);
      initData.set(discCreate("init_vault"), 0);
      new DataView(initData.buffer).setUint16(8, perfBps, true);
      new DataView(initData.buffer).setUint16(10, mgmtBps, true);
      new DataView(initData.buffer).setBigUint64(12, cap, true);

      const tx2 = new Transaction().add(
        new TransactionInstruction({
          programId: SYNTX_PROGRAM_ID,
          keys: [
            { pubkey: publicKey, isSigner: true, isWritable: true },
            { pubkey: vaultPdaPk, isSigner: false, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: shareMintKeypair.publicKey, isSigner: false, isWritable: false },
            { pubkey: slabPk, isSigner: false, isWritable: false },
            { pubkey: percPk, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: initData as any,
        }),
      );
      const sig2 = await sendTransaction(tx2, connection);
      await connection.confirmTransaction(sig2, "confirmed");

      // TX 3: RegisterOnPercolator
      setDeployStatus("Registering on Percolator (TX 3/3)...");
      const [percVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), slabPk.toBuffer()], percPk,
      );
      const percVaultAta = await getAssociatedTokenAddress(mint, percVaultPda, true);

      const regData = new Uint8Array(16);
      regData.set(discCreate("register_on_percolator"), 0);
      // fee_payment = 0 (or minimal)
      new DataView(regData.buffer).setBigUint64(8, 0n, true);

      const tx3 = new Transaction().add(
        new TransactionInstruction({
          programId: SYNTX_PROGRAM_ID,
          keys: [
            { pubkey: publicKey, isSigner: true, isWritable: false },
            { pubkey: vaultPdaPk, isSigner: false, isWritable: true },
            { pubkey: vaultColAta, isSigner: false, isWritable: true },
            { pubkey: slabPk, isSigner: false, isWritable: true },
            { pubkey: percVaultAta, isSigner: false, isWritable: true },
            { pubkey: percPk, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
          ],
          data: regData as any,
        }),
      );
      const sig3 = await sendTransaction(tx3, connection);
      await connection.confirmTransaction(sig3, "confirmed");

      setDeployedVault(vaultPdaPk.toBase58());
      setDeployStatus(null);
    } catch (e: any) {
      console.error("Deploy error:", e);
      setDeployError(e?.message?.slice(0, 200) || "Deployment failed");
      setDeployStatus(null);
    } finally {
      setDeploying(false);
    }
  };

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

                {/* Quick select from known markets */}
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-dim)] block mb-1.5">Quick Select</label>
                  <div className="flex gap-2">
                    {KNOWN_MARKETS.map((m) => (
                      <button
                        key={m.name}
                        onClick={() => {
                          updateConfig("slab", m.slab);
                          updateConfig("collateralMint", m.mint);
                          updateConfig("percolatorProgram", m.percolatorProgram);
                        }}
                        className={`px-3 py-2 rounded-lg text-xs font-mono border transition ${
                          config.slab === m.slab
                            ? "border-[var(--primary)] bg-[var(--primary)]/10 text-white"
                            : "border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-white"
                        }`}
                      >
                        {m.name}
                      </button>
                    ))}
                    <button
                      onClick={() => { updateConfig("slab", ""); updateConfig("collateralMint", ""); }}
                      className={`px-3 py-2 rounded-lg text-xs font-mono border transition ${
                        config.slab && !KNOWN_MARKETS.find(m => m.slab === config.slab)
                          ? "border-[var(--primary)] bg-[var(--primary)]/10 text-white"
                          : "border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-white"
                      }`}
                    >
                      Custom
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <Field
                    label="Percolator Slab Address"
                    value={config.slab}
                    onChange={(v) => updateConfig("slab", v)}
                    placeholder="e.g., J55KavPouZg8ZeWnTY77ZBL2DdQskzKpkFvuTtbUNzYC"
                    help="The slab account for the perp market"
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

                {deployStatus && (
                  <div className="bg-blue-950 border border-blue-800 rounded-lg p-3 text-xs font-mono text-[var(--primary)]">
                    {deployStatus}
                  </div>
                )}
                {deployError && (
                  <div className="bg-red-950 border border-red-800 rounded-lg p-3 text-xs font-mono text-[var(--red)]">
                    {deployError}
                  </div>
                )}
                {deployedVault && (
                  <div className="bg-green-950 border border-green-800 rounded-lg p-4 text-xs text-[var(--green)]">
                    Vault deployed! PDA: <span className="font-mono">{deployedVault}</span>
                    <br />
                    <a href="/vaults" className="underline mt-2 inline-block">View in Vault Marketplace</a>
                  </div>
                )}
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
                  onClick={handleDeploy}
                  disabled={deploying || !config.slab || !config.collateralMint || !!deployedVault}
                  className="px-6 py-2 text-sm bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:opacity-50 rounded-lg font-medium transition"
                >
                  {deploying ? "Deploying..." : deployedVault ? "Deployed" : "Deploy Vault"}
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
