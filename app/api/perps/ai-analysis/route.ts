import { createHash } from "node:crypto";
import { z } from "zod";
import { buildPerpsAIDecision, type PerpsAIDecision, type PerpsAIInput } from "@/lib/perps/ai-decision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const candleSchema = z.object({
  open: z.number().finite().positive(),
  high: z.number().finite().positive(),
  low: z.number().finite().positive(),
  close: z.number().finite().positive(),
  volume: z.number().finite().nonnegative(),
  trades: z.number().int().nonnegative(),
});

const inputSchema = z.object({
  symbol: z.string().trim().regex(/^[A-Z0-9-]{3,24}$/),
  price: z.number().finite().positive(),
  change: z.number().finite().min(-100).max(100),
  funding: z.number().finite().min(-100).max(100),
  openInterest: z.number().finite().nonnegative(),
  tradeCount: z.number().int().nonnegative(),
  candles: z.array(candleSchema).max(60),
});

const decisionSchema = z.object({
  side: z.enum(["LONG", "SHORT", "WAIT"]),
  confidence: z.number().int().min(0).max(100),
  quality: z.enum(["HIGH", "MEDIUM", "LOW"]),
  summary: z.string().trim().min(20).max(320),
  drivers: z.array(z.string().trim().min(10).max(240)).min(2).max(4),
  counterThesis: z.string().trim().min(15).max(320),
  invalidation: z.string().trim().min(15).max(320),
});

const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    side: { type: "string", enum: ["LONG", "SHORT", "WAIT"] },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    quality: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
    summary: { type: "string" },
    drivers: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" } },
    counterThesis: { type: "string" },
    invalidation: { type: "string" },
  },
  required: ["side", "confidence", "quality", "summary", "drivers", "counterThesis", "invalidation"],
} as const;

type CachedDecision = { expiresAt: number; decision: PerpsAIDecision; model: string; latencyMs: number };
const cache = new Map<string, CachedDecision>();
const requestLog = new Map<string, number[]>();
const CACHE_TTL_MS = 45_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 12;

function clientId(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anonymous";
}

function rateLimited(id: string) {
  const now = Date.now();
  const recent = (requestLog.get(id) ?? []).filter(time => now - time < RATE_WINDOW_MS);
  recent.push(now);
  requestLog.set(id, recent);
  return recent.length > RATE_LIMIT;
}

function localResponse(input: PerpsAIInput, reason: string, startedAt: number) {
  return Response.json({
    decision: buildPerpsAIDecision(input),
    meta: { provider: "local", model: "eventra-risk-engine", generatedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, fallbackReason: reason },
  }, { headers: { "Cache-Control": "no-store" } });
}

function buildPrompt(input: PerpsAIInput, baseline: PerpsAIDecision) {
  const closes = input.candles.map(candle => candle.close);
  const lastFive = closes.slice(-5);
  return `You are Eventra's cautious DreamDEX perpetual-market analyst. Analyze only the supplied public market snapshot. Do not invent news, order-book depth, wallet state, support/resistance, or future prices. Return WAIT when evidence is weak or contradictory. The deterministic risk engine remains authoritative and the user must sign every transaction manually. Use concise English.\n\nMARKET SNAPSHOT:\n${JSON.stringify({ ...input, candles: input.candles.slice(-30), lastFiveCloses: lastFive })}\n\nDETERMINISTIC BASELINE:\n${JSON.stringify(baseline)}\n\nYour decision may disagree with the baseline only when you explicitly reflect that uncertainty through lower confidence and a concrete counter-thesis. Invalidation must be testable using price, funding, activity, or liquidity evidence present in the snapshot.`;
}

export async function GET() {
  const configured = Boolean(process.env.GEMINI_API_KEY?.trim());
  return Response.json({ configured, provider: configured ? "Gemini" : "Eventra local fallback", model: process.env.GEMINI_MODEL || "gemini-2.5-flash-lite" }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let input: PerpsAIInput;
  try {
    input = inputSchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Invalid Perps market snapshot." }, { status: 400 });
  }

  if (rateLimited(clientId(request))) {
    return localResponse(input, "Gemini request limit reached; local analysis remains available.", startedAt);
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return localResponse(input, "GEMINI_API_KEY is not configured.", startedAt);

  const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash-lite";
  const key = createHash("sha256").update(JSON.stringify({ model, input })).digest("hex");
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json({ decision: cached.decision, meta: { provider: "gemini", model: cached.model, generatedAt: new Date().toISOString(), latencyMs: cached.latencyMs, cached: true } }, { headers: { "Cache-Control": "no-store" } });
  }

  const baseline = buildPerpsAIDecision(input);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: "You provide evidence-bounded trading decision support, never financial guarantees or autonomous execution." }] },
        contents: [{ role: "user", parts: [{ text: buildPrompt(input, baseline) }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 700, responseMimeType: "application/json", responseJsonSchema },
      }),
      signal: controller.signal,
      cache: "no-store",
    }).finally(() => clearTimeout(timeout));
    if (!response.ok) throw new Error(`Gemini returned ${response.status}`);
    const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = payload.candidates?.[0]?.content?.parts?.map(part => part.text ?? "").join("").trim();
    if (!text) throw new Error("Gemini returned no analysis");
    const decision = decisionSchema.parse(JSON.parse(text));
    const latencyMs = Date.now() - startedAt;
    cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, decision, model, latencyMs });
    return Response.json({ decision, meta: { provider: "gemini", model, generatedAt: new Date().toISOString(), latencyMs, cached: false } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Gemini Perps analysis fallback", error);
    return localResponse(input, error instanceof Error ? error.message : "Gemini analysis unavailable.", startedAt);
  }
}
