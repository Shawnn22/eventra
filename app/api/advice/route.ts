import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, Output } from "ai";
import { ZodError } from "zod";
import { adviceSchema, campaignInputSchema, generateLocalAdvice } from "@/lib/advice";
import { getAdvisorModel, isAdvisorModel } from "@/lib/models";
import { computeTechnicalAnalysis } from "@/lib/technical-analysis";

export const runtime = "nodejs";

const SYSTEM_PROMPT = `
You are DreamPilot, a cautious decision-support advisor for binary DreamDEX Event Contracts.

Rules:
- Use only the DreamDEX campaign snapshot supplied by the application. Never claim access to live news, social feeds, wallets, spot feeds, or order books unless that data is present.
- Return BUY_UP, BUY_DOWN, or WAIT. Prefer WAIT when evidence is weak, stale, contradictory, illiquid, or too close to expiry.
- Separate evidence for the position from evidence against it.
- Treat market probability as a price signal, not truth.
- Never guarantee profit, imply certainty, or call the output financial advice.
- Suggested stake is a percentage of the campaign risk budget, capped at 25%. It must be 0 for WAIT.
- Identify missing data that could materially change the recommendation.
- The fields spotMovePercent and volatilityPercent are user-supplied unless explicitly marked otherwise. Do not describe them as DreamDEX data.
- If marketProbabilityAvailable is false, the displayed 50% is only a neutral UI placeholder; return WAIT and list the missing market price/order-book liquidity as a data gap.
- Write concise English suitable for a global trading review screen.
- A deterministic technical-analysis object may be supplied. Treat its calculated values as source evidence: do not alter SMA spread, momentum, RSI, volatility, range position, support, resistance, bias, or score.
- Explain whether technical bias and DreamDEX market evidence agree. A technical UP/DOWN bias alone is not enough to trade when liquidity is missing or expiry risk is high.
- The report must read like an analyst memo, not a list of generic indicator definitions. Tie every paragraph to this campaign's question, horizon, settlement window, chart structure and executable DreamDEX evidence.
- Do not invent news, sentiment, volume, order-book depth, support/resistance or catalysts that are absent from the supplied evidence.
`;

function hasOpenRouterKey() {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

async function buildDemoForecast(asset: "BTC" | "ETH", horizon: "1m" | "5m" | "10m" | "15m" | "45m" | "1h" | "4h") {
  const granularity = horizon === "1m" || horizon === "5m" || horizon === "10m" ? 60 : horizon === "15m" || horizon === "45m" ? 300 : horizon === "1h" ? 900 : 3600;
  const response = await fetch(`https://api.exchange.coinbase.com/products/${asset}-USD/candles?granularity=${granularity}`, {
    headers: { Accept: "application/json", "User-Agent": "DreamPilot/0.4" },
    next: { revalidate: 60 },
  });
  if (!response.ok) throw new Error(`Coinbase candles returned ${response.status}`);
  const raw = (await response.json()) as number[][];
  const candles = raw.slice(0, 60)
    .map((row) => ({ time: Number(row[0]), close: Number(row[4]) }))
    .filter((item) => Number.isFinite(item.time) && Number.isFinite(item.close))
    .reverse();
  const closes = candles.map((item) => item.close);
  if (closes.length < 8) throw new Error("Not enough public candles for forecast");
  const currentPrice = closes.at(-1)!;
  const change = (lookback: number) => (currentPrice / closes[Math.max(0, closes.length - 1 - lookback)] - 1) * 100;
  const returns = closes.slice(1).map((close, index) => (close / closes[index] - 1) * 100);
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const volatility = Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length);
  const expectedMovePercent = Math.max(-2.5, Math.min(2.5, change(3) * 0.55 + change(7) * 0.3 + mean * 0.15));
  const direction = expectedMovePercent >= 0 ? "UP" as const : "DOWN" as const;
  const confidence = Math.round(Math.max(51, Math.min(74, 54 + Math.abs(expectedMovePercent) * 8 - volatility * 4)));
  const technical = computeTechnicalAnalysis(closes);
  return {
    asset, horizon, currentPrice, direction, confidence,
    predictedPrice: currentPrice * (1 + expectedMovePercent / 100),
    expectedMovePercent,
    source: "Coinbase Exchange public OHLCV",
    candleCount: closes.length,
    candles,
    generatedAt: new Date().toISOString(),
    technical,
  };
}

