import { Connection, PublicKey } from "@solana/web3.js";
import { VaultState } from "./types";

// Anchor account discriminator for VaultState
// sha256("account:VaultState")[..8]
import { createHash } from "crypto";
const VAULT_STATE_DISC = createHash("sha256").update("account:VaultState").digest().subarray(0, 8);

/**
 * Parse VaultState from raw account data.
 * Layout: disc(8) + bump(1) + manager(32) + collateral_mint(32) + share_mint(32)
 *         + percolator_program(32) + percolator_slab(32) + percolator_user_idx(2)
 *         + total_shares(8) + total_deposits(8)
 *         + performance_fee_bps(2) + management_fee_bps(2)
 *         + high_water_mark(8) + last_fee_collection(8)
 *         + deposit_cap(8) + paused(1) + initialized(1)
 */
export function parseVaultState(data: Buffer): VaultState {
  // Verify discriminator
  const actualDisc = data.subarray(0, 8);
  if (Buffer.compare(actualDisc, VAULT_STATE_DISC) !== 0) {
    throw new Error("Invalid VaultState discriminator");
  }

  let off = 8;

  const bump = data.readUInt8(off); off += 1;
  const manager = new PublicKey(data.subarray(off, off + 32)); off += 32;
  const collateralMint = new PublicKey(data.subarray(off, off + 32)); off += 32;
  const shareMint = new PublicKey(data.subarray(off, off + 32)); off += 32;
  const percolatorProgram = new PublicKey(data.subarray(off, off + 32)); off += 32;
  const percolatorSlab = new PublicKey(data.subarray(off, off + 32)); off += 32;
  const percolatorUserIdx = data.readUInt16LE(off); off += 2;

  // Anchor pads u16 to u64 alignment — check if there's padding
  // Actually Anchor with InitSpace packs tightly. Let's read as packed.
  const totalShares = data.readBigUInt64LE(off); off += 8;
  const totalDeposits = data.readBigUInt64LE(off); off += 8;
  const performanceFeeBps = data.readUInt16LE(off); off += 2;
  const managementFeeBps = data.readUInt16LE(off); off += 2;
  const highWaterMark = data.readBigUInt64LE(off); off += 8;
  const lastFeeCollection = data.readBigInt64LE(off); off += 8;
  const depositCap = data.readBigUInt64LE(off); off += 8;
  const paused = data.readUInt8(off) !== 0; off += 1;
  const initialized = data.readUInt8(off) !== 0; off += 1;

  return {
    bump, manager, collateralMint, shareMint,
    percolatorProgram, percolatorSlab, percolatorUserIdx,
    totalShares, totalDeposits,
    performanceFeeBps, managementFeeBps,
    highWaterMark, lastFeeCollection: BigInt(lastFeeCollection),
    depositCap, paused, initialized,
  };
}

/**
 * Fetch and parse VaultState from chain.
 */
export async function fetchVaultState(
  connection: Connection,
  vaultPda: PublicKey,
): Promise<VaultState> {
  const info = await connection.getAccountInfo(vaultPda);
  if (!info) throw new Error(`Vault not found: ${vaultPda.toBase58()}`);
  return parseVaultState(Buffer.from(info.data));
}

/**
 * Discover all Syntx vaults by scanning program accounts.
 * Returns vault PDAs + parsed state.
 */
export async function fetchAllVaults(
  connection: Connection,
  programId: PublicKey,
): Promise<{ pubkey: PublicKey; state: VaultState }[]> {
  const accounts = await connection.getProgramAccounts(programId, {
    filters: [
      { memcmp: { offset: 0, bytes: VAULT_STATE_DISC.toString("base64") } },
    ],
  });

  const vaults: { pubkey: PublicKey; state: VaultState }[] = [];
  for (const { pubkey, account } of accounts) {
    try {
      const state = parseVaultState(Buffer.from(account.data));
      vaults.push({ pubkey, state });
    } catch {
      // skip malformed accounts
    }
  }
  return vaults;
}
