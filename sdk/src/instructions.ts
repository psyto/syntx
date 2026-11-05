import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { disc, SYNTX_PROGRAM_ID } from "./constants";

// =============================================================================
// Instruction builders — return TransactionInstruction ready to add to a TX
// =============================================================================

/**
 * Create a new Syntx vault.
 *
 * The vault PDA is derived from `[b"vault", collateral_mint, manager]`.
 * The share mint must be pre-created with the vault PDA as mint authority.
 *
 * @param params.manager - Manager keypair (signer, payer for PDA rent)
 * @param params.vaultPda - Derived vault PDA address
 * @param params.collateralMint - SPL token mint for vault collateral (e.g., USDC)
 * @param params.shareMint - SPL token mint for vault shares (vault PDA is authority)
 * @param params.percolatorSlab - Percolator market slab account
 * @param params.percolatorProgram - Percolator program ID
 * @param params.performanceFeeBps - Performance fee in basis points (e.g., 2000 = 20%)
 * @param params.managementFeeBps - Annual management fee in basis points (e.g., 200 = 2%)
 * @param params.depositCap - Maximum total deposits (0 = unlimited)
 * @param params.minDrawdownBps - Immutable circuit breaker floor (e.g., 500 = 5%). Cannot be reduced after creation.
 */
