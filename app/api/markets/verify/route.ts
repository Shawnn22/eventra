import { z } from "zod";
import { verifyDreamDexMarketOnchain } from "@/lib/dreamdex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  marketId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  pool: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    const result = await verifyDreamDexMarketOnchain({
      marketId: input.marketId as `0x${string}`,
      expectedPool: input.pool as `0x${string}`,
    });
    if (!result.verified) {
      return Response.json(
        { ...result, error: "Market is no longer Trading or its pool/collateral does not match the DreamDEX registry." },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("DreamDEX on-chain verification error", error);
    return Response.json(
      { verified: false, error: "Unable to verify this market through the DreamDEX BinaryMarketsModule." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
