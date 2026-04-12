import {
  Connection,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { VaultState, VaultInfo } from "./types";
import { fetchVaultState } from "./accounts";
import { createDepositIx, createWithdrawIx } from "./instructions";
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
   * Derive the Percolator vault ATA from vault state.
   */
  private async getPercolatorVaultAta(state: VaultState): Promise<PublicKey> {
    const [percVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), state.percolatorSlab.toBuffer()],
      state.percolatorProgram,
    );
    return getAssociatedTokenAddress(state.collateralMint, percVaultPda, true);
  }

  /**
   * Build a deposit transaction. Creates share token ATA if needed.
   */
  async buildDepositTx(user: PublicKey, amount: bigint): Promise<Transaction> {
    const state = await this.getVaultState(true);
    const userCollateral = await getAssociatedTokenAddress(state.collateralMint, user);
    const userShares = await getAssociatedTokenAddress(state.shareMint, user);
    const vaultCollateral = await getAssociatedTokenAddress(state.collateralMint, this.vaultPda, true);
    const percVaultAta = await this.getPercolatorVaultAta(state);

    const tx = new Transaction();

    // Create share ATA if it doesn't exist
    try {
      await this.connection.getTokenAccountBalance(userShares);
    } catch {
      tx.add(createAssociatedTokenAccountInstruction(user, userShares, user, state.shareMint));
    }

    tx.add(createDepositIx({
      user,
      vaultPda: this.vaultPda,
      userCollateral,
      userShares,
      vaultCollateral,
      shareMint: state.shareMint,
      percolatorSlab: state.percolatorSlab,
      percolatorVault: percVaultAta,
      percolatorProgram: state.percolatorProgram,
      amount,
      programId: this.programId,
    }));

    return tx;
  }

  /**
   * Build a withdraw transaction. Creates collateral ATA if needed.
   * Accepts dollar amount — converts to shares internally.
   */
  async buildWithdrawTx(user: PublicKey, sharesToBurn: bigint): Promise<Transaction> {
    const state = await this.getVaultState(true);
    const userShares = await getAssociatedTokenAddress(state.shareMint, user);
    const userCollateral = await getAssociatedTokenAddress(state.collateralMint, user);
    const vaultCollateral = await getAssociatedTokenAddress(state.collateralMint, this.vaultPda, true);
    const percVaultAta = await this.getPercolatorVaultAta(state);

    const [percVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), state.percolatorSlab.toBuffer()],
      state.percolatorProgram,
    );

    const tx = new Transaction();

    // Create collateral ATA if it doesn't exist
    try {
      await this.connection.getTokenAccountBalance(userCollateral);
    } catch {
      tx.add(createAssociatedTokenAccountInstruction(user, userCollateral, user, state.collateralMint));
    }

    tx.add(createWithdrawIx({
      user,
      vaultPda: this.vaultPda,
      userShares,
      userCollateral,
      vaultCollateral,
      shareMint: state.shareMint,
      percolatorSlab: state.percolatorSlab,
      percolatorVault: percVaultAta,
      percolatorVaultAuthority: percVaultPda,
      oracle: state.percolatorSlab, // oracle = slab in authority mode
      percolatorProgram: state.percolatorProgram,
      sharesToBurn,
      programId: this.programId,
    }));

    return tx;
  }

  /**
   * Build a withdraw transaction from a dollar amount.
   * Converts USDC amount to shares based on current share price.
   */
  async buildWithdrawByAmountTx(user: PublicKey, usdcAmount: number): Promise<Transaction> {
    const info = await this.getVaultInfo();
    const shares = info.sharePrice > 0
      ? BigInt(Math.floor(usdcAmount * 1_000_000 / info.sharePrice))
      : 0n;
    if (shares === 0n) throw new Error("Invalid amount — zero shares");
    return this.buildWithdrawTx(user, shares);
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
