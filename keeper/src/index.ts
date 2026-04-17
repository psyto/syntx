import { Connection, Keypair } from "@solana/web3.js";
import { readFileSync } from "fs";
import { loadConfig, Config } from "./config";
import { runKeeper } from "./keeper";
import { runStructuredKeeper } from "./structured-keeper";
import { DEFAULT_CONFIG as DEFAULT_STRUCTURED_CONFIG } from "./structured-strategy";
import { DEFAULT_DELTA_CONFIG } from "./delta-hedge-strategy";
import { runIntentKeeper } from "./intent-keeper";
import { VenueAdapter, PercolatorAdapter, PhoenixAdapter, JupiterPerpsAdapter, KaminoAdapter, VenueRouter } from "./venues";

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

    case "jupiter":
      return new JupiterPerpsAdapter({
        connection,
        manager,
        vaultPda: config.vaultPda,
        market: config.jupiterMarket ?? "SOL",
      });

    case "kamino":
      return new KaminoAdapter({
        connection,
        manager,
        vaultPda: config.vaultPda,
        marketAddress: config.kaminoMarket,
        reserveMint: config.kaminoReserve,
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

      if (config.jupiterMarket) {
        venues.push(new JupiterPerpsAdapter({
          connection,
          manager,
          vaultPda: config.vaultPda,
          market: config.jupiterMarket,
        }));
      }

      if (config.kaminoMarket) {
        venues.push(new KaminoAdapter({
          connection,
          manager,
          vaultPda: config.vaultPda,
          marketAddress: config.kaminoMarket,
          reserveMint: config.kaminoReserve,
        }));
      }

      if (venues.length === 0) {
        throw new Error("Router venue requires at least one venue configured");
      }

      return new VenueRouter(venues);
    }

    default:
      throw new Error(`Unknown venue: ${config.venue}`);
  }
}

function createSpotVenue(config: Config, connection: Connection, manager: Keypair): VenueAdapter {
  const spotVenueType = config.spotVenue ?? "phoenix";
  switch (spotVenueType) {
    case "phoenix":
      if (!config.phoenixMarket) throw new Error("Structured strategy requires PHOENIX_MARKET for spot venue");
      return new PhoenixAdapter({ connection, manager, vaultPda: config.vaultPda, marketAddress: config.phoenixMarket });
    case "jupiter":
      return new JupiterPerpsAdapter({ connection, manager, vaultPda: config.vaultPda, market: config.jupiterMarket ?? "SOL" });
    default:
      throw new Error(`Unsupported spot venue for structured strategy: ${spotVenueType}`);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();

  if (config.strategy === "intent") {
    const connection = new Connection(config.rpcUrl, "confirmed");
    const manager = loadKeypair(config.managerKeypairPath);

    // Collect all perp venues for intent routing
    const venues: VenueAdapter[] = [];

    if (config.percolatorProgramId && config.percolatorSlab) {
      venues.push(new PercolatorAdapter({
        connection, manager, vaultPda: config.vaultPda,
        syntxProgramId: config.syntxProgramId,
        percolatorProgramId: config.percolatorProgramId,
        percolatorSlab: config.percolatorSlab,
      }));
    }

    if (config.jupiterMarket) {
      venues.push(new JupiterPerpsAdapter({
        connection, manager, vaultPda: config.vaultPda,
        market: config.jupiterMarket,
      }));
    }

    if (config.phoenixMarket) {
      venues.push(new PhoenixAdapter({
        connection, manager, vaultPda: config.vaultPda,
        marketAddress: config.phoenixMarket,
      }));
    }

    if (venues.length === 0) {
      throw new Error("Intent strategy requires at least one venue configured");
    }

    await runIntentKeeper(venues, {
      pollIntervalMs: config.crankIntervalMs,
      minVenueScore: 10,
    });
  } else if (config.strategy === "structured") {
    const connection = new Connection(config.rpcUrl, "confirmed");
    const manager = loadKeypair(config.managerKeypairPath);

    const lendingVenue = new KaminoAdapter({
      connection, manager, vaultPda: config.vaultPda,
      marketAddress: config.kaminoMarket, reserveMint: config.kaminoReserve,
    });
    const spotVenue = createSpotVenue(config, connection, manager);

    // Total capital function — reads vault's USDC balance
    // In production, read from on-chain vault state
    const totalCapitalFn = async (): Promise<bigint> => {
      const lendingPos = await lendingVenue.getPosition();
      const spotPos = await spotVenue.getPosition();
      return (lendingPos?.capital ?? 0n) + (spotPos?.capital ?? 0n);
    };

    await runStructuredKeeper(lendingVenue, spotVenue, totalCapitalFn, {
      crankIntervalMs: config.crankIntervalMs,
      strategy: {
        ...DEFAULT_STRUCTURED_CONFIG,
        protectionHorizonDays: config.protectionHorizonDays ?? 30,
      },
      deltaHedge: {
        ...DEFAULT_DELTA_CONFIG,
        strikePrice: config.strikePrice ?? 0,
        impliedVol: config.impliedVol ?? 0.80,
        leverage: config.leverage ?? 5,
        rebalanceThreshold: config.rebalanceThreshold ?? 0.05,
        expiryDays: config.protectionHorizonDays ?? 30,
      },
    });
  } else {
    const venue = createVenue(config);
    await runKeeper(venue, { crankIntervalMs: config.crankIntervalMs });
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
