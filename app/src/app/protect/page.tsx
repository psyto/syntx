"use client";

import { useEffect, useState, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import dynamic from "next/dynamic";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((mod) => mod.WalletMultiButton),
  { ssr: false },
);

// --- Constants ---

const SYNTX_PROGRAM_ID = new PublicKey("53r6bg7JBFqf5Jfs7fe4kHDtwXwUgDWoLarYrsWcoF1V");
const PERCOLATOR_PROGRAM_ID = new PublicKey("Edq18N2pdT3Sz9EukbZe4YsQkvmxvmmkUL1KHpv96xJF");
const DISC_DEPOSIT = new Uint8Array([0xf2, 0x23, 0xc6, 0x89, 0x52, 0xe1, 0xf2, 0xb6]);
const DISC_WITHDRAW = new Uint8Array([0xb7, 0x12, 0x46, 0x9c, 0x94, 0x6d, 0xa1, 0x22]);

// Structured product vault addresses (populated after deployment)
// These will be updated by setup-structured.ts output
const STRUCTURED_VAULT_PDA = process.env.NEXT_PUBLIC_STRUCTURED_VAULT_PDA || "";
const STRUCTURED_COLLATERAL_MINT = process.env.NEXT_PUBLIC_STRUCTURED_COLLATERAL_MINT || "";
const STRUCTURED_SHARE_MINT = process.env.NEXT_PUBLIC_STRUCTURED_SHARE_MINT || "";
const STRUCTURED_SLAB = process.env.NEXT_PUBLIC_STRUCTURED_SLAB || "9Gh75RYAkN5wD97HtHo6Za6RwPReZSAcgNxtbvYy2jDF";

// --- Strategy parameters (matching structured-strategy.ts defaults) ---

const PROTECTION_HORIZON_DAYS = 30;
const MIN_LENDING_PCT = 85;
const MAX_SPOT_PCT = 15;

// --- Helpers ---

function readU16LE(d: Uint8Array, off: number): number {
  return d[off] | (d[off + 1] << 8);
}
function readU64LE(d: Uint8Array, off: number): bigint {
  const lo = BigInt(d[off]) | (BigInt(d[off+1]) << 8n) | (BigInt(d[off+2]) << 16n) | (BigInt(d[off+3]) << 24n);
  const hi = BigInt(d[off+4]) | (BigInt(d[off+5]) << 8n) | (BigInt(d[off+6]) << 16n) | (BigInt(d[off+7]) << 24n);
  return lo | (hi << 32n);
}

function usdFmt(raw: bigint): string {
  return `$${(Number(raw) / 1_000_000).toFixed(2)}`;
}

function pctFmt(n: number): string {
  return `${n.toFixed(1)}%`;
}

// --- Allocation math (mirrors structured-strategy.ts) ---

function computeAllocation(totalCapital: number, supplyApy: number) {
  const horizonYears = PROTECTION_HORIZON_DAYS / 365;
  const growthFactor = 1 + supplyApy * horizonYears;

  let lendingPct = (1 / growthFactor) * 100;
  let spotPct = 100 - lendingPct;

  lendingPct = Math.max(lendingPct, MIN_LENDING_PCT);
  spotPct = Math.min(spotPct, MAX_SPOT_PCT);
  spotPct = Math.max(spotPct, 0);
  lendingPct = 100 - spotPct;

  return {
    lendingPct,
    spotPct,
    lendingAmount: totalCapital * lendingPct / 100,
    spotAmount: totalCapital * spotPct / 100,
  };
}

// --- Vault state parsing ---

interface VaultState {
  totalShares: bigint;
  totalDeposits: bigint;
  shareMint: string;
  collateralMint: string;
  slab: string;
  perfFeeBps: number;
  mgmtFeeBps: number;
  paused: boolean;
}

