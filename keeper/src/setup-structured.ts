/**
 * Deploy a Structured Product vault on devnet.
 *
 * Creates a new Syntx vault configured for the principal-protected strategy.
 * Kamino runs in simulation mode on devnet (no mainnet SDK needed).
 * Phoenix spot can use the devnet SOL/USDC market.
 *
 * Usage: npx ts-node src/setup-structured.ts
 *        npx ts-node src/setup-structured.ts --resume  (reuse existing mint/slab)
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import * as fs from "fs";
import { disc } from "./abi";

// ============================================================
// Config
// ============================================================

const RPC_URL = "https://api.devnet.solana.com";
const SYNTX_PROGRAM_ID = new PublicKey("53r6bg7JBFqf5Jfs7fe4kHDtwXwUgDWoLarYrsWcoF1V");
const PERCOLATOR_PROGRAM_ID = new PublicKey("Edq18N2pdT3Sz9EukbZe4YsQkvmxvmmkUL1KHpv96xJF");

// Reuse existing slab from the funding rate vault (same Percolator market)
const EXISTING_SLAB = new PublicKey("9Gh75RYAkN5wD97HtHo6Za6RwPReZSAcgNxtbvYy2jDF");
const EXISTING_COLLATERAL_MINT = new PublicKey("AhGQVQm7HudP6eWekMDLZiZogwvnMPFGL5owZCHFGquC");

// Phoenix devnet SOL/USDC market
const PHOENIX_DEVNET_MARKET = new PublicKey("4DoNfFBfF7UokCC2FQzriy7yHK6DY6NVdYpuekQ5pRgg");

// Amount of test USDC to mint to manager for demo (1000 USDC)
const DEMO_USDC_AMOUNT = 1_000_000_000; // 1000 * 10^6

function loadKeypair(filePath: string): Keypair {
  const expanded = filePath.replace("~", process.env.HOME || "");
  const raw = JSON.parse(fs.readFileSync(expanded, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function bufU16(v: number): Buffer { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; }
function bufU64(v: bigint): Buffer { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; }

// ============================================================
// Main
// ============================================================

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const admin = loadKeypair("~/.config/solana/id.json");
  console.log("Admin:", admin.publicKey.toBase58());

  const balance = await connection.getBalance(admin.publicKey);
  console.log("Balance:", balance / 1e9, "SOL");
  if (balance < 0.1 * 1e9) {
    console.log("\n⚠ Low balance. Run: solana airdrop 2");
    return;
  }

  const collateralMint = EXISTING_COLLATERAL_MINT;
  const slabPubkey = EXISTING_SLAB;
  console.log("Collateral mint:", collateralMint.toBase58());
  console.log("Percolator slab:", slabPubkey.toBase58());

  // --- Step 1: Create Syntx vault for structured product ---
  // Use a unique seed by adding a "structured" tag via a different manager
  // Actually, vault PDA = seeds["vault", mint, manager] — same manager + mint = same PDA
  // So we need a separate manager keypair OR a separate collateral mint
  // For simplicity, create a new collateral mint for the structured vault
  console.log("\n=== Step 1: Create structured vault collateral mint ===");
  let structuredMint: PublicKey;

  const resume = process.argv.includes("--resume");
  const resumeFile = "devnet-structured.json";

  if (resume && fs.existsSync(resumeFile)) {
    const existing = JSON.parse(fs.readFileSync(resumeFile, "utf-8"));
    structuredMint = new PublicKey(existing.collateralMint);
    console.log("Reusing mint:", structuredMint.toBase58());
  } else {
    structuredMint = await createMint(connection, admin, admin.publicKey, null, 6);
    console.log("New mint:", structuredMint.toBase58());
  }

  // --- Step 2: Derive vault PDA ---
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), structuredMint.toBuffer(), admin.publicKey.toBuffer()],
    SYNTX_PROGRAM_ID,
  );
  console.log("\n=== Step 2: Vault PDA ===");
  console.log("Vault PDA:", vaultPda.toBase58());

  // Check if vault already exists
  const vaultInfo = await connection.getAccountInfo(vaultPda);
  if (vaultInfo) {
    console.log("Vault already exists, skipping creation");
  } else {
    // Share mint
    const shareMint = await createMint(connection, admin, vaultPda, null, 6);
    console.log("Share mint:", shareMint.toBase58());

    // Vault collateral ATA
    const vaultCollateral = await getOrCreateAssociatedTokenAccount(
      connection, admin, structuredMint, vaultPda, true,
    );
    console.log("Vault collateral ATA:", vaultCollateral.address.toBase58());

    // Mint fee payment tokens
    await mintTo(connection, admin, structuredMint, vaultCollateral.address, admin, 10000);

    // --- Step 3: InitVault ---
    console.log("\n=== Step 3: InitVault ===");
    const initVaultData = Buffer.concat([
      Buffer.from(disc("init_vault")),
      bufU16(1000), // performance_fee_bps (10% — lower for structured product)
      bufU16(100),  // management_fee_bps (1%)
      bufU64(100_000_000_000n), // deposit_cap (100K USDC)
      bufU16(300),  // min_drawdown_bps (3% floor — tighter for principal protection)
    ]);

    const initVaultIx = new TransactionInstruction({
      programId: SYNTX_PROGRAM_ID,
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: structuredMint, isSigner: false, isWritable: false },
        { pubkey: shareMint, isSigner: false, isWritable: false },
        { pubkey: slabPubkey, isSigner: false, isWritable: false },
        { pubkey: PERCOLATOR_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: initVaultData,
    });

    const tx = new Transaction().add(initVaultIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [admin]);
    console.log("InitVault tx:", sig);

    // --- Step 4: RegisterOnPercolator ---
    console.log("\n=== Step 4: RegisterOnPercolator ===");
    const [percVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), slabPubkey.toBuffer()],
      PERCOLATOR_PROGRAM_ID,
    );
    const percVaultAta = await getOrCreateAssociatedTokenAccount(
      connection, admin, structuredMint, percVaultPda, true,
    );

    // Mint tokens to Percolator vault ATA for fee
    await mintTo(connection, admin, structuredMint, percVaultAta.address, admin, 10000);

    const registerData = Buffer.concat([
      Buffer.from(disc("register_on_percolator")),
      bufU64(1000n),
    ]);

    const registerIx = new TransactionInstruction({
      programId: SYNTX_PROGRAM_ID,
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: false },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: vaultCollateral.address, isSigner: false, isWritable: true },
        { pubkey: slabPubkey, isSigner: false, isWritable: true },
        { pubkey: percVaultAta.address, isSigner: false, isWritable: true },
        { pubkey: PERCOLATOR_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: registerData,
    });

    const tx2 = new Transaction().add(registerIx);
    const sig2 = await sendAndConfirmTransaction(connection, tx2, [admin]);
    console.log("RegisterOnPercolator tx:", sig2);

    // --- Step 5: SetPercolatorIdx ---
    console.log("\n=== Step 5: SetPercolatorIdx ===");
    const setIdxData = Buffer.concat([
      Buffer.from(disc("set_percolator_idx")),
      bufU16(0),
    ]);

    const setIdxIx = new TransactionInstruction({
      programId: SYNTX_PROGRAM_ID,
      keys: [
        { pubkey: admin.publicKey, isSigner: true, isWritable: false },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
      ],
      data: setIdxData,
    });

    const tx3 = new Transaction().add(setIdxIx);
    const sig3 = await sendAndConfirmTransaction(connection, tx3, [admin]);
    console.log("SetPercolatorIdx tx:", sig3);

    // Save vault info
    const vaultConfig = {
      network: "devnet",
      type: "structured-product",
      createdAt: new Date().toISOString(),
      syntxProgramId: SYNTX_PROGRAM_ID.toBase58(),
      percolatorProgramId: PERCOLATOR_PROGRAM_ID.toBase58(),
      slab: slabPubkey.toBase58(),
      collateralMint: structuredMint.toBase58(),
      vaultPda: vaultPda.toBase58(),
      shareMint: shareMint.toBase58(),
      vaultCollateral: vaultCollateral.address.toBase58(),
      phoenixMarket: PHOENIX_DEVNET_MARKET.toBase58(),
    };

    fs.writeFileSync(resumeFile, JSON.stringify(vaultConfig, null, 2));
    console.log("\nConfig saved to", resumeFile);
  }

  // --- Step 6: Mint demo USDC to manager ---
  console.log("\n=== Step 6: Fund manager with test USDC ===");
  const managerAta = await getOrCreateAssociatedTokenAccount(
    connection, admin, structuredMint, admin.publicKey,
  );
  await mintTo(connection, admin, structuredMint, managerAta.address, admin, DEMO_USDC_AMOUNT);
  console.log(`Minted ${DEMO_USDC_AMOUNT / 1_000_000} test USDC to manager`);

  // --- Output .env ---
  console.log("\n=== .env for structured keeper ===");
  console.log("---");
  const envLines = [
    `SOLANA_RPC_URL=${RPC_URL}`,
    `MANAGER_KEYPAIR_PATH=~/.config/solana/id.json`,
    `SYNTX_PROGRAM_ID=${SYNTX_PROGRAM_ID.toBase58()}`,
    `PERCOLATOR_PROGRAM_ID=${PERCOLATOR_PROGRAM_ID.toBase58()}`,
    `PERCOLATOR_SLAB=${slabPubkey.toBase58()}`,
    `VAULT_PDA=${vaultPda.toBase58()}`,
    `COLLATERAL_MINT=${structuredMint.toBase58()}`,
    `CRANK_INTERVAL_MS=30000`,
    ``,
    `# Structured product config`,
    `STRATEGY=structured`,
    `SPOT_VENUE=phoenix`,
    `PHOENIX_MARKET=${PHOENIX_DEVNET_MARKET.toBase58()}`,
    `PROTECTION_HORIZON_DAYS=30`,
  ];
  envLines.forEach(l => console.log(l));

  // Write .env.structured
  fs.writeFileSync(".env.structured", envLines.join("\n") + "\n");
  console.log("---");
  console.log("Saved to .env.structured");
  console.log("\nTo run: cp .env.structured .env && npx ts-node src/index.ts");
}

main().catch(console.error);
