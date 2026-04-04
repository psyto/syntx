import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "fs";
import { Config } from "./config.js";
import {
  fetchSlab,
  parseHeader,
  parseEngine,
  getVaultHealth,
  VaultHealth,
} from "./slab.js";

// =============================================================================
// Helpers
// =============================================================================

function loadKeypair(path: string): Keypair {
  const resolved = path.replace("~", process.env.HOME ?? "");
  const raw = readFileSync(resolved, "utf-8");
  const secret = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secret);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatE6(val: bigint): string {
  const sign = val < 0n ? "-" : "";
  const abs = val < 0n ? -val : val;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0");
  return `${sign}${whole}.${frac}`;
}

function ts(): string {
  return new Date().toISOString();
}

// =============================================================================
// Keeper loop
// =============================================================================

export async function runKeeper(config: Config): Promise<void> {
  console.log(`[${ts()}] Syntx Keeper starting...`);
  console.log(`  RPC:          ${config.rpcUrl}`);
  console.log(`  Slab:         ${config.percolatorSlab.toBase58()}`);
  console.log(`  Vault PDA:    ${config.vaultPda.toBase58()}`);
  console.log(`  Crank every:  ${config.crankIntervalMs}ms`);

  const connection = new Connection(config.rpcUrl, "confirmed");
  const manager = loadKeypair(config.managerKeypairPath);
  console.log(`  Manager:      ${manager.publicKey.toBase58()}`);

  let loopCount = 0;

  while (true) {
    loopCount++;
    console.log(`\n[${ts()}] === Loop #${loopCount} ===`);

    try {
      await tick(connection, config, manager);
    } catch (err) {
      console.error(`[${ts()}] Loop error:`, err);
    }

    await sleep(config.crankIntervalMs);
  }
}

async function tick(
  connection: Connection,
  config: Config,
  _manager: Keypair,
): Promise<void> {
  // 1. Read slab state
  const slabData = await fetchSlab(connection, config.percolatorSlab);
  const header = parseHeader(slabData);
  const engine = parseEngine(slabData);

  console.log(`  Slab v${header.version} | resolved: ${header.resolved}`);
  console.log(`  Engine slot: ${engine.currentSlot} | accounts: ${engine.numUsedAccounts}`);
  console.log(`  Total OI: ${formatE6(engine.totalOpenInterest)}`);
  console.log(`  Funding rate (bps/slot): ${engine.fundingRateBpsPerSlotLast}`);
  console.log(`  Vault collateral: ${formatE6(engine.vault)}`);
  console.log(`  Insurance: ${formatE6(engine.insuranceBalance)}`);

  // 2. Get vault's position health
  const health = getVaultHealth(slabData, config.vaultPda);
  if (health) {
    logVaultHealth(health);
    evaluateStrategy(health);
  } else {
    console.log("  [!] Vault account not found on slab — not yet initialized?");
  }

  // 3. Crank (placeholder — actual TX submission to be wired up)
  // TODO: Build and send manager_crank transaction
  // const crankIx = encodeManagerCrank();
  // await sendTransaction(connection, manager, crankIx, ...accounts);
  console.log("  [crank] Placeholder — TX submission not yet wired");
}

function logVaultHealth(health: VaultHealth): void {
  console.log("  --- Vault Health ---");
  console.log(`    Capital:       ${formatE6(health.capital)}`);
  console.log(`    PnL:           ${formatE6(health.pnl)}`);
  console.log(`    Position size: ${health.positionSize}`);
  console.log(`    Entry price:   ${formatE6(health.entryPrice)}`);
  console.log(`    Slots since crank: ${health.slotsSinceCrank}`);
}

/**
 * Strategy placeholder: log when conditions are favorable.
 * Actual trading logic (funding rate capture, delta-neutral, etc.)
 * will be ported from Yogi's signal detection.
 */
function evaluateStrategy(health: VaultHealth): void {
  const fundingRate = health.fundingRateBpsPerSlot;

  // Positive funding = longs pay shorts (favorable for short)
  // Negative funding = shorts pay longs (favorable for long)
  if (fundingRate > 0n) {
    console.log(
      `  [strategy] Funding rate positive (${fundingRate} bps/slot) — favorable for short`,
    );
  } else if (fundingRate < 0n) {
    console.log(
      `  [strategy] Funding rate negative (${fundingRate} bps/slot) — favorable for long`,
    );
  } else {
    console.log("  [strategy] Funding rate neutral — no directional edge");
  }

  // Alert if position is stale (not cranked in a while)
  if (health.slotsSinceCrank > 1000n) {
    console.log(
      `  [!] WARNING: ${health.slotsSinceCrank} slots since last crank — needs attention`,
    );
  }
}
