import { createHash } from "crypto";

// =============================================================================
// Encoding helpers (inline, no external deps)
// =============================================================================

function encU8(val: number): Buffer {
  const buf = Buffer.alloc(1);
  buf.writeUInt8(val, 0);
  return buf;
}

function encU16(val: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(val, 0);
  return buf;
}

function encU64(val: bigint | string): Buffer {
  const n = typeof val === "string" ? BigInt(val) : val;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(n, 0);
  return buf;
}

function encI128(val: bigint | string): Buffer {
  const n = typeof val === "string" ? BigInt(val) : val;
  let unsigned = n;
  if (n < 0n) {
    unsigned = (1n << 128n) + n;
  }
  const buf = Buffer.alloc(16);
  const lo = unsigned & 0xffff_ffff_ffff_ffffn;
  const hi = unsigned >> 64n;
  buf.writeBigUInt64LE(lo, 0);
  buf.writeBigUInt64LE(hi, 8);
  return buf;
}

function encU128(val: bigint | string): Buffer {
  const n = typeof val === "string" ? BigInt(val) : val;
  const buf = Buffer.alloc(16);
  const lo = n & 0xffff_ffff_ffff_ffffn;
  const hi = n >> 64n;
  buf.writeBigUInt64LE(lo, 0);
  buf.writeBigUInt64LE(hi, 8);
  return buf;
}

// =============================================================================
// Anchor 8-byte discriminator
// =============================================================================

/**
 * Compute the Anchor 8-byte instruction discriminator.
 * disc("global:instruction_name") => first 8 bytes of SHA-256
 */
export function disc(name: string): Buffer {
  const hash = createHash("sha256")
    .update(`global:${name}`)
    .digest();
  return hash.subarray(0, 8);
}

// =============================================================================
// Syntx instruction encoders (Anchor CPI through vault)
// =============================================================================

/**
 * Encode manager_trade instruction data.
 * Trades on Percolator via the vault's manager authority.
 *
 * @param lpIdx  - LP account index on the Percolator slab
 * @param size   - Signed position size (positive = long, negative = short, i128)
 */
export function encodeManagerTrade(lpIdx: number, size: bigint): Buffer {
  return Buffer.concat([
    disc("manager_trade"),
    encU16(lpIdx),
    encI128(size),
  ]);
}

/**
 * Encode manager_crank instruction data.
 * Settles funding and maintenance fees on the vault's Percolator position.
 */
export function encodeManagerCrank(): Buffer {
  return Buffer.concat([
    disc("manager_crank"),
  ]);
}

/**
 * Encode deposit instruction data.
 * Deposits collateral into the Syntx vault.
 *
 * @param amount - Collateral amount in native units (u64)
 */
export function encodeDeposit(amount: bigint): Buffer {
  return Buffer.concat([
    disc("deposit"),
    encU64(amount),
  ]);
}

// =============================================================================
// Percolator raw instruction encoders (for direct slab interaction)
// =============================================================================

/** Percolator instruction tags — matches Rust ix::Instruction::decode */
export const PERCOLATOR_IX_TAG = {
  InitMarket: 0,
  InitUser: 1,
  InitLP: 2,
  DepositCollateral: 3,
  WithdrawCollateral: 4,
  KeeperCrank: 5,
  TradeNoCpi: 6,
  LiquidateAtOracle: 7,
  CloseAccount: 8,
  TopUpInsurance: 9,
  TradeCpi: 10,
} as const;

/**
 * Encode Percolator KeeperCrank instruction data (4 bytes).
 * Used for direct crank calls if the vault exposes raw crank access.
 */
export function encodePercolatorCrank(callerIdx: number, allowPanic: boolean): Buffer {
  return Buffer.concat([
    encU8(PERCOLATOR_IX_TAG.KeeperCrank),
    encU16(callerIdx),
    encU8(allowPanic ? 1 : 0),
  ]);
}

/**
 * Encode Percolator TradeNoCpi instruction data (21 bytes).
 * Direct trade without CPI — for reference/testing.
 */
export function encodePercolatorTrade(
  lpIdx: number,
  userIdx: number,
  size: bigint,
): Buffer {
  return Buffer.concat([
    encU8(PERCOLATOR_IX_TAG.TradeNoCpi),
    encU16(lpIdx),
    encU16(userIdx),
    encI128(size),
  ]);
}
