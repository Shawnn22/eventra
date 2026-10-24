import { SomniaMarkets } from "@somnia-chain/markets-sdk";
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains";
import { formatUnits, type Address } from "viem";

const HIDEKI_INDEXER = "https://hideki-dev.smk.somnia.host/v1/graphql";

export type PerpsAccountSnapshot = {
  positions: Array<{ symbol: string; poolAddress: Address; side: "LONG" | "SHORT"; size: number; sizeRaw: string; baseDecimals: number; entryPrice: number; markPrice: number; unrealizedPnl: number; realizedPnl: number; updatedAt: number }>;
  openOrders: Array<{ orderId: string; symbol: string; side: "LONG" | "SHORT"; price: number; remaining: number; filled: number; placedAt: number }>;
  trades: Array<{ id: string; symbol: string; side: "LONG" | "SHORT"; price: number; quantity: number; quoteQuantity: number; timestamp: number }>;
  updatedAt: string;
};

export async function readConnectedPerpsAccount(account: Address): Promise<PerpsAccountSnapshot> {
  const exchange = new SomniaMarkets({ chain: hidekiTestnet, indexerUrl: HIDEKI_INDEXER });
  try {
    const [marketRows, positionRows, portfolio] = await Promise.all([
      exchange.client.listPerpMarkets({ limit: 100 }),
      exchange.client.listPerpPositions(account, { limit: 100 }),
      exchange.client.getPerpPortfolio(account, { tradesLimit: 20 }),
    ]);
    const markets = new Map(marketRows.map(row => [row.poolAddress.toLowerCase(), row]));
    const positions = positionRows.flatMap(position => {
      const market = markets.get(position.pool.toLowerCase());
      if (!market?.markPrice || !position.avgEntryPrice) return [];
      const rawSize = BigInt(position.size);
      const size = Number(formatUnits(rawSize < 0n ? -rawSize : rawSize, market.baseDecimals));
      const entryPrice = Number(formatUnits(BigInt(position.avgEntryPrice), market.quoteDecimals));
      const markPrice = Number(formatUnits(BigInt(market.markPrice), market.quoteDecimals));
      const side = rawSize >= 0n ? "LONG" as const : "SHORT" as const;
      return [{
        symbol: `${market.baseSymbol ?? "UNKNOWN"}-PERP`, poolAddress: market.poolAddress, side, size,
        sizeRaw: (rawSize < 0n ? -rawSize : rawSize).toString(), baseDecimals: market.baseDecimals, entryPrice, markPrice,
        unrealizedPnl: (markPrice - entryPrice) * size * (side === "LONG" ? 1 : -1),
        realizedPnl: position.lastUpdateRealizedPnl ? Number(formatUnits(BigInt(position.lastUpdateRealizedPnl), market.quoteDecimals)) : 0,
        updatedAt: Number(position.updatedAt),
      }];
    });
    return {
      positions,
      openOrders: portfolio.openOrders.map(order => ({
        orderId: order.orderId,
        symbol: `${order.market.baseSymbol ?? "UNKNOWN"}-PERP`,
        side: order.isBid ? "LONG" as const : "SHORT" as const,
        price: Number(formatUnits(BigInt(order.price), order.market.quoteDecimals)),
        remaining: Number(formatUnits(BigInt(order.quantityRemaining), order.market.baseDecimals)),
        filled: Number(formatUnits(BigInt(order.filledQuantity), order.market.baseDecimals)),
        placedAt: Number(order.placedAtTimestamp),
      })),
      trades: portfolio.trades.map(trade => ({
        id: trade.id,
        symbol: `${trade.market.baseSymbol ?? "UNKNOWN"}-PERP`,
        side: trade.isBid ? "LONG" as const : "SHORT" as const,
        price: Number(formatUnits(BigInt(trade.fillPrice), trade.market.quoteDecimals)),
        quantity: Number(formatUnits(BigInt(trade.quantity), trade.market.baseDecimals)),
        quoteQuantity: Number(formatUnits(BigInt(trade.quoteQuantity), trade.market.quoteDecimals)),
        timestamp: Number(trade.timestamp),
      })),
      updatedAt: new Date().toISOString(),
    };
  } finally {
    await exchange.close();
  }
}