function parseVaultState(d: Uint8Array): VaultState {
  let off = 9; // disc(8) + bump(1)
  off += 32; // manager
  const collateralMint = new PublicKey(d.slice(off, off + 32)).toBase58(); off += 32;
  const shareMint = new PublicKey(d.slice(off, off + 32)).toBase58(); off += 32;
  off += 32; // percolatorProgram
  const slab = new PublicKey(d.slice(off, off + 32)).toBase58(); off += 32;
  off += 2; // userIdx
  const totalShares = readU64LE(d, off); off += 8;
  const totalDeposits = readU64LE(d, off); off += 8;
  const perfFeeBps = readU16LE(d, off); off += 2;
  const mgmtFeeBps = readU16LE(d, off); off += 2;
  off += 16; // HWM + lastFeeCollection
  off += 8; // depositCap
  const paused = d[off] !== 0;
  return { totalShares, totalDeposits, shareMint, collateralMint, slab, perfFeeBps, mgmtFeeBps, paused };
}

// --- Component ---

export default function ProtectPage() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();
  const [vault, setVault] = useState<VaultState | null>(null);
  const [userShares, setUserShares] = useState<bigint>(0n);
  const [userBalance, setUserBalance] = useState<bigint>(0n);
  const [depositAmt, setDepositAmt] = useState("");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [loading, setLoading] = useState(true);

  // Simulated Kamino APY for demo (in production, read from Kamino market)
  const kaminoApy = 0.082; // 8.2%
  const solPrice = 138.0;

  const hasVault = STRUCTURED_VAULT_PDA.length > 0;

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  const fetchData = useCallback(async () => {
    if (!hasVault) { setLoading(false); return; }
    try {
      setLoading(true);
      const vaultPda = new PublicKey(STRUCTURED_VAULT_PDA);
      const info = await connection.getAccountInfo(vaultPda);
      if (!info) { setLoading(false); return; }
      const data = parseVaultState(new Uint8Array(info.data));
      setVault(data);

      if (publicKey && data.shareMint) {
        try {
          const ata = await getAssociatedTokenAddress(new PublicKey(data.shareMint), publicKey);
          const bal = await connection.getTokenAccountBalance(ata);
          setUserShares(BigInt(bal.value.amount));
        } catch { setUserShares(0n); }

        try {
          const colAta = await getAssociatedTokenAddress(new PublicKey(data.collateralMint), publicKey);
          const colBal = await connection.getTokenAccountBalance(colAta);
          setUserBalance(BigInt(colBal.value.amount));
        } catch { setUserBalance(0n); }
      }
    } catch (e) { console.error("Fetch error:", e); } finally { setLoading(false); }
  }, [connection, publicKey, hasVault]);

  useEffect(() => {
    fetchData();
    const i = setInterval(fetchData, 15000);
    return () => clearInterval(i);
  }, [fetchData]);

  // Allocation calculation
  const tvl = vault ? Number(vault.totalDeposits) / 1_000_000 : 0;
  const alloc = computeAllocation(tvl || 1000, kaminoApy);
  const sharePrice = vault && vault.totalShares > 0n
    ? Number(vault.totalDeposits) / Number(vault.totalShares)
    : 1.0;
  const userValue = vault && vault.totalShares > 0n
    ? Number(userShares * vault.totalDeposits / vault.totalShares) / 1_000_000
    : 0;

  // Estimated APY: lending yield on lending portion + SOL upside on spot portion
  // Conservative estimate: just the lending yield (spot upside is variable)
  const estimatedApy = kaminoApy * alloc.lendingPct / 100;

  const handleDeposit = async () => {
    if (!depositAmt || !publicKey || !hasVault) return;
    setTxStatus("Building..."); setTxError(null);
    try {
      const vaultPda = new PublicKey(STRUCTURED_VAULT_PDA);
      const colMint = new PublicKey(STRUCTURED_COLLATERAL_MINT);
      const shrMint = new PublicKey(STRUCTURED_SHARE_MINT);
      const slabPk = new PublicKey(STRUCTURED_SLAB);

      const amount = BigInt(Math.floor(parseFloat(depositAmt) * 1_000_000));
      const userCol = await getAssociatedTokenAddress(colMint, publicKey);
      const userShr = await getAssociatedTokenAddress(shrMint, publicKey);
      const vaultCol = await getAssociatedTokenAddress(colMint, vaultPda, true);

      const [percVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), slabPk.toBuffer()], PERCOLATOR_PROGRAM_ID,
      );
      const percVaultAta = await getAssociatedTokenAddress(colMint, percVaultPda, true);

      const tx = new Transaction();

      try { await connection.getTokenAccountBalance(userShr); } catch {
        tx.add(createAssociatedTokenAccountInstruction(publicKey, userShr, publicKey, shrMint));
      }

      const data = new Uint8Array(16);
      data.set(DISC_DEPOSIT, 0);
      new DataView(data.buffer).setBigUint64(8, amount, true);

      tx.add(new TransactionInstruction({
        programId: SYNTX_PROGRAM_ID,
        keys: [
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: vaultPda, isSigner: false, isWritable: true },
          { pubkey: userCol, isSigner: false, isWritable: true },
          { pubkey: userShr, isSigner: false, isWritable: true },
          { pubkey: vaultCol, isSigner: false, isWritable: true },
          { pubkey: shrMint, isSigner: false, isWritable: true },
          { pubkey: slabPk, isSigner: false, isWritable: true },
          { pubkey: percVaultAta, isSigner: false, isWritable: true },
          { pubkey: PERCOLATOR_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
        ],
        data: data as any,
      }));

      setTxStatus("Confirm in wallet...");
      const sig = await sendTransaction(tx, connection);
      setTxStatus("Confirming...");
      await connection.confirmTransaction(sig, "confirmed");
      setTxStatus(null); setDepositAmt("");
      showToast(`Deposited ${depositAmt} USDC`, "success");
      fetchData();
    } catch (e: any) {
      setTxError(e?.message?.slice(0, 300) || "Transaction failed");
      setTxStatus(null);
      showToast("Deposit failed", "error");
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawAmt || !publicKey || !hasVault || !vault) return;
    setTxStatus("Refreshing oracle..."); setTxError(null);
    try {
      try { await fetch("/vaults/api/push-oracle", { method: "POST" }); } catch {}

      setTxStatus("Building...");
      const vaultPda = new PublicKey(STRUCTURED_VAULT_PDA);
      const colMint = new PublicKey(STRUCTURED_COLLATERAL_MINT);
      const shrMint = new PublicKey(STRUCTURED_SHARE_MINT);
      const slabPk = new PublicKey(STRUCTURED_SLAB);

      const withdrawUsd = parseFloat(withdrawAmt);
      let shares: bigint;
      if (vault.totalShares > 0n && vault.totalDeposits > 0n) {
        const amountRaw = BigInt(Math.floor(withdrawUsd * 1_000_000));
        shares = amountRaw * vault.totalShares / vault.totalDeposits;
      } else {
        shares = BigInt(Math.floor(withdrawUsd * 1_000_000));
      }
      if (shares > userShares) shares = userShares;
      if (shares === 0n) { setTxError("Amount too small"); setTxStatus(null); return; }

      const userCol = await getAssociatedTokenAddress(colMint, publicKey);
      const userShr = await getAssociatedTokenAddress(shrMint, publicKey);
      const vaultCol = await getAssociatedTokenAddress(colMint, vaultPda, true);

      const [percVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), slabPk.toBuffer()], PERCOLATOR_PROGRAM_ID,
      );
      const percVaultAta = await getAssociatedTokenAddress(colMint, percVaultPda, true);

      const data = new Uint8Array(16);
      data.set(DISC_WITHDRAW, 0);
      new DataView(data.buffer).setBigUint64(8, shares, true);

      const tx = new Transaction().add(new TransactionInstruction({
        programId: SYNTX_PROGRAM_ID,
        keys: [
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: vaultPda, isSigner: false, isWritable: true },
          { pubkey: userCol, isSigner: false, isWritable: true },
          { pubkey: userShr, isSigner: false, isWritable: true },
          { pubkey: vaultCol, isSigner: false, isWritable: true },
          { pubkey: shrMint, isSigner: false, isWritable: true },
          { pubkey: slabPk, isSigner: false, isWritable: true },
          { pubkey: percVaultAta, isSigner: false, isWritable: true },
          { pubkey: PERCOLATOR_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
        ],
        data: data as any,
      }));

      setTxStatus("Confirm in wallet...");
      const sig = await sendTransaction(tx, connection);
      setTxStatus("Confirming...");
      await connection.confirmTransaction(sig, "confirmed");
      setTxStatus(null); setWithdrawAmt("");
      showToast(`Withdrew ${withdrawAmt} USDC`, "success");
      fetchData();
    } catch (e: any) {
      setTxError(e?.message?.slice(0, 300) || "Transaction failed");
      setTxStatus(null);
      showToast("Withdrawal failed", "error");
    }
  };

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div className={`fixed top-20 right-6 z-50 px-4 py-3 rounded-lg text-sm font-medium shadow-lg ${
          toast.type === "success" ? "bg-[var(--green)]/20 text-[var(--green)] border border-[var(--green)]/30" : "bg-[var(--red)]/20 text-[var(--red)] border border-[var(--red)]/30"
        }`}>
          {toast.message}
        </div>
      )}

      {/* Hero */}
      <section className="grid-bg border-b border-[var(--border)]">
        <div className="max-w-[1100px] mx-auto px-6 py-16 md:py-24 flex flex-col items-center text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--green)]/10 border border-[var(--green)]/20 text-[var(--green)] text-xs font-medium mb-6">
            Principal Protected
          </div>
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight leading-tight mb-4">
            SOL Exposure
            <br />
            <span className="text-[var(--text-muted)]">Without the Downside</span>
          </h1>
          <p className="text-[var(--text-muted)] text-lg max-w-2xl mb-8">
            Deposit USDC. Get SOL upside. Your principal is protected by Kamino lending yield.
            Powered by Syntx venue-agnostic vaults.
          </p>
          <div className="grid grid-cols-3 gap-6 text-center max-w-lg">
            <div>
              <div className="text-2xl font-bold text-[var(--green)]">{pctFmt(kaminoApy * 100)}</div>
              <div className="text-xs text-[var(--text-muted)] mt-1">Kamino APY</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-[var(--primary)]">{PROTECTION_HORIZON_DAYS}d</div>
              <div className="text-xs text-[var(--text-muted)] mt-1">Protection Horizon</div>
            </div>
            <div>
              <div className="text-2xl font-bold">{pctFmt(alloc.spotPct)}</div>
              <div className="text-xs text-[var(--text-muted)] mt-1">SOL Exposure</div>
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-[1100px] mx-auto px-6 py-10 space-y-8">

        {/* How It Works */}
        <section>
          <h2 className="text-lg font-semibold mb-4">How It Works</h2>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="panel p-5">
              <div className="text-xs font-mono text-[var(--primary)] mb-2">01</div>
              <h3 className="font-medium mb-2">You Deposit USDC</h3>
              <p className="text-sm text-[var(--text-muted)]">
                Your USDC enters the Syntx vault. The keeper automatically splits it between lending and spot.
              </p>
            </div>
            <div className="panel p-5">
              <div className="text-xs font-mono text-[var(--primary)] mb-2">02</div>
              <h3 className="font-medium mb-2">Keeper Allocates</h3>
              <p className="text-sm text-[var(--text-muted)]">
                ~{pctFmt(alloc.lendingPct)} goes to Kamino lending (earns {pctFmt(kaminoApy * 100)} APY).
                ~{pctFmt(alloc.spotPct)} buys SOL on Phoenix for upside exposure.
              </p>
            </div>
            <div className="panel p-5">
              <div className="text-xs font-mono text-[var(--primary)] mb-2">03</div>
              <h3 className="font-medium mb-2">Principal Protected</h3>
              <p className="text-sm text-[var(--text-muted)]">
                Even if SOL drops to zero, lending yield covers the loss.
                After {PROTECTION_HORIZON_DAYS} days, you get back at least your deposit.
              </p>
            </div>
          </div>
        </section>

        {/* Allocation Visualization */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Current Allocation</h2>
          <div className="panel p-6">
            {/* Bar */}
            <div className="flex rounded-lg overflow-hidden h-10 mb-4">
              <div
                className="bg-[var(--primary)]/30 flex items-center justify-center text-xs font-medium"
                style={{ width: `${alloc.lendingPct}%` }}
              >
                Kamino Lending {pctFmt(alloc.lendingPct)}
              </div>
              <div
                className="bg-[var(--green)]/30 flex items-center justify-center text-xs font-medium"
                style={{ width: `${alloc.spotPct}%` }}
              >
                SOL {pctFmt(alloc.spotPct)}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="stat-card p-4">
                <div className="text-xs text-[var(--text-muted)] mb-1">TVL</div>
                <div className="text-lg font-semibold">${tvl.toFixed(2)}</div>
              </div>
              <div className="stat-card p-4">
                <div className="text-xs text-[var(--text-muted)] mb-1">Lending Portion</div>
                <div className="text-lg font-semibold text-[var(--primary)]">${alloc.lendingAmount.toFixed(2)}</div>
              </div>
              <div className="stat-card p-4">
                <div className="text-xs text-[var(--text-muted)] mb-1">SOL Portion</div>
                <div className="text-lg font-semibold text-[var(--green)]">${alloc.spotAmount.toFixed(2)}</div>
              </div>
              <div className="stat-card p-4">
                <div className="text-xs text-[var(--text-muted)] mb-1">Min Yield (Lending Only)</div>
                <div className="text-lg font-semibold">{pctFmt(estimatedApy * 100)} APY</div>
              </div>
            </div>
          </div>
        </section>

        {/* Deposit / Withdraw */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Deposit & Withdraw</h2>
          {!connected ? (
            <div className="panel p-8 flex flex-col items-center gap-4">
              <p className="text-[var(--text-muted)]">Connect your wallet to deposit</p>
              <WalletMultiButton />
            </div>
          ) : !hasVault ? (
            <div className="panel p-8 text-center">
              <p className="text-[var(--text-muted)] mb-2">Structured product vault not yet deployed</p>
              <p className="text-xs text-[var(--text-muted)]">
                Run <code className="text-[var(--primary)]">npm run setup:structured</code> in the keeper directory,
                then set NEXT_PUBLIC_STRUCTURED_VAULT_PDA in your environment.
              </p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {/* Deposit */}
              <div className="panel p-6">
                <h3 className="font-medium mb-1">Deposit USDC</h3>
                <p className="text-xs text-[var(--text-muted)] mb-4">
                  Balance: {(Number(userBalance) / 1_000_000).toFixed(2)} USDC
                </p>
                <div className="flex gap-2 mb-3">
                  <input
                    type="number"
                    value={depositAmt}
                    onChange={(e) => setDepositAmt(e.target.value)}
                    placeholder="Amount in USDC"
                    className="flex-1 h-10 px-3 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--primary)]"
                  />
                  <button
                    onClick={() => setDepositAmt((Number(userBalance) / 1_000_000).toString())}
                    className="px-3 h-10 text-xs text-[var(--primary)] border border-[var(--border)] rounded-lg hover:bg-[var(--bg-card)]"
                  >
                    Max
                  </button>
                </div>
                <button
                  onClick={handleDeposit}
                  disabled={!depositAmt || !!txStatus}
                  className="w-full h-10 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-sm font-medium disabled:opacity-40 transition"
                >
                  {txStatus || "Deposit"}
                </button>
              </div>

              {/* Withdraw */}
              <div className="panel p-6">
                <h3 className="font-medium mb-1">Withdraw USDC</h3>
                <p className="text-xs text-[var(--text-muted)] mb-4">
                  Position: ${userValue.toFixed(2)} ({Number(userShares).toLocaleString()} shares)
                </p>
                <div className="flex gap-2 mb-3">
                  <input
                    type="number"
                    value={withdrawAmt}
                    onChange={(e) => setWithdrawAmt(e.target.value)}
                    placeholder="Amount in USD"
                    className="flex-1 h-10 px-3 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--primary)]"
                  />
                  <button
                    onClick={() => setWithdrawAmt(userValue.toFixed(2))}
                    className="px-3 h-10 text-xs text-[var(--primary)] border border-[var(--border)] rounded-lg hover:bg-[var(--bg-card)]"
                  >
                    Max
                  </button>
                </div>
                <button
                  onClick={handleWithdraw}
                  disabled={!withdrawAmt || !!txStatus}
                  className="w-full h-10 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] hover:border-[var(--primary)] text-sm font-medium disabled:opacity-40 transition"
                >
                  {txStatus || "Withdraw"}
                </button>
              </div>
            </div>
          )}

          {txError && (
            <div className="mt-3 p-3 rounded-lg bg-[var(--red)]/10 border border-[var(--red)]/20 text-[var(--red)] text-xs font-mono break-all">
              {txError}
            </div>
          )}
        </section>

        {/* Architecture */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Architecture</h2>
          <div className="panel p-6">
            <div className="font-mono text-xs text-[var(--text-muted)] space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-[var(--text)] font-medium w-24">User</span>
                <span className="text-[var(--primary)]">--deposit USDC--&gt;</span>
                <span className="text-[var(--text)] font-medium">Syntx Vault</span>
              </div>
              <div className="flex items-center gap-3 ml-36">
                <span className="text-[var(--primary)]">|</span>
              </div>
              <div className="flex items-center gap-3 ml-28">
                <span className="text-[var(--text)] font-medium">Keeper</span>
                <span className="text-[var(--text-muted)]">(structured-strategy)</span>
              </div>
              <div className="flex items-center gap-3 ml-24">
                <span className="text-[var(--primary)]">/ \</span>
              </div>
              <div className="flex items-center gap-6 ml-12">
                <div className="text-center">
                  <div className="text-[var(--primary)] font-medium">Kamino</div>
                  <div className="text-[var(--text-muted)]">~{pctFmt(alloc.lendingPct)} USDC</div>
                  <div className="text-[var(--text-muted)]">Lending yield</div>
                </div>
                <div className="text-center">
                  <div className="text-[var(--green)] font-medium">Phoenix</div>
                  <div className="text-[var(--text-muted)]">~{pctFmt(alloc.spotPct)} SOL</div>
                  <div className="text-[var(--text-muted)]">Upside exposure</div>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-[var(--border)]">
              <h4 className="text-xs font-medium text-[var(--text-muted)] mb-3">Powered by Syntx VenueAdapter</h4>
              <div className="flex flex-wrap gap-2">
                {["KaminoAdapter", "PhoenixAdapter", "JupiterPerpsAdapter", "PercolatorAdapter", "VenueRouter"].map((name) => (
                  <span key={name} className="px-2 py-1 text-xs font-mono rounded bg-[var(--bg)] border border-[var(--border)]">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Protection Math */}
        <section className="pb-10">
          <h2 className="text-lg font-semibold mb-4">Protection Math</h2>
          <div className="panel p-6">
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h4 className="text-sm font-medium mb-3">Formula</h4>
                <div className="space-y-2 text-sm text-[var(--text-muted)]">
                  <div className="font-mono text-xs bg-[var(--bg)] p-3 rounded-lg border border-[var(--border)]">
                    <div>lending = total / (1 + apy * horizon)</div>
                    <div>spot = total - lending</div>
                    <div className="mt-2 text-[var(--green)]">// lending grows back to total</div>
                    <div className="text-[var(--green)]">// even if spot goes to zero</div>
                  </div>
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-3">Example ($1,000 deposit)</h4>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Kamino ({pctFmt(kaminoApy * 100)} APY)</span>
                    <span>${(1000 * alloc.lendingPct / 100).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">SOL spot</span>
                    <span>${(1000 * alloc.spotPct / 100).toFixed(2)}</span>
                  </div>
                  <div className="border-t border-[var(--border)] pt-1.5 mt-1.5">
                    <div className="flex justify-between text-[var(--green)]">
                      <span>After {PROTECTION_HORIZON_DAYS}d (SOL = $0)</span>
                      <span>$1,000.00</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--text-muted)]">After {PROTECTION_HORIZON_DAYS}d (SOL +50%)</span>
                      <span>${(1000 + 1000 * alloc.spotPct / 100 * 0.5).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
