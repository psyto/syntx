import { Connection, Keypair } from "@solana/web3.js";
import { readFileSync } from "fs";
import { loadConfig } from "./config";
import { runKeeper } from "./keeper";
import { VenueAdapter, PercolatorAdapter, PhoenixAdapter, VenueRouter } from "./venues";

function loadKeypair(path: string): Keypair {
  const resolved = path.replace("~", process.env.HOME ?? "");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(resolved, "utf-8"))));
}

function createVenue(config: ReturnType<typeof loadConfig>): VenueAdapter {
  const connection = new Connection(config.rpcUrl, "confirmed");
  const manager = loadKeypair(config.managerKeypairPath);

  console.log(`  Manager: ${manager.publicKey.toBase58()}`);

  switch (config.venue) {
    case "percolator":
      if (!config.percolatorProgramId || !config.percolatorSlab) {
        throw new Error("Percolator venue requires PERCOLATOR_PROGRAM_ID and PERCOLATOR_SLAB");
      }
      return new PercolatorAdapter({
        connection,
        manager,
        vaultPda: config.vaultPda,
        syntxProgramId: config.syntxProgramId,
        percolatorProgramId: config.percolatorProgramId,
        percolatorSlab: config.percolatorSlab,
      });

    case "phoenix":
      if (!config.phoenixMarket) {
        throw new Error("Phoenix venue requires PHOENIX_MARKET");
      }
      return new PhoenixAdapter({
        connection,
        manager,
        vaultPda: config.vaultPda,
        marketAddress: config.phoenixMarket,
      });

    case "router": {
      const venues: VenueAdapter[] = [];

      if (config.percolatorProgramId && config.percolatorSlab) {
        venues.push(new PercolatorAdapter({
          connection,
          manager,
          vaultPda: config.vaultPda,
          syntxProgramId: config.syntxProgramId,
          percolatorProgramId: config.percolatorProgramId,
          percolatorSlab: config.percolatorSlab,
        }));
      }

      if (config.phoenixMarket) {
        venues.push(new PhoenixAdapter({
          connection,
          manager,
          vaultPda: config.vaultPda,
          marketAddress: config.phoenixMarket,
        }));
      }

      if (venues.length === 0) {
        throw new Error("Router venue requires at least one venue configured (Percolator and/or Phoenix)");
      }

      return new VenueRouter(venues);
    }

    default:
      throw new Error(`Unknown venue: ${config.venue}`);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const venue = createVenue(config);
  await runKeeper(venue, { crankIntervalMs: config.crankIntervalMs });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
