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

function envPubkey(key: string): PublicKey {
  return new PublicKey(requireEnv(key));
}

export interface Config {
  rpcUrl: string;
  managerKeypairPath: string;
  syntxProgramId: PublicKey;
  percolatorProgramId: PublicKey;
  percolatorSlab: PublicKey;
  vaultPda: PublicKey;
  collateralMint: PublicKey;
  crankIntervalMs: number;
}

export function loadConfig(): Config {
  return {
    rpcUrl: requireEnv("SOLANA_RPC_URL"),
    managerKeypairPath: requireEnv("MANAGER_KEYPAIR_PATH"),
    syntxProgramId: envPubkey("SYNTX_PROGRAM_ID"),
    percolatorProgramId: envPubkey("PERCOLATOR_PROGRAM_ID"),
    percolatorSlab: envPubkey("PERCOLATOR_SLAB"),
    vaultPda: envPubkey("VAULT_PDA"),
    collateralMint: envPubkey("COLLATERAL_MINT"),
    crankIntervalMs: parseInt(process.env.CRANK_INTERVAL_MS ?? "30000", 10),
  };
}
