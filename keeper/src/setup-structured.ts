/**
 * Deploy a Structured Product vault on devnet.
 *
 * Uses the existing Percolator slab + collateral mint from the funding rate vault,
 * but with a separate manager keypair to get a different vault PDA.
 *
 * Usage: npx ts-node src/setup-structured.ts
 *        npx ts-node src/setup-structured.ts --resume
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
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
// Config — reuse existing infra
// ============================================================

const RPC_URL = "https://api.devnet.solana.com";
const SYNTX_PROGRAM_ID = new PublicKey("53r6bg7JBFqf5Jfs7fe4kHDtwXwUgDWoLarYrsWcoF1V");
const PERCOLATOR_PROGRAM_ID = new PublicKey("Edq18N2pdT3Sz9EukbZe4YsQkvmxvmmkUL1KHpv96xJF");

// Reuse from existing funding rate vault deployment
const EXISTING_SLAB = new PublicKey("9Gh75RYAkN5wD97HtHo6Za6RwPReZSAcgNxtbvYy2jDF");
const EXISTING_COLLATERAL_MINT = new PublicKey("AhGQVQm7HudP6eWekMDLZiZogwvnMPFGL5owZCHFGquC");

// Phoenix devnet SOL/USDC market
const PHOENIX_DEVNET_MARKET = new PublicKey("4DoNfFBfF7UokCC2FQzriy7yHK6DY6NVdYpuekQ5pRgg");

const DEMO_USDC_AMOUNT = 1_000_000_000; // 1000 USDC
const RESUME_FILE = "devnet-structured.json";
const MANAGER_KEY_FILE = "structured-manager.json";

// ============================================================
// Helpers
// ============================================================

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
  console.log("Admin (mint authority):", admin.publicKey.toBase58());

  const balance = await connection.getBalance(admin.publicKey);
  console.log("Balance:", balance / 1e9, "SOL");

  const resume = process.argv.includes("--resume");

  if (resume && fs.existsSync(RESUME_FILE)) {
    const existing = JSON.parse(fs.readFileSync(RESUME_FILE, "utf-8"));
    console.log("\nResuming from", RESUME_FILE);
    console.log("Vault PDA:", existing.vaultPda);
    printEnv(existing);
    return;
  }

  // --- Step 1: Create or load manager keypair ---
  console.log("\n=== Step 1: Manager keypair ===");
  let manager: Keypair;
  if (fs.existsSync(MANAGER_KEY_FILE)) {
    manager = loadKeypair(MANAGER_KEY_FILE);
    console.log("Loaded existing manager:", manager.publicKey.toBase58());
  } else {
    manager = Keypair.generate();
    fs.writeFileSync(MANAGER_KEY_FILE, JSON.stringify(Array.from(manager.secretKey)));
    console.log("Generated new manager:", manager.publicKey.toBase58());
    console.log("Saved to", MANAGER_KEY_FILE);
  }

  // Fund manager with SOL for transactions
  const managerBalance = await connection.getBalance(manager.publicKey);
  if (managerBalance < 0.1 * 1e9) {
    console.log("Funding manager with 0.5 SOL...");
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: manager.publicKey,
        lamports: 0.5 * 1e9,
      }),
    );
    await sendAndConfirmTransaction(connection, tx, [admin]);
    console.log("Manager funded");
  }

  const collateralMint = EXISTING_COLLATERAL_MINT;
  const slabPubkey = EXISTING_SLAB;
  console.log("Collateral mint:", collateralMint.toBase58());
  console.log("Percolator slab:", slabPubkey.toBase58());

  // --- Step 2: Derive vault PDA (different from funding rate vault due to different manager) ---
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), collateralMint.toBuffer(), manager.publicKey.toBuffer()],
    SYNTX_PROGRAM_ID,
  );
  console.log("\n=== Step 2: Vault PDA ===");
  console.log("Vault PDA:", vaultPda.toBase58());

  // Check if already exists
  const vaultInfo = await connection.getAccountInfo(vaultPda);
  if (vaultInfo) {
    console.log("Vault already exists!");
    const config = JSON.parse(fs.readFileSync(RESUME_FILE, "utf-8"));
    printEnv(config);
    return;
  }

  // --- Step 3: Create share mint (manager is NOT the authority — vault PDA is) ---
  console.log("\n=== Step 3: Create share mint ===");
  const shareMint = await createMint(connection, admin, vaultPda, null, 6);
  console.log("Share mint:", shareMint.toBase58());

  // --- Step 4: Create vault collateral ATA ---
  const vaultCollateral = await getOrCreateAssociatedTokenAccount(
    connection, admin, collateralMint, vaultPda, true,
  );
  console.log("Vault collateral ATA:", vaultCollateral.address.toBase58());

  // Mint fee payment tokens to vault
  await mintTo(connection, admin, collateralMint, vaultCollateral.address, admin, 10000);

  // --- Step 5: InitVault (manager signs) ---
  console.log("\n=== Step 4: InitVault ===");
  const initVaultData = Buffer.concat([
    Buffer.from(disc("init_vault")),
    bufU16(1000), // performance_fee_bps (10%)
    bufU16(100),  // management_fee_bps (1%)
    bufU64(100_000_000_000n), // deposit_cap (100K USDC)
    bufU16(300),  // min_drawdown_bps (3%)
  ]);

  const initVaultIx = new TransactionInstruction({
    programId: SYNTX_PROGRAM_ID,
    keys: [
      { pubkey: manager.publicKey, isSigner: true, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: collateralMint, isSigner: false, isWritable: false },
      { pubkey: shareMint, isSigner: false, isWritable: false },
      { pubkey: slabPubkey, isSigner: false, isWritable: false },
      { pubkey: PERCOLATOR_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: initVaultData,
  });

  const tx3 = new Transaction().add(initVaultIx);
  const sig3 = await sendAndConfirmTransaction(connection, tx3, [manager]);
  console.log("InitVault tx:", sig3);

  // --- Step 6: RegisterOnPercolator ---
  console.log("\n=== Step 5: RegisterOnPercolator ===");
  const [percVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), slabPubkey.toBuffer()],
    PERCOLATOR_PROGRAM_ID,
  );
  const percVaultAta = await getOrCreateAssociatedTokenAccount(
    connection, admin, collateralMint, percVaultPda, true,
  );

  const registerData = Buffer.concat([
    Buffer.from(disc("register_on_percolator")),
    bufU64(1000n),
  ]);

  const registerIx = new TransactionInstruction({
    programId: SYNTX_PROGRAM_ID,
    keys: [
      { pubkey: manager.publicKey, isSigner: true, isWritable: false },
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

  const tx4 = new Transaction().add(registerIx);
  const sig4 = await sendAndConfirmTransaction(connection, tx4, [manager]);
  console.log("RegisterOnPercolator tx:", sig4);

  // --- Step 7: SetPercolatorIdx ---
  console.log("\n=== Step 6: SetPercolatorIdx ===");
  // Second user on this slab (funding rate vault = idx 0, structured = idx 1)
  const setIdxData = Buffer.concat([
    Buffer.from(disc("set_percolator_idx")),
    bufU16(1), // index 1
  ]);

  const setIdxIx = new TransactionInstruction({
    programId: SYNTX_PROGRAM_ID,
    keys: [
      { pubkey: manager.publicKey, isSigner: true, isWritable: false },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
    ],
    data: setIdxData,
  });

  const tx5 = new Transaction().add(setIdxIx);
  const sig5 = await sendAndConfirmTransaction(connection, tx5, [manager]);
  console.log("SetPercolatorIdx tx:", sig5);

  // --- Step 8: Fund manager with test USDC ---
  console.log("\n=== Step 7: Fund manager with test USDC ===");
  const managerUsdcAta = await getOrCreateAssociatedTokenAccount(
    connection, admin, collateralMint, manager.publicKey,
  );
  await mintTo(connection, admin, collateralMint, managerUsdcAta.address, admin, DEMO_USDC_AMOUNT);
  console.log(`Minted ${DEMO_USDC_AMOUNT / 1_000_000} test USDC to manager`);

  // --- Save config ---
  const config = {
    network: "devnet",
    type: "structured-product",
    createdAt: new Date().toISOString(),
    syntxProgramId: SYNTX_PROGRAM_ID.toBase58(),
    percolatorProgramId: PERCOLATOR_PROGRAM_ID.toBase58(),
    slab: slabPubkey.toBase58(),
    collateralMint: collateralMint.toBase58(),
    vaultPda: vaultPda.toBase58(),
    shareMint: shareMint.toBase58(),
    vaultCollateral: vaultCollateral.address.toBase58(),
    managerPubkey: manager.publicKey.toBase58(),
    managerKeypairFile: MANAGER_KEY_FILE,
    phoenixMarket: PHOENIX_DEVNET_MARKET.toBase58(),
    percolatorUserIdx: 1,
  };

  fs.writeFileSync(RESUME_FILE, JSON.stringify(config, null, 2));
  console.log("\nConfig saved to", RESUME_FILE);

  printEnv(config);
}

function printEnv(config: any) {
  const managerPath = config.managerKeypairFile
    ? `${process.cwd()}/${config.managerKeypairFile}`
    : "~/.config/solana/id.json";

  console.log("\n=== .env for structured keeper ===");
  const envLines = [
    `SOLANA_RPC_URL=${RPC_URL}`,
    `MANAGER_KEYPAIR_PATH=${managerPath}`,
    `SYNTX_PROGRAM_ID=${config.syntxProgramId}`,
    `PERCOLATOR_PROGRAM_ID=${config.percolatorProgramId}`,
    `PERCOLATOR_SLAB=${config.slab}`,
    `VAULT_PDA=${config.vaultPda}`,
    `COLLATERAL_MINT=${config.collateralMint}`,
    `CRANK_INTERVAL_MS=30000`,
    ``,
    `# Structured product config`,
    `STRATEGY=structured`,
    `SPOT_VENUE=phoenix`,
    `PHOENIX_MARKET=${config.phoenixMarket}`,
    `PROTECTION_HORIZON_DAYS=30`,
  ];
  envLines.forEach(l => console.log(l));

  fs.writeFileSync(".env.structured", envLines.join("\n") + "\n");
  console.log("\nSaved to .env.structured");

  console.log("\n=== Frontend env vars (add to app/.env.local) ===");
  console.log(`NEXT_PUBLIC_STRUCTURED_VAULT_PDA=${config.vaultPda}`);
  console.log(`NEXT_PUBLIC_STRUCTURED_COLLATERAL_MINT=${config.collateralMint}`);
  console.log(`NEXT_PUBLIC_STRUCTURED_SHARE_MINT=${config.shareMint}`);
  console.log(`NEXT_PUBLIC_STRUCTURED_SLAB=${config.slab}`);

  console.log("\nTo run keeper: cp .env.structured .env && npx ts-node src/index.ts");
}

main().catch(console.error);
