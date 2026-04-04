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

const SYNTX_PROGRAM_ID = new PublicKey("53r6bg7JBFqf5Jfs7fe4kHDtwXwUgDWoLarYrsWcoF1V");

// Pre-computed Anchor discriminators
const DISC_DEPOSIT = new Uint8Array([0xf2, 0x23, 0xc6, 0x89, 0x52, 0xe1, 0xf2, 0xb6]);
const DISC_WITHDRAW = new Uint8Array([0xb7, 0x12, 0x46, 0x9c, 0x94, 0x6d, 0xa1, 0x22]);

// Read helpers
function readU16LE(d: Uint8Array, off: number): number {
  return d[off] | (d[off + 1] << 8);
}
function readU64LE(d: Uint8Array, off: number): bigint {
  const lo = BigInt(d[off]) | (BigInt(d[off+1]) << 8n) | (BigInt(d[off+2]) << 16n) | (BigInt(d[off+3]) << 24n);
  const hi = BigInt(d[off+4]) | (BigInt(d[off+5]) << 8n) | (BigInt(d[off+6]) << 16n) | (BigInt(d[off+7]) << 24n);
  return lo | (hi << 32n);
}

interface VaultData {
  manager: string;
  collateralMint: string;
  shareMint: string;
  percolatorProgram: string;
  slab: string;
  userIdx: number;
  totalShares: bigint;
  totalDeposits: bigint;
  perfFeeBps: number;
  mgmtFeeBps: number;
  depositCap: bigint;
  paused: boolean;
  initialized: boolean;
}

function parseVaultData(d: Uint8Array): VaultData {
  let off = 9; // disc(8) + bump(1)
  const manager = new PublicKey(d.slice(off, off + 32)).toBase58(); off += 32;
  const collateralMint = new PublicKey(d.slice(off, off + 32)).toBase58(); off += 32;
  const shareMint = new PublicKey(d.slice(off, off + 32)).toBase58(); off += 32;
  const percolatorProgram = new PublicKey(d.slice(off, off + 32)).toBase58(); off += 32;
  const slab = new PublicKey(d.slice(off, off + 32)).toBase58(); off += 32;
  const userIdx = readU16LE(d, off); off += 2;
  const totalShares = readU64LE(d, off); off += 8;
  const totalDeposits = readU64LE(d, off); off += 8;
  const perfFeeBps = readU16LE(d, off); off += 2;
  const mgmtFeeBps = readU16LE(d, off); off += 2;
  off += 16; // HWM + lastFeeCollection
  const depositCap = readU64LE(d, off); off += 8;
  const paused = d[off] !== 0; off += 1;
  const initialized = d[off] !== 0;
  return { manager, collateralMint, shareMint, percolatorProgram, slab, userIdx, totalShares, totalDeposits, perfFeeBps, mgmtFeeBps, depositCap, paused, initialized };
}

function short(addr: string): string {
  return addr.slice(0, 4) + "..." + addr.slice(-4);
}

