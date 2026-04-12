import { PublicKey } from "@solana/web3.js";
import dotenv from "dotenv";

dotenv.config();

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
}

function optionalEnv(key: string): string | undefined {
  return process.env[key];
}

function envPubkey(key: string): PublicKey {
  return new PublicKey(requireEnv(key));
}

function optionalPubkey(key: string): PublicKey | undefined {
  const val = optionalEnv(key);
  return val ? new PublicKey(val) : undefined;
}

export type VenueType = "percolator" | "phoenix" | "jupiter" | "router";

export interface Config {
  rpcUrl: string;
  managerKeypairPath: string;
  venue: VenueType;
  crankIntervalMs: number;

  // Syntx program
  syntxProgramId: PublicKey;
  vaultPda: PublicKey;
  collateralMint: PublicKey;

  // Percolator-specific (required when venue=percolator)
  percolatorProgramId?: PublicKey;
  percolatorSlab?: PublicKey;

  // Phoenix-specific (required when venue=phoenix)
  phoenixProgramId?: PublicKey;
  phoenixMarket?: PublicKey;

  // Jupiter Perps-specific (required when venue=jupiter)
  jupiterMarket?: string; // "SOL", "BTC", or "ETH"
}

export function loadConfig(): Config {
  const venue = (optionalEnv("VENUE") ?? "percolator") as VenueType;

  const config: Config = {
    rpcUrl: requireEnv("SOLANA_RPC_URL"),
    managerKeypairPath: requireEnv("MANAGER_KEYPAIR_PATH"),
    venue,
    crankIntervalMs: parseInt(process.env.CRANK_INTERVAL_MS ?? "30000", 10),
    syntxProgramId: envPubkey("SYNTX_PROGRAM_ID"),
    vaultPda: envPubkey("VAULT_PDA"),
    collateralMint: envPubkey("COLLATERAL_MINT"),
  };

  if (venue === "percolator" || venue === "router") {
    config.percolatorProgramId = envPubkey("PERCOLATOR_PROGRAM_ID");
    config.percolatorSlab = envPubkey("PERCOLATOR_SLAB");
  }

  if (venue === "phoenix" || venue === "router") {
    config.phoenixMarket = optionalPubkey("PHOENIX_MARKET");
  }

  if (venue === "jupiter" || venue === "router") {
    config.jupiterMarket = optionalEnv("JUPITER_MARKET") ?? "SOL";
  }

  return config;
}
