import {
  Connection,
  PublicKey,
  Transaction,
  Keypair,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { VaultState, VaultInfo, VaultHealth } from "./types";
import { fetchVaultState } from "./accounts";
import { createDepositIx, createWithdrawIx, createCollectFeesIx } from "./instructions";
import { deriveVaultPda, SYNTX_PROGRAM_ID } from "./constants";

/**
 * High-level Syntx client for interacting with a vault.
 *
 * Usage:
 * ```ts
 * const client = new SyntxClient(connection, vaultPda);
 * const info = await client.getVaultInfo();
 * console.log("Share price:", info.sharePrice);
 * ```
 */
export class SyntxClient {
  readonly connection: Connection;
  readonly vaultPda: PublicKey;
  readonly programId: PublicKey;

  private _state: VaultState | null = null;

  constructor(
    connection: Connection,
    vaultPda: PublicKey,
    programId: PublicKey = SYNTX_PROGRAM_ID,
  ) {
    this.connection = connection;
    this.vaultPda = vaultPda;
    this.programId = programId;
  }

  /**
   * Create a client by deriving the vault PDA from mint + manager.
   */
  static fromMintAndManager(
    connection: Connection,
    collateralMint: PublicKey,
    manager: PublicKey,
    programId: PublicKey = SYNTX_PROGRAM_ID,
  ): SyntxClient {
    const [vaultPda] = deriveVaultPda(collateralMint, manager, programId);
    return new SyntxClient(connection, vaultPda, programId);
  }

  /**
   * Fetch the raw VaultState from chain.
   */
  async getVaultState(refresh = false): Promise<VaultState> {
    if (!this._state || refresh) {
      this._state = await fetchVaultState(this.connection, this.vaultPda);
    }
    return this._state;
  }

  /**
   * Get human-readable vault info including share price.
   */
  async getVaultInfo(): Promise<VaultInfo> {
    const state = await this.getVaultState(true);

    const totalEquity = state.totalDeposits; // simplified — full version reads Percolator PnL
    const sharePrice = state.totalShares > 0n
      ? Number(totalEquity) / Number(state.totalShares)
      : 1.0;

    return {
      sharePrice,
      totalEquity,
      totalShares: state.totalShares,
      totalDeposits: state.totalDeposits,
      paused: state.paused,
      depositCap: state.depositCap,
      performanceFeeBps: state.performanceFeeBps,
      managementFeeBps: state.managementFeeBps,
    };
  }

  /**
   * Get the user's share balance for this vault.
   */
  async getUserShares(userPubkey: PublicKey): Promise<bigint> {
    const state = await this.getVaultState();
    const ata = await getAssociatedTokenAddress(state.shareMint, userPubkey);
    try {
      const balance = await this.connection.getTokenAccountBalance(ata);
      return BigInt(balance.value.amount);
    } catch {
      return 0n; // account doesn't exist
    }
  }

  /**
   * Calculate how much collateral a share amount is worth.
   */
  async sharesToCollateral(shares: bigint): Promise<bigint> {
    const state = await this.getVaultState(true);
    if (state.totalShares === 0n) return 0n;
    return (shares * state.totalDeposits) / state.totalShares;
  }

  /**
   * Calculate how many shares a collateral amount would mint.
   */
  async collateralToShares(amount: bigint): Promise<bigint> {
    const state = await this.getVaultState(true);
    if (state.totalShares === 0n) return amount; // 1:1 on first deposit
    return (amount * state.totalShares) / state.totalDeposits;
  }

  /**
   * Build a deposit transaction (does not send).
   */
  async buildDepositTx(
    user: PublicKey,
    amount: bigint,
    userCollateral: PublicKey,
    userShares: PublicKey,
  ): Promise<Transaction> {
    const state = await this.getVaultState(true);
    const vaultCollateral = await getAssociatedTokenAddress(
      state.collateralMint, this.vaultPda, true,
    );

    // Read devnet-vault.json for percolator vault address
    // For now, caller must provide these
    throw new Error("Use createDepositIx directly — need percolatorVault address");
  }

  /**
   * Check if the vault can accept a deposit of the given amount.
   */
  async canDeposit(amount: bigint): Promise<{ ok: boolean; reason?: string }> {
    const state = await this.getVaultState(true);
    if (state.paused) return { ok: false, reason: "Vault is paused" };
    if (!state.initialized) return { ok: false, reason: "Vault not initialized" };
    if (state.depositCap > 0n && state.totalDeposits + amount > state.depositCap) {
      return { ok: false, reason: `Exceeds deposit cap (${state.depositCap})` };
    }
    return { ok: true };
  }
}
