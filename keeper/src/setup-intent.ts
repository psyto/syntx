/**
 * Setup script for shielded intent execution on devnet.
 *
 * Creates: Percolator slab + market, LP account, user account,
 * privacy matcher context, and test USDC. Everything needed to
 * execute a real encrypted intent on-chain.
 *
 * Usage: npx ts-node src/setup-intent.ts
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

// ============================================================
// Config — freshly deployed programs
// ============================================================

const RPC_URL = process.env.SOLANA_RPC_URL || "http://localhost:8899";
const PERCOLATOR_PROGRAM_ID = new PublicKey("AHS7CyMJwSbt6P2oRJxxuG3f2rKETbJjgsiWXCchpkrL");
const PRIVACY_MATCHER_ID = new PublicKey("B2GB1aku91TAm2eRs3AAYiC9d5Xo35TdnbdA1mtqYuTG");

// Slab size for MAX_ACCOUNTS=4096 (current build: 1,156,848 bytes)
const SLAB_LEN = 1_156_848;

// Hyperp mode: all-zero feed ID = internal pricing
const FEED_ID = "0000000000000000000000000000000000000000000000000000000000000000";

const RESUME_FILE = "devnet-intent.json";

// ============================================================
// Helpers
// ============================================================

function loadKeypair(filePath: string): Keypair {
  const expanded = filePath.replace("~", process.env.HOME || "");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(expanded, "utf-8"))));
}

function feedIdToBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substring(i, i + 2), 16));
  }
  return bytes;
}

function bufU16(v: number): Buffer { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; }
function bufU32(v: number): Buffer { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; }
function bufU64(v: bigint): Buffer { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; }
function bufI64(v: bigint): Buffer { const b = Buffer.alloc(8); b.writeBigInt64LE(v); return b; }
function bufU128(v: bigint): Buffer {
  const b = Buffer.alloc(16);
  b.writeBigUInt64LE(v & 0xFFFFFFFFFFFFFFFFn, 0);
  b.writeBigUInt64LE(v >> 64n, 8);
  return b;
}

function encodeInitMarket(admin: PublicKey, mint: PublicKey): Buffer {
  const parts: Buffer[] = [];
  parts.push(Buffer.from([0])); // tag
  parts.push(admin.toBuffer());
  parts.push(mint.toBuffer());
  parts.push(Buffer.from(feedIdToBytes(FEED_ID)));
  parts.push(bufU64(BigInt("18446744073709551615"))); // max_staleness_secs
  parts.push(bufU16(500)); // conf_filter_bps
  parts.push(Buffer.from([0])); // invert
  parts.push(bufU32(0)); // unit_scale
  parts.push(bufU64(138_000_000n)); // initial_mark_price_e6
  parts.push(bufU128(0n)); // maintenance_fee
  parts.push(bufU128(10_000_000_000_000_000n)); // max_insurance_floor
  parts.push(Buffer.alloc(8)); // min_oracle_price_cap
  // RiskParams
  parts.push(bufU64(0n));    // h_min
  parts.push(bufU64(500n));  // maintenance_margin_bps
  parts.push(bufU64(1000n)); // initial_margin_bps
  parts.push(bufU64(0n));    // trading_fee_bps
  parts.push(bufU64(4096n)); // max_accounts (matches production binary)
  parts.push(bufU128(0n));   // new_account_fee
  parts.push(bufU128(0n));   // risk_reduction_threshold
  parts.push(bufU64(0n));    // h_max
  parts.push(bufU64(BigInt("18446744073709551615"))); // max_crank_staleness
  parts.push(bufU64(50n));   // liquidation_fee_bps
  parts.push(bufU128(1_000_000_000_000n)); // liquidation_fee_cap
  parts.push(bufU64(100n));  // resolve_price_deviation_bps
  parts.push(bufU128(0n));   // min_liquidation_abs
  parts.push(bufU128(100n)); // min_initial_deposit
  parts.push(bufU128(1n));   // min_nonzero_mm_req
  parts.push(bufU128(2n));   // min_nonzero_im_req
  // Extended tail
  parts.push(bufU16(0));     // insurance_withdraw_max_bps
  parts.push(bufU64(0n));    // insurance_withdraw_cooldown
  parts.push(bufU64(0n));    // permissionless_resolve_stale
  parts.push(bufU64(500n));  // funding_horizon_slots
  parts.push(bufU64(100n));  // funding_k_bps
  parts.push(bufI64(500n));  // funding_max_premium_bps
  parts.push(bufI64(5n));    // funding_max_bps_per_slot
  parts.push(bufU64(0n));    // mark_min_fee
  parts.push(bufU64(0n));    // force_close_delay_slots
  return Buffer.concat(parts);
}

// ============================================================
// Main
// ============================================================

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const admin = loadKeypair("~/.config/solana/id.json");
  console.log("Admin:", admin.publicKey.toBase58());
  console.log("Balance:", (await connection.getBalance(admin.publicKey)) / 1e9, "SOL");

  if (fs.existsSync(RESUME_FILE)) {
    const existing = JSON.parse(fs.readFileSync(RESUME_FILE, "utf-8"));
    console.log("\nExisting config found:", RESUME_FILE);
    console.log(JSON.stringify(existing, null, 2));
    return;
  }

  // --- Step 1: Create collateral mint ---
  console.log("\n=== Step 1: Collateral mint ===");
  const collateralMint = await createMint(connection, admin, admin.publicKey, null, 6);
  console.log("Mint:", collateralMint.toBase58());

  // --- Step 2: Create slab ---
  console.log("\n=== Step 2: Percolator slab ===");
  const slabKeypair = Keypair.generate();
  const slabRent = await connection.getMinimumBalanceForRentExemption(SLAB_LEN);
  console.log("Slab rent:", slabRent / 1e9, "SOL");

  const createSlabTx = new Transaction().add(SystemProgram.createAccount({
    fromPubkey: admin.publicKey,
    newAccountPubkey: slabKeypair.publicKey,
    lamports: slabRent,
    space: SLAB_LEN,
    programId: PERCOLATOR_PROGRAM_ID,
  }));
  await sendAndConfirmTransaction(connection, createSlabTx, [admin, slabKeypair]);
  console.log("Slab:", slabKeypair.publicKey.toBase58());

  // --- Step 3: Init market ---
  console.log("\n=== Step 3: InitMarket ===");
  const [percVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), slabKeypair.publicKey.toBuffer()],
    PERCOLATOR_PROGRAM_ID,
  );
  const percVaultAta = await getOrCreateAssociatedTokenAccount(
    connection, admin, collateralMint, percVaultPda, true,
  );

  const initMarketIx = new TransactionInstruction({
    programId: PERCOLATOR_PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: slabKeypair.publicKey, isSigner: false, isWritable: true },
      { pubkey: collateralMint, isSigner: false, isWritable: false },
      { pubkey: percVaultAta.address, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: percVaultPda, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: encodeInitMarket(admin.publicKey, collateralMint),
  });

  const sig3 = await sendAndConfirmTransaction(connection, new Transaction().add(initMarketIx), [admin]);
  console.log("InitMarket tx:", sig3);

  // --- Step 4: Init LP account (for the solver to trade against) ---
  console.log("\n=== Step 4: InitLP ===");
  // InitLP: tag(1)=2, deposit_amount(8)
  const lpDeposit = 100_000_000n; // 100 USDC
  // Mint USDC to admin for LP deposit
  const adminAta = await getOrCreateAssociatedTokenAccount(connection, admin, collateralMint, admin.publicKey);
  await mintTo(connection, admin, collateralMint, adminAta.address, admin, 1_000_000_000); // 1000 USDC

  // InitLP: tag(1) + matcherProgram(32) + matcherContext(32) + feePayment(8) = 73 bytes
  // We'll create the matcher context first, then use it here
  // For now, use a dummy matcher context — we'll init it in step 6
  const dummyMatcherCtx = Keypair.generate();
  const matcherRent = await connection.getMinimumBalanceForRentExemption(320);
  await sendAndConfirmTransaction(connection, new Transaction().add(SystemProgram.createAccount({
    fromPubkey: admin.publicKey,
    newAccountPubkey: dummyMatcherCtx.publicKey,
    lamports: matcherRent,
    space: 320,
    programId: PRIVACY_MATCHER_ID,
  })), [admin, dummyMatcherCtx]);
  console.log("Matcher context:", dummyMatcherCtx.publicKey.toBase58());

  const initLpData = Buffer.alloc(73);
  initLpData[0] = 2; // InitLP tag
  PRIVACY_MATCHER_ID.toBuffer().copy(initLpData, 1);        // matcherProgram
  dummyMatcherCtx.publicKey.toBuffer().copy(initLpData, 33); // matcherContext
  initLpData.writeBigUInt64LE(lpDeposit, 65);                // feePayment

  const initLpIx = new TransactionInstruction({
    programId: PERCOLATOR_PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: slabKeypair.publicKey, isSigner: false, isWritable: true },
      { pubkey: adminAta.address, isSigner: false, isWritable: true },
      { pubkey: percVaultAta.address, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: initLpData,
  });

  const sig4 = await sendAndConfirmTransaction(connection, new Transaction().add(initLpIx), [admin]);
  console.log("InitLP tx:", sig4);

  // --- Step 5: Init user account (for the trader) ---
  console.log("\n=== Step 5: InitUser ===");
  const userDeposit = 50_000_000n; // 50 USDC

  const initUserData = Buffer.alloc(9);
  initUserData[0] = 1; // InitUser tag
  initUserData.writeBigUInt64LE(userDeposit, 1);

  const initUserIx = new TransactionInstruction({
    programId: PERCOLATOR_PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: slabKeypair.publicKey, isSigner: false, isWritable: true },
      { pubkey: adminAta.address, isSigner: false, isWritable: true },
      { pubkey: percVaultAta.address, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: initUserData,
  });

  const sig5 = await sendAndConfirmTransaction(connection, new Transaction().add(initUserIx), [admin]);
  console.log("InitUser tx:", sig5);

  // --- Step 6: Init privacy matcher context ---
  console.log("\n=== Step 6: Init privacy matcher ===");
  // Context account was already created in step 4 (dummyMatcherCtx)
  const matcherCtx = dummyMatcherCtx;

  // Derive LP PDA for matcher init (must match what Percolator passes during TradeCpi)
  const lpIdxBufInit = Buffer.alloc(2);
  lpIdxBufInit.writeUInt16LE(0, 0);
  const [lpPdaForInit] = PublicKey.findProgramAddressSync(
    [Buffer.from("lp"), slabKeypair.publicKey.toBuffer(), lpIdxBufInit],
    PERCOLATOR_PROGRAM_ID,
  );
  console.log("LP PDA for matcher:", lpPdaForInit.toBase58());

  // Init matcher: tag(1)=0x02, base_spread(4), max_spread(4), solver_fee(4), encryption_pubkey(32)
  const initMatcherData = Buffer.alloc(45);
  initMatcherData[0] = 0x02; // Init tag
  initMatcherData.writeUInt32LE(15, 1);  // base_spread 15 bps
  initMatcherData.writeUInt32LE(100, 5); // max_spread 100 bps
  initMatcherData.writeUInt32LE(5, 9);   // solver_fee 5 bps

  const initMatcherIx = new TransactionInstruction({
    programId: PRIVACY_MATCHER_ID,
    keys: [
      { pubkey: lpPdaForInit, isSigner: false, isWritable: false },         // LP PDA (must match what Percolator passes)
      { pubkey: matcherCtx.publicKey, isSigner: false, isWritable: true },
      { pubkey: admin.publicKey, isSigner: false, isWritable: false },       // solver pubkey
    ],
    data: initMatcherData,
  });

  const sig6 = await sendAndConfirmTransaction(connection, new Transaction().add(initMatcherIx), [admin]);
  console.log("Init matcher tx:", sig6);
  console.log("Matcher context:", matcherCtx.publicKey.toBase58());

  // --- Step 6b: Set oracle authority (required before PushOraclePrice) ---
  console.log("\n=== Step 6b: SetOracleAuthority ===");
  const setAuthData = Buffer.alloc(33);
  setAuthData[0] = 16; // SetOracleAuthority tag
  admin.publicKey.toBuffer().copy(setAuthData, 1);

  const setAuthIx = new TransactionInstruction({
    programId: PERCOLATOR_PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: false },
      { pubkey: slabKeypair.publicKey, isSigner: false, isWritable: true },
    ],
    data: setAuthData,
  });

  const sigAuth = await sendAndConfirmTransaction(connection, new Transaction().add(setAuthIx), [admin]);
  console.log("SetOracleAuthority tx:", sigAuth);

  // --- Step 7: Push initial oracle price ---
  console.log("\n=== Step 7: Push oracle price ===");
  const pushData = Buffer.alloc(17);
  pushData[0] = 17; // PushOraclePrice tag
  pushData.writeBigUInt64LE(138_000_000n, 1); // $138.00
  pushData.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000)), 9);

  const pushIx = new TransactionInstruction({
    programId: PERCOLATOR_PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: false },
      { pubkey: slabKeypair.publicKey, isSigner: false, isWritable: true },
    ],
    data: pushData,
  });

  const sig7 = await sendAndConfirmTransaction(connection, new Transaction().add(pushIx), [admin]);
  console.log("Push oracle tx:", sig7);

  // --- Step 8: Execute a test trade (TradeCpi through privacy matcher) ---
  console.log("\n=== Step 8: Test TradeCpi ===");

  // Update matcher oracle first
  const matcherOracleData = Buffer.alloc(9);
  matcherOracleData[0] = 0x03; // Oracle update tag
  matcherOracleData.writeBigUInt64LE(138_000_000n, 1);

  const matcherOracleIx = new TransactionInstruction({
    programId: PRIVACY_MATCHER_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: false },
      { pubkey: matcherCtx.publicKey, isSigner: false, isWritable: true },
    ],
    data: matcherOracleData,
  });

  // Derive LP PDA: seeds = ["lp", slab, lp_idx as u16 LE] under Percolator program
  const lpIdxBuf = Buffer.alloc(2);
  lpIdxBuf.writeUInt16LE(0, 0);
  const [lpPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("lp"), slabKeypair.publicKey.toBuffer(), lpIdxBuf],
    PERCOLATOR_PROGRAM_ID,
  );
  console.log("LP PDA:", lpPda.toBase58());

  // TradeCpi: tag(1)=10, lp_idx(2), user_idx(2), size(16 i128), limit_price_e6(8 u64)
  const tradeData = Buffer.alloc(29);
  tradeData[0] = 10; // TradeCpi tag
  tradeData.writeUInt16LE(0, 1);  // lp_idx = 0
  tradeData.writeUInt16LE(1, 3);  // user_idx = 1 (user created in step 5)
  // size = 1_000_000 (1 SOL-PERP long)
  tradeData.writeBigUInt64LE(1_000_000n, 5);
  tradeData.writeBigUInt64LE(0n, 13); // high 8 bytes = 0
  tradeData.writeBigUInt64LE(0n, 21); // limit_price_e6 = 0 (no limit)

  // Oracle account — for hyperp mode, pass the slab itself as dummy oracle
  const oracleAccount = slabKeypair.publicKey;

  const tradeIx = new TransactionInstruction({
    programId: PERCOLATOR_PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: false },       // user (signer)
      { pubkey: admin.publicKey, isSigner: false, isWritable: false },      // lpOwner
      { pubkey: slabKeypair.publicKey, isSigner: false, isWritable: true }, // slab
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false }, // clock
      { pubkey: oracleAccount, isSigner: false, isWritable: false },       // oracle
      { pubkey: PRIVACY_MATCHER_ID, isSigner: false, isWritable: false },  // matcherProg
      { pubkey: matcherCtx.publicKey, isSigner: false, isWritable: true }, // matcherCtx
      { pubkey: lpPda, isSigner: false, isWritable: false },               // lpPda
    ],
    data: tradeData,
  });

  try {
    const tradeTx = new Transaction().add(matcherOracleIx, tradeIx);
    const sig8 = await sendAndConfirmTransaction(connection, tradeTx, [admin]);
    console.log("TradeCpi tx:", sig8);
    console.log("\n=== REAL INTENT EXECUTION SUCCEEDED! ===");
  } catch (e: any) {
    console.error("TradeCpi failed:", e?.message?.slice(0, 200));
    if (e?.logs) console.error("Logs:", e.logs.join("\n"));
  }

  // --- Save config ---
  const config = {
    network: "devnet",
    createdAt: new Date().toISOString(),
    percolatorProgramId: PERCOLATOR_PROGRAM_ID.toBase58(),
    privacyMatcherId: PRIVACY_MATCHER_ID.toBase58(),
    slab: slabKeypair.publicKey.toBase58(),
    collateralMint: collateralMint.toBase58(),
    percVaultPda: percVaultPda.toBase58(),
    percVaultAta: percVaultAta.address.toBase58(),
    matcherContext: matcherCtx.publicKey.toBase58(),
    lpIdx: 0,
    userIdx: 1,
    adminPubkey: admin.publicKey.toBase58(),
  };

  fs.writeFileSync(RESUME_FILE, JSON.stringify(config, null, 2));
  console.log("\nConfig saved to", RESUME_FILE);
  console.log(JSON.stringify(config, null, 2));
}

main().catch(console.error);
