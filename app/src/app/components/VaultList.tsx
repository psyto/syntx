"use client";

import { useEffect, useState, useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import dynamic from "next/dynamic";

const VaultDashboard = dynamic(() => import("./VaultDashboard"), { ssr: false });

const SYNTX_PROGRAM_ID = new PublicKey("53r6bg7JBFqf5Jfs7fe4kHDtwXwUgDWoLarYrsWcoF1V");

// Anchor account discriminator for VaultState
const VAULT_DISC = new Uint8Array([
  0xe4, 0xc4, 0x52, 0xa5, 0x62, 0xd2, 0xeb, 0x98,
]);

// Read helpers
function readU16LE(d: Uint8Array, off: number): number {
  return d[off] | (d[off + 1] << 8);
}
function readU64LE(d: Uint8Array, off: number): bigint {
  const lo = BigInt(d[off]) | (BigInt(d[off+1]) << 8n) | (BigInt(d[off+2]) << 16n) | (BigInt(d[off+3]) << 24n);
  const hi = BigInt(d[off+4]) | (BigInt(d[off+5]) << 8n) | (BigInt(d[off+6]) << 16n) | (BigInt(d[off+7]) << 24n);
  return lo | (hi << 32n);
}

interface VaultEntry {
  pubkey: string;
  name: string;
  venue: string;
  manager: string;
  collateralMint: string;
  slab: string;
  totalShares: bigint;
  totalDeposits: bigint;
  perfFeeBps: number;
  mgmtFeeBps: number;
  paused: boolean;
  initialized: boolean;
}

// Derive human-readable vault name from on-chain state
const KNOWN_SLABS: Record<string, { name: string; venue: string }> = {
  "9Gh75RYAkN5wD97HtHo6Za6RwPReZSAcgNxtbvYy2jDF": { name: "SOL Funding Rate", venue: "Percolator" },
  // Legacy slabs (pre-timelock program)
  "J55KavPouZg8ZeWnTY77ZBL2DdQskzKpkFvuTtbUNzYC": { name: "SOL Funding Rate (v1)", venue: "Percolator" },
  "B3SbXLH9YBRLuoMkUXyowrpZjpfQDZ7WZeUUt42pnqDQ": { name: "SOL Delta Neutral (v1)", venue: "Percolator" },
};

function deriveVaultName(pubkey: string, slab: string, index: number): { name: string; venue: string } {
  const known = KNOWN_SLABS[slab];
  if (known) return known;
  return { name: `Strategy Vault #${index + 1}`, venue: "Percolator" };
}

function parseVaultEntry(pubkey: PublicKey, data: Uint8Array, index: number): VaultEntry | null {
  if (data.length < 200) return null;
  // Skip old vaults — current program creates 309-byte accounts
  if (data.length < 300) return null;
  // Verify discriminator
  for (let i = 0; i < 8; i++) {
    if (data[i] !== VAULT_DISC[i]) return null;
  }
  let off = 9; // disc(8) + bump(1)
  const manager = new PublicKey(data.slice(off, off + 32)).toBase58(); off += 32;
  const collateralMint = new PublicKey(data.slice(off, off + 32)).toBase58(); off += 32;
  off += 32; // share_mint
  off += 32; // percolator_program
  const slab = new PublicKey(data.slice(off, off + 32)).toBase58(); off += 32;
  off += 2; // user_idx
  const totalShares = readU64LE(data, off); off += 8;
  const totalDeposits = readU64LE(data, off); off += 8;
  const perfFeeBps = readU16LE(data, off); off += 2;
  const mgmtFeeBps = readU16LE(data, off); off += 2;
  off += 16; // HWM + lastFeeCollection
  off += 8; // deposit_cap
  const paused = data[off] !== 0; off += 1;
  const initialized = data[off] !== 0;

  const pk = pubkey.toBase58();
  const { name, venue } = deriveVaultName(pk, slab, index);

  return {
    pubkey: pk, name, venue, manager, collateralMint, slab,
    totalShares, totalDeposits, perfFeeBps, mgmtFeeBps, paused, initialized,
  };
}

function short(addr: string): string {
  return addr.slice(0, 4) + "..." + addr.slice(-4);
}

export default function VaultList() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [vaults, setVaults] = useState<VaultEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedVault, setExpandedVault] = useState<string | null>(null);

  const fetchVaults = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const accounts = await connection.getProgramAccounts(SYNTX_PROGRAM_ID, {
        dataSlice: { offset: 0, length: 320 },
      });

      const parsed: VaultEntry[] = [];
      for (let i = 0; i < accounts.length; i++) {
        const { pubkey, account } = accounts[i];
        const entry = parseVaultEntry(pubkey, new Uint8Array(account.data), i);
        if (entry) parsed.push(entry);
      }
      setVaults(parsed);
    } catch (e: any) {
      console.error("Failed to fetch vaults:", e);
      setError(e?.message?.includes("fetch") || e?.message?.includes("429")
        ? "Devnet RPC is temporarily unavailable. Please try again in a moment."
        : "Failed to load vaults. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }, [connection]);

  useEffect(() => {
    fetchVaults();
  }, [fetchVaults]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-mono uppercase tracking-wider text-[var(--text-dim)]">
          All Vaults ({vaults.length})
        </h3>
        {publicKey && (
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="text-xs px-3 py-1.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] rounded-lg transition"
          >
            + Create Vault
          </button>
        )}
      </div>

      {showCreate && publicKey && (
        <CreateVaultForm
          onCreated={() => { setShowCreate(false); fetchVaults(); }}
        />
      )}

      {error ? (
        <div className="panel p-6 text-center">
          <div className="text-sm text-[var(--text-muted)] mb-3">{error}</div>
          <button
            onClick={fetchVaults}
            className="text-xs px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] rounded-lg transition"
          >
            Retry
          </button>
        </div>
      ) : loading ? (
        <div className="space-y-2">
          <div className="shimmer h-20 rounded-xl" />
          <div className="shimmer h-20 rounded-xl" />
        </div>
      ) : vaults.length === 0 ? (
        <div className="panel p-6 text-center text-[var(--text-dim)]">
          No vaults found. Create the first one!
        </div>
      ) : (
        <div className="space-y-2">
          {vaults.map((v) => {
            const isExpanded = expandedVault === v.pubkey;
            return (
              <div key={v.pubkey} className="panel overflow-hidden">
                {/* Vault Header — click to toggle */}
                <button
                  onClick={() => setExpandedVault(isExpanded ? null : v.pubkey)}
                  className="w-full p-4 text-left hover:bg-[var(--bg-card)] transition"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[var(--text-dim)] mr-1">{isExpanded ? "▼" : "▶"}</span>
                      <span className="font-semibold text-sm">{v.name}</span>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-950 text-blue-400">
                        {v.venue}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${v.initialized ? (v.paused ? "bg-red-950 text-[var(--red)]" : "bg-green-950 text-[var(--green)]") : "bg-yellow-950 text-yellow-400"}`}>
                        {v.initialized ? (v.paused ? "PAUSED" : "ACTIVE") : "SETUP"}
                      </span>
                    </div>
                    <span className="text-xs text-[var(--text-dim)]">
                      {v.perfFeeBps / 100}% perf / {v.mgmtFeeBps / 100}% mgmt
                    </span>
                  </div>
                  <div className="flex gap-6 text-xs text-[var(--text-muted)]">
                    <span>TVL: {(Number(v.totalDeposits) / 1_000_000).toFixed(2)} USDC</span>
                    <span>Shares: {v.totalShares.toLocaleString()}</span>
                    <span>Manager: {short(v.manager)}</span>
                    <span className="font-mono text-[var(--text-dim)]">{short(v.pubkey)}</span>
                  </div>
                </button>

                {/* Expanded: Vault Dashboard */}
                {isExpanded && (
                  <div className="border-t border-[var(--border)] p-4 bg-[var(--bg)]">
                    <VaultDashboard vaultPda={v.pubkey} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Create Vault Form
// =============================================================================

function CreateVaultForm({ onCreated }: { onCreated: () => void }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [slab, setSlab] = useState("");
  const [percProgram, setPercProgram] = useState("Edq18N2pdT3Sz9EukbZe4YsQkvmxvmmkUL1KHpv96xJF");
  const [collateralMint, setCollateralMint] = useState("2uGTCDSfisKCTN2Yd8umXiWJzfRpWe8mhZM6WCK2vj8D");
  const [perfFee, setPerfFee] = useState("20");
  const [mgmtFee, setMgmtFee] = useState("2");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!publicKey) return null;

  const handleCreate = async () => {
    if (!slab || !publicKey) return;
    setStatus("Creating vault..."); setError(null);

    try {
      const mint = new PublicKey(collateralMint);
      const slabPk = new PublicKey(slab);
      const percPk = new PublicKey(percProgram);

      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), mint.toBuffer(), publicKey.toBuffer()],
        SYNTX_PROGRAM_ID,
      );

      // Check if vault already exists
      const existing = await connection.getAccountInfo(vaultPda);
      if (existing) {
        setError("Vault already exists for this mint + manager combination");
        setStatus(null);
        return;
      }

      // Create share mint with vault PDA as authority
      // This requires a separate transaction first
      setStatus("Creating share mint...");

      // We need to use a pre-created mint. For now, guide user.
      setError(
        "Create vault via CLI: cd keeper && npx ts-node src/setup-devnet.ts\n" +
        "Vault PDA: " + vaultPda.toBase58()
      );
      setStatus(null);

    } catch (e: any) {
      setError(e?.message?.slice(0, 200) || "Failed");
      setStatus(null);
    }
  };

  return (
    <div className="panel p-5 space-y-3">
      <h4 className="text-sm font-medium">Create New Vault</h4>

      {status && (
        <div className="text-xs font-mono bg-blue-950 text-[var(--primary)] rounded px-3 py-2">{status}</div>
      )}
      {error && (
        <div className="text-xs font-mono bg-red-950 text-[var(--red)] rounded px-3 py-2 whitespace-pre-line">{error}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-[var(--text-dim)] uppercase">Percolator Slab</label>
          <input
            value={slab}
            onChange={(e) => setSlab(e.target.value)}
            placeholder="Slab pubkey"
            className="w-full mt-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-[var(--primary)]"
          />
        </div>
        <div>
          <label className="text-[10px] text-[var(--text-dim)] uppercase">Collateral Mint</label>
          <input
            value={collateralMint}
            onChange={(e) => setCollateralMint(e.target.value)}
            className="w-full mt-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-[var(--primary)]"
          />
        </div>
        <div>
          <label className="text-[10px] text-[var(--text-dim)] uppercase">Performance Fee (%)</label>
          <input
            type="number"
            value={perfFee}
            onChange={(e) => setPerfFee(e.target.value)}
            className="w-full mt-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-[var(--primary)]"
          />
        </div>
        <div>
          <label className="text-[10px] text-[var(--text-dim)] uppercase">Management Fee (%/yr)</label>
          <input
            type="number"
            value={mgmtFee}
            onChange={(e) => setMgmtFee(e.target.value)}
            className="w-full mt-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-[var(--primary)]"
          />
        </div>
      </div>

      <button
        onClick={handleCreate}
        disabled={!slab}
        className="px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:bg-[var(--bg-card)] disabled:text-[var(--text-dim)] rounded-lg text-sm font-medium transition"
      >
        Create Vault
      </button>
    </div>
  );
}
