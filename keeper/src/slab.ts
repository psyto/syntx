import { Connection, PublicKey } from "@solana/web3.js";

// =============================================================================
// Layout constants (from percolator-cli/src/solana/slab.ts)
// =============================================================================

const MAGIC: bigint = 0x504552434f4c4154n; // "PERCOLAT"
const HEADER_LEN = 72;
const CONFIG_OFFSET = HEADER_LEN;
const CONFIG_LEN = 368;
const RESERVED_OFF = 48;
const FLAG_RESOLVED = 1 << 0;

// RiskEngine starts after header + config
const ENGINE_OFF = 440;

// Engine field offsets
const ENGINE_VAULT_OFF = 0;
const ENGINE_INSURANCE_OFF = 16;
const ENGINE_CURRENT_SLOT_OFF = 192;
const ENGINE_FUNDING_INDEX_OFF = 200;
const ENGINE_LAST_FUNDING_SLOT_OFF = 216;
const ENGINE_FUNDING_RATE_BPS_OFF = 224;
const ENGINE_LAST_CRANK_SLOT_OFF = 232;
const ENGINE_TOTAL_OI_OFF = 248;
const ENGINE_C_TOT_OFF = 264;
const ENGINE_PNL_POS_TOT_OFF = 280;
const ENGINE_NUM_USED_OFF = 920;
const ENGINE_BITMAP_OFF = 408;
const ENGINE_ACCOUNTS_OFF = 9136;

const BITMAP_WORDS = 64;
const MAX_ACCOUNTS = 4096;
const ACCOUNT_SIZE = 240;

// Account field offsets
const ACCT_ACCOUNT_ID_OFF = 0;
const ACCT_CAPITAL_OFF = 8;
const ACCT_KIND_OFF = 24;
const ACCT_PNL_OFF = 32;
const ACCT_POSITION_SIZE_OFF = 80;
const ACCT_ENTRY_PRICE_OFF = 96;
const ACCT_FUNDING_INDEX_OFF = 104;
const ACCT_OWNER_OFF = 184;

// =============================================================================
// Helper: read i128/u128 from buffer
// =============================================================================

function readI128LE(buf: Buffer, offset: number): bigint {
  const lo = buf.readBigUInt64LE(offset);
  const hi = buf.readBigUInt64LE(offset + 8);
  const unsigned = (hi << 64n) | lo;
  const SIGN_BIT = 1n << 127n;
  if (unsigned >= SIGN_BIT) {
    return unsigned - (1n << 128n);
  }
  return unsigned;
}

function readU128LE(buf: Buffer, offset: number): bigint {
  const lo = buf.readBigUInt64LE(offset);
  const hi = buf.readBigUInt64LE(offset + 8);
  return (hi << 64n) | lo;
}

// =============================================================================
// Interfaces
// =============================================================================

export interface SlabHeader {
  magic: bigint;
  version: number;
  bump: number;
  flags: number;
  resolved: boolean;
  admin: PublicKey;
  nonce: bigint;
  lastThrUpdateSlot: bigint;
}

export interface MarketConfig {
  collateralMint: PublicKey;
  vaultPubkey: PublicKey;
  indexFeedId: PublicKey;
  maxStalenessSlots: bigint;
  confFilterBps: number;
  invert: number;
  unitScale: number;
  fundingHorizonSlots: bigint;
  fundingKBps: bigint;
  fundingMaxPremiumBps: bigint;
  fundingMaxBpsPerSlot: bigint;
}

export interface EngineState {
  vault: bigint;
  insuranceBalance: bigint;
  insuranceFeeRevenue: bigint;
  currentSlot: bigint;
  fundingIndexQpbE6: bigint;
  lastFundingSlot: bigint;
  fundingRateBpsPerSlotLast: bigint;
  lastCrankSlot: bigint;
  totalOpenInterest: bigint;
  cTot: bigint;
  pnlPosTot: bigint;
  numUsedAccounts: number;
}

export enum AccountKind {
  User = 0,
  LP = 1,
}

export interface SlabAccount {
  kind: AccountKind;
  accountId: bigint;
  capital: bigint;
  pnl: bigint;
  positionSize: bigint;
  entryPrice: bigint;
  fundingIndex: bigint;
  owner: PublicKey;
}

