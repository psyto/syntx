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

// Percolator-backed vault instructions
const DISC_DEPOSIT = new Uint8Array([0xf2, 0x23, 0xc6, 0x89, 0x52, 0xe1, 0xf2, 0xb6]);
const DISC_WITHDRAW = new Uint8Array([0xb7, 0x12, 0x46, 0x9c, 0x94, 0x6d, 0xa1, 0x22]);

// Standalone vault instructions (no Percolator)
const DISC_DEPOSIT_STANDALONE = new Uint8Array([0x0a, 0xce, 0x85, 0xf6, 0x6b, 0x32, 0x04, 0x37]);
const DISC_WITHDRAW_STANDALONE = new Uint8Array([0x56, 0x65, 0x25, 0x31, 0x99, 0x49, 0x1e, 0xf3]);

const STRUCTURED_VAULT_PDA = process.env.NEXT_PUBLIC_STRUCTURED_VAULT_PDA || "";
const STRUCTURED_COLLATERAL_MINT = process.env.NEXT_PUBLIC_STRUCTURED_COLLATERAL_MINT || "";
const STRUCTURED_SHARE_MINT = process.env.NEXT_PUBLIC_STRUCTURED_SHARE_MINT || "";
const STRUCTURED_STANDALONE = process.env.NEXT_PUBLIC_STRUCTURED_STANDALONE === "true";
const STRUCTURED_SLAB = process.env.NEXT_PUBLIC_STRUCTURED_SLAB || "";

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

function pctFmt(n: number): string {
  return `${n.toFixed(1)}%`;
}

function computeAllocation(supplyApy: number) {
  const horizonYears = PROTECTION_HORIZON_DAYS / 365;
  const growthFactor = 1 + supplyApy * horizonYears;
  let lendingPct = (1 / growthFactor) * 100;
  let spotPct = 100 - lendingPct;
  lendingPct = Math.max(lendingPct, MIN_LENDING_PCT);
  spotPct = Math.min(spotPct, MAX_SPOT_PCT);
  spotPct = Math.max(spotPct, 0);
  lendingPct = 100 - spotPct;
  return { lendingPct, spotPct };
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
}

function parseVaultState(d: Uint8Array): VaultState {
  let off = 9;
  off += 32; // manager
  const collateralMint = new PublicKey(d.slice(off, off + 32)).toBase58(); off += 32;
  const shareMint = new PublicKey(d.slice(off, off + 32)).toBase58(); off += 32;
  off += 32; // percolatorProgram
  const slab = new PublicKey(d.slice(off, off + 32)).toBase58(); off += 32;
  off += 2; // userIdx
  const totalShares = readU64LE(d, off); off += 8;
  const totalDeposits = readU64LE(d, off); off += 8;
  const perfFeeBps = readU16LE(d, off); off += 2;
  const mgmtFeeBps = readU16LE(d, off);
  return { totalShares, totalDeposits, shareMint, collateralMint, slab, perfFeeBps, mgmtFeeBps };
}

// --- Portfolio types ---

const VAULT_DISC = new Uint8Array([0xe4, 0xc4, 0x52, 0xa5, 0x62, 0xd2, 0xeb, 0x98]);

const KNOWN_VAULTS: Record<string, string> = {
  "H2Hvrz4sS4bcBFdD4s1GQ2dWWctfYh35uR2Qqi1H1reH": "SOL Funding Rate",
  [STRUCTURED_VAULT_PDA]: "Principal Protected SOL",
};

interface PortfolioPosition {
  vaultPda: string;
  name: string;
  shares: bigint;
  totalShares: bigint;
  totalDeposits: bigint;
  value: number;
  shareMint: string;
}

function short(addr: string): string {
  return addr.slice(0, 4) + "..." + addr.slice(-4);
}

// --- Component ---

