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
import { computeTradeDecision, decisionToTradeSize, MarketState } from "./strategy";

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

const PERC_KEEPER_CRANK = 5;
const PERC_PUSH_ORACLE_PRICE = 17;
const LP_IDX = 1; // LP account index on the slab

// Engine offsets for funding rate (from percolator-cli)
const ENGINE_OFF = 584;
const ENGINE_FUNDING_RATE_OFF = 200; // funding_rate_bps_per_slot_last: i64

function readFundingRate(slabData: Buffer): bigint {
  return slabData.readBigInt64LE(ENGINE_OFF + ENGINE_FUNDING_RATE_OFF);
}

export async function runKeeper(config: Config): Promise<void> {
  console.log(`[${ts()}] Syntx Keeper starting...`);
  console.log(`  Slab:     ${config.percolatorSlab.toBase58()}`);
  console.log(`  Vault:    ${config.vaultPda.toBase58()}`);
  console.log(`  Interval: ${config.crankIntervalMs}ms`);
  console.log(`  Strategy: Funding Rate Harvest\n`);

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
  const engine = parseEngine(slabData);
  const fundingRate = readFundingRate(slabData);

  const health = getVaultHealth(slabData, config.vaultPda);
  if (!health) {
    console.log("  [!] Vault not found in slab");
    return;
  }

  // Compute vault equity (capital + PnL)
  const equity = health.capital + (health.pnl < 0n ? health.pnl : health.pnl);
  const sharePrice = equity > 0n ? Number(equity) / 1_000_000 : 0;

  console.log(`  Vault: capital=${health.capital} pnl=${health.pnl} pos=${health.positionSize} equity=${equity}`);
  console.log(`  Market: funding=${fundingRate} bps/slot | accounts=${engine.numUsedAccounts} | insurance=${engine.insuranceBalance}`);
  console.log(`  Share price: $${sharePrice.toFixed(6)}`);

  // 2. Push oracle price (with retry)
  const price = 138_000_000; // $138 — in production, fetch from Pyth
  await pushOracleWithRetry(connection, config, manager, price, 3);

  // 3. Crank funding
  const crankData = Buffer.alloc(4);
  crankData.writeUInt8(PERC_KEEPER_CRANK, 0);
  crankData.writeUInt16LE(0xFFFF, 1);
  crankData.writeUInt8(0, 3);

  try {
    const tx = new Transaction().add(new TransactionInstruction({
      programId: config.percolatorProgramId,
      keys: [
        { pubkey: manager.publicKey, isSigner: true, isWritable: false },
        { pubkey: config.percolatorSlab, isSigner: false, isWritable: true },
        { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: config.percolatorSlab, isSigner: false, isWritable: false },
      ],
      data: crankData,
    }));
    await sendAndConfirmTransaction(connection, tx, [manager]);
    console.log(`  [crank] OK`);
  } catch (err: any) {
    const logs = err?.transactionLogs || err?.logs || [];
    if (logs.length) {
      console.log(`  [crank] Failed:`);
      for (const log of logs) console.log(`    ${log}`);
    } else {
      console.log(`  [crank] Failed: ${err?.message?.slice(0, 150) || "unknown"}`);
    }
  }

  // 4. Strategy decision
  const marketState: MarketState = {
    fundingRateBpsPerSlot: fundingRate,
    vaultCapital: health.capital,
    vaultPosition: health.positionSize,
    insuranceBalance: engine.insuranceBalance,
    numAccounts: engine.numUsedAccounts,
  };

  const decision = computeTradeDecision(marketState);
  console.log(`  [strategy] ${decision.action}: ${decision.reason}`);

  // 5. Execute trade if needed
  if (decision.action === "hold") return;

  let tradeSize: bigint;
  if (decision.action === "close") {
    // Close by opening opposite position
    tradeSize = -health.positionSize;
  } else {
    const size = decisionToTradeSize(decision);
    if (!size) return;
    tradeSize = size;
  }

  if (tradeSize === 0n) return;

  await executeTrade(connection, config, manager, LP_IDX, tradeSize);
}

async function executeTrade(
  connection: Connection,
  config: Config,
  manager: Keypair,
  lpIdx: number,
  size: bigint,
): Promise<void> {
  const tradeData = Buffer.alloc(26);
  const d = Buffer.from(disc("manager_trade"));
  d.copy(tradeData, 0);
  tradeData.writeUInt16LE(lpIdx, 8);
  const sizeUnsigned = size < 0n ? (1n << 128n) + size : size;
  tradeData.writeBigUInt64LE(sizeUnsigned & 0xFFFFFFFFFFFFFFFFn, 10);
  tradeData.writeBigUInt64LE(sizeUnsigned >> 64n, 18);

  const tradeIx = new TransactionInstruction({
    programId: config.syntxProgramId,
    keys: [
      { pubkey: manager.publicKey, isSigner: true, isWritable: false },
      { pubkey: config.vaultPda, isSigner: false, isWritable: false },
      { pubkey: manager.publicKey, isSigner: true, isWritable: false },
      { pubkey: config.percolatorSlab, isSigner: false, isWritable: true },
      { pubkey: config.percolatorSlab, isSigner: false, isWritable: false },
      { pubkey: config.percolatorProgramId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: tradeData,
  });

  try {
    const tx = new Transaction().add(tradeIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [manager]);
    console.log(`  [trade] ${size > 0n ? "LONG" : "SHORT"} ${size > 0n ? size : -size} units → ${sig.slice(0, 16)}...`);
  } catch (err: any) {
    const logs = err?.transactionLogs || [];
    console.log(`  [trade] Failed: ${logs[logs.length - 2] || err?.message?.slice(0, 100) || "unknown"}`);
  }
}

async function pushOracleWithRetry(
  connection: Connection,
  config: Config,
  manager: Keypair,
  price: number,
  maxRetries: number,
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const now = Math.floor(Date.now() / 1000);
      const data = Buffer.alloc(17);
      data.writeUInt8(PERC_PUSH_ORACLE_PRICE, 0);
      data.writeBigUInt64LE(BigInt(price), 1);
      data.writeBigInt64LE(BigInt(now), 9);

      const tx = new Transaction().add(new TransactionInstruction({
        programId: config.percolatorProgramId,
        keys: [
          { pubkey: manager.publicKey, isSigner: true, isWritable: false },
          { pubkey: config.percolatorSlab, isSigner: false, isWritable: true },
        ],
        data,
      }));
      await sendAndConfirmTransaction(connection, tx, [manager]);
      console.log(`  [oracle] $${price / 1_000_000} pushed`);
      return;
    } catch (err: any) {
      if (attempt < maxRetries) {
        const delay = attempt * 2000; // 2s, 4s, 6s backoff
        console.log(`  [oracle] Attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms...`);
        await sleep(delay);
      } else {
        console.log(`  [oracle] All ${maxRetries} attempts failed: ${err?.message?.slice(0, 80) || "unknown"}`);
      }
    }
  }
}
