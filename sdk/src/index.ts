// Core client
export { SyntxClient } from "./client";

// Types
export type { VaultState, VaultHealth, VaultInfo } from "./types";

// Account parsers
export { fetchVaultState, fetchAllVaults, parseVaultState } from "./accounts";

// Instruction builders
export {
  createInitVaultIx,
  createDepositIx,
  createWithdrawIx,
  createCollectFeesIx,
} from "./instructions";

// Constants + helpers
export { SYNTX_PROGRAM_ID, disc, deriveVaultPda } from "./constants";
