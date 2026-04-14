"use client";

import { useEffect, useState, useCallback } from "react";
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
  MINT_SIZE,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import dynamic from "next/dynamic";
// (discriminators defined in CreateVaultForm section below)

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

// Known vault PDAs — overrides slab-based naming
const KNOWN_VAULTS: Record<string, { name: string; venue: string }> = {
  "H2Hvrz4sS4bcBFdD4s1GQ2dWWctfYh35uR2Qqi1H1reH": { name: "SOL Funding Rate", venue: "Percolator" },
  "93emRqQSrXrUREYys3g4yePJdewCMY56AoMZ4oxvHGWP": { name: "Principal Protected SOL", venue: "Kamino + Jupiter" },
};

function deriveVaultName(pubkey: string, slab: string, index: number): { name: string; venue: string } {
  const knownVault = KNOWN_VAULTS[pubkey];
  if (knownVault) return knownVault;
  const known = KNOWN_SLABS[slab];
  if (known) return known;
  return { name: `Strategy Vault #${index + 1}`, venue: "Unknown" };
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
// Create Vault Form — Full on-chain flow
// =============================================================================

// Pre-computed Anchor discriminators
const DISC_INIT_VAULT = new Uint8Array([0x4d, 0x4f, 0x55, 0x96, 0x21, 0xd9, 0x34, 0x6a]);
const DISC_REGISTER = new Uint8Array([0xf2, 0x93, 0xed, 0xd7, 0xe3, 0x33, 0xb9, 0x3f]);
const DISC_SET_IDX = new Uint8Array([0x2f, 0xc9, 0x6e, 0x3a, 0xa9, 0x5a, 0x26, 0x46]);

const DEFAULT_SLAB = "9Gh75RYAkN5wD97HtHo6Za6RwPReZSAcgNxtbvYy2jDF";
const DEFAULT_PERC = "Edq18N2pdT3Sz9EukbZe4YsQkvmxvmmkUL1KHpv96xJF";
const DEFAULT_MINT = "AhGQVQm7HudP6eWekMDLZiZogwvnMPFGL5owZCHFGquC";

function CreateVaultForm({ onCreated }: { onCreated: () => void }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [perfFee, setPerfFee] = useState("20");
  const [mgmtFee, setMgmtFee] = useState("2");
  const [minDrawdown, setMinDrawdown] = useState("5");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!publicKey) return null;

  const handleCreate = async () => {
    if (!publicKey) return;
    setStatus("Step 1/4: Creating share mint..."); setError(null);

    try {
      const colMint = new PublicKey(DEFAULT_MINT);
      const slabPk = new PublicKey(DEFAULT_SLAB);
      const percPk = new PublicKey(DEFAULT_PERC);

      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), colMint.toBuffer(), publicKey.toBuffer()],
        SYNTX_PROGRAM_ID,
      );

      // Check if vault already exists
      const existing = await connection.getAccountInfo(vaultPda);
      if (existing) {
        setError("Vault already exists for your wallet");
        setStatus(null);
        return;
      }

      // --- TX 1: Create share mint + vault collateral ATA ---
      const shareMintKeypair = Keypair.generate();
      const mintRent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);

      const tx1 = new Transaction();

      // Create mint account
      tx1.add(
        SystemProgram.createAccount({
          fromPubkey: publicKey,
          newAccountPubkey: shareMintKeypair.publicKey,
          lamports: mintRent,
          space: MINT_SIZE,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
          shareMintKeypair.publicKey,
          6, // decimals
          vaultPda, // mint authority = vault PDA
          null, // no freeze authority
        ),
      );

      // Create vault collateral ATA
      const vaultCol = await getAssociatedTokenAddress(colMint, vaultPda, true);
      try { await connection.getTokenAccountBalance(vaultCol); } catch {
        tx1.add(createAssociatedTokenAccountInstruction(publicKey, vaultCol, vaultPda, colMint));
      }

      setStatus("Step 1/4: Confirm share mint creation...");
      const sig1 = await sendTransaction(tx1, connection, { signers: [shareMintKeypair] });
      await connection.confirmTransaction(sig1, "confirmed");

      // --- API: Mint registration fee tokens to vault collateral ---
      setStatus("Step 2/4: Funding registration fee...");
      const setupResp = await fetch("/vaults/api/vault-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vaultCollateralAta: vaultCol.toBase58() }),
      });
      if (!setupResp.ok) {
        const data = await setupResp.json();
        throw new Error(data.error || "Failed to fund registration");
      }

      // --- TX 2: init_vault ---
      setStatus("Step 3/4: Confirm vault creation...");
      const perfFeeBps = Math.floor(parseFloat(perfFee) * 100);
      const mgmtFeeBps = Math.floor(parseFloat(mgmtFee) * 100);
      const minDrawdownBps = Math.floor(parseFloat(minDrawdown) * 100);

      const initData = new Uint8Array(8 + 2 + 2 + 8 + 2);
      const initView = new DataView(initData.buffer);
      initData.set(DISC_INIT_VAULT, 0);
      initView.setUint16(8, perfFeeBps, true);
      initView.setUint16(10, mgmtFeeBps, true);
      initView.setBigUint64(12, 10_000_000_000n, true); // deposit cap
      initView.setUint16(20, minDrawdownBps, true);

      const tx2 = new Transaction().add(new TransactionInstruction({
        programId: SYNTX_PROGRAM_ID,
        keys: [
          { pubkey: publicKey, isSigner: true, isWritable: true },
          { pubkey: vaultPda, isSigner: false, isWritable: true },
          { pubkey: colMint, isSigner: false, isWritable: false },
          { pubkey: shareMintKeypair.publicKey, isSigner: false, isWritable: false },
          { pubkey: slabPk, isSigner: false, isWritable: false },
          { pubkey: percPk, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: initData as any,
      }));

      const sig2 = await sendTransaction(tx2, connection);
      await connection.confirmTransaction(sig2, "confirmed");

      // --- TX 3: register_on_percolator + set_percolator_idx ---
      setStatus("Step 4/4: Confirm Percolator registration...");

      const [percVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), slabPk.toBuffer()], percPk,
      );
      const percVaultAta = await getAssociatedTokenAddress(colMint, percVaultPda, true);

      const regData = new Uint8Array(16);
      regData.set(DISC_REGISTER, 0);
      new DataView(regData.buffer).setBigUint64(8, 1000n, true); // fee_payment

      const idxData = new Uint8Array(10);
      idxData.set(DISC_SET_IDX, 0);
      // Need to find the correct user index — read from slab after register
      // For simplicity, use index based on numUsedAccounts
      new DataView(idxData.buffer).setUint16(8, 0, true); // will be overwritten

      const tx3 = new Transaction();
      tx3.add(new TransactionInstruction({
        programId: SYNTX_PROGRAM_ID,
        keys: [
          { pubkey: publicKey, isSigner: true, isWritable: false },
          { pubkey: vaultPda, isSigner: false, isWritable: true },
          { pubkey: vaultCol, isSigner: false, isWritable: true },
          { pubkey: slabPk, isSigner: false, isWritable: true },
          { pubkey: percVaultAta, isSigner: false, isWritable: true },
          { pubkey: percPk, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
        ],
        data: regData as any,
      }));

      const sig3 = await sendTransaction(tx3, connection);
      await connection.confirmTransaction(sig3, "confirmed");

      // TX 4: set_percolator_idx (separate because we need register to complete first)
      // Read the slab to find our account index
      const slabInfo = await connection.getAccountInfo(slabPk);
      let userIdx = 0;
      if (slabInfo) {
        // numUsedAccounts is at ENGINE_OFF(584) + 1120
        const numUsed = slabInfo.data[584 + 1120] | (slabInfo.data[584 + 1121] << 8);
        userIdx = numUsed - 1; // our account is the last one registered
      }

      const idxData2 = new Uint8Array(10);
      idxData2.set(DISC_SET_IDX, 0);
      new DataView(idxData2.buffer).setUint16(8, userIdx, true);

      const tx4 = new Transaction().add(new TransactionInstruction({
        programId: SYNTX_PROGRAM_ID,
        keys: [
          { pubkey: publicKey, isSigner: true, isWritable: false },
          { pubkey: vaultPda, isSigner: false, isWritable: true },
        ],
        data: idxData2 as any,
      }));

      const sig4 = await sendTransaction(tx4, connection);
      await connection.confirmTransaction(sig4, "confirmed");

      setStatus("Vault created!");
      setTimeout(() => { setStatus(null); onCreated(); }, 2000);

    } catch (e: any) {
      console.error("Create vault error:", e);
      const logs = e?.logs || e?.transactionLogs || [];
      const msg = logs.length > 0 ? logs.join("\n") : e?.message || "Failed";
      setError(msg.slice(0, 500));
      setStatus(null);
    }
  };

  return (
    <div className="panel p-5 space-y-3">
      <h4 className="text-sm font-medium">Create New Vault</h4>
      <p className="text-xs text-[var(--text-muted)]">
        Creates a new strategy vault on the SOL-PERP market. You become the vault manager.
        Requires 4 wallet confirmations.
      </p>

      {status && (
        <div className="text-xs font-mono bg-blue-950 text-[var(--primary)] rounded px-3 py-2">{status}</div>
      )}
      {error && (
        <div className="text-xs font-mono bg-red-950 text-[var(--red)] rounded px-3 py-2 whitespace-pre-line">{error}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
        <div>
          <label className="text-[10px] text-[var(--text-dim)] uppercase">Min Drawdown Floor (%)</label>
          <input
            type="number"
            value={minDrawdown}
            onChange={(e) => setMinDrawdown(e.target.value)}
            className="w-full mt-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-[var(--primary)]"
          />
        </div>
      </div>

      <button
        onClick={handleCreate}
        disabled={!!status}
        className="px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] disabled:bg-[var(--bg-card)] disabled:text-[var(--text-dim)] rounded-lg text-sm font-medium transition"
      >
        {status ? "Creating..." : "Create Vault"}
      </button>
    </div>
  );
}
