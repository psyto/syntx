/**
 * Single tick test — reads slab state and vault health from devnet.
 * Usage: npx ts-node src/test-tick.ts
 */
import { Connection } from "@solana/web3.js";
import { loadConfig } from "./config";
import { fetchSlab, parseHeader, parseEngine, getVaultHealth } from "./slab";

async function main() {
  const config = loadConfig();
  const connection = new Connection(config.rpcUrl, "confirmed");
  console.log("Slab:", config.percolatorSlab.toBase58());
  console.log("Vault PDA:", config.vaultPda.toBase58());

  const slabData = await fetchSlab(connection, config.percolatorSlab);
  console.log("Loaded:", slabData.length, "bytes\n");

  const header = parseHeader(slabData);
  console.log("Resolved:", header.resolved);

  const engine = parseEngine(slabData);
  console.log("Used accounts:", engine.numUsedAccounts);
  console.log("Vault balance:", engine.vault.toString());
  console.log("Insurance:", engine.insuranceBalance.toString());

  const health = getVaultHealth(slabData, config.vaultPda);
  if (health) {
    console.log("\n--- Vault Account [idx=" + health.accountIndex + "] ---");
    console.log("Capital:", health.capital.toString());
    console.log("PnL:", health.pnl.toString());
    console.log("Position:", health.positionSize.toString());
    console.log("Entry price:", health.entryPrice.toString());
  } else {
    console.log("\nVault account NOT FOUND in slab");
  }
}

main().catch(console.error);