export async function GET() {
  return Response.json(
    {
      configured: hasOpenRouterKey(),
      localAvailable: true,
      openRouterConfigured: hasOpenRouterKey(),
      provider: "OpenRouter",
      keyName: "OPENROUTER_API_KEY",
      mode: hasOpenRouterKey() ? "live" : "local",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const startedAt = Date.now();

  try {
    const parsed = campaignInputSchema.parse(await request.json());

    if (!isAdvisorModel(parsed.selectedModel)) {
      return Response.json(
        { error: "This model is not in the supported free-tier list." },
        { status: 400 },
      );
    }

    const forceLocal = new URL(request.url).searchParams.get("mode") === "local";
    if (forceLocal || !hasOpenRouterKey()) {
      let forecast: Awaited<ReturnType<typeof buildDemoForecast>> | undefined;
      try { forecast = await buildDemoForecast(parsed.asset, parsed.horizon); } catch (error) { console.error("Demo forecast unavailable", error); }
      return Response.json({
        advice: generateLocalAdvice(parsed, forecast?.technical),
        forecast: forecast ? (({ technical: _technical, ...value }) => value)(forecast) : undefined,
        technical: forecast?.technical,
        meta: {
          model: "dreampilot-local-v1",
          provider: "DreamPilot Local",
          mode: "local",
          latencyMs: Date.now() - startedAt,
          generatedAt: new Date().toISOString(),
        },
      });
    }

    const selectedModel = getAdvisorModel(parsed.selectedModel);
    let forecast: Awaited<ReturnType<typeof buildDemoForecast>> | undefined;
    try { forecast = await buildDemoForecast(parsed.asset, parsed.horizon); } catch (error) { console.error("Technical evidence unavailable", error); }
    const openrouter = createOpenAICompatible({
      name: "openrouter",
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
      headers: {
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
        "X-Title": "DreamPilot",
      },
    });

    const result = await generateText({
      model: openrouter.chatModel(selectedModel.id),
      system: SYSTEM_PROMPT,
      output: Output.object({ schema: adviceSchema }),
      prompt: `Review this DreamDEX Event Contract snapshot and propose one cautious action. Use the deterministic technical evidence without changing its values. Explain agreement or conflict between chart evidence and DreamDEX market evidence.\n\nMODEL ANALYSIS LENS:\n${selectedModel.specialty}. Use this lens to shape emphasis and reasoning, while still completing every report section.\n\nMARKET SNAPSHOT:\n${JSON.stringify(parsed, null, 2)}\n\nDETERMINISTIC TECHNICAL EVIDENCE:\n${JSON.stringify(forecast?.technical ?? null, null, 2)}`,
    });

    return Response.json({
      advice: result.output,
      forecast: forecast ? (({ technical: _technical, ...value }) => value)(forecast) : undefined,
      technical: forecast?.technical,
      meta: {
        model: selectedModel.id,
        provider: selectedModel.provider,
        mode: "live",
        latencyMs: Date.now() - startedAt,
        generatedAt: new Date().toISOString(),
        usage: {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
        },
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        { error: "Invalid market input.", details: error.issues },
        { status: 400 },
      );
    }

    console.error("DreamPilot advice error", error);
    return Response.json(
      {
        error:
          "The free-tier model did not respond. Try Auto Free or check your OpenRouter quota.",
      },
      { status: 502 },
    );
  }
}