/** Aggregated vault health snapshot */
export interface VaultHealth {
  capital: bigint;
  pnl: bigint;
  positionSize: bigint;
  entryPrice: bigint;
  fundingRateBpsPerSlot: bigint;
  totalOI: bigint;
  lastCrankSlot: bigint;
  currentSlot: bigint;
  slotsSinceCrank: bigint;
}

// =============================================================================
// Fetch + Parse
// =============================================================================

/**
 * Fetch raw slab account data from the chain.
 */
export async function fetchSlab(
  connection: Connection,
  slabPubkey: PublicKey,
): Promise<Buffer> {
  const info = await connection.getAccountInfo(slabPubkey);
  if (!info) {
    throw new Error(`Slab account not found: ${slabPubkey.toBase58()}`);
  }
  return Buffer.from(info.data);
}

/**
 * Parse slab header (first 72 bytes).
 */
export function parseHeader(data: Buffer): SlabHeader {
  if (data.length < HEADER_LEN) {
    throw new Error(`Slab data too short for header: ${data.length}`);
  }

  const magic = data.readBigUInt64LE(0);
  if (magic !== MAGIC) {
    throw new Error(
      `Invalid slab magic: expected ${MAGIC.toString(16)}, got ${magic.toString(16)}`,
    );
  }

  const version = data.readUInt32LE(8);
  const bump = data.readUInt8(12);
  const flags = data.readUInt8(13);
  const admin = new PublicKey(data.subarray(16, 48));
  const nonce = data.readBigUInt64LE(RESERVED_OFF);
  const lastThrUpdateSlot = data.readBigUInt64LE(RESERVED_OFF + 8);

  return {
    magic,
    version,
    bump,
    flags,
    resolved: (flags & FLAG_RESOLVED) !== 0,
    admin,
    nonce,
    lastThrUpdateSlot,
  };
}

/**
 * Parse market config (starts at byte 72).
 */
export function parseConfig(data: Buffer): MarketConfig {
  const minLen = CONFIG_OFFSET + CONFIG_LEN;
  if (data.length < minLen) {
    throw new Error(`Slab data too short for config: ${data.length}`);
  }

  let off = CONFIG_OFFSET;

  const collateralMint = new PublicKey(data.subarray(off, off + 32));
  off += 32;
  const vaultPubkey = new PublicKey(data.subarray(off, off + 32));
  off += 32;
  const indexFeedId = new PublicKey(data.subarray(off, off + 32));
  off += 32;
  const maxStalenessSlots = data.readBigUInt64LE(off);
  off += 8;
  const confFilterBps = data.readUInt16LE(off);
  off += 2;
  // skip vaultAuthorityBump (1) + invert (1) + unitScale (4)
  off += 1;
  const invert = data.readUInt8(off);
  off += 1;
  const unitScale = data.readUInt32LE(off);
  off += 4;

  const fundingHorizonSlots = data.readBigUInt64LE(off);
  off += 8;
  const fundingKBps = data.readBigUInt64LE(off);
  off += 8;
  // skip fundingInvScaleNotionalE6 (16)
  off += 16;
  const fundingMaxPremiumBps = data.readBigUInt64LE(off);
  off += 8;
  const fundingMaxBpsPerSlot = data.readBigUInt64LE(off);

  return {
    collateralMint,
    vaultPubkey,
    indexFeedId,
    maxStalenessSlots,
    confFilterBps,
    invert,
    unitScale,
    fundingHorizonSlots,
    fundingKBps,
    fundingMaxPremiumBps,
    fundingMaxBpsPerSlot,
  };
}

/**
 * Parse RiskEngine state (summary fields only).
 */