export function createInitVaultIx(params: {
  manager: PublicKey;
  vaultPda: PublicKey;
  collateralMint: PublicKey;
  shareMint: PublicKey;
  percolatorSlab: PublicKey;
  percolatorProgram: PublicKey;
  performanceFeeBps: number;
  managementFeeBps: number;
  depositCap: bigint;
  minDrawdownBps: number;
  programId?: PublicKey;
}): TransactionInstruction {
  const pid = params.programId ?? SYNTX_PROGRAM_ID;

  const data = Buffer.alloc(8 + 2 + 2 + 8 + 2);
  disc("init_vault").copy(data, 0);
  data.writeUInt16LE(params.performanceFeeBps, 8);
  data.writeUInt16LE(params.managementFeeBps, 10);
  data.writeBigUInt64LE(params.depositCap, 12);
  data.writeUInt16LE(params.minDrawdownBps, 20);

  return new TransactionInstruction({
    programId: pid,
    keys: [
      { pubkey: params.manager, isSigner: true, isWritable: true },
      { pubkey: params.vaultPda, isSigner: false, isWritable: true },
      { pubkey: params.collateralMint, isSigner: false, isWritable: false },
      { pubkey: params.shareMint, isSigner: false, isWritable: false },
      { pubkey: params.percolatorSlab, isSigner: false, isWritable: false },
      { pubkey: params.percolatorProgram, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Deposit collateral into a Syntx vault. Mints proportional share tokens to the user.
 *
 * @param params.user - Depositor's public key (signer)
 * @param params.amount - Collateral amount in native units (e.g., 1_000_000 = 1 USDC)
 * @param params.vaultPda - Vault PDA address
 * @param params.userCollateral - User's collateral token account (ATA)
 * @param params.userShares - User's share token account (ATA, created if needed)
 * @param params.vaultCollateral - Vault's collateral token account (PDA-owned ATA)
 * @param params.shareMint - Share token mint address
 * @param params.percolatorSlab - Percolator market slab
 * @param params.percolatorVault - Percolator vault's collateral ATA
 * @param params.percolatorProgram - Percolator program ID
 */
export function createDepositIx(params: {
  user: PublicKey;
  vaultPda: PublicKey;
  userCollateral: PublicKey;
  userShares: PublicKey;
  vaultCollateral: PublicKey;
  shareMint: PublicKey;
  percolatorSlab: PublicKey;
  percolatorVault: PublicKey;
  percolatorProgram: PublicKey;
  amount: bigint;
  programId?: PublicKey;
}): TransactionInstruction {
  const pid = params.programId ?? SYNTX_PROGRAM_ID;

  const data = Buffer.alloc(8 + 8);
  disc("deposit").copy(data, 0);
  data.writeBigUInt64LE(params.amount, 8);

  return new TransactionInstruction({
    programId: pid,
    keys: [
      { pubkey: params.user, isSigner: true, isWritable: true },
      { pubkey: params.vaultPda, isSigner: false, isWritable: true },
      { pubkey: params.userCollateral, isSigner: false, isWritable: true },
      { pubkey: params.userShares, isSigner: false, isWritable: true },
      { pubkey: params.vaultCollateral, isSigner: false, isWritable: true },
      { pubkey: params.shareMint, isSigner: false, isWritable: true },
      { pubkey: params.percolatorSlab, isSigner: false, isWritable: true },
      { pubkey: params.percolatorVault, isSigner: false, isWritable: true },
      { pubkey: params.percolatorProgram, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Withdraw from a Syntx vault by burning share tokens.
 * Returns proportional collateral based on current share price.
 *
 * @param params.user - Withdrawer's public key (signer)
 * @param params.sharesToBurn - Number of share tokens to burn
 * @param params.vaultPda - Vault PDA address
 * @param params.userShares - User's share token account (ATA)
 * @param params.userCollateral - User's collateral token account (ATA)
 * @param params.vaultCollateral - Vault's collateral token account
 * @param params.shareMint - Share token mint address
 * @param params.percolatorSlab - Percolator market slab
 * @param params.percolatorVault - Percolator vault's collateral ATA
 * @param params.percolatorVaultAuthority - Percolator vault PDA (authority)
 * @param params.oracle - Oracle price feed account
 * @param params.percolatorProgram - Percolator program ID
 */
export function createWithdrawIx(params: {
  user: PublicKey;
  vaultPda: PublicKey;
  userShares: PublicKey;
  userCollateral: PublicKey;
  vaultCollateral: PublicKey;
  shareMint: PublicKey;
  percolatorSlab: PublicKey;
  percolatorVault: PublicKey;
  percolatorVaultAuthority: PublicKey;
  oracle: PublicKey;
  percolatorProgram: PublicKey;
  sharesToBurn: bigint;
  programId?: PublicKey;
}): TransactionInstruction {
  const pid = params.programId ?? SYNTX_PROGRAM_ID;

  const data = Buffer.alloc(8 + 8);
  disc("withdraw").copy(data, 0);
  data.writeBigUInt64LE(params.sharesToBurn, 8);

  return new TransactionInstruction({
    programId: pid,
    keys: [
      { pubkey: params.user, isSigner: true, isWritable: true },
      { pubkey: params.vaultPda, isSigner: false, isWritable: true },
      { pubkey: params.userShares, isSigner: false, isWritable: true },
      { pubkey: params.userCollateral, isSigner: false, isWritable: true },
      { pubkey: params.vaultCollateral, isSigner: false, isWritable: true },
      { pubkey: params.shareMint, isSigner: false, isWritable: true },
      { pubkey: params.percolatorSlab, isSigner: false, isWritable: true },
      { pubkey: params.percolatorVault, isSigner: false, isWritable: true },
      { pubkey: params.percolatorVaultAuthority, isSigner: false, isWritable: false },
      { pubkey: params.oracle, isSigner: false, isWritable: false },
      { pubkey: params.percolatorProgram, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Collect accumulated performance and management fees.
 * Mints new share tokens to the manager proportional to fees earned.
 * Only callable by the vault manager.
 *
 * @param params.manager - Vault manager (signer)
 * @param params.vaultPda - Vault PDA address
 * @param params.shareMint - Share token mint address
 * @param params.managerShares - Manager's share token account (receives fee shares)
 * @param params.vaultCollateral - Vault PDA's collateral token account
 *
 * Vault equity is computed on-chain (total_deposits, capped by the vault's
 * collateral balance for standalone vaults); it is not passed by the caller.
 */
export function createCollectFeesIx(params: {
  manager: PublicKey;
  vaultPda: PublicKey;
  shareMint: PublicKey;
  managerShares: PublicKey;
  vaultCollateral: PublicKey;
  programId?: PublicKey;
}): TransactionInstruction {
  const pid = params.programId ?? SYNTX_PROGRAM_ID;

  const data = Buffer.alloc(8);
  disc("collect_fees").copy(data, 0);

  return new TransactionInstruction({
    programId: pid,
    keys: [
      { pubkey: params.manager, isSigner: true, isWritable: false },
      { pubkey: params.vaultPda, isSigner: false, isWritable: true },
      { pubkey: params.shareMint, isSigner: false, isWritable: true },
      { pubkey: params.managerShares, isSigner: false, isWritable: true },
      { pubkey: params.vaultCollateral, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Propose a manager transfer. Starts a 48-hour timelock.
 * After the timelock, call executeManagerTransfer to complete.
 *
 * @param params.manager - Current vault manager (signer)
 * @param params.vaultPda - Vault PDA address
 * @param params.newManager - Proposed new manager public key
 */
export function createProposeManagerIx(params: {
  manager: PublicKey;
  vaultPda: PublicKey;
  newManager: PublicKey;
  programId?: PublicKey;
}): TransactionInstruction {
  const pid = params.programId ?? SYNTX_PROGRAM_ID;

  const data = Buffer.concat([
    disc("propose_manager"),
    params.newManager.toBuffer(),
  ]);

  return new TransactionInstruction({
    programId: pid,
    keys: [
      { pubkey: params.manager, isSigner: true, isWritable: false },
      { pubkey: params.vaultPda, isSigner: false, isWritable: true },
    ],
    data,
  });
}

/**
 * Execute a previously proposed manager transfer after the 48h timelock.
 * Callable by either the current or pending manager.
 *
 * @param params.caller - Current or pending manager (signer)
 * @param params.vaultPda - Vault PDA address
 */
export function createExecuteManagerTransferIx(params: {
  caller: PublicKey;
  vaultPda: PublicKey;
  programId?: PublicKey;
}): TransactionInstruction {
  const pid = params.programId ?? SYNTX_PROGRAM_ID;

  return new TransactionInstruction({
    programId: pid,
    keys: [
      { pubkey: params.caller, isSigner: true, isWritable: false },
      { pubkey: params.vaultPda, isSigner: false, isWritable: true },
    ],
    data: disc("execute_manager_transfer"),
  });
}

/**
 * Cancel a pending manager transfer. Only callable by the current manager.
 *
 * @param params.manager - Current vault manager (signer)
 * @param params.vaultPda - Vault PDA address
 */
export function createCancelManagerTransferIx(params: {
  manager: PublicKey;
  vaultPda: PublicKey;
  programId?: PublicKey;
}): TransactionInstruction {
  const pid = params.programId ?? SYNTX_PROGRAM_ID;

  return new TransactionInstruction({
    programId: pid,
    keys: [
      { pubkey: params.manager, isSigner: true, isWritable: false },
      { pubkey: params.vaultPda, isSigner: false, isWritable: true },
    ],
    data: disc("cancel_manager_transfer"),
  });
}
