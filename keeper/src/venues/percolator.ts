import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SYSVAR_CLOCK_PUBKEY,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { VenueAdapter, Position, OrderResult, VenueState } from "./types";
import { fetchSlab, parseEngine, getVaultHealth } from "../slab";
import { disc } from "../abi";

// =============================================================================
// Percolator constants
// =============================================================================

const PERC_KEEPER_CRANK = 5;
const PERC_PUSH_ORACLE_PRICE = 17;
const LP_IDX = 1;

// Engine offsets for funding rate
const ENGINE_OFF = 584;
const ENGINE_FUNDING_RATE_OFF = 200;

function readFundingRate(slabData: Buffer): bigint {
  return slabData.readBigInt64LE(ENGINE_OFF + ENGINE_FUNDING_RATE_OFF);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// PercolatorAdapter
// =============================================================================

export interface PercolatorConfig {
  connection: Connection;
  manager: Keypair;
  vaultPda: PublicKey;
  syntxProgramId: PublicKey;
  percolatorProgramId: PublicKey;
  percolatorSlab: PublicKey;
}

export class PercolatorAdapter implements VenueAdapter {
  readonly name = "Percolator";
  readonly type = "perp" as const;

  private config: PercolatorConfig;
  private cachedSlabData: Buffer | null = null;

  constructor(config: PercolatorConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    // Validate slab is reachable
    await fetchSlab(this.config.connection, this.config.percolatorSlab);
    console.log(`  [${this.name}] Initialized — slab ${this.config.percolatorSlab.toBase58().slice(0, 8)}...`);
  }

  async getPrice(_market: string): Promise<number> {
    // In production, fetch from Pyth oracle. For now, hardcoded.
    return 138.0;
  }

  async getPosition(): Promise<Position | null> {
    const slabData = await this.refreshSlab();
    const health = getVaultHealth(slabData, this.config.vaultPda);
    if (!health) return null;

    return {
      size: health.positionSize,
      entryPrice: health.entryPrice,
      pnl: health.pnl,
      capital: health.capital,
    };
  }

  async getVenueState(): Promise<VenueState> {
    const slabData = await this.refreshSlab();
    const engine = parseEngine(slabData);
    const fundingRate = readFundingRate(slabData);

    return {
      fundingRateBpsPerSlot: fundingRate,
      insuranceBalance: engine.insuranceBalance,
      numAccounts: engine.numUsedAccounts,
    };
  }

  async trade(size: bigint): Promise<OrderResult> {
    const tradeData = Buffer.alloc(26);
    const d = Buffer.from(disc("manager_trade"));
    d.copy(tradeData, 0);
    tradeData.writeUInt16LE(LP_IDX, 8);
    const sizeUnsigned = size < 0n ? (1n << 128n) + size : size;
    tradeData.writeBigUInt64LE(sizeUnsigned & 0xFFFFFFFFFFFFFFFFn, 10);
    tradeData.writeBigUInt64LE(sizeUnsigned >> 64n, 18);

    const tradeIx = new TransactionInstruction({
      programId: this.config.syntxProgramId,
      keys: [
        { pubkey: this.config.manager.publicKey, isSigner: true, isWritable: false },
        { pubkey: this.config.vaultPda, isSigner: false, isWritable: false },
        { pubkey: this.config.manager.publicKey, isSigner: true, isWritable: false },
        { pubkey: this.config.percolatorSlab, isSigner: false, isWritable: true },
        { pubkey: this.config.percolatorSlab, isSigner: false, isWritable: false },
        { pubkey: this.config.percolatorProgramId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: tradeData,
    });

    const tx = new Transaction().add(tradeIx);
    const sig = await sendAndConfirmTransaction(this.config.connection, tx, [this.config.manager]);

    const side = size > 0n ? "long" : "short";
    const absSize = size > 0n ? size : -size;
    console.log(`  [${this.name}] ${side.toUpperCase()} ${absSize} units → ${sig.slice(0, 16)}...`);

    return { signature: sig, side, size: absSize };
  }

  async crank(): Promise<void> {
    const { connection, manager, percolatorProgramId, percolatorSlab } = this.config;

    // 1. Push oracle price (with retry)
    const price = 138_000_000; // $138 — in production, fetch from Pyth
    await this.pushOracleWithRetry(price, 3);

    // 2. Crank funding settlement
    const crankData = Buffer.alloc(4);
    crankData.writeUInt8(PERC_KEEPER_CRANK, 0);
    crankData.writeUInt16LE(0xFFFF, 1);
    crankData.writeUInt8(0, 3);

    try {
      const tx = new Transaction().add(new TransactionInstruction({
        programId: percolatorProgramId,
        keys: [
          { pubkey: manager.publicKey, isSigner: true, isWritable: false },
          { pubkey: percolatorSlab, isSigner: false, isWritable: true },
          { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
          { pubkey: percolatorSlab, isSigner: false, isWritable: false },
        ],
        data: crankData,
      }));
      await sendAndConfirmTransaction(connection, tx, [manager]);
      console.log(`  [${this.name}] Crank OK`);
    } catch (err: any) {
      const logs = err?.transactionLogs || err?.logs || [];
      if (logs.length) {
        console.log(`  [${this.name}] Crank failed:`);
        for (const log of logs) console.log(`    ${log}`);
      } else {
        console.log(`  [${this.name}] Crank failed: ${err?.message?.slice(0, 150) || "unknown"}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async refreshSlab(): Promise<Buffer> {
    this.cachedSlabData = await fetchSlab(this.config.connection, this.config.percolatorSlab);
    return this.cachedSlabData;
  }

  private async pushOracleWithRetry(price: number, maxRetries: number): Promise<void> {
    const { connection, manager, percolatorProgramId, percolatorSlab } = this.config;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const now = Math.floor(Date.now() / 1000);
        const data = Buffer.alloc(17);
        data.writeUInt8(PERC_PUSH_ORACLE_PRICE, 0);
        data.writeBigUInt64LE(BigInt(price), 1);
        data.writeBigInt64LE(BigInt(now), 9);

        const tx = new Transaction().add(new TransactionInstruction({
          programId: percolatorProgramId,
          keys: [
            { pubkey: manager.publicKey, isSigner: true, isWritable: false },
            { pubkey: percolatorSlab, isSigner: false, isWritable: true },
          ],
          data,
        }));
        await sendAndConfirmTransaction(connection, tx, [manager]);
        console.log(`  [${this.name}] Oracle $${price / 1_000_000} pushed`);
        return;
      } catch (err: any) {
        if (attempt < maxRetries) {
          const delay = attempt * 2000;
          console.log(`  [${this.name}] Oracle attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms...`);
          await sleep(delay);
        } else {
          console.log(`  [${this.name}] Oracle all ${maxRetries} attempts failed: ${err?.message?.slice(0, 80) || "unknown"}`);
        }
      }
    }
  }
}
