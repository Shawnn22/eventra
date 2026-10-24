import { NextResponse } from "next/server";
import { SomniaMarkets } from "@somnia-chain/markets-sdk";
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains";
import { formatUnits } from "viem";

type PublicPerpsMarket = {
  symbol: string;
  price: number;
  change: number;
  funding: number;
  poolAddress?: string;
  markPriceUpdatedAt?: string | null;
  openInterest?: number;
  tradeCount?: number;
  candles?: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number; trades: number }>;
};

const HIDEKI_INDEXER = "https://hideki-dev.smk.somnia.host/v1/graphql";
const preferredMarkets = ["BTC", "ETH", "SOL"];

const demoMarkets: PublicPerpsMarket[] = [
  { symbol: "BTC-PERP", price: 108420.6, change: 2.84, funding: 0.0081 },
  { symbol: "ETH-PERP", price: 3884.2, change: 1.37, funding: -0.0032 },
  { symbol: "SOL-PERP", price: 186.44, change: -0.72, funding: 0.0054 },
];

export async function GET() {
  const exchange = new SomniaMarkets({
    chain: hidekiTestnet,
    indexerUrl: process.env.DREAMDEX_PERPS_INDEXER_URL || HIDEKI_INDEXER,
  });

  try {
    const rows = await exchange.client.listPerpMarkets({ limit: 100 });
    const valid = rows.filter(row => row.baseSymbol && row.markPrice && Number(row.markPrice) > 0);
    const preferred = preferredMarkets
      .map(symbol => valid.find(row => row.baseSymbol === symbol || row.baseSymbol === `W${symbol}`))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    const selected = preferred.length >= 2 ? preferred : valid.slice(0, 6);
    const markets: PublicPerpsMarket[] = await Promise.all(selected.map(async row => {
      const rawCandles = await exchange.client.getCandles(row.poolAddress, 60, { market: row.id, limit: 30 }).catch(() => []);
      const candles = rawCandles.map(candle => ({
        time: Number(candle.bucketStart),
        open: Number(formatUnits(BigInt(candle.openPrice), row.quoteDecimals)),
        high: Number(formatUnits(BigInt(candle.high), row.quoteDecimals)),
        low: Number(formatUnits(BigInt(candle.low), row.quoteDecimals)),
        close: Number(formatUnits(BigInt(candle.closePrice), row.quoteDecimals)),
        volume: Number(formatUnits(BigInt(candle.quoteVolume), row.quoteDecimals)),
        trades: candle.tradeCount,
      }));
      const first = candles[0]?.open;
      const last = candles.at(-1)?.close;
      return {
        symbol: `${row.baseSymbol ?? "UNKNOWN"}-PERP`,
        price: Number(formatUnits(BigInt(row.markPrice!), row.quoteDecimals)),
        change: first && last ? (last - first) / first * 100 : 0,
        funding: row.fundingRate ? Number(formatUnits(BigInt(row.fundingRate), 18)) * 100 : 0,
        poolAddress: row.poolAddress,
        markPriceUpdatedAt: row.markPriceUpdatedAt,
        openInterest: row.openInterest ? Number(formatUnits(BigInt(row.openInterest), row.baseDecimals)) : 0,
        tradeCount: candles.reduce((sum, candle) => sum + candle.trades, 0),
        candles,
      };
    }));
    if (!markets.length) throw new Error("Hideki indexer returned no priceable Perps markets");
    return NextResponse.json({ mode: "live", source: "dreamdex-hideki-indexer", chainId: hidekiTestnet.id, markets, updatedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ mode: "demo", source: "eventra-fallback", chainId: hidekiTestnet.id, markets: demoMarkets, updatedAt: new Date().toISOString(), message: error instanceof Error ? error.message : "Perps market feed unavailable" });
  } finally {
    await exchange.close();
  }
}
