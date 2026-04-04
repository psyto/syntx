/**
 * Full devnet setup: Create Percolator slab + market, then Syntx vault.
 *
 * Usage: npx ts-node src/setup-devnet.ts
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
  createAssociatedTokenAccount,
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

// Production SLAB_LEN for MAX_ACCOUNTS=4096 (latest Percolator)
// Percolator must be built WITHOUT --features test for real CPI to work
const SLAB_LEN = 1_156_800;

// SOL/USD Pyth feed ID (devnet)
const SOL_USD_FEED_ID = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

function loadKeypair(filePath: string): Keypair {
  const expanded = filePath.replace("~", process.env.HOME || "");
  const raw = JSON.parse(fs.readFileSync(expanded, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function feedIdToBytes(hex: string): number[] {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    bytes.push(parseInt(clean.substring(i, i + 2), 16));
  }
  return bytes;
}

// ============================================================
// Percolator instruction encoders (matching latest version)
// ============================================================

function encodeInitMarket(admin: PublicKey, mint: PublicKey, feedId: string): Buffer {
  const feedBytes = feedIdToBytes(feedId);
  const parts: Buffer[] = [];

  parts.push(Buffer.from([0])); // tag
  parts.push(admin.toBuffer()); // admin
  parts.push(mint.toBuffer()); // collateral_mint
  parts.push(Buffer.from(feedBytes)); // index_feed_id (32 bytes)

  // max_staleness_secs (u64)
  const buf8 = Buffer.alloc(8);
  buf8.writeBigUInt64LE(BigInt("18446744073709551615")); // u64::MAX
  parts.push(buf8);

  // conf_filter_bps (u16)
  const buf2 = Buffer.alloc(2);
  buf2.writeUInt16LE(500);
  parts.push(buf2);

  parts.push(Buffer.from([0])); // invert = 0

  // unit_scale (u32)
  const buf4 = Buffer.alloc(4);
  buf4.writeUInt32LE(0);
  parts.push(buf4);

  // initial_mark_price_e6 (u64) = 0 for non-Hyperp
  parts.push(Buffer.alloc(8));

  // Per-market admin limits
  parts.push(bufU128(100_000_000_000_000_000_000n)); // max_maintenance_fee_per_slot
  parts.push(bufU128(10_000_000_000_000_000n));       // max_insurance_floor

  // min_oracle_price_cap_e2bps (u64) = 0
  parts.push(Buffer.alloc(8));

  // RiskParams
  parts.push(bufU64(0n));    // warmup_period_slots
  parts.push(bufU64(500n));  // maintenance_margin_bps
  parts.push(bufU64(1000n)); // initial_margin_bps
  parts.push(bufU64(10n));   // trading_fee_bps (0.1%)
  parts.push(bufU64(4096n)); // max_accounts (production)
  parts.push(bufU128(0n));   // new_account_fee
  parts.push(bufU128(0n));   // risk_reduction_threshold
  parts.push(bufU128(0n));   // maintenance_fee_per_slot
  parts.push(bufU64(BigInt("18446744073709551615"))); // max_crank_staleness_slots
  parts.push(bufU64(50n));   // liquidation_fee_bps
  parts.push(bufU128(1_000_000_000_000n)); // liquidation_fee_cap
  parts.push(bufU64(100n));  // liquidation_buffer_bps
  parts.push(bufU128(0n));   // min_liquidation_abs
  parts.push(bufU128(100n)); // min_initial_deposit
  parts.push(bufU128(1n));   // min_nonzero_mm_req
  parts.push(bufU128(2n));   // min_nonzero_im_req

  // Omit extended tail — Percolator uses defaults when rest.is_empty()

  return Buffer.concat(parts);
}

function bufU16(v: number): Buffer { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; }
function bufU64(v: bigint): Buffer { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; }
function bufI64(v: bigint): Buffer { const b = Buffer.alloc(8); b.writeBigInt64LE(v); return b; }
function bufU128(v: bigint): Buffer {
  const b = Buffer.alloc(16);
  b.writeBigUInt64LE(v & 0xFFFFFFFFFFFFFFFFn, 0);
  b.writeBigUInt64LE(v >> 64n, 8);
  return b;
}

// ============================================================
// Main
// ============================================================

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const admin = loadKeypair("~/.config/solana/id.json");
  console.log("Admin:", admin.publicKey.toBase58());
  console.log("Balance:", (await connection.getBalance(admin.publicKey)) / 1e9, "SOL");

  // Check for --resume flag to skip slab/mint creation
  const resume = process.argv.includes("--resume");

  let collateralMint!: PublicKey;
  let slabPubkey!: PublicKey;

  if (resume) {
    // Reuse existing slab + mint from previous run
    collateralMint = new PublicKey("GM9cB1YceqdxuWeivy2fy6XoPFZUGcCzkCF7GngLew9n");
    slabPubkey = new PublicKey("4EJSXHjuFtk4RA4MXqtGgigE8DmrdMTnAXr6CuacXRHM");
    console.log("Resuming with existing slab:", slabPubkey.toBase58());
    console.log("Collateral mint:", collateralMint.toBase58());
  } else {
    // --- Step 1: Create collateral mint (test USDC, 6 decimals) ---
    console.log("\n=== Step 1: Create collateral mint ===");
    collateralMint = await createMint(connection, admin, admin.publicKey, null, 6);
    console.log("Collateral mint:", collateralMint.toBase58());

    // --- Step 2: Create slab account ---
    console.log("\n=== Step 2: Create Percolator slab ===");
    const slabKeypair = Keypair.generate();
    const slabRent = await connection.getMinimumBalanceForRentExemption(SLAB_LEN);
    console.log("Slab rent:", slabRent / 1e9, "SOL");

    const createSlabIx = SystemProgram.createAccount({
      fromPubkey: admin.publicKey,
      newAccountPubkey: slabKeypair.publicKey,
      lamports: slabRent,
      space: SLAB_LEN,
      programId: PERCOLATOR_PROGRAM_ID,
    });

    const tx1 = new Transaction().add(createSlabIx);
    await sendAndConfirmTransaction(connection, tx1, [admin, slabKeypair]);
    slabPubkey = slabKeypair.publicKey;
    console.log("Slab:", slabPubkey.toBase58());
  }

  // --- Step 3: Create Percolator vault token account ---
  const [percVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), slabPubkey.toBuffer()],
    PERCOLATOR_PROGRAM_ID,
  );
  console.log("Percolator vault PDA:", percVaultPda.toBase58());

  const percVaultAtaInfo = await getOrCreateAssociatedTokenAccount(
    connection, admin, collateralMint, percVaultPda, true, // allowOwnerOffCurve
  );
  const percVaultAta = percVaultAtaInfo.address;
  console.log("Percolator vault ATA:", percVaultAta.toBase58());

  // --- Step 4: InitMarket ---
  console.log("\n=== Step 3: InitMarket ===");
  const initMarketIx = new TransactionInstruction({
    programId: PERCOLATOR_PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: slabPubkey, isSigner: false, isWritable: true },
      { pubkey: collateralMint, isSigner: false, isWritable: false },
      { pubkey: percVaultAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: percVaultPda, isSigner: false, isWritable: false }, // dummy ATA
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: encodeInitMarket(admin.publicKey, collateralMint, SOL_USD_FEED_ID),
  });

  try {
    const tx2 = new Transaction().add(initMarketIx);
    const sig2 = await sendAndConfirmTransaction(connection, tx2, [admin]);
    console.log("InitMarket tx:", sig2);
  } catch (e: any) {
    if (e.transactionLogs?.some((l: string) => l.includes("0x2"))) {
      console.log("InitMarket skipped (already initialized)");
    } else {
      throw e;
    }
  }

  // --- Step 5: Create Syntx vault ---
  console.log("\n=== Step 4: Create Syntx vault ===");
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), collateralMint.toBuffer(), admin.publicKey.toBuffer()],
    SYNTX_PROGRAM_ID,
  );
  console.log("Vault PDA:", vaultPda.toBase58());

  // Share mint
  const shareMint = await createMint(connection, admin, vaultPda, null, 6);
  console.log("Share mint:", shareMint.toBase58());

  // Vault collateral ATA
  const vaultCollateral = await getOrCreateAssociatedTokenAccount(
    connection, admin, collateralMint, vaultPda, true,
  );
  console.log("Vault collateral ATA:", vaultCollateral.address.toBase58());

  // Mint some test tokens to vault collateral for registration fee
  await mintTo(connection, admin, collateralMint, vaultCollateral.address, admin, 10000);

  // InitVault
  const initVaultData = Buffer.concat([
    Buffer.from(disc("init_vault")),
    bufU16(2000), // performance_fee_bps (20%)
    bufU16(200),  // management_fee_bps (2%)
    bufU64(10_000_000_000n), // deposit_cap
  ]);

  const initVaultIx = new TransactionInstruction({
    programId: SYNTX_PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: collateralMint, isSigner: false, isWritable: false },
      { pubkey: shareMint, isSigner: false, isWritable: false },
      { pubkey: slabPubkey, isSigner: false, isWritable: false },
      { pubkey: PERCOLATOR_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: initVaultData,
  });

  try {
    const tx3 = new Transaction().add(initVaultIx);
    const sig3 = await sendAndConfirmTransaction(connection, tx3, [admin]);
    console.log("InitVault tx:", sig3);
  } catch (e: any) {
    if (e.message?.includes("already in use")) {
      console.log("InitVault skipped (vault PDA already exists)");
    } else {
      throw e;
    }
  }

  // --- Step 6: RegisterOnPercolator ---
  console.log("\n=== Step 5: RegisterOnPercolator ===");
  const registerData = Buffer.concat([
    Buffer.from(disc("register_on_percolator")),
    bufU64(1000n), // fee_payment (min_initial_deposit = 100)
  ]);

  const registerIx = new TransactionInstruction({
    programId: SYNTX_PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: false },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: vaultCollateral.address, isSigner: false, isWritable: true },
      { pubkey: slabPubkey, isSigner: false, isWritable: true },
      { pubkey: percVaultAta, isSigner: false, isWritable: true },
      { pubkey: PERCOLATOR_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: registerData,
  });

  const tx4 = new Transaction().add(registerIx);
  const sig4 = await sendAndConfirmTransaction(connection, tx4, [admin]);
  console.log("RegisterOnPercolator tx:", sig4);

  // --- Step 7: Set Percolator idx ---
  console.log("\n=== Step 6: SetPercolatorIdx ===");
  const setIdxData = Buffer.concat([
    Buffer.from(disc("set_percolator_idx")),
    bufU16(0), // first user = index 0
  ]);

  const setIdxIx = new TransactionInstruction({
    programId: SYNTX_PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: false },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
    ],
    data: setIdxData,
  });

  const tx5 = new Transaction().add(setIdxIx);
  const sig5 = await sendAndConfirmTransaction(connection, tx5, [admin]);
  console.log("SetPercolatorIdx tx:", sig5);

  // --- Output ---
  const config = {
    network: "devnet",
    createdAt: new Date().toISOString(),
    syntxProgramId: SYNTX_PROGRAM_ID.toBase58(),
    percolatorProgramId: PERCOLATOR_PROGRAM_ID.toBase58(),
    slab: slabPubkey.toBase58(),
    collateralMint: collateralMint.toBase58(),
    percolatorVault: percVaultAta.toBase58(),
    percolatorVaultPda: percVaultPda.toBase58(),
    vaultPda: vaultPda.toBase58(),
    shareMint: shareMint.toBase58(),
    vaultCollateral: vaultCollateral.address.toBase58(),
    percolatorUserIdx: 0,
    feedId: SOL_USD_FEED_ID,
  };

  // Save config
  fs.writeFileSync("devnet-vault.json", JSON.stringify(config, null, 2));
  console.log("\n=== Devnet vault deployed! ===");
  console.log("Config saved to keeper/devnet-vault.json");
  console.log(JSON.stringify(config, null, 2));

  // Generate .env
  console.log("\n--- .env for keeper ---");
  console.log(`SOLANA_RPC_URL=${RPC_URL}`);
  console.log(`MANAGER_KEYPAIR_PATH=~/.config/solana/id.json`);
  console.log(`SYNTX_PROGRAM_ID=${SYNTX_PROGRAM_ID.toBase58()}`);
  console.log(`PERCOLATOR_PROGRAM_ID=${PERCOLATOR_PROGRAM_ID.toBase58()}`);
  console.log(`PERCOLATOR_SLAB=${slabPubkey.toBase58()}`);
  console.log(`VAULT_PDA=${vaultPda.toBase58()}`);
  console.log(`COLLATERAL_MINT=${collateralMint.toBase58()}`);
  console.log(`CRANK_INTERVAL_MS=30000`);
}

main().catch(console.error);
