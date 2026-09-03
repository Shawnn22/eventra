import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const asset = request.nextUrl.searchParams.get("asset")?.toUpperCase();
  if (asset !== "BTC" && asset !== "ETH") {
    return Response.json({ error: "asset must be BTC or ETH" }, { status: 400 });
  }

  try {
    const response = await fetch(`https://api.exchange.coinbase.com/products/${asset}-USD/ticker`, {
      cache: "no-store",
      headers: { Accept: "application/json", "User-Agent": "DreamPilot/0.5" },
    });
    if (!response.ok) throw new Error(`Coinbase returned ${response.status}`);
    const payload = await response.json() as { price?: string; time?: string };
    const price = Number(payload.price);
    if (!Number.isFinite(price) || price <= 0) throw new Error("Invalid ticker price");
    return Response.json({ asset, price, time: payload.time ?? new Date().toISOString(), source: "Coinbase Exchange ticker" }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Ticker unavailable" }, { status: 502 });
  }
}
