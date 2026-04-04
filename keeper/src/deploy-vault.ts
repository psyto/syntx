/**
 * Deploy a Syntx vault on devnet targeting an existing Percolator slab.
 *
 * Usage: npx ts-node src/deploy-vault.ts
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
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import { disc } from "./abi";

// ============================================================
// Config — from devnet-market.json
// ============================================================

const SYNTX_PROGRAM_ID = new PublicKey("53r6bg7JBFqf5Jfs7fe4kHDtwXwUgDWoLarYrsWcoF1V");
const PERCOLATOR_PROGRAM_ID = new PublicKey("2SSnp35m7FQ7cRLNKGdW5UzjYFF6RBUNq7d3m5mqNByp");
const PERCOLATOR_SLAB = new PublicKey("A7wQtRT9DhFqYho8wTVqQCDc7kYPTUXGPATiyVbZKVFs");
const COLLATERAL_MINT = new PublicKey("So11111111111111111111111111111111111111112"); // wSOL
const PERCOLATOR_VAULT = new PublicKey("63juJmvm1XHCHveWv9WdanxqJX6tD6DLFTZD7dvH12dc");

const RPC_URL = "https://api.devnet.solana.com";

function loadKeypair(filePath: string): Keypair {
  const expanded = filePath.replace("~", process.env.HOME || "");
  const raw = JSON.parse(fs.readFileSync(expanded, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const manager = loadKeypair("~/.config/solana/id.json");
  console.log("Manager:", manager.publicKey.toBase58());

  const balance = await connection.getBalance(manager.publicKey);
  console.log("Balance:", balance / 1e9, "SOL");

  // Derive vault PDA
  const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), COLLATERAL_MINT.toBuffer(), manager.publicKey.toBuffer()],
    SYNTX_PROGRAM_ID,
  );
  console.log("Vault PDA:", vaultPda.toBase58());

  // Check if vault already exists
  const vaultInfo = await connection.getAccountInfo(vaultPda);
  if (vaultInfo) {
    console.log("Vault already exists! Size:", vaultInfo.data.length);
    console.log("Owner:", vaultInfo.owner.toBase58());
    return;
  }

  // Step 1: Create share mint with vault PDA as authority
  console.log("\n--- Creating share mint ---");
  const shareMint = await createMint(
    connection,
    manager,
    vaultPda,     // mint authority = vault PDA
    null,         // no freeze authority
    6,            // decimals
  );
  console.log("Share mint:", shareMint.toBase58());

  // Step 2: Create vault's collateral token account (wSOL ATA)
  console.log("\n--- Creating vault collateral ATA ---");
  const vaultCollateral = await getOrCreateAssociatedTokenAccount(
    connection,
    manager,
    COLLATERAL_MINT,
    vaultPda,
    true, // allowOwnerOffCurve (PDA)
  );
  console.log("Vault collateral ATA:", vaultCollateral.address.toBase58());

  // Step 3: InitVault
  console.log("\n--- InitVault ---");
  const performanceFeeBps = 2000; // 20%
  const managementFeeBps = 200;   // 2%
  const depositCap = BigInt(10_000_000_000); // 10,000 wSOL (in lamports)

  const initData = Buffer.concat([
    Buffer.from(disc("init_vault")),
    Buffer.from(new Uint8Array(new Uint16Array([performanceFeeBps]).buffer)),
    Buffer.from(new Uint8Array(new Uint16Array([managementFeeBps]).buffer)),
    Buffer.from(new Uint8Array(new BigUint64Array([depositCap]).buffer)),
  ]);

  const initIx = new TransactionInstruction({
    programId: SYNTX_PROGRAM_ID,
    keys: [
      { pubkey: manager.publicKey, isSigner: true, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: COLLATERAL_MINT, isSigner: false, isWritable: false },
      { pubkey: shareMint, isSigner: false, isWritable: false },
      { pubkey: PERCOLATOR_SLAB, isSigner: false, isWritable: false },
      { pubkey: PERCOLATOR_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: initData,
  });

  const tx1 = new Transaction().add(initIx);
  const sig1 = await sendAndConfirmTransaction(connection, tx1, [manager]);
  console.log("InitVault tx:", sig1);

  // Step 4: RegisterOnPercolator
  console.log("\n--- RegisterOnPercolator ---");
  const registerData = Buffer.concat([
    Buffer.from(disc("register_on_percolator")),
    Buffer.from(new Uint8Array(new BigUint64Array([BigInt(0)]).buffer)), // fee_payment = 0
  ]);

  const registerIx = new TransactionInstruction({
    programId: SYNTX_PROGRAM_ID,
    keys: [
      { pubkey: manager.publicKey, isSigner: true, isWritable: false },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: vaultCollateral.address, isSigner: false, isWritable: true },
      { pubkey: PERCOLATOR_SLAB, isSigner: false, isWritable: true },
      { pubkey: PERCOLATOR_VAULT, isSigner: false, isWritable: true },
      { pubkey: PERCOLATOR_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: registerData,
  });

  const tx2 = new Transaction().add(registerIx);
  const sig2 = await sendAndConfirmTransaction(connection, tx2, [manager]);
  console.log("RegisterOnPercolator tx:", sig2);

  // Step 5: Set Percolator idx
  // The slab already has LP at idx 0 and vAMM LP at idx 4, so our user will be at some index.
  // We need to read the slab to find it. For now, try common indices.
  console.log("\n--- SetPercolatorIdx ---");
  // Read the slab to find our index
  const slabInfo = await connection.getAccountInfo(PERCOLATOR_SLAB);
  if (!slabInfo) throw new Error("Slab not found");

  // Find our account by scanning for our PDA as owner
  // Engine starts at offset 440, each account is 240 bytes
  const ENGINE_OFF = 440;
  const ACCOUNT_SIZE = 240;
  const OWNER_OFF = 192; // owner field offset within Account struct
  const vaultPdaBytes = vaultPda.toBuffer();

  let foundIdx = -1;
  for (let i = 0; i < 64; i++) { // check first 64 accounts
    const accOff = ENGINE_OFF + 88 + (i * ACCOUNT_SIZE); // 88 = engine header before accounts array
    if (accOff + ACCOUNT_SIZE > slabInfo.data.length) break;
    const ownerBytes = slabInfo.data.slice(accOff + OWNER_OFF, accOff + OWNER_OFF + 32);
    if (Buffer.compare(ownerBytes, vaultPdaBytes) === 0) {
      foundIdx = i;
      break;
    }
  }

  if (foundIdx >= 0) {
    console.log("Found vault at Percolator index:", foundIdx);

    const setIdxData = Buffer.concat([
      Buffer.from(disc("set_percolator_idx")),
      Buffer.from(new Uint8Array(new Uint16Array([foundIdx]).buffer)),
    ]);

    const setIdxIx = new TransactionInstruction({
      programId: SYNTX_PROGRAM_ID,
      keys: [
        { pubkey: manager.publicKey, isSigner: true, isWritable: false },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
      ],
      data: setIdxData,
    });

    const tx3 = new Transaction().add(setIdxIx);
    const sig3 = await sendAndConfirmTransaction(connection, tx3, [manager]);
    console.log("SetPercolatorIdx tx:", sig3);
  } else {
    console.log("WARNING: Could not find vault PDA in slab accounts. Set idx manually.");
  }

  // Output .env config
  console.log("\n=== Vault deployed! ===");
  console.log("\nAdd to keeper/.env:");
  console.log(`SOLANA_RPC_URL=${RPC_URL}`);
  console.log(`MANAGER_KEYPAIR_PATH=~/.config/solana/id.json`);
  console.log(`SYNTX_PROGRAM_ID=${SYNTX_PROGRAM_ID.toBase58()}`);
  console.log(`PERCOLATOR_PROGRAM_ID=${PERCOLATOR_PROGRAM_ID.toBase58()}`);
  console.log(`PERCOLATOR_SLAB=${PERCOLATOR_SLAB.toBase58()}`);
  console.log(`VAULT_PDA=${vaultPda.toBase58()}`);
  console.log(`COLLATERAL_MINT=${COLLATERAL_MINT.toBase58()}`);
  console.log(`SHARE_MINT=${shareMint.toBase58()}`);
  console.log(`VAULT_COLLATERAL_ATA=${vaultCollateral.address.toBase58()}`);
  console.log(`PERCOLATOR_VAULT=${PERCOLATOR_VAULT.toBase58()}`);
  console.log(`CRANK_INTERVAL_MS=30000`);
}

main().catch(console.error);
