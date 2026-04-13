import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

const RPC_URL = "https://api.devnet.solana.com";
const COLLATERAL_MINT = "2uGTCDSfisKCTN2Yd8umXiWJzfRpWe8mhZM6WCK2vj8D"; // Vault 1 test USDC
const FAUCET_AMOUNT = 100_000_000; // 100 test USDC

// Rate limiting: 1 request per wallet per 5 minutes
const recentRequests = new Map<string, number>();
const RATE_LIMIT_MS = 5 * 60 * 1000;

function getAdminKeypair(): Keypair | null {
  const raw = process.env.FAUCET_KEYPAIR;
  if (!raw) return null;
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { wallet } = await req.json();
    if (!wallet) {
      return NextResponse.json({ error: "Missing wallet address" }, { status: 400 });
    }

    // Validate pubkey
    let userPubkey: PublicKey;
    try {
      userPubkey = new PublicKey(wallet);
    } catch {
      return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
    }

    // Rate limit
    const now = Date.now();
    const lastRequest = recentRequests.get(wallet);
    if (lastRequest && now - lastRequest < RATE_LIMIT_MS) {
      const waitSecs = Math.ceil((RATE_LIMIT_MS - (now - lastRequest)) / 1000);
      return NextResponse.json(
        { error: `Rate limited. Try again in ${waitSecs}s` },
        { status: 429 },
      );
    }

    const admin = getAdminKeypair();
    if (!admin) {
      return NextResponse.json(
        { error: "Faucet not configured. Set FAUCET_KEYPAIR env var." },
        { status: 503 },
      );
    }

    const connection = new Connection(RPC_URL, "confirmed");
    const mint = new PublicKey(COLLATERAL_MINT);

    // Send 0.05 SOL for gas fees (if user has less than 0.01 SOL)
    let solSent = false;
    try {
      const balance = await connection.getBalance(userPubkey);
      if (balance < 0.01 * LAMPORTS_PER_SOL) {
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: admin.publicKey,
            toPubkey: userPubkey,
            lamports: Math.floor(0.05 * LAMPORTS_PER_SOL),
          }),
        );
        await sendAndConfirmTransaction(connection, tx, [admin]);
        solSent = true;
      }
    } catch {
      // SOL transfer failed — continue with USDC mint anyway
    }

    // Create or get user's token account
    const ata = await getOrCreateAssociatedTokenAccount(
      connection, admin, mint, userPubkey,
    );

    // Mint test USDC
    const sig = await mintTo(
      connection, admin, mint, ata.address, admin, FAUCET_AMOUNT,
    );

    // Rate limit tracking
    recentRequests.set(wallet, now);

    return NextResponse.json({
      success: true,
      amount: FAUCET_AMOUNT / 1_000_000,
      token: "Test USDC",
      solSent,
      signature: sig,
      ata: ata.address.toBase58(),
    });
  } catch (err: any) {
    console.error("Faucet error:", err);
    return NextResponse.json(
      { error: err?.message?.slice(0, 200) || "Faucet failed" },
      { status: 500 },
    );
  }
}
