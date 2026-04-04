import { Connection, Keypair } from "@solana/web3.js";
import { readFileSync } from "fs";
import { Config } from "./config";
import { fetchSlab, parseHeader, parseEngine, getVaultHealth } from "./slab";

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

export async function runKeeper(config: Config): Promise<void> {
  console.log(`[${ts()}] Syntx Keeper starting...`);
  console.log(`  Slab:     ${config.percolatorSlab.toBase58()}`);
  console.log(`  Vault:    ${config.vaultPda.toBase58()}`);
  console.log(`  Interval: ${config.crankIntervalMs}ms`);

  const connection = new Connection(config.rpcUrl, "confirmed");
  const manager = loadKeypair(config.managerKeypairPath);
  console.log(`  Manager:  ${manager.publicKey.toBase58()}`);

  let loopCount = 0;

  while (true) {
    loopCount++;
    console.log(`\n[${ts()}] === Tick #${loopCount} ===`);

    try {
      await tick(connection, config);
    } catch (err) {
      console.error(`[${ts()}] Error:`, err instanceof Error ? err.message : err);
    }

    await sleep(config.crankIntervalMs);
  }
}

async function tick(connection: Connection, config: Config): Promise<void> {
  const slabData = await fetchSlab(connection, config.percolatorSlab);
  const header = parseHeader(slabData);
  const engine = parseEngine(slabData);

  console.log(`  Resolved: ${header.resolved} | Accounts: ${engine.numUsedAccounts}`);
  console.log(`  Vault balance: ${engine.vault} | Insurance: ${engine.insuranceBalance}`);

  const health = getVaultHealth(slabData, config.vaultPda);
  if (health) {
    console.log(`  --- Vault [idx=${health.accountIndex}] ---`);
    console.log(`    Capital:  ${health.capital}`);
    console.log(`    PnL:      ${health.pnl}`);
    console.log(`    Position: ${health.positionSize}`);
    console.log(`    Entry:    ${health.entryPrice}`);
  } else {
    console.log("  [!] Vault account not found in slab");
  }
}
