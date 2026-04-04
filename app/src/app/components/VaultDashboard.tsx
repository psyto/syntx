"use client";

import { useEffect, useState, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";

// Vault config (devnet)
const VAULT_PDA = new PublicKey("4pL2aQawAbc2XwjRE9ptrH4yxihn4BL2uVMavgZrtYUK");
const SYNTX_PROGRAM_ID = new PublicKey("53r6bg7JBFqf5Jfs7fe4kHDtwXwUgDWoLarYrsWcoF1V");

interface VaultData {
  manager: string;
  collateralMint: string;
  shareMint: string;
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

// Read helpers for Uint8Array (browser doesn't have Buffer.readBigUInt64LE)
function readU8(d: Uint8Array, off: number): number {
  return d[off];
}
function readU16LE(d: Uint8Array, off: number): number {
  return d[off] | (d[off + 1] << 8);
}
function readU64LE(d: Uint8Array, off: number): bigint {
  const lo = BigInt(d[off]) | (BigInt(d[off+1]) << 8n) | (BigInt(d[off+2]) << 16n) | (BigInt(d[off+3]) << 24n);
  const hi = BigInt(d[off+4]) | (BigInt(d[off+5]) << 8n) | (BigInt(d[off+6]) << 16n) | (BigInt(d[off+7]) << 24n);
  return lo | (hi << 32n);
}

function parseVaultData(raw: Uint8Array): VaultData {
  const d = raw;
  let off = 8; // skip discriminator
  off += 1; // bump
  const manager = new PublicKey(d.slice(off, off + 32)).toBase58(); off += 32;
  const collateralMint = new PublicKey(d.slice(off, off + 32)).toBase58(); off += 32;
  const shareMint = new PublicKey(d.slice(off, off + 32)).toBase58(); off += 32;
  off += 32; // percolator_program
  const slab = new PublicKey(d.slice(off, off + 32)).toBase58(); off += 32;
  const userIdx = readU16LE(d, off); off += 2;
  const totalShares = readU64LE(d, off); off += 8;
  const totalDeposits = readU64LE(d, off); off += 8;
  const perfFeeBps = readU16LE(d, off); off += 2;
  const mgmtFeeBps = readU16LE(d, off); off += 2;
  off += 8; // high_water_mark
  off += 8; // last_fee_collection
  const depositCap = readU64LE(d, off); off += 8;
  const paused = readU8(d, off) !== 0; off += 1;
  const initialized = readU8(d, off) !== 0; off += 1;

  return {
    manager, collateralMint, shareMint, slab, userIdx,
    totalShares, totalDeposits, perfFeeBps, mgmtFeeBps,
    depositCap, paused, initialized,
  };
}

function shortAddr(addr: string): string {
  return addr.slice(0, 4) + "..." + addr.slice(-4);
}

export default function VaultDashboard() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [vault, setVault] = useState<VaultData | null>(null);
  const [userShares, setUserShares] = useState<bigint>(0n);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const info = await connection.getAccountInfo(VAULT_PDA);
      if (!info) {
        setError("Vault not found on-chain");
        return;
      }
      const data = parseVaultData(new Uint8Array(info.data));
      setVault(data);

      // Fetch user's share balance
      if (publicKey) {
        try {
          const shareMint = new PublicKey(data.shareMint);
          const ata = await getAssociatedTokenAddress(shareMint, publicKey);
          const balance = await connection.getTokenAccountBalance(ata);
          setUserShares(BigInt(balance.value.amount));
        } catch {
          setUserShares(0n);
        }
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch vault data");
    } finally {
      setLoading(false);
    }
  }, [connection, publicKey]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading && !vault) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-400">Loading vault data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-800 rounded-xl p-6">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  if (!vault) return null;

  const sharePrice = vault.totalShares > 0n
    ? Number(vault.totalDeposits) / Number(vault.totalShares)
    : 1.0;

  const userValue = vault.totalShares > 0n
    ? Number(userShares * vault.totalDeposits / vault.totalShares) / 1_000_000
    : 0;

  return (
    <div className="space-y-6">
      {/* Vault Overview */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h2 className="text-xl font-semibold mb-4">Vault Overview</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Share Price"
            value={`$${sharePrice.toFixed(6)}`}
          />
          <StatCard
            label="Total Deposits"
            value={`${(Number(vault.totalDeposits) / 1_000_000).toFixed(2)}`}
          />
          <StatCard
            label="Total Shares"
            value={vault.totalShares.toLocaleString()}
          />
          <StatCard
            label="Status"
            value={vault.paused ? "Paused" : "Active"}
            valueColor={vault.paused ? "text-red-400" : "text-green-400"}
          />
        </div>
      </div>

      {/* User Position */}
      {publicKey && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4">Your Position</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <StatCard label="Your Shares" value={userShares.toLocaleString()} />
            <StatCard label="Value" value={`$${userValue.toFixed(2)}`} />
            <StatCard
              label="Share of Vault"
              value={vault.totalShares > 0n
                ? `${(Number(userShares) / Number(vault.totalShares) * 100).toFixed(2)}%`
                : "0%"
              }
            />
          </div>
        </div>
      )}

      {/* Vault Config */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h2 className="text-xl font-semibold mb-4">Vault Config</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <InfoRow label="Manager" value={shortAddr(vault.manager)} />
          <InfoRow label="Collateral Mint" value={shortAddr(vault.collateralMint)} />
          <InfoRow label="Share Mint" value={shortAddr(vault.shareMint)} />
          <InfoRow label="Percolator Slab" value={shortAddr(vault.slab)} />
          <InfoRow label="Account Index" value={String(vault.userIdx)} />
          <InfoRow label="Performance Fee" value={`${vault.perfFeeBps / 100}%`} />
          <InfoRow label="Management Fee" value={`${vault.mgmtFeeBps / 100}% / yr`} />
          <InfoRow label="Deposit Cap" value={
            vault.depositCap > 0n
              ? `${(Number(vault.depositCap) / 1_000_000).toLocaleString()}`
              : "Unlimited"
          } />
        </div>
      </div>

      {/* Addresses */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h2 className="text-xl font-semibold mb-4">Addresses</h2>
        <div className="space-y-2 text-sm font-mono">
          <AddrRow label="Vault PDA" addr={VAULT_PDA.toBase58()} />
          <AddrRow label="Program" addr={SYNTX_PROGRAM_ID.toBase58()} />
          <AddrRow label="Manager" addr={vault.manager} />
          <AddrRow label="Slab" addr={vault.slab} />
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, valueColor }: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="bg-gray-800/50 rounded-lg p-4">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className={`text-lg font-semibold ${valueColor || "text-white"}`}>{value}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-1 border-b border-gray-800/50">
      <span className="text-gray-400">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function AddrRow({ label, addr }: { label: string; addr: string }) {
  return (
    <div className="flex justify-between items-center py-1">
      <span className="text-gray-400 text-xs">{label}</span>
      <a
        href={`https://explorer.solana.com/address/${addr}?cluster=devnet`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-400 hover:text-blue-300 text-xs"
      >
        {shortAddr(addr)}
      </a>
    </div>
  );
}
