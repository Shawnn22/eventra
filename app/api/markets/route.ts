import { DREAMDEX_TESTNET, fetchDreamDexMarkets } from "@/lib/dreamdex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const assets = new Set(["BTC", "ETH"]);
const horizons = new Set(["1m", "5m", "10m", "15m", "45m", "1h", "4h"]);

export async function GET(request: Request) {
  const startedAt = Date.now();
  const url = new URL(request.url);
  const rawAsset = url.searchParams.get("asset")?.toUpperCase();
  const rawHorizon = url.searchParams.get("horizon");
  const asset = rawAsset && assets.has(rawAsset) ? (rawAsset as "BTC" | "ETH") : undefined;
  const horizon = rawHorizon && horizons.has(rawHorizon)
    ? (rawHorizon as "1m" | "5m" | "10m" | "15m" | "45m" | "1h" | "4h")
    : undefined;

  try {
    const scan = await fetchDreamDexMarkets({
      asset,
      horizon,
      signal: request.signal,
    });

    return Response.json(
      {
        markets: scan.markets,
        meta: {
          mode: "live",
          source: "DreamDEX Event Contracts SDK",
          network: "Somnia Shannon testnet",
          chainId: DREAMDEX_TESTNET.chainId,
          venueId: DREAMDEX_TESTNET.venueId,
          fallbackVenueId: DREAMDEX_TESTNET.fallbackVenueId,
          fetchedAt: new Date().toISOString(),
          latencyMs: Date.now() - startedAt,
          diagnostics: scan.diagnostics,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("DreamDEX market read error", error);
    const rawError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const retryable = /fetch failed|enotfound|econnreset|etimedout|network/i.test(rawError);
    return Response.json(
      {
        error: retryable
          ? "DreamDEX is temporarily unreachable. Eventra will retry automatically."
          : "Unable to read DreamDEX Event Contracts on testnet.",
        meta: {
          mode: "unavailable",
          source: "DreamDEX Event Contracts SDK",
          retryable,
          latencyMs: Date.now() - startedAt,
        },
      },
      { status: retryable ? 503 : 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
