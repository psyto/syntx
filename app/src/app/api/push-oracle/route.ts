import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

const RPC_URL = "https://api.devnet.solana.com";
const PERCOLATOR_PROGRAM_ID = new PublicKey("Edq18N2pdT3Sz9EukbZe4YsQkvmxvmmkUL1KHpv96xJF");
const SLAB = new PublicKey("9Gh75RYAkN5wD97HtHo6Za6RwPReZSAcgNxtbvYy2jDF");
const PRICE_E6 = 130_000_000; // $130 SOL

function getAdminKeypair(): Keypair | null {
  const raw = process.env.FAUCET_KEYPAIR;
  if (!raw) return null;
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  } catch {
    return null;
  }
}

/**
 * Push oracle price so withdrawals work.
 * Must be called before withdraw — Percolator needs a fresh authority price.
 */
export async function POST(_req: NextRequest) {
  try {
    const admin = getAdminKeypair();
    if (!admin) {
      return NextResponse.json({ error: "Not configured" }, { status: 503 });
    }

    const connection = new Connection(RPC_URL, "confirmed");

    // PushOraclePrice: tag=17, price_e6(u64), timestamp(i64)
    const now = Math.floor(Date.now() / 1000) - 3; // slight past to avoid clock skew
    const data = Buffer.alloc(17);
    data.writeUInt8(17, 0);
    data.writeBigUInt64LE(BigInt(PRICE_E6), 1);
    data.writeBigInt64LE(BigInt(now), 9);

    const ix = new TransactionInstruction({
      programId: PERCOLATOR_PROGRAM_ID,
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: false },
        { pubkey: SLAB, isSigner: false, isWritable: true },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [admin]);

    return NextResponse.json({ success: true, price: PRICE_E6 / 1_000_000, signature: sig });
  } catch (err: any) {
    console.error("Push oracle error:", err);
    return NextResponse.json({ error: err?.message?.slice(0, 200) || "Failed" }, { status: 500 });
  }
}
