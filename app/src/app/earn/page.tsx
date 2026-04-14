"use client";

import { useEffect, useState, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
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

const DISC_DEPOSIT_STANDALONE = new Uint8Array([0x0a, 0xce, 0x85, 0xf6, 0x6b, 0x32, 0x04, 0x37]);
const DISC_WITHDRAW_STANDALONE = new Uint8Array([0x56, 0x65, 0x25, 0x31, 0x99, 0x49, 0x1e, 0xf3]);

// --- Vault configs ---

interface VaultConfig {
  id: string;
  name: string;
  badge: string;
  badgeColor: string;
  heading: string;
  headingSub: string;
  description: string;
  vaultPda: string;
  collateralMint: string;
  shareMint: string;
  stats: { value: string; label: string; color?: string }[];
  allocationBar?: { left: string; leftPct: number; right: string; rightPct: number };
  feesLabel: string;
}

const VAULTS: VaultConfig[] = [
  {
    id: "protected",
    name: "Principal Protected SOL",
    badge: "Principal Protected",
    badgeColor: "var(--green)",
    heading: "SOL Exposure",
    headingSub: "Without the Downside",
    description: "Deposit USDC. Kamino yield protects your principal while delta hedging captures SOL upside. After 30 days, you get back at least what you put in.",
    vaultPda: process.env.NEXT_PUBLIC_STRUCTURED_VAULT_PDA || "",
    collateralMint: process.env.NEXT_PUBLIC_STRUCTURED_COLLATERAL_MINT || "AhGQVQm7HudP6eWekMDLZiZogwvnMPFGL5owZCHFGquC",
    shareMint: process.env.NEXT_PUBLIC_STRUCTURED_SHARE_MINT || "",
    stats: [
      { value: "8.2%", label: "Kamino APY", color: "var(--green)" },
      { value: "6.8%", label: "SOL Exposure", color: "var(--primary)" },
      { value: "30d", label: "Protection" },
    ],
    allocationBar: { left: "Kamino 93.2%", leftPct: 93.2, right: "SOL 6.8%", rightPct: 6.8 },
    feesLabel: "10% perf / 1% mgmt",
  },
  {
    id: "funding",
    name: "SOL Funding Rate",
    badge: "Yield",
    badgeColor: "var(--primary)",
    heading: "Earn From Every",
    headingSub: "Funding Tick",
    description: "Deposit USDC. The keeper positions your capital to collect perpetual funding rate payments across any venue.",
    vaultPda: "HYicfqAdnPFhzYKFJTVkSSBp8nFwQCqj64MvYKzSJPVw",
    collateralMint: "AhGQVQm7HudP6eWekMDLZiZogwvnMPFGL5owZCHFGquC",
    shareMint: "3Ttd7cshwdf9adCZahSTe4eD5iirkcnZS6kjvxJC7toT",
    stats: [
      { value: "+12", label: "bps/slot Funding", color: "var(--green)" },
      { value: "50%", label: "Max Deploy", color: "var(--primary)" },
      { value: "5%", label: "Circuit Breaker" },
    ],
    feesLabel: "20% perf / 2% mgmt",
  },
];

// --- Helpers ---

function readU16LE(d: Uint8Array, off: number): number {
  return d[off] | (d[off + 1] << 8);
}
function readU64LE(d: Uint8Array, off: number): bigint {
  const lo = BigInt(d[off]) | (BigInt(d[off+1]) << 8n) | (BigInt(d[off+2]) << 16n) | (BigInt(d[off+3]) << 24n);
  const hi = BigInt(d[off+4]) | (BigInt(d[off+5]) << 8n) | (BigInt(d[off+6]) << 16n) | (BigInt(d[off+7]) << 24n);
  return lo | (hi << 32n);
}

function short(addr: string): string {
  return addr.slice(0, 4) + "..." + addr.slice(-4);
}

interface VaultState {
  totalShares: bigint;
  totalDeposits: bigint;
  shareMint: string;
  collateralMint: string;
}

function parseVaultState(d: Uint8Array): VaultState {
  let off = 9;
  off += 32; // manager
  const collateralMint = new PublicKey(d.slice(off, off + 32)).toBase58(); off += 32;
  const shareMint = new PublicKey(d.slice(off, off + 32)).toBase58(); off += 32;
  off += 32 + 32 + 2; // percolatorProgram + slab + userIdx
  const totalShares = readU64LE(d, off); off += 8;
  const totalDeposits = readU64LE(d, off);
  return { totalShares, totalDeposits, shareMint, collateralMint };
}

// Portfolio
const VAULT_DISC = new Uint8Array([0xe4, 0xc4, 0x52, 0xa5, 0x62, 0xd2, 0xeb, 0x98]);
const KNOWN_NAMES: Record<string, string> = {};
VAULTS.forEach(v => { if (v.vaultPda) KNOWN_NAMES[v.vaultPda] = v.name; });

interface PortfolioPosition {
  vaultPda: string;
  name: string;
  shares: bigint;
  totalShares: bigint;
  totalDeposits: bigint;
  value: number;
}

// --- Component ---

export default function EarnPage() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();

  const [activeTab, setActiveTab] = useState(0);
  const [vault, setVault] = useState<VaultState | null>(null);
  const [userShares, setUserShares] = useState<bigint>(0n);
  const [userBalance, setUserBalance] = useState<bigint>(0n);
  const [depositAmt, setDepositAmt] = useState("");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [loading, setLoading] = useState(true);
  const [faucetStatus, setFaucetStatus] = useState<string | null>(null);
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [totalPortfolioValue, setTotalPortfolioValue] = useState(0);
  const [showHow, setShowHow] = useState(false);

  const activeVault = VAULTS[activeTab];
  const hasVault = activeVault.vaultPda.length > 0;

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  const fetchData = useCallback(async () => {
    if (!hasVault) { setLoading(false); return; }
    try {
      setLoading(true);
      const vaultPda = new PublicKey(activeVault.vaultPda);
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

      // Portfolio across all vaults
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

            let off = 9 + 32 + 32;
            const shareMint = new PublicKey(d.slice(off, off + 32)).toBase58(); off += 32;
            off += 32 + 32 + 2;
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
                  name: KNOWN_NAMES[pda] || `Vault ${short(pda)}`,
                  shares, totalShares, totalDeposits, value,
                });
              }
            } catch { /* no ATA */ }
          }
          setPositions(found);
          setTotalPortfolioValue(found.reduce((s, p) => s + p.value, 0));
        } catch { /* non-critical */ }
      }
    } catch (e) { console.error("Fetch error:", e); } finally { setLoading(false); }
  }, [connection, publicKey, activeVault.vaultPda, hasVault]);

  useEffect(() => {
    fetchData();
    const i = setInterval(fetchData, 15000);
    return () => clearInterval(i);
  }, [fetchData]);

  // Reset form when switching tabs
  useEffect(() => {
    setDepositAmt(""); setWithdrawAmt(""); setTxError(null); setTxStatus(null);
    setUserShares(0n); setVault(null);
  }, [activeTab]);

  const tvl = vault ? Number(vault.totalDeposits) / 1_000_000 : 0;
  const userValue = vault && vault.totalShares > 0n
    ? Number(userShares * vault.totalDeposits / vault.totalShares) / 1_000_000 : 0;

  const handleDeposit = async () => {
    if (!depositAmt || !publicKey || !hasVault) return;
    setTxStatus("Building..."); setTxError(null);
    try {
      const vaultPda = new PublicKey(activeVault.vaultPda);
      const colMint = new PublicKey(activeVault.collateralMint);
      const shrMint = new PublicKey(activeVault.shareMint);

      const amount = BigInt(Math.floor(parseFloat(depositAmt) * 1_000_000));
      const userCol = await getAssociatedTokenAddress(colMint, publicKey);
      const userShr = await getAssociatedTokenAddress(shrMint, publicKey);
      const vaultCol = await getAssociatedTokenAddress(colMint, vaultPda, true);

      const tx = new Transaction();
      try { await connection.getTokenAccountBalance(userShr); } catch {
        tx.add(createAssociatedTokenAccountInstruction(publicKey, userShr, publicKey, shrMint));
      }

      const data = new Uint8Array(16);
      data.set(DISC_DEPOSIT_STANDALONE, 0);
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
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
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
      console.error("Deposit error:", e);
      const logs = e?.logs || e?.transactionLogs || [];
      const msg = logs.length > 0 ? logs.join(" | ") : (e?.message || "Transaction failed");
      setTxError(msg.slice(0, 500));
      setTxStatus(null);
      showToast("Deposit failed", "error");
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawAmt || !publicKey || !hasVault || !vault) return;
    setTxStatus("Building..."); setTxError(null);
    try {
      const vaultPda = new PublicKey(activeVault.vaultPda);
      const colMint = new PublicKey(activeVault.collateralMint);
      const shrMint = new PublicKey(activeVault.shareMint);

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
      data.set(DISC_WITHDRAW_STANDALONE, 0);
      new DataView(data.buffer).setBigUint64(8, shares, true);

      const tx = new Transaction().add(new TransactionInstruction({
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

      {/* Tabs */}
      <div className="border-b border-[var(--border)] bg-[var(--bg-panel)]">
        <div className="max-w-[1100px] mx-auto px-6 flex gap-1">
          {VAULTS.map((v, i) => (
            <button
              key={v.id}
              onClick={() => setActiveTab(i)}
              className={`px-4 py-3 text-sm transition-colors ${
                activeTab === i
                  ? "text-[var(--text)] border-b-2 border-[var(--primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              {v.name}
            </button>
          ))}
        </div>
      </div>

      {/* Hero + Deposit */}
      <section className="grid-bg border-b border-[var(--border)]">
        <div className="max-w-[1100px] mx-auto px-6 py-12 md:py-16">
          <div className="grid md:grid-cols-2 gap-8 items-start">

            {/* Left: Value prop + stats */}
            <div>
              <div
                className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium mb-4"
                style={{
                  backgroundColor: `${activeVault.badgeColor}15`,
                  borderColor: `${activeVault.badgeColor}33`,
                  color: activeVault.badgeColor,
                  borderWidth: 1,
                  borderStyle: "solid",
                }}
              >
                {activeVault.badge}
              </div>
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight leading-tight mb-3">
                {activeVault.heading}
                <br />
                <span className="text-[var(--text-muted)]">{activeVault.headingSub}</span>
              </h1>
              <p className="text-[var(--text-muted)] mb-6">{activeVault.description}</p>

              <div className="grid grid-cols-3 gap-4">
                {activeVault.stats.map((s, i) => (
                  <div key={i} className="stat-card p-3">
                    <div className="text-xl font-bold" style={{ color: s.color || "var(--text)" }}>{s.value}</div>
                    <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{s.label}</div>
                  </div>
                ))}
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
                                if (r.ok || r.status === 429) { setFaucetStatus(null); fetchData(); }
                                else { setFaucetStatus("failed"); }
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

        {/* Allocation bar (only for Principal Protected) */}
        {activeVault.allocationBar && (
          <section>
            <div className="panel p-5">
              <div className="flex rounded-lg overflow-hidden h-8 mb-3">
                <div
                  className="bg-[var(--primary)]/20 flex items-center justify-center text-xs font-medium text-[var(--primary)]"
                  style={{ width: `${activeVault.allocationBar.leftPct}%` }}
                >
                  {activeVault.allocationBar.left}
                </div>
                <div
                  className="bg-[var(--green)]/20 flex items-center justify-center text-xs font-medium text-[var(--green)]"
                  style={{ width: `${activeVault.allocationBar.rightPct}%` }}
                >
                  {activeVault.allocationBar.right}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 text-center text-xs">
                <div>
                  <span className="text-[var(--text-muted)]">TVL</span>
                  <div className="font-semibold mt-0.5">${tvl.toFixed(2)}</div>
                </div>
                <div>
                  <span className="text-[var(--text-muted)]">Min Yield</span>
                  <div className="font-semibold mt-0.5">8.1% APY</div>
                </div>
                <div>
                  <span className="text-[var(--text-muted)]">Fees</span>
                  <div className="font-semibold mt-0.5">{activeVault.feesLabel}</div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Funding Rate info (only for Funding Rate) */}
        {activeVault.id === "funding" && (
          <section>
            <div className="panel p-5">
              <div className="grid grid-cols-3 gap-4 text-center text-xs">
                <div>
                  <span className="text-[var(--text-muted)]">TVL</span>
                  <div className="font-semibold mt-0.5">${tvl.toFixed(2)}</div>
                </div>
                <div>
                  <span className="text-[var(--text-muted)]">Strategy</span>
                  <div className="font-semibold mt-0.5">Venue-Agnostic</div>
                </div>
                <div>
                  <span className="text-[var(--text-muted)]">Fees</span>
                  <div className="font-semibold mt-0.5">{activeVault.feesLabel}</div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Your Positions */}
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
          {showHow && activeVault.id === "protected" && (
            <div className="grid md:grid-cols-3 gap-3">
              <div className="stat-card p-4">
                <div className="text-xs font-mono text-[var(--primary)] mb-1">01</div>
                <h3 className="text-sm font-medium mb-1">You Deposit USDC</h3>
                <p className="text-xs text-[var(--text-muted)]">USDC enters the Syntx vault. The keeper splits it automatically.</p>
              </div>
              <div className="stat-card p-4">
                <div className="text-xs font-mono text-[var(--primary)] mb-1">02</div>
                <h3 className="text-sm font-medium mb-1">Delta Hedge</h3>
                <p className="text-xs text-[var(--text-muted)]">93% earns yield on Kamino. 7% runs a delta-hedged perp for SOL upside.</p>
              </div>
              <div className="stat-card p-4">
                <div className="text-xs font-mono text-[var(--primary)] mb-1">03</div>
                <h3 className="text-sm font-medium mb-1">Protected</h3>
                <p className="text-xs text-[var(--text-muted)]">Lending yield covers worst-case loss. After 30 days, at least your full deposit back.</p>
              </div>
            </div>
          )}
          {showHow && activeVault.id === "funding" && (
            <div className="grid md:grid-cols-3 gap-3">
              <div className="stat-card p-4">
                <div className="text-xs font-mono text-[var(--primary)] mb-1">01</div>
                <h3 className="text-sm font-medium mb-1">You Deposit USDC</h3>
                <p className="text-xs text-[var(--text-muted)]">USDC enters the vault as collateral for perp trading.</p>
              </div>
              <div className="stat-card p-4">
                <div className="text-xs font-mono text-[var(--primary)] mb-1">02</div>
                <h3 className="text-sm font-medium mb-1">Collect Funding</h3>
                <p className="text-xs text-[var(--text-muted)]">Keeper goes long or short based on funding rate direction. Collects payments every tick.</p>
              </div>
              <div className="stat-card p-4">
                <div className="text-xs font-mono text-[var(--primary)] mb-1">03</div>
                <h3 className="text-sm font-medium mb-1">Venue Agnostic</h3>
                <p className="text-xs text-[var(--text-muted)]">Routes across Percolator, Jupiter Perps, or Phoenix — picks the best funding rate automatically.</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
