import { Connection, PublicKey } from "@solana/web3.js";

// =============================================================================
// Layout constants (from percolator-cli latest, 2026-04-04)
// =============================================================================

const MAGIC: bigint = 0x504552434f4c4154n; // "PERCOLAT"
const HEADER_LEN = 72;
const CONFIG_LEN = 512;
const FLAG_RESOLVED = 1 << 0;

// RiskEngine offset = align_up(HEADER_LEN + CONFIG_LEN, 8)
const ENGINE_OFF = 584;

// Engine field offsets (relative to ENGINE_OFF)
const ENGINE_VAULT_OFF = 0;               // U128
const ENGINE_INSURANCE_BAL_OFF = 16;      // U128 (insurance_fund.balance)
const ENGINE_NUM_USED_OFF = 1120;         // u16
const ENGINE_ACCOUNTS_OFF = 9336;         // accounts: [Account; MAX_ACCOUNTS]

const ACCOUNT_SIZE = 280;

// Account field offsets (relative to account start)
const ACCT_CAPITAL_OFF = 8;               // U128 (16 bytes)
const ACCT_KIND_OFF = 24;                 // u8
const ACCT_PNL_OFF = 32;                  // i128 (16 bytes)
const ACCT_POSITION_BASIS_Q_OFF = 88;     // i128 (was position_size)
const ACCT_ENTRY_PRICE_OFF = 104;         // u64
const ACCT_OWNER_OFF = 208;              // [u8; 32]

// =============================================================================
// BigInt helpers
// =============================================================================

function readU128LE(buf: Buffer, offset: number): bigint {
  const lo = buf.readBigUInt64LE(offset);
  const hi = buf.readBigUInt64LE(offset + 8);
  return lo | (hi << 64n);
}

function readI128LE(buf: Buffer, offset: number): bigint {
  const unsigned = readU128LE(buf, offset);
  if (unsigned >= 1n << 127n) return unsigned - (1n << 128n);
  return unsigned;
}

// =============================================================================
// Types
// =============================================================================

export interface SlabHeader {
  version: number;
  bump: number;
  resolved: boolean;
  admin: PublicKey;
}

export interface EngineState {
  vault: bigint;
  insuranceBalance: bigint;
  numUsedAccounts: number;
}

export interface VaultHealth {
  capital: bigint;
  pnl: bigint;
  positionSize: bigint;
  entryPrice: bigint;
  accountIndex: number;
}

// =============================================================================
// Fetch + Parse
// =============================================================================

export async function fetchSlab(connection: Connection, slabPubkey: PublicKey): Promise<Buffer> {
  const info = await connection.getAccountInfo(slabPubkey);
  if (!info) throw new Error(`Slab not found: ${slabPubkey.toBase58()}`);
  return Buffer.from(info.data);
}

export function parseHeader(data: Buffer): SlabHeader {
  const magic = data.readBigUInt64LE(0);
  if (magic !== MAGIC) throw new Error(`Invalid magic: ${magic.toString(16)}`);
  return {
    version: data.readUInt32LE(8),
    bump: data.readUInt8(12),
    resolved: (data.readUInt8(13) & FLAG_RESOLVED) !== 0,
    admin: new PublicKey(data.subarray(16, 48)),
  };
}

export function parseEngine(data: Buffer): EngineState {
  const base = ENGINE_OFF;
  return {
    vault: readU128LE(data, base + ENGINE_VAULT_OFF),
    insuranceBalance: readU128LE(data, base + ENGINE_INSURANCE_BAL_OFF),
    numUsedAccounts: data.readUInt16LE(base + ENGINE_NUM_USED_OFF),
  };
}

export function getVaultHealth(data: Buffer, vaultPda: PublicKey): VaultHealth | null {
  const engine = parseEngine(data);
  const vaultBytes = vaultPda.toBuffer();

  for (let i = 0; i < Math.min(engine.numUsedAccounts + 10, 100); i++) {
    const base = ENGINE_OFF + ENGINE_ACCOUNTS_OFF + i * ACCOUNT_SIZE;
    if (base + ACCOUNT_SIZE > data.length) break;

    const ownerBytes = data.subarray(base + ACCT_OWNER_OFF, base + ACCT_OWNER_OFF + 32);
    if (Buffer.compare(ownerBytes, vaultBytes) === 0) {
      return {
        capital: readU128LE(data, base + ACCT_CAPITAL_OFF),
        pnl: readI128LE(data, base + ACCT_PNL_OFF),
        positionSize: readI128LE(data, base + ACCT_POSITION_BASIS_Q_OFF),
        entryPrice: BigInt(data.readBigUInt64LE(base + ACCT_ENTRY_PRICE_OFF)),
        accountIndex: i,
      };
    }
  }
  return null;
}
