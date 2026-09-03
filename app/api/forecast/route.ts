import { NextRequest } from "next/server";

const horizons = ["1m", "5m", "10m", "15m", "45m", "1h", "4h"] as const;
type Horizon = (typeof horizons)[number];

function isHorizon(value: string): value is Horizon {
  return horizons.includes(value as Horizon);
}

export async function GET(request: NextRequest) {
  const asset = request.nextUrl.searchParams.get("asset");
  const horizon = request.nextUrl.searchParams.get("horizon");
  if ((asset !== "BTC" && asset !== "ETH") || !horizon || !isHorizon(horizon)) {
    return Response.json({ error: "asset and horizon are invalid" }, { status: 400 });
  }

  const granularity = horizon === "1m" || horizon === "5m" || horizon === "10m" ? 60 : horizon === "15m" || horizon === "45m" ? 300 : horizon === "1h" ? 900 : 3600;
  try {
    const response = await fetch(`https://api.exchange.coinbase.com/products/${asset}-USD/candles?granularity=${granularity}`, {
      headers: { Accept: "application/json", "User-Agent": "DreamPilot/0.5" },
      next: { revalidate: 60 },
    });
    if (!response.ok) throw new Error(`Coinbase returned ${response.status}`);
    const raw = (await response.json()) as number[][];
    const candles = raw.slice(0, 60)
      .map((row) => ({ time: Number(row[0]), close: Number(row[4]) }))
      .filter((item) => Number.isFinite(item.time) && Number.isFinite(item.close))
      .reverse();
    const closes = candles.map((item) => item.close);
    if (closes.length < 8) throw new Error("Insufficient candles");
    const currentPrice = closes.at(-1)!;
    const change = (lookback: number) => (currentPrice / closes[Math.max(0, closes.length - 1 - lookback)] - 1) * 100;
    const returns = closes.slice(1).map((close, index) => (close / closes[index] - 1) * 100);
    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const volatility = Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length);
    const expectedMovePercent = Math.max(-2.5, Math.min(2.5, change(3) * .55 + change(7) * .3 + mean * .15));
    const direction = expectedMovePercent >= 0 ? "UP" : "DOWN";
    const confidence = Math.round(Math.max(51, Math.min(74, 54 + Math.abs(expectedMovePercent) * 8 - volatility * 4)));
    return Response.json({ asset, horizon, currentPrice, predictedPrice: currentPrice * (1 + expectedMovePercent / 100), expectedMovePercent, direction, confidence, candleCount: closes.length, candles, source: "Coinbase Exchange public OHLCV", generatedAt: new Date().toISOString() }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Forecast unavailable" }, { status: 502 });
  }
}
