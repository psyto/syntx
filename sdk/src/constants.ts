import { PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";

/** Default Syntx vault program ID (devnet) */
export const SYNTX_PROGRAM_ID = new PublicKey("53r6bg7JBFqf5Jfs7fe4kHDtwXwUgDWoLarYrsWcoF1V");

/** Anchor instruction discriminator: sha256("global:<name>")[..8] */
export function disc(name: string): Buffer {
  const hash = createHash("sha256").update(`global:${name}`).digest();
  return hash.subarray(0, 8);
}

/** Derive vault PDA */
export function deriveVaultPda(
  collateralMint: PublicKey,
  manager: PublicKey,
  programId: PublicKey = SYNTX_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), collateralMint.toBuffer(), manager.toBuffer()],
    programId,
  );
}
