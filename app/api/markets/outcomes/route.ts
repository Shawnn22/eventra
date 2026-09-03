import { z } from "zod";
import { resolveDreamDexMarketOutcomes } from "@/lib/dreamdex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  marketIds: z.array(z.string().regex(/^0x[0-9a-fA-F]{64}$/)).min(1).max(20),
});

export async function POST(request: Request) {
  try {
    const { marketIds } = requestSchema.parse(await request.json());
    const outcomes = await resolveDreamDexMarketOutcomes(marketIds as `0x${string}`[]);
    return Response.json(
      { outcomes, checkedAt: new Date().toISOString(), source: "DreamDEX BinaryMarketsModule" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("DreamDEX outcome read error", error);
    return Response.json(
      { error: "Unable to verify DreamDEX settlements." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
