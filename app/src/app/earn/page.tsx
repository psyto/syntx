"use client";

import { useEffect, useState, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import dynamic from "next/dynamic";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((mod) => mod.WalletMultiButton),
  { ssr: false },
);

const SYNTX_PROGRAM_ID = new PublicKey("53r6bg7JBFqf5Jfs7fe4kHDtwXwUgDWoLarYrsWcoF1V");

const VAULT_DISC = new Uint8Array([0xe4, 0xc4, 0x52, 0xa5, 0x62, 0xd2, 0xeb, 0x98]);

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

interface Position {
  vaultPda: string;
  shareMint: string;
  shares: bigint;
  totalShares: bigint;
  totalDeposits: bigint;
  value: number;
  perfFeeBps: number;
  mgmtFeeBps: number;
}

export default function EarnPage() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalValue, setTotalValue] = useState(0);

  const fetchPositions = useCallback(async () => {
    if (!publicKey) { setPositions([]); setLoading(false); return; }

    try {
      setLoading(true);
      const accounts = await connection.getProgramAccounts(SYNTX_PROGRAM_ID, {
        dataSlice: { offset: 0, length: 210 },
      });

      const positions: Position[] = [];
      for (const { pubkey, account } of accounts) {
        const d = new Uint8Array(account.data);
        // Check discriminator
        let match = true;
        for (let i = 0; i < 8; i++) { if (d[i] !== VAULT_DISC[i]) { match = false; break; } }
        if (!match) continue;

        let off = 9 + 32; // skip disc + bump + manager
        off += 32; // collateral_mint
        const shareMint = new PublicKey(d.slice(off, off + 32)).toBase58(); off += 32;
        off += 32 + 32 + 2; // percolator_program + slab + userIdx
        const totalShares = readU64LE(d, off); off += 8;
        const totalDeposits = readU64LE(d, off); off += 8;
        const perfFeeBps = readU16LE(d, off); off += 2;
        const mgmtFeeBps = readU16LE(d, off);

        // Check if user has shares
        try {
          const ata = await getAssociatedTokenAddress(new PublicKey(shareMint), publicKey);
          const bal = await connection.getTokenAccountBalance(ata);
          const shares = BigInt(bal.value.amount);
          if (shares > 0n) {
            const value = totalShares > 0n
              ? Number(shares * totalDeposits / totalShares) / 1_000_000
              : 0;
            positions.push({
              vaultPda: pubkey.toBase58(), shareMint,
              shares, totalShares, totalDeposits,
              value, perfFeeBps, mgmtFeeBps,
            });
          }
        } catch { /* no ATA = no position */ }
      }

      setPositions(positions);
      setTotalValue(positions.reduce((sum, p) => sum + p.value, 0));
    } catch (e) {
      console.error("Failed to fetch positions:", e);
    } finally {
      setLoading(false);
    }
  }, [connection, publicKey]);

  useEffect(() => { fetchPositions(); }, [fetchPositions]);

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-2">Earn</h1>
        <p className="text-[var(--text-muted)]">
          Your positions across all Syntx. Deposit into vaults to earn yield from perp trading strategies.
        </p>
      </div>

      {!publicKey ? (
        <div className="panel p-12 text-center">
          <p className="text-[var(--text-muted)] mb-4">Connect your wallet to see your positions</p>
          <WalletMultiButton />
        </div>
      ) : loading ? (
        <div className="space-y-4">
          <div className="shimmer h-24 rounded-xl" />
          <div className="shimmer h-48 rounded-xl" />
        </div>
      ) : (
        <>
          {/* Portfolio Summary */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-[1px] bg-[var(--border)] rounded-xl overflow-hidden mb-8">
            <div className="bg-[var(--bg-panel)] p-6">
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-dim)] mb-2">Total Value</div>
              <div className="text-2xl font-semibold">${totalValue.toFixed(2)}</div>
            </div>
            <div className="bg-[var(--bg-panel)] p-6">
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-dim)] mb-2">Active Positions</div>
              <div className="text-2xl font-semibold">{positions.length}</div>
            </div>
            <div className="bg-[var(--bg-panel)] p-6">
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-dim)] mb-2">Wallet</div>
              <div className="text-sm font-mono text-[var(--text-muted)]">{short(publicKey.toBase58())}</div>
            </div>
          </div>

          {/* Positions */}
          {positions.length === 0 ? (
            <div className="panel p-12 text-center">
              <p className="text-[var(--text-muted)] mb-4">No positions yet</p>
              <a
                href="/vaults"
                className="inline-flex h-10 px-6 items-center bg-[var(--primary)] hover:bg-[var(--primary-hover)] rounded-lg text-sm font-medium transition"
              >
                Browse Vaults
              </a>
            </div>
          ) : (
            <div className="space-y-3">
              {positions.map((p) => {
                const sharePrice = p.totalShares > 0n ? Number(p.totalDeposits) / Number(p.totalShares) : 1;
                const pct = p.totalShares > 0n ? (Number(p.shares) / Number(p.totalShares) * 100) : 0;
                return (
                  <div key={p.vaultPda} className="panel p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm">{short(p.vaultPda)}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-950 text-[var(--green)]">ACTIVE</span>
                      </div>
                      <span className="text-lg font-semibold">${p.value.toFixed(2)}</span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                      <div>
                        <span className="text-[var(--text-dim)]">Shares</span>
                        <div className="font-mono mt-0.5">{p.shares.toLocaleString()}</div>
                      </div>
                      <div>
                        <span className="text-[var(--text-dim)]">Share Price</span>
                        <div className="font-mono mt-0.5">${sharePrice.toFixed(6)}</div>
                      </div>
                      <div>
                        <span className="text-[var(--text-dim)]">Share of Vault</span>
                        <div className="font-mono mt-0.5">{pct.toFixed(2)}%</div>
                      </div>
                      <div>
                        <span className="text-[var(--text-dim)]">Fees</span>
                        <div className="font-mono mt-0.5">{p.perfFeeBps / 100}% / {p.mgmtFeeBps / 100}%</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
