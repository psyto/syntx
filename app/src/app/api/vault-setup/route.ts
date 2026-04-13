import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

const RPC_URL = "https://api.devnet.solana.com";
const COLLATERAL_MINT = "AhGQVQm7HudP6eWekMDLZiZogwvnMPFGL5owZCHFGquC";

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
 * Mint registration fee tokens to a vault's collateral ATA.
 * Called after the user creates the share mint + vault collateral ATA,
 * but before register_on_percolator (which needs some collateral).
 */
export async function POST(req: NextRequest) {
  try {
    const { vaultCollateralAta } = await req.json();
    if (!vaultCollateralAta) {
      return NextResponse.json({ error: "Missing vaultCollateralAta" }, { status: 400 });
    }

    const admin = getAdminKeypair();
    if (!admin) {
      return NextResponse.json({ error: "Not configured" }, { status: 503 });
    }

    const connection = new Connection(RPC_URL, "confirmed");
    const mint = new PublicKey(COLLATERAL_MINT);
    const ata = new PublicKey(vaultCollateralAta);

    // Mint 10000 tokens (registration fee)
    const sig = await mintTo(connection, admin, mint, ata, admin, 10000);

    return NextResponse.json({ success: true, signature: sig });
  } catch (err: any) {
    console.error("Vault setup error:", err);
    return NextResponse.json({ error: err?.message?.slice(0, 200) || "Failed" }, { status: 500 });
  }
}
