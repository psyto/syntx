import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SYSVAR_CLOCK_PUBKEY,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { readFileSync } from "fs";
import { Config } from "./config";
import { fetchSlab, parseHeader, parseEngine, getVaultHealth } from "./slab";
import { disc } from "./abi";

function loadKeypair(path: string): Keypair {
  const resolved = path.replace("~", process.env.HOME ?? "");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(resolved, "utf-8"))));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ts(): string {
  return new Date().toISOString();
}

// Percolator instruction tags
const PERC_KEEPER_CRANK = 5;
const PERC_PUSH_ORACLE_PRICE = 17;

export async function runKeeper(config: Config): Promise<void> {
  console.log(`[${ts()}] Syntx Keeper starting...`);
  console.log(`  Slab:     ${config.percolatorSlab.toBase58()}`);
  console.log(`  Vault:    ${config.vaultPda.toBase58()}`);
  console.log(`  Interval: ${config.crankIntervalMs}ms`);

  const connection = new Connection(config.rpcUrl, "confirmed");
  const manager = loadKeypair(config.managerKeypairPath);
  console.log(`  Manager:  ${manager.publicKey.toBase58()}\n`);

  let loopCount = 0;

  while (true) {
    loopCount++;
    console.log(`[${ts()}] === Tick #${loopCount} ===`);

    try {
      await tick(connection, config, manager);
    } catch (err) {
      console.error(`[${ts()}] Error:`, err instanceof Error ? err.message : err);
    }

    await sleep(config.crankIntervalMs);
  }
}

async function tick(connection: Connection, config: Config, manager: Keypair): Promise<void> {
  // 1. Read slab state
  const slabData = await fetchSlab(connection, config.percolatorSlab);
  const header = parseHeader(slabData);
  const engine = parseEngine(slabData);

  console.log(`  Accounts: ${engine.numUsedAccounts} | Vault: ${engine.vault} | Insurance: ${engine.insuranceBalance}`);

  const health = getVaultHealth(slabData, config.vaultPda);
  if (health) {
    console.log(`  Vault [${health.accountIndex}]: capital=${health.capital} pnl=${health.pnl} pos=${health.positionSize}`);
  } else {
    console.log("  [!] Vault not found in slab");
    return;
  }

  // 2. Push oracle price (authority mode — we are the oracle authority)
  const price = 138_000_000; // $138 SOL — in production, fetch from Pyth/Binance
  const now = Math.floor(Date.now() / 1000);

  const pushPriceData = Buffer.alloc(17);
  pushPriceData.writeUInt8(PERC_PUSH_ORACLE_PRICE, 0);
  pushPriceData.writeBigUInt64LE(BigInt(price), 1);
  pushPriceData.writeBigInt64LE(BigInt(now), 9);

  const pushIx = new TransactionInstruction({
    programId: config.percolatorProgramId,
    keys: [
      { pubkey: manager.publicKey, isSigner: true, isWritable: false },
      { pubkey: config.percolatorSlab, isSigner: false, isWritable: true },
    ],
    data: pushPriceData,
  });

  // 3. Permissionless crank (direct to Percolator)
  const crankData = Buffer.alloc(4);
  crankData.writeUInt8(PERC_KEEPER_CRANK, 0);
  crankData.writeUInt16LE(0xFFFF, 1); // permissionless (u16::MAX)
  crankData.writeUInt8(0, 3); // format_version = 0

  const crankIx = new TransactionInstruction({
    programId: config.percolatorProgramId,
    keys: [
      { pubkey: manager.publicKey, isSigner: true, isWritable: false },
      { pubkey: config.percolatorSlab, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: config.percolatorSlab, isSigner: false, isWritable: false }, // oracle (dummy, authority mode)
    ],
    data: crankData,
  });

  // Push oracle price
  try {
    const txPush = new Transaction().add(pushIx);
    const sig1 = await sendAndConfirmTransaction(connection, txPush, [manager]);
    console.log(`  [oracle] Price pushed: ${sig1.slice(0, 16)}...`);
  } catch (err: any) {
    const logs = err?.transactionLogs || [];
    console.log(`  [oracle] Push failed:`);
    for (const log of logs) console.log(`    ${log}`);
    if (!logs.length) console.log(`    ${err?.message || "unknown"}`);
  }

  // Crank
  try {
    const txCrank = new Transaction().add(crankIx);
    const sig2 = await sendAndConfirmTransaction(connection, txCrank, [manager]);
    console.log(`  [crank] OK: ${sig2.slice(0, 16)}...`);
  } catch (err: any) {
    const logs = err?.transactionLogs || [];
    console.log(`  [crank] Failed: ${logs[logs.length - 2] || err?.message || "unknown"}`);
  }
}
