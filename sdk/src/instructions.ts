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
  programId?: PublicKey;
}): TransactionInstruction {
  const pid = params.programId ?? SYNTX_PROGRAM_ID;

  const data = Buffer.alloc(8 + 2 + 2 + 8);
  disc("init_vault").copy(data, 0);
  data.writeUInt16LE(params.performanceFeeBps, 8);
  data.writeUInt16LE(params.managementFeeBps, 10);
  data.writeBigUInt64LE(params.depositCap, 12);

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

export function createCollectFeesIx(params: {
  manager: PublicKey;
  vaultPda: PublicKey;
  shareMint: PublicKey;
  managerShares: PublicKey;
  vaultEquity: bigint;
  programId?: PublicKey;
}): TransactionInstruction {
  const pid = params.programId ?? SYNTX_PROGRAM_ID;

  const data = Buffer.alloc(8 + 8);
  disc("collect_fees").copy(data, 0);
  data.writeBigUInt64LE(params.vaultEquity, 8);

  return new TransactionInstruction({
    programId: pid,
    keys: [
      { pubkey: params.manager, isSigner: true, isWritable: false },
      { pubkey: params.vaultPda, isSigner: false, isWritable: true },
      { pubkey: params.shareMint, isSigner: false, isWritable: true },
      { pubkey: params.managerShares, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}
