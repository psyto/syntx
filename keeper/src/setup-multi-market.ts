/**
 * Multi-market setup: creates BTC-PERP and ETH-PERP slabs on devnet.
 *
 * Uses the same Percolator program as the SOL-PERP market.
 * Each market gets its own slab, collateral mint, and oracle.
 *
 * Usage: npx ts-node src/setup-multi-market.ts
 *
 * Note: Requires ~0.3 SOL per market (slab rent for test-sized slabs)
 * or ~8 SOL per market (production slabs). Check SLAB_LEN below.
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
} from "@solana/spl-token";
import * as fs from "fs";

const RPC_URL = "https://api.devnet.solana.com";
const PERCOLATOR_PROGRAM_ID = new PublicKey("Edq18N2pdT3Sz9EukbZe4YsQkvmxvmmkUL1KHpv96xJF");
const SYNTX_PROGRAM_ID = new PublicKey("53r6bg7JBFqf5Jfs7fe4kHDtwXwUgDWoLarYrsWcoF1V");

// Production slab size — change to smaller if using test build
const SLAB_LEN = 1_156_800;

// Market definitions
const MARKETS = [
  {
    name: "BTC-PERP",
    symbol: "BTC",
    // BTC/USD Pyth feed ID (devnet)
    feedId: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    initialPrice: 97_000_000_000, // $97,000 in e6
  },
  {
    name: "ETH-PERP",
    symbol: "ETH",
    // ETH/USD Pyth feed ID (devnet)
    feedId: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    initialPrice: 3_400_000_000, // $3,400 in e6
  },
];

function loadKeypair(filePath: string): Keypair {
  const expanded = filePath.replace("~", process.env.HOME || "");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(expanded, "utf-8"))));
}

function feedIdToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
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

function encodeInitMarket(admin: PublicKey, mint: PublicKey, feedId: string): Buffer {
  const parts: Buffer[] = [];
  parts.push(Buffer.from([0]));
  parts.push(admin.toBuffer());
  parts.push(mint.toBuffer());
  parts.push(Buffer.from(feedIdToBytes(feedId)));
  parts.push(bufU64(BigInt("18446744073709551615"))); // max_staleness
  parts.push(bufU16(500)); // conf_filter_bps
  parts.push(Buffer.from([0])); // invert
  parts.push(Buffer.alloc(4)); // unit_scale
  parts.push(bufU64(0n)); // initial_mark_price
  parts.push(bufU128(100_000_000_000_000_000_000n)); // max_maintenance_fee
  parts.push(bufU128(10_000_000_000_000_000n)); // max_insurance_floor
  parts.push(bufU64(0n)); // min_oracle_price_cap
  parts.push(bufU64(0n)); // warmup
  parts.push(bufU64(500n)); // maintenance_margin_bps
  parts.push(bufU64(1000n)); // initial_margin_bps
  parts.push(bufU64(10n)); // trading_fee_bps
  parts.push(bufU64(4096n)); // max_accounts
  parts.push(bufU128(0n)); // new_account_fee
  parts.push(bufU128(0n)); // insurance_floor (was risk_reduction_threshold)
  parts.push(bufU128(0n)); // maintenance_fee
  parts.push(bufU64(BigInt("18446744073709551615"))); // max_crank_staleness
  parts.push(bufU64(50n)); // liquidation_fee_bps
  parts.push(bufU128(1_000_000_000_000n)); // liquidation_fee_cap
  parts.push(bufU64(100n)); // liquidation_buffer_bps
  parts.push(bufU128(0n)); // min_liquidation_abs
  parts.push(bufU128(100n)); // min_initial_deposit
  parts.push(bufU128(1n)); // min_nonzero_mm_req
  parts.push(bufU128(2n)); // min_nonzero_im_req
  // No extended tail — uses defaults
  return Buffer.concat(parts);
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const admin = loadKeypair("~/.config/solana/id.json");
  console.log("Admin:", admin.publicKey.toBase58());
  console.log("Balance:", (await connection.getBalance(admin.publicKey)) / 1e9, "SOL");

  const slabRent = await connection.getMinimumBalanceForRentExemption(SLAB_LEN);
  console.log(`Slab rent: ${slabRent / 1e9} SOL each`);
  console.log(`Markets to create: ${MARKETS.length}`);
  console.log(`Total SOL needed: ~${(MARKETS.length * slabRent / 1e9 + 0.5).toFixed(2)} SOL\n`);

  const results: any[] = [];

  for (const market of MARKETS) {
    console.log(`\n=== Creating ${market.name} ===`);

    try {
      // Create collateral mint
      const mint = await createMint(connection, admin, admin.publicKey, null, 6);
      console.log(`  Mint: ${mint.toBase58()}`);

      // Create slab
      const slabKeypair = Keypair.generate();
      const tx1 = new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: slabKeypair.publicKey,
          lamports: slabRent,
          space: SLAB_LEN,
          programId: PERCOLATOR_PROGRAM_ID,
        }),
      );
      await sendAndConfirmTransaction(connection, tx1, [admin, slabKeypair]);
      console.log(`  Slab: ${slabKeypair.publicKey.toBase58()}`);

      // Create vault token account
      const [percVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), slabKeypair.publicKey.toBuffer()],
        PERCOLATOR_PROGRAM_ID,
      );
      const percVaultAta = await getOrCreateAssociatedTokenAccount(
        connection, admin, mint, percVaultPda, true,
      );
      console.log(`  Vault ATA: ${percVaultAta.address.toBase58()}`);

      // InitMarket
      const initIx = new TransactionInstruction({
        programId: PERCOLATOR_PROGRAM_ID,
        keys: [
          { pubkey: admin.publicKey, isSigner: true, isWritable: true },
          { pubkey: slabKeypair.publicKey, isSigner: false, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: percVaultAta.address, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
          { pubkey: percVaultPda, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: encodeInitMarket(admin.publicKey, mint, market.feedId),
      });
      const tx2 = new Transaction().add(initIx);
      await sendAndConfirmTransaction(connection, tx2, [admin]);
      console.log(`  InitMarket: OK`);

      // Set oracle authority
      const setAuthData = Buffer.alloc(33);
      setAuthData.writeUInt8(16, 0); // SetOracleAuthority tag
      admin.publicKey.toBuffer().copy(setAuthData, 1);
      const setAuthIx = new TransactionInstruction({
        programId: PERCOLATOR_PROGRAM_ID,
        keys: [
          { pubkey: admin.publicKey, isSigner: true, isWritable: false },
          { pubkey: slabKeypair.publicKey, isSigner: false, isWritable: true },
        ],
        data: setAuthData,
      });
      const tx3 = new Transaction().add(setAuthIx);
      await sendAndConfirmTransaction(connection, tx3, [admin]);
      console.log(`  Oracle authority: set`);

      // Push initial price
      const pushData = Buffer.alloc(17);
      pushData.writeUInt8(17, 0); // PushOraclePrice tag
      pushData.writeBigUInt64LE(BigInt(market.initialPrice), 1);
      pushData.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000)), 9);
      const pushIx = new TransactionInstruction({
        programId: PERCOLATOR_PROGRAM_ID,
        keys: [
          { pubkey: admin.publicKey, isSigner: true, isWritable: false },
          { pubkey: slabKeypair.publicKey, isSigner: false, isWritable: true },
        ],
        data: pushData,
      });
      const tx4 = new Transaction().add(pushIx);
      await sendAndConfirmTransaction(connection, tx4, [admin]);
      console.log(`  Price: $${market.initialPrice / 1_000_000} pushed`);

      results.push({
        name: market.name,
        slab: slabKeypair.publicKey.toBase58(),
        mint: mint.toBase58(),
        percVaultAta: percVaultAta.address.toBase58(),
        feedId: market.feedId,
      });

      console.log(`  ✓ ${market.name} ready`);
    } catch (e: any) {
      console.error(`  ✗ ${market.name} failed:`, e.message?.slice(0, 100));
    }
  }

  // Save results
  const existing = JSON.parse(fs.readFileSync("devnet-vault.json", "utf-8"));
  existing.markets = [
    { name: "SOL-PERP", slab: existing.slab, mint: existing.collateralMint },
    ...results,
  ];
  fs.writeFileSync("devnet-vault.json", JSON.stringify(existing, null, 2));

  console.log("\n=== Multi-market setup complete ===");
  console.log("Markets:", JSON.stringify(results, null, 2));
  console.log("\nUsers can now create vaults on any market via /create");
}

main().catch(console.error);