export default function EarnPage() {
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
  const [showHow, setShowHow] = useState(false);
  const [faucetStatus, setFaucetStatus] = useState<string | null>(null);
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [totalPortfolioValue, setTotalPortfolioValue] = useState(0);

  const kaminoApy = 0.082;
  const hasVault = STRUCTURED_VAULT_PDA.length > 0;
  const alloc = computeAllocation(kaminoApy);

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
          console.log("[earn] share ATA:", ata.toBase58(), "for mint:", data.shareMint, "user:", publicKey.toBase58());
          const bal = await connection.getTokenAccountBalance(ata);
          console.log("[earn] shares:", bal.value.amount);
          setUserShares(BigInt(bal.value.amount));
        } catch (e) { console.error("[earn] share balance error:", e); setUserShares(0n); }

        try {
          const colAta = await getAssociatedTokenAddress(new PublicKey(data.collateralMint), publicKey);
          const colBal = await connection.getTokenAccountBalance(colAta);
          setUserBalance(BigInt(colBal.value.amount));
        } catch { setUserBalance(0n); }
      }
      // Fetch portfolio across all vaults
      if (publicKey) {
        try {
          const accounts = await connection.getProgramAccounts(SYNTX_PROGRAM_ID, {
            dataSlice: { offset: 0, length: 210 },
          });
          const found: PortfolioPosition[] = [];
          for (const { pubkey, account } of accounts) {
            const d = new Uint8Array(account.data);
            let match = true;
            for (let i = 0; i < 8; i++) { if (d[i] !== VAULT_DISC[i]) { match = false; break; } }
            if (!match) continue;

            let off = 9 + 32 + 32; // disc + bump + manager + collateralMint
            const shareMint = new PublicKey(d.slice(off, off + 32)).toBase58(); off += 32;
            off += 32 + 32 + 2; // percolatorProgram + slab + userIdx
            const totalShares = readU64LE(d, off); off += 8;
            const totalDeposits = readU64LE(d, off);

            try {
              const ata = await getAssociatedTokenAddress(new PublicKey(shareMint), publicKey);
              const bal = await connection.getTokenAccountBalance(ata);
              const shares = BigInt(bal.value.amount);
              if (shares > 0n) {
                const value = totalShares > 0n ? Number(shares * totalDeposits / totalShares) / 1_000_000 : 0;
                const pda = pubkey.toBase58();
                found.push({
                  vaultPda: pda,
                  name: KNOWN_VAULTS[pda] || `Vault ${short(pda)}`,
                  shares, totalShares, totalDeposits, value, shareMint,
                });
              }
            } catch { /* no ATA */ }
          }
          setPositions(found);
          setTotalPortfolioValue(found.reduce((s, p) => s + p.value, 0));
        } catch { /* portfolio fetch failed, non-critical */ }
      }
    } catch (e) { console.error("Fetch error:", e); } finally { setLoading(false); }
  }, [connection, publicKey, hasVault]);

  useEffect(() => {
    fetchData();
    const i = setInterval(fetchData, 15000);
    return () => clearInterval(i);
  }, [fetchData]);

  const tvl = vault ? Number(vault.totalDeposits) / 1_000_000 : 0;
  const userValue = vault && vault.totalShares > 0n
    ? Number(userShares * vault.totalDeposits / vault.totalShares) / 1_000_000 : 0;
  const minYield = kaminoApy * alloc.lendingPct / 100;

  const handleDeposit = async () => {
    if (!depositAmt || !publicKey || !hasVault) return;
    setTxStatus("Building..."); setTxError(null);
    try {
      const vaultPda = new PublicKey(STRUCTURED_VAULT_PDA);
      const colMint = new PublicKey(STRUCTURED_COLLATERAL_MINT);
      const shrMint = new PublicKey(STRUCTURED_SHARE_MINT);

      const amount = BigInt(Math.floor(parseFloat(depositAmt) * 1_000_000));
      const userCol = await getAssociatedTokenAddress(colMint, publicKey);
      const userShr = await getAssociatedTokenAddress(shrMint, publicKey);
      const vaultCol = await getAssociatedTokenAddress(colMint, vaultPda, true);

      const tx = new Transaction();
      try { await connection.getTokenAccountBalance(userShr); } catch {
        tx.add(createAssociatedTokenAccountInstruction(publicKey, userShr, publicKey, shrMint));
      }

      const data = new Uint8Array(16);
      new DataView(data.buffer).setBigUint64(8, amount, true);

      if (STRUCTURED_STANDALONE) {
        // Standalone: no Percolator accounts needed
        data.set(DISC_DEPOSIT_STANDALONE, 0);
        tx.add(new TransactionInstruction({
          programId: SYNTX_PROGRAM_ID,
          keys: [
            { pubkey: publicKey, isSigner: true, isWritable: true },
            { pubkey: vaultPda, isSigner: false, isWritable: true },
            { pubkey: userCol, isSigner: false, isWritable: true },
            { pubkey: userShr, isSigner: false, isWritable: true },
            { pubkey: vaultCol, isSigner: false, isWritable: true },
            { pubkey: shrMint, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          ],
          data: data as any,
        }));
      } else {
        // Percolator-backed vault
        const slabPk = new PublicKey(STRUCTURED_SLAB);
        data.set(DISC_DEPOSIT, 0);
        const [percVaultPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("vault"), slabPk.toBuffer()], PERCOLATOR_PROGRAM_ID,
        );
        const percVaultAta = await getAssociatedTokenAddress(colMint, percVaultPda, true);
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
      }

      setTxStatus("Confirm in wallet...");
      const sig = await sendTransaction(tx, connection);
      setTxStatus("Confirming...");
      await connection.confirmTransaction(sig, "confirmed");
      setTxStatus(null); setDepositAmt("");
      showToast(`Deposited ${depositAmt} USDC`, "success");
      fetchData();
    } catch (e: any) {
      console.error("Deposit error:", e);
      const logs = e?.logs || e?.transactionLogs || [];
      if (logs.length > 0) console.error("TX Logs:", logs.join("\n"));
      const msg = logs.length > 0 ? logs.join(" | ") : (e?.message || "Transaction failed");
      setTxError(msg.slice(0, 500));
      setTxStatus(null);
      showToast("Deposit failed", "error");
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawAmt || !publicKey || !hasVault || !vault) return;
    setTxError(null);

    // Standalone vaults don't need oracle refresh
    if (!STRUCTURED_STANDALONE) {
      setTxStatus("Refreshing oracle...");
      try { await fetch("/vaults/api/push-oracle", { method: "POST" }); } catch {}
    }

    setTxStatus("Building...");
    try {
      const vaultPda = new PublicKey(STRUCTURED_VAULT_PDA);
      const colMint = new PublicKey(STRUCTURED_COLLATERAL_MINT);
      const shrMint = new PublicKey(STRUCTURED_SHARE_MINT);

      const withdrawUsd = parseFloat(withdrawAmt);
      let shares: bigint;
      if (vault.totalShares > 0n && vault.totalDeposits > 0n) {
        shares = BigInt(Math.floor(withdrawUsd * 1_000_000)) * vault.totalShares / vault.totalDeposits;
      } else {
        shares = BigInt(Math.floor(withdrawUsd * 1_000_000));
      }
      if (shares > userShares) shares = userShares;
      if (shares === 0n) { setTxError("Amount too small"); setTxStatus(null); return; }

      const userCol = await getAssociatedTokenAddress(colMint, publicKey);
      const userShr = await getAssociatedTokenAddress(shrMint, publicKey);
      const vaultCol = await getAssociatedTokenAddress(colMint, vaultPda, true);

      const data = new Uint8Array(16);
      new DataView(data.buffer).setBigUint64(8, shares, true);

      const tx = new Transaction();

      if (STRUCTURED_STANDALONE) {
        data.set(DISC_WITHDRAW_STANDALONE, 0);
        tx.add(new TransactionInstruction({
          programId: SYNTX_PROGRAM_ID,
          keys: [
            { pubkey: publicKey, isSigner: true, isWritable: true },
            { pubkey: vaultPda, isSigner: false, isWritable: true },
            { pubkey: userShr, isSigner: false, isWritable: true },
            { pubkey: userCol, isSigner: false, isWritable: true },
            { pubkey: vaultCol, isSigner: false, isWritable: true },
            { pubkey: shrMint, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          ],
          data: data as any,
        }));
      } else {
        const slabPk = new PublicKey(STRUCTURED_SLAB);
        data.set(DISC_WITHDRAW, 0);
        const [percVaultPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("vault"), slabPk.toBuffer()], PERCOLATOR_PROGRAM_ID,
        );
        const percVaultAta = await getAssociatedTokenAddress(colMint, percVaultPda, true);
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
      }

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

      {/* Hero + Deposit — above the fold */}
      <section className="grid-bg border-b border-[var(--border)]">
        <div className="max-w-[1100px] mx-auto px-6 py-12 md:py-16">
          <div className="grid md:grid-cols-2 gap-8 items-start">

            {/* Left: Value prop + stats */}
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--green)]/10 border border-[var(--green)]/20 text-[var(--green)] text-xs font-medium mb-4">
                Principal Protected
              </div>
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight leading-tight mb-3">
                SOL Exposure
                <br />
                <span className="text-[var(--text-muted)]">Without the Downside</span>
              </h1>
              <p className="text-[var(--text-muted)] mb-6">
                Deposit USDC. Your capital earns yield on Kamino while a portion captures SOL upside.
                After {PROTECTION_HORIZON_DAYS} days, you get back at least what you put in.
              </p>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-4">
                <div className="stat-card p-3">
                  <div className="text-xl font-bold text-[var(--green)]">{pctFmt(kaminoApy * 100)}</div>
                  <div className="text-[10px] text-[var(--text-muted)] mt-0.5">Kamino APY</div>
                </div>
                <div className="stat-card p-3">
                  <div className="text-xl font-bold text-[var(--primary)]">{pctFmt(alloc.spotPct)}</div>
                  <div className="text-[10px] text-[var(--text-muted)] mt-0.5">SOL Exposure</div>
                </div>
                <div className="stat-card p-3">
                  <div className="text-xl font-bold">{PROTECTION_HORIZON_DAYS}d</div>
                  <div className="text-[10px] text-[var(--text-muted)] mt-0.5">Protection</div>
                </div>
              </div>
            </div>

            {/* Right: Deposit / Withdraw */}
            <div className="panel p-6">
              {!connected ? (
                <div className="flex flex-col items-center gap-4 py-8">
                  <p className="text-[var(--text-muted)] text-sm">Connect wallet to deposit</p>
                  <WalletMultiButton />
                </div>
              ) : !hasVault ? (
                <div className="text-center py-8">
                  <p className="text-[var(--text-muted)] text-sm">Vault not deployed yet</p>
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Deposit */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">Deposit</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[var(--text-muted)]">
                          {(Number(userBalance) / 1_000_000).toFixed(2)} USDC
                        </span>
                        {userBalance === 0n && (
                          <button
                            onClick={async () => {
                              setFaucetStatus("...");
                              try {
                                const r = await fetch("/vaults/api/faucet", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ wallet: publicKey!.toBase58() }),
                                });
                                if (r.ok || r.status === 429) {
                                  setFaucetStatus(null);
                                  fetchData();
                                } else { setFaucetStatus("failed"); }
                              } catch { setFaucetStatus("failed"); }
                            }}
                            className="text-[10px] text-[var(--primary)] hover:underline"
                          >
                            {faucetStatus || "Get test USDC"}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 mb-2">
                      <input
                        type="number"
                        value={depositAmt}
                        onChange={(e) => setDepositAmt(e.target.value)}
                        placeholder="0.00"
                        className="flex-1 h-11 px-3 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--primary)]"
                      />
                      <button
                        onClick={() => setDepositAmt((Number(userBalance) / 1_000_000).toString())}
                        className="px-3 h-11 text-xs text-[var(--primary)] border border-[var(--border)] rounded-lg hover:bg-[var(--bg-card)]"
                      >
                        Max
                      </button>
                    </div>
                    <button
                      onClick={handleDeposit}
                      disabled={!depositAmt || !!txStatus}
                      className="w-full h-11 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-sm font-medium disabled:opacity-40 transition"
                    >
                      {txStatus || "Deposit USDC"}
                    </button>
                  </div>

                  {/* Divider */}
                  <div className="border-t border-[var(--border)]" />

                  {/* Position + Withdraw */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">Your Position</span>
                      <span className="text-sm font-semibold">${userValue.toFixed(2)}</span>
                    </div>
                    {userShares > 0n && (
                      <>
                        <div className="flex gap-2 mb-2">
                          <input
                            type="number"
                            value={withdrawAmt}
                            onChange={(e) => setWithdrawAmt(e.target.value)}
                            placeholder="0.00"
                            className="flex-1 h-11 px-3 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--primary)]"
                          />
                          <button
                            onClick={() => setWithdrawAmt(userValue.toFixed(2))}
                            className="px-3 h-11 text-xs text-[var(--primary)] border border-[var(--border)] rounded-lg hover:bg-[var(--bg-card)]"
                          >
                            Max
                          </button>
                        </div>
                        <button
                          onClick={handleWithdraw}
                          disabled={!withdrawAmt || !!txStatus}
                          className="w-full h-11 rounded-lg bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-sm font-medium disabled:opacity-40 transition"
                        >
                          {txStatus || "Withdraw"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {txError && (
                <div className="mt-3 p-3 rounded-lg bg-[var(--red)]/10 border border-[var(--red)]/20 text-[var(--red)] text-xs font-mono break-all">
                  {txError}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-[1100px] mx-auto px-6 py-8 space-y-8">

        {/* Allocation bar */}
        <section>
          <div className="panel p-5">
            <div className="flex rounded-lg overflow-hidden h-8 mb-3">
              <div
                className="bg-[var(--primary)]/20 flex items-center justify-center text-xs font-medium text-[var(--primary)]"
                style={{ width: `${alloc.lendingPct}%` }}
              >
                Kamino {pctFmt(alloc.lendingPct)}
              </div>
              <div
                className="bg-[var(--green)]/20 flex items-center justify-center text-xs font-medium text-[var(--green)]"
                style={{ width: `${alloc.spotPct}%` }}
              >
                SOL {pctFmt(alloc.spotPct)}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center text-xs">
              <div>
                <span className="text-[var(--text-muted)]">TVL</span>
                <div className="font-semibold mt-0.5">${tvl.toFixed(2)}</div>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">Min Yield</span>
                <div className="font-semibold mt-0.5">{pctFmt(minYield * 100)} APY</div>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">Fees</span>
                <div className="font-semibold mt-0.5">10% perf / 1% mgmt</div>
              </div>
            </div>
          </div>
        </section>

        {/* Your Positions — portfolio across all vaults */}
        {connected && positions.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">Your Positions</h2>
              <span className="text-sm font-semibold">${totalPortfolioValue.toFixed(2)}</span>
            </div>
            <div className="space-y-2">
              {positions.map((p) => {
                const sharePrice = p.totalShares > 0n ? Number(p.totalDeposits) / Number(p.totalShares) : 1;
                const pct = p.totalShares > 0n ? (Number(p.shares) / Number(p.totalShares) * 100) : 0;
                return (
                  <div key={p.vaultPda} className="panel p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{p.name}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-950 text-[var(--green)]">ACTIVE</span>
                      </div>
                      <span className="text-sm font-semibold">${p.value.toFixed(2)}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-xs">
                      <div>
                        <span className="text-[var(--text-muted)]">Shares</span>
                        <div className="font-mono mt-0.5">{p.shares.toLocaleString()}</div>
                      </div>
                      <div>
                        <span className="text-[var(--text-muted)]">Share Price</span>
                        <div className="font-mono mt-0.5">${sharePrice.toFixed(6)}</div>
                      </div>
                      <div>
                        <span className="text-[var(--text-muted)]">Ownership</span>
                        <div className="font-mono mt-0.5">{pct.toFixed(2)}%</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* How it works — collapsible */}
        <section className="pb-6">
          <button
            onClick={() => setShowHow(!showHow)}
            className="flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition mb-3"
          >
            <span className="text-xs">{showHow ? "v" : ">"}</span>
            How it works
          </button>
          {showHow && (
            <div className="grid md:grid-cols-3 gap-3">
              <div className="stat-card p-4">
                <div className="text-xs font-mono text-[var(--primary)] mb-1">01</div>
                <h3 className="text-sm font-medium mb-1">You Deposit USDC</h3>
                <p className="text-xs text-[var(--text-muted)]">
                  USDC enters the Syntx vault. The keeper splits it automatically.
                </p>
              </div>
              <div className="stat-card p-4">
                <div className="text-xs font-mono text-[var(--primary)] mb-1">02</div>
                <h3 className="text-sm font-medium mb-1">Auto Allocation</h3>
                <p className="text-xs text-[var(--text-muted)]">
                  {pctFmt(alloc.lendingPct)} earns yield on Kamino. {pctFmt(alloc.spotPct)} buys SOL for upside.
                </p>
              </div>
              <div className="stat-card p-4">
                <div className="text-xs font-mono text-[var(--primary)] mb-1">03</div>
                <h3 className="text-sm font-medium mb-1">Protected</h3>
                <p className="text-xs text-[var(--text-muted)]">
                  Lending yield covers worst-case loss. After {PROTECTION_HORIZON_DAYS} days, at least your full deposit back.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
