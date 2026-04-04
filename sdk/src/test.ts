/**
 * SDK test — reads vault state from devnet.
 * Usage: npx ts-node src/test.ts
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { SyntxClient, deriveVaultPda, SYNTX_PROGRAM_ID } from "./index";

const RPC = "https://api.devnet.solana.com";
const VAULT_PDA = new PublicKey("4pL2aQawAbc2XwjRE9ptrH4yxihn4BL2uVMavgZrtYUK");

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const client = new SyntxClient(connection, VAULT_PDA);

  console.log("=== Syntx SDK Test ===\n");

  // Read vault state
  const state = await client.getVaultState();
  console.log("Vault State:");
  console.log("  Manager:", state.manager.toBase58());
  console.log("  Collateral Mint:", state.collateralMint.toBase58());
  console.log("  Share Mint:", state.shareMint.toBase58());
  console.log("  Percolator Slab:", state.percolatorSlab.toBase58());
  console.log("  User Index:", state.percolatorUserIdx);
  console.log("  Total Shares:", state.totalShares.toString());
  console.log("  Total Deposits:", state.totalDeposits.toString());
  console.log("  Performance Fee:", state.performanceFeeBps, "bps");
  console.log("  Management Fee:", state.managementFeeBps, "bps");
  console.log("  Deposit Cap:", state.depositCap.toString());
  console.log("  Paused:", state.paused);
  console.log("  Initialized:", state.initialized);

  // Get vault info
  const info = await client.getVaultInfo();
  console.log("\nVault Info:");
  console.log("  Share Price:", info.sharePrice);
  console.log("  Total Equity:", info.totalEquity.toString());

  // Check deposit eligibility
  const canDep = await client.canDeposit(1_000_000n);
  console.log("\nCan deposit 1M units:", canDep.ok, canDep.reason || "");

  // Derive PDA verification
  const [derived] = deriveVaultPda(state.collateralMint, state.manager);
  console.log("\nPDA Verification:");
  console.log("  Expected:", VAULT_PDA.toBase58());
  console.log("  Derived: ", derived.toBase58());
  console.log("  Match:", derived.equals(VAULT_PDA));

  console.log("\n=== SDK Test Passed ===");
}

main().catch(console.error);
