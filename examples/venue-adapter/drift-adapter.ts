/**
 * Example: DriftAdapter — how to add Drift as an execution venue.
 *
 * This is a skeleton showing the pattern. In production, you'd use
 * @drift-labs/sdk for actual Drift integration.
 *
 * Once implemented, add to the factory in keeper/src/index.ts:
 *
 *   case "drift":
 *     return new DriftAdapter({ connection, manager, vaultPda, ... });
 *
 * Then run with: VENUE=drift npx ts-node src/index.ts
 * Or add to router: VENUE=router (auto-includes all configured venues)
 */

import { Connection, Keypair, PublicKey } from "@solana/web3.js";

// Import from the keeper's venue types
interface Position {
  size: bigint;
  entryPrice: bigint;
  pnl: bigint;
  capital: bigint;
}

interface OrderResult {
  signature: string;
  side: "long" | "short";
  size: bigint;
}

interface VenueState {
  fundingRateBpsPerSlot: bigint;
  insuranceBalance: bigint;
  numAccounts: number;
}

interface VenueAdapter {
  readonly name: string;
  readonly type: "perp" | "spot" | "hybrid";
  initialize(): Promise<void>;
  getPrice(market: string): Promise<number>;
  getPosition(): Promise<Position | null>;
  getVenueState(): Promise<VenueState>;
  trade(size: bigint): Promise<OrderResult>;
  crank(): Promise<void>;
}

// =============================================================================
// DriftAdapter — example venue implementation
// =============================================================================

interface DriftConfig {
  connection: Connection;
  manager: Keypair;
  vaultPda: PublicKey;
  marketIndex: number; // e.g., 0 = SOL-PERP
}

export class DriftAdapter implements VenueAdapter {
  readonly name = "Drift";
  readonly type = "perp" as const;

  private config: DriftConfig;
  // private driftClient: DriftClient; // from @drift-labs/sdk

  constructor(config: DriftConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    // In production:
    // this.driftClient = new DriftClient({ connection, wallet, ... });
    // await this.driftClient.subscribe();
    console.log(`[${this.name}] Initialized — market index ${this.config.marketIndex}`);
  }

  async getPrice(_market: string): Promise<number> {
    // In production:
    // const oracle = this.driftClient.getOracleDataForPerpMarket(this.config.marketIndex);
    // return oracle.price.toNumber() / 1e6;
    return 0;
  }

  async getPosition(): Promise<Position | null> {
    // In production:
    // const user = this.driftClient.getUser();
    // const pos = user.getPerpPosition(this.config.marketIndex);
    // return { size: pos.baseAssetAmount, ... };
    return { size: 0n, entryPrice: 0n, pnl: 0n, capital: 0n };
  }

  async getVenueState(): Promise<VenueState> {
    // In production:
    // const market = this.driftClient.getPerpMarketAccount(this.config.marketIndex);
    // return {
    //   fundingRateBpsPerSlot: market.amm.lastFundingRate,
    //   insuranceBalance: market.insuranceFund.totalShares,
    //   numAccounts: market.numberOfUsers,
    // };
    return { fundingRateBpsPerSlot: 0n, insuranceBalance: 0n, numAccounts: 0 };
  }

  async trade(size: bigint): Promise<OrderResult> {
    // In production:
    // const tx = await this.driftClient.openPosition(
    //   PositionDirection.LONG_or_SHORT,
    //   size,
    //   this.config.marketIndex,
    // );
    const side = size > 0n ? "long" : "short";
    const absSize = size > 0n ? size : -size;
    console.log(`[${this.name}] ${side.toUpperCase()} ${absSize} units`);
    return { signature: "simulated", side: side as "long" | "short", size: absSize };
  }

  async crank(): Promise<void> {
    // Drift doesn't need manual cranking — funding settles automatically.
    // But we can refresh data here.
    // await this.driftClient.fetchAccounts();
    console.log(`[${this.name}] Accounts refreshed`);
  }
}