export function parseEngine(data: Buffer): EngineState {
  const base = ENGINE_OFF;
  if (data.length < base + ENGINE_ACCOUNTS_OFF) {
    throw new Error("Slab data too short for RiskEngine");
  }

  return {
    vault: readU128LE(data, base + ENGINE_VAULT_OFF),
    insuranceBalance: readU128LE(data, base + ENGINE_INSURANCE_OFF),
    insuranceFeeRevenue: readU128LE(data, base + ENGINE_INSURANCE_OFF + 16),
    currentSlot: data.readBigUInt64LE(base + ENGINE_CURRENT_SLOT_OFF),
    fundingIndexQpbE6: readI128LE(data, base + ENGINE_FUNDING_INDEX_OFF),
    lastFundingSlot: data.readBigUInt64LE(base + ENGINE_LAST_FUNDING_SLOT_OFF),
    fundingRateBpsPerSlotLast: data.readBigInt64LE(base + ENGINE_FUNDING_RATE_BPS_OFF),
    lastCrankSlot: data.readBigUInt64LE(base + ENGINE_LAST_CRANK_SLOT_OFF),
    totalOpenInterest: readU128LE(data, base + ENGINE_TOTAL_OI_OFF),
    cTot: readU128LE(data, base + ENGINE_C_TOT_OFF),
    pnlPosTot: readU128LE(data, base + ENGINE_PNL_POS_TOT_OFF),
    numUsedAccounts: data.readUInt16LE(base + ENGINE_NUM_USED_OFF),
  };
}

/**
 * Parse bitmap to get list of used account indices.
 */
export function parseUsedIndices(data: Buffer): number[] {
  const base = ENGINE_OFF + ENGINE_BITMAP_OFF;
  if (data.length < base + BITMAP_WORDS * 8) {
    throw new Error("Slab data too short for bitmap");
  }

  const used: number[] = [];
  for (let word = 0; word < BITMAP_WORDS; word++) {
    const bits = data.readBigUInt64LE(base + word * 8);
    if (bits === 0n) continue;
    for (let bit = 0; bit < 64; bit++) {
      if ((bits >> BigInt(bit)) & 1n) {
        used.push(word * 64 + bit);
      }
    }
  }
  return used;
}

/**
 * Parse a single account by index.
 */
export function parseAccount(data: Buffer, idx: number): SlabAccount {
  const maxIdx = Math.floor(
    (data.length - ENGINE_OFF - ENGINE_ACCOUNTS_OFF) / ACCOUNT_SIZE,
  );
  if (idx < 0 || idx >= maxIdx) {
    throw new Error(`Account index out of range: ${idx} (max: ${maxIdx - 1})`);
  }

  const base = ENGINE_OFF + ENGINE_ACCOUNTS_OFF + idx * ACCOUNT_SIZE;

  const kindByte = data.readUInt8(base + ACCT_KIND_OFF);
  const kind = kindByte === 1 ? AccountKind.LP : AccountKind.User;

  return {
    kind,
    accountId: data.readBigUInt64LE(base + ACCT_ACCOUNT_ID_OFF),
    capital: readU128LE(data, base + ACCT_CAPITAL_OFF),
    pnl: readI128LE(data, base + ACCT_PNL_OFF),
    positionSize: readI128LE(data, base + ACCT_POSITION_SIZE_OFF),
    entryPrice: data.readBigUInt64LE(base + ACCT_ENTRY_PRICE_OFF),
    fundingIndex: readI128LE(data, base + ACCT_FUNDING_INDEX_OFF),
    owner: new PublicKey(
      data.subarray(base + ACCT_OWNER_OFF, base + ACCT_OWNER_OFF + 32),
    ),
  };
}

/**
 * Find account by owner pubkey. Returns index and account, or null.
 */
export function findAccountByOwner(
  data: Buffer,
  owner: PublicKey,
): { idx: number; account: SlabAccount } | null {
  const indices = parseUsedIndices(data);
  for (const idx of indices) {
    try {
      const acct = parseAccount(data, idx);
      if (acct.owner.equals(owner)) {
        return { idx, account: acct };
      }
    } catch {
      // Skip invalid indices
    }
  }
  return null;
}

/**
 * Build a VaultHealth snapshot from slab data and the vault's account.
 */
export function getVaultHealth(
  data: Buffer,
  vaultOwner: PublicKey,
): VaultHealth | null {
  const engine = parseEngine(data);
  const result = findAccountByOwner(data, vaultOwner);

  if (!result) return null;

  const { account } = result;
  return {
    capital: account.capital,
    pnl: account.pnl,
    positionSize: account.positionSize,
    entryPrice: account.entryPrice,
    fundingRateBpsPerSlot: engine.fundingRateBpsPerSlotLast,
    totalOI: engine.totalOpenInterest,
    lastCrankSlot: engine.lastCrankSlot,
    currentSlot: engine.currentSlot,
    slotsSinceCrank: engine.currentSlot - engine.lastCrankSlot,
  };
}
