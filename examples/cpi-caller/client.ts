/**
 * Example: TypeScript client for CPI trading through a Syntx vault.
 *
 * Shows how to build a transaction that calls your program's hedge_via_syntx
 * instruction, which internally CPI calls Syntx's cpi_trade.
 *
 * NOTE: This is example code for reference.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SYSVAR_CLOCK_PUBKEY,
  Keypair,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createHash } from "crypto";

// Program IDs
const YOUR_PROGRAM_ID = new PublicKey("ExampleCpiCa11er1111111111111111111111111");
const SYNTX_PROGRAM_ID = new PublicKey("53r6bg7JBFqf5Jfs7fe4kHDtwXwUgDWoLarYrsWcoF1V");
const PERCOLATOR_PROGRAM_ID = new PublicKey("Edq18N2pdT3Sz9EukbZe4YsQkvmxvmmkUL1KHpv96xJF");

// Devnet addresses
const SYNTX_VAULT = new PublicKey("4pL2aQawAbc2XwjRE9ptrH4yxihn4BL2uVMavgZrtYUK");
const PERCOLATOR_SLAB = new PublicKey("J55KavPouZg8ZeWnTY77ZBL2DdQskzKpkFvuTtbUNzYC");

/** Anchor discriminator */
function disc(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

/** Encode i128 as 16 bytes LE */
function encodeI128(val: bigint): Buffer {
  let unsigned = val;
  if (val < 0n) unsigned = (1n << 128n) + val;
  const buf = Buffer.alloc(16);
  buf.writeBigUInt64LE(unsigned & 0xFFFFFFFFFFFFFFFFn, 0);
  buf.writeBigUInt64LE(unsigned >> 64n, 8);
  return buf;
}

/**
 * Build a hedge_via_syntx transaction.
 *
 * Your lending protocol calls this when a user borrows an asset,
 * opening a matching short through the Syntx vault atomically.
 */
function buildHedgeTransaction(
  authority: PublicKey,
  lpIdx: number,
  hedgeSize: bigint, // negative = short (e.g., -100_000n)
): Transaction {
  // Encode instruction data: disc + lp_idx(u16) + size(i128)
  const data = Buffer.concat([
    disc("hedge_via_syntx"),
    Buffer.from(new Uint8Array(new Uint16Array([lpIdx]).buffer)),
    encodeI128(hedgeSize),
  ]);

  const ix = new TransactionInstruction({
    programId: YOUR_PROGRAM_ID,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: SYNTX_VAULT, isSigner: false, isWritable: false },
      { pubkey: PERCOLATOR_SLAB, isSigner: false, isWritable: true },
      { pubkey: PERCOLATOR_SLAB, isSigner: false, isWritable: false }, // oracle = slab in authority mode
      { pubkey: PERCOLATOR_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });

  return new Transaction().add(ix);
}

// ---------------------------------------------------------------------------
// Usage example
// ---------------------------------------------------------------------------

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const authority = Keypair.generate(); // your program's authority

  // User borrows 100 SOL → open a 100-unit short hedge
  const hedgeSize = -100_000n; // negative = short
  const lpIdx = 1; // LP account index on Percolator

  const tx = buildHedgeTransaction(authority.publicKey, lpIdx, hedgeSize);

  console.log("Hedge transaction built:");
  console.log("  Authority:", authority.publicKey.toBase58());
  console.log("  Syntx Vault:", SYNTX_VAULT.toBase58());
  console.log("  Hedge size:", hedgeSize.toString(), "(short)");
  console.log("  LP index:", lpIdx);

  // In production, sign and send:
  // const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
  // console.log("Hedge opened:", sig);
}

main().catch(console.error);
