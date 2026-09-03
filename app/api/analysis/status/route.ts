import { EVENTRA_ANALYSIS_ESCROW_ADDRESS, EVENTRA_ANALYSIS_TOKEN_ADDRESS } from "@/lib/eventra/analysis-escrow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    network: "Somnia Shannon Testnet",
    chainId: 50312,
    escrowAddress: EVENTRA_ANALYSIS_ESCROW_ADDRESS,
    paymentToken: EVENTRA_ANALYSIS_TOKEN_ADDRESS,
    paymentRail: "ready",
    fulfillerConfigured: Boolean(process.env.EVENTRA_ANALYSIS_FULFILLER_PRIVATE_KEY),
    providers: {
      eventraCore: true,
      openRouter: Boolean(process.env.OPENROUTER_API_KEY),
      surf: Boolean(process.env.SURF_API_KEY),
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
