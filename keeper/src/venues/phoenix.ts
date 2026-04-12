import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as Phoenix from "@ellipsis-labs/phoenix-sdk";
import { VenueAdapter, Position, OrderResult, VenueState } from "./types";

// =============================================================================
// PhoenixAdapter — spot orderbook execution via Phoenix V1
// =============================================================================

export interface PhoenixConfig {
  connection: Connection;
  manager: Keypair;
  vaultPda: PublicKey;
  marketAddress: PublicKey; // e.g. SOL/USDC market
}

export class PhoenixAdapter implements VenueAdapter {
  readonly name = "Phoenix";
  readonly type = "spot" as const;

  private config: PhoenixConfig;
  private client: Phoenix.Client | null = null;
  private marketKey: string;

  // Track position locally since Phoenix is spot (no on-chain position tracking like perps)
  private positionSize = 0n;
  private positionEntryPrice = 0n;
  private capitalDeposited = 0n;

  constructor(config: PhoenixConfig) {
    this.config = config;
    this.marketKey = config.marketAddress.toBase58();
  }

  async initialize(): Promise<void> {
    this.client = await Phoenix.Client.createWithoutConfig(
      this.config.connection,
      [this.config.marketAddress],
    );
    const ladder = this.client.getUiLadder(this.marketKey, 1);
    const bestBid = ladder.bids[0]?.price ?? 0;
    const bestAsk = ladder.asks[0]?.price ?? 0;
    console.log(`  [${this.name}] Initialized — market ${this.marketKey.slice(0, 8)}...`);
    console.log(`  [${this.name}] Best bid: $${bestBid.toFixed(4)} | Best ask: $${bestAsk.toFixed(4)}`);
  }

  async getPrice(_market: string): Promise<number> {
    if (!this.client) throw new Error("Phoenix client not initialized");
    await this.client.refreshMarket(this.marketKey);
    const ladder = this.client.getUiLadder(this.marketKey, 1);
    const bestBid = ladder.bids[0]?.price ?? 0;
    const bestAsk = ladder.asks[0]?.price ?? 0;
    if (bestBid === 0 || bestAsk === 0) return 0;
    return (bestBid + bestAsk) / 2; // midpoint
  }

  async getPosition(): Promise<Position | null> {
    // Phoenix is spot — no native position tracking.
    // Return locally tracked state for the vault.
    return {
      size: this.positionSize,
      entryPrice: this.positionEntryPrice,
      pnl: 0n, // Would need mark price to calculate
      capital: this.capitalDeposited,
    };
  }

  async getVenueState(): Promise<VenueState> {
    if (!this.client) throw new Error("Phoenix client not initialized");
    await this.client.refreshMarket(this.marketKey);
    const ladder = this.client.getUiLadder(this.marketKey, 10);

    // Phoenix is spot — no funding rate. Return 0.
    // numAccounts = orderbook depth as a proxy for liquidity
    const bidDepth = ladder.bids.length;
    const askDepth = ladder.asks.length;

    return {
      fundingRateBpsPerSlot: 0n, // Spot venue — no funding
      insuranceBalance: 0n,
      numAccounts: bidDepth + askDepth,
    };
  }

  async trade(size: bigint): Promise<OrderResult> {
    if (!this.client) throw new Error("Phoenix client not initialized");

    await this.client.refreshMarket(this.marketKey);
    const marketState = this.client.marketStates.get(this.marketKey);
    if (!marketState) throw new Error(`Market not found: ${this.marketKey}`);

    // Determine side: positive = buy (bid), negative = sell (ask)
    const isBuy = size > 0n;
    const absSize = isBuy ? size : -size;
    const side = isBuy ? Phoenix.Side.Bid : Phoenix.Side.Ask;

    // Get midpoint price for amount calculation
    const ladder = this.client.getUiLadder(this.marketKey, 5);
    const bestPrice = isBuy
      ? (ladder.asks[0]?.price ?? 0)
      : (ladder.bids[0]?.price ?? 0);

    if (bestPrice === 0) throw new Error("No liquidity on Phoenix orderbook");

    // Convert size (raw units) to quote/base amount for swap
    // For bids: inAmount is in quote units (USDC)
    // For asks: inAmount is in raw base units (SOL)
    const inAmount = Number(absSize) / 1_000_000; // Convert from 6-decimal raw to UI units

    const orderPacket = marketState.getSwapOrderPacket({
      side,
      inAmount,
      slippage: 0.005, // 0.5% slippage tolerance
    });

    const swapIx = marketState.createSwapInstruction(orderPacket, this.config.manager.publicKey);
    const tx = new Transaction().add(swapIx);
    const sig = await sendAndConfirmTransaction(this.config.connection, tx, [this.config.manager]);

    // Update local position tracking
    const sideLabel = isBuy ? "long" : "short";
    if (isBuy) {
      this.positionSize += absSize;
    } else {
      this.positionSize -= absSize;
    }
    this.positionEntryPrice = BigInt(Math.floor(bestPrice * 1_000_000));

    console.log(`  [${this.name}] ${sideLabel.toUpperCase()} ${inAmount} @ $${bestPrice.toFixed(4)} → ${sig.slice(0, 16)}...`);

    return { signature: sig, side: sideLabel, size: absSize };
  }

  async crank(): Promise<void> {
    // Phoenix V1 spot has no funding to crank.
    // Refresh market data for the next tick.
    if (!this.client) return;
    await this.client.refreshMarket(this.marketKey);
    console.log(`  [${this.name}] Market refreshed`);
  }
}