export default function VaultDashboard({ vaultPda }: { vaultPda: string }) {
  const VAULT_PDA = new PublicKey(vaultPda);
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [vault, setVault] = useState<VaultData | null>(null);
  const [userShares, setUserShares] = useState<bigint>(0n);
  const [loading, setLoading] = useState(true);
  const [depositAmt, setDepositAmt] = useState("");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const info = await connection.getAccountInfo(VAULT_PDA);
      if (!info) return;
      const data = parseVaultData(new Uint8Array(info.data));
      setVault(data);

      if (publicKey) {
        try {
          const ata = await getAssociatedTokenAddress(new PublicKey(data.shareMint), publicKey);
          const bal = await connection.getTokenAccountBalance(ata);
          const shares = BigInt(bal.value.amount);
          setUserShares(shares);
          console.log("User shares:", shares.toString(), "ATA:", ata.toBase58());
        } catch (e) {
          console.log("No share ATA for", publicKey.toBase58());
          setUserShares(0n);
        }
      }
    } catch (e) { console.error("Fetch error:", e); } finally { setLoading(false); }
  }, [connection, publicKey, vaultPda]);

  useEffect(() => {
    fetchData();
    const i = setInterval(fetchData, 15000);
    return () => clearInterval(i);
  }, [fetchData]);

  if (loading && !vault) {
    return (
      <div className="space-y-4">
        <div className="shimmer h-48 rounded-xl" />
        <div className="shimmer h-32 rounded-xl" />
      </div>
    );
  }

  if (!vault) return <div className="text-[var(--text-dim)]">Vault not found</div>;

  const sharePrice = vault.totalShares > 0n ? Number(vault.totalDeposits) / Number(vault.totalShares) : 1.0;
  const userValue = vault.totalShares > 0n ? Number(userShares * vault.totalDeposits / vault.totalShares) / 1_000_000 : 0;

  const handleDeposit = async () => {
    if (!depositAmt || !publicKey) return;
    setTxStatus("Building..."); setTxError(null);
    try {
      if (!vault) return;
      const colMint = new PublicKey(vault.collateralMint);
      const shrMint = new PublicKey(vault.shareMint);
      const percProg = new PublicKey(vault.percolatorProgram);
      const slabPk = new PublicKey(vault.slab);

      const amount = BigInt(Math.floor(parseFloat(depositAmt) * 1_000_000));
      const userCol = await getAssociatedTokenAddress(colMint, publicKey);
      const userShr = await getAssociatedTokenAddress(shrMint, publicKey);
      const vaultCol = await getAssociatedTokenAddress(colMint, VAULT_PDA, true);

      // Derive Percolator vault PDA + ATA
      const [percVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), slabPk.toBuffer()], percProg,
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
          { pubkey: VAULT_PDA, isSigner: false, isWritable: true },
          { pubkey: userCol, isSigner: false, isWritable: true },
          { pubkey: userShr, isSigner: false, isWritable: true },
          { pubkey: vaultCol, isSigner: false, isWritable: true },
          { pubkey: shrMint, isSigner: false, isWritable: true },
          { pubkey: slabPk, isSigner: false, isWritable: true },
          { pubkey: percVaultAta, isSigner: false, isWritable: true },
          { pubkey: percProg, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
        ],
        data: data as any,
      }));

      setTxStatus("Confirm in wallet...");
      const sig = await sendTransaction(tx, connection);
      setTxStatus("Confirming...");
      await connection.confirmTransaction(sig, "confirmed");
      setTxStatus(null); setDepositAmt(""); fetchData();
    } catch (e: any) {
      console.error("Deposit error:", e);
      const msg = e?.logs?.join("\n") || e?.message || "Failed";
      setTxError(msg.slice(0, 200));
      setTxStatus(null);
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawAmt || !publicKey) return;
    setTxStatus("Building..."); setTxError(null);
    try {
      if (!vault) return;
      const colMint = new PublicKey(vault.collateralMint);
      const shrMint = new PublicKey(vault.shareMint);
      const percProg = new PublicKey(vault.percolatorProgram);
      const slabPk = new PublicKey(vault.slab);

      const shares = BigInt(withdrawAmt);
      const userShr = await getAssociatedTokenAddress(shrMint, publicKey);
      const userCol = await getAssociatedTokenAddress(colMint, publicKey);
      const vaultCol = await getAssociatedTokenAddress(colMint, VAULT_PDA, true);

      const [percVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), slabPk.toBuffer()], percProg,
      );
      const percVaultAta = await getAssociatedTokenAddress(colMint, percVaultPda, true);

      const tx = new Transaction();

      try { await connection.getTokenAccountBalance(userCol); } catch {
        tx.add(createAssociatedTokenAccountInstruction(publicKey, userCol, publicKey, colMint));
      }

      const data = new Uint8Array(16);
      data.set(DISC_WITHDRAW, 0);
      new DataView(data.buffer).setBigUint64(8, shares, true);

      tx.add(new TransactionInstruction({
        programId: SYNTX_PROGRAM_ID,
        keys: [
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: VAULT_PDA, isSigner: false, isWritable: true },
          { pubkey: userShr, isSigner: false, isWritable: true },
          { pubkey: userCol, isSigner: false, isWritable: true },
          { pubkey: vaultCol, isSigner: false, isWritable: true },
          { pubkey: shrMint, isSigner: false, isWritable: true },
          { pubkey: slabPk, isSigner: false, isWritable: true },
          { pubkey: percVaultAta, isSigner: false, isWritable: true },
          { pubkey: percVaultPda, isSigner: false, isWritable: false },
          { pubkey: slabPk, isSigner: false, isWritable: false }, // oracle
          { pubkey: percProg, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
        ],
        data: data as any,
      }));

      setTxStatus("Confirm in wallet...");
      const sig = await sendTransaction(tx, connection);
      setTxStatus("Confirming...");
      await connection.confirmTransaction(sig, "confirmed");
      setTxStatus(null); setWithdrawAmt(""); fetchData();
    } catch (e: any) {
      console.error("Withdraw error:", e);
      const msg = e?.logs?.join("\n") || e?.message || "Failed";
      setTxError(msg.slice(0, 200));
      setTxStatus(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="flex justify-end mb-2">
        <button
          onClick={fetchData}
          className="text-xs text-[var(--text-dim)] hover:text-white transition px-3 py-1 border border-[var(--border)] rounded-lg"
        >
          Refresh
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[1px] bg-[var(--border)] rounded-xl overflow-hidden">
        <Stat label="Share Price" value={`$${sharePrice.toFixed(6)}`} />
        <Stat label="TVL" value={`${(Number(vault.totalDeposits) / 1_000_000).toFixed(2)}`} />
        <Stat label="Shares Outstanding" value={vault.totalShares.toLocaleString()} />
        <Stat label="Status" value={vault.paused ? "Paused" : "Active"} accent={vault.paused ? "var(--red)" : "var(--green)"} />
      </div>

      {/* User + Actions */}
      {publicKey && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-[1px] bg-[var(--border)] rounded-xl overflow-hidden">
          {/* Your Position */}
          <div className="bg-[var(--bg-panel)] p-6">
            <h3 className="text-xs font-mono uppercase tracking-wider text-[var(--text-dim)] mb-4">Your Position</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Shares</span>
                <span className="font-mono">{userShares.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Value</span>
                <span className="font-mono">${userValue.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Share</span>
                <span className="font-mono">
                  {vault.totalShares > 0n ? `${(Number(userShares) / Number(vault.totalShares) * 100).toFixed(2)}%` : "0%"}
                </span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="bg-[var(--bg-panel)] p-6">
            <h3 className="text-xs font-mono uppercase tracking-wider text-[var(--text-dim)] mb-4">Actions</h3>

            {(txStatus || txError) && (
              <div className={`mb-4 rounded-lg px-3 py-2 text-xs font-mono ${txError ? "bg-red-950 text-[var(--red)]" : "bg-blue-950 text-[var(--primary)]"}`}>
                {txError || txStatus}
              </div>
            )}

            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="Amount"
                  value={depositAmt}
                  onChange={(e) => setDepositAmt(e.target.value)}
                  className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-[var(--primary)]"
                />
                <button
                  onClick={handleDeposit}
                  disabled={!depositAmt || vault.paused}
                  className="px-5 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:bg-[var(--bg-card)] disabled:text-[var(--text-dim)] rounded-lg text-sm font-medium transition"
                >
                  Deposit
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type="number"
                  placeholder="Shares"
                  value={withdrawAmt}
                  onChange={(e) => setWithdrawAmt(e.target.value)}
                  className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-[var(--orange)]"
                />
                <button
                  onClick={handleWithdraw}
                  disabled={!withdrawAmt || userShares === 0n}
                  className="px-5 py-2.5 bg-[var(--bg-card)] border border-[var(--border)] hover:border-[var(--border-hover)] disabled:text-[var(--text-dim)] rounded-lg text-sm font-medium transition"
                >
                  Withdraw
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Vault Details */}
      <div className="panel p-6">
        <h3 className="text-xs font-mono uppercase tracking-wider text-[var(--text-dim)] mb-4">Vault Details</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <Row label="Manager" value={short(vault.manager)} href={vault.manager} />
          <Row label="Percolator Slab" value={short(vault.slab)} href={vault.slab} />
          <Row label="Account Index" value={String(vault.userIdx)} />
          <Row label="Performance Fee" value={`${vault.perfFeeBps / 100}%`} />
          <Row label="Management Fee" value={`${vault.mgmtFeeBps / 100}%/yr`} />
          <Row label="Deposit Cap" value={vault.depositCap > 0n ? (Number(vault.depositCap) / 1_000_000).toLocaleString() : "Unlimited"} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-[var(--bg-panel)] p-5">
      <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-dim)] mb-2">{label}</div>
      <div className="text-xl font-semibold" style={accent ? { color: accent } : undefined}>{value}</div>
    </div>
  );
}

function Row({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-[var(--border)]">
      <span className="text-[var(--text-muted)]">{label}</span>
      {href ? (
        <a
          href={`https://explorer.solana.com/address/${href}?cluster=devnet`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[var(--primary)] hover:text-[var(--primary-hover)] transition"
        >
          {value}
        </a>
      ) : (
        <span className="font-mono">{value}</span>
      )}
    </div>
  );
}
