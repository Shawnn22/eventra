import { z } from "zod";
import type { TechnicalAnalysis } from "@/lib/technical-analysis";

export const campaignInputSchema = z.object({
  campaignName: z.string().trim().min(3).max(80),
  question: z.string().trim().min(8).max(240),
  asset: z.enum(["BTC", "ETH"]),
  horizon: z.enum(["1m", "5m", "10m", "15m", "45m", "1h", "4h"]),
  marketProbability: z.number().min(1).max(99),
  marketProbabilityAvailable: z.boolean().default(true),
  spotMovePercent: z.number().min(-20).max(20),
  volatilityPercent: z.number().min(0).max(100),
  volumeUsd: z.number().min(0).max(100_000_000),
  minutesRemaining: z.number().min(1).max(1440),
  riskBudgetUsd: z.number().min(1).max(100_000),
  selectedModel: z.string(),
  marketId: z.string().optional(),
  venueId: z.string().optional(),
  poolAddress: z.string().optional(),
  tradeCount: z.number().int().min(0).optional(),
  marketSource: z.enum(["dreamdex-live", "manual"]).default("manual"),
  marketUpdatedAt: z.string().datetime().optional(),
});

export type CampaignInput = z.infer<typeof campaignInputSchema>;

export const analysisReportSchema = z.object({
  headline: z.string().min(10).max(180),
  executiveSummary: z.string().min(40).max(900),
  marketRegime: z.string().min(30).max(700),
  priceAction: z.string().min(30).max(700),
  technicalSynthesis: z.string().min(40).max(900),
  dreamdexRead: z.string().min(30).max(700),
  conflictAnalysis: z.string().min(30).max(700),
  decisionRationale: z.string().min(40).max(900),
});

export const adviceSchema = z.object({
  action: z.enum(["BUY_UP", "BUY_DOWN", "WAIT"]),
  confidence: z.number().int().min(0).max(100),
  summary: z.string().min(20).max(500),
  thesis: z.array(z.string().min(5).max(220)).min(2).max(4),
  counterThesis: z.array(z.string().min(5).max(220)).min(1).max(3),
  risks: z.array(z.string().min(5).max(220)).min(2).max(4),
  invalidation: z.string().min(10).max(300),
  suggestedMaxStakePercent: z.number().min(0).max(25),
  dataGaps: z.array(z.string().min(3).max(160)).max(4),
  report: analysisReportSchema,
});

export type Advice = z.infer<typeof adviceSchema>;

export type AdviceResponse = {
  advice: Advice;
  technical?: TechnicalAnalysis;
  forecast?: {
    asset: "BTC" | "ETH";
    horizon: "1m" | "5m" | "10m" | "15m" | "45m" | "1h" | "4h";
    currentPrice: number;
    predictedPrice: number;
    expectedMovePercent: number;
    direction: "UP" | "DOWN";
    confidence: number;
    source: string;
    candleCount: number;
    generatedAt: string;
    candles?: Array<{ time: number; close: number }>;
  };
  meta: {
    model: string;
    provider: string;
  mode: "live" | "local";
    latencyMs: number;
    generatedAt: string;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
  };
};

export function generateLocalAdvice(input: CampaignInput, technical?: TechnicalAnalysis): Advice {
  const tradeCount = input.tradeCount ?? 0;
  const hasEnoughData = input.marketProbabilityAvailable && tradeCount >= 2 && input.volumeUsd >= 25 && input.minutesRemaining >= 10;
  const downProbability = 100 - input.marketProbability;
  const pricedSide = input.marketProbability >= 55 ? "UP" : downProbability >= 55 ? "DOWN" : null;
  const action: Advice["action"] = hasEnoughData && pricedSide ? (pricedSide === "UP" ? "BUY_UP" : "BUY_DOWN") : "WAIT";
  const confidence = action === "WAIT" ? Math.min(48, 22 + tradeCount * 3) : Math.min(74, 50 + Math.round(Math.abs(input.marketProbability - 50) / 2) + Math.min(tradeCount, 8));
  const dataGaps = [
    !input.marketProbabilityAvailable ? "No executable DreamDEX market price" : null,
    tradeCount < 2 ? "Too few on-chain trades" : null,
    input.volumeUsd < 25 ? "Low observed DreamDEX volume" : null,
    "No independent spot-price or news confirmation",
  ].filter((item): item is string => Boolean(item)).slice(0, 4);
  const trend = technical?.signals.find((signal) => signal.id === "trend");
  const momentum = technical?.signals.find((signal) => signal.id === "momentum");
  const rsi = technical?.signals.find((signal) => signal.id === "rsi");
  const volatility = technical?.signals.find((signal) => signal.id === "volatility");
  const range = technical?.signals.find((signal) => signal.id === "range");
  const technicalBias = technical?.bias ?? "WAIT";
  const marketBias = !input.marketProbabilityAvailable ? "UNPRICED" : input.marketProbability >= 55 ? "UP" : downProbability >= 55 ? "DOWN" : "BALANCED";
  const conflict = technicalBias === "WAIT" || marketBias === "BALANCED" || marketBias === "UNPRICED" ? "not confirmed" : technicalBias === marketBias ? "aligned" : "in conflict";
  const report: Advice["report"] = {
    headline: `${input.asset} ${input.horizon}: ${action === "WAIT" ? "direction exists, but execution evidence is incomplete" : `${pricedSide} evidence passes the initial gate`}`,
    executiveSummary: `This report evaluates “${input.question}” as a short-horizon binary decision, not as a general ${input.asset} price forecast. The chart model reads ${technicalBias} with a score of ${technical?.score ?? 0}, while DreamDEX is ${marketBias === "UNPRICED" ? "not currently priced" : `${marketBias}-leaning at ${input.marketProbability.toFixed(1)}% UP`}. The final ${action} decision also accounts for ${tradeCount} on-chain trades, $${input.volumeUsd.toFixed(2)} observed volume and ${input.minutesRemaining} minutes to settlement.`,
    marketRegime: `The active ${input.horizon} window is a ${volatility?.signal === "RISK" ? "high-noise" : "contained-volatility"} regime. ${volatility?.explanation ?? "Volatility evidence is unavailable."} With ${input.minutesRemaining} minutes remaining, ${input.minutesRemaining < 10 ? "execution and confirmation latency can dominate the underlying signal" : "there is still time for additional price and order-book confirmation"}.`,
    priceAction: `${trend?.value ?? "Trend unavailable"}: ${trend?.explanation ?? "No trend read."} ${momentum?.value ?? "Momentum unavailable"}: ${momentum?.explanation ?? "No momentum read."} Price sits at ${range?.value ?? "an unknown range position"}, between observed support ${technical ? `$${technical.support.toFixed(2)}` : "—"} and resistance ${technical ? `$${technical.resistance.toFixed(2)}` : "—"}.`,
    technicalSynthesis: `The indicators should be read as a system rather than five independent votes. Trend and momentum describe direction, RSI tests whether that direction is stretched, volatility reduces confidence when noise rises, and range position shows whether price is accepting the upper or lower part of the observed distribution. Here, RSI is ${rsi?.value ?? "unavailable"} and the combined evidence produces ${technicalBias}, score ${technical?.score ?? 0}.`,
    dreamdexRead: input.marketProbabilityAvailable ? `DreamDEX prices UP at ${input.marketProbability.toFixed(1)}% and DOWN at ${downProbability.toFixed(1)}%. That price is supported by ${tradeCount} recorded trades and $${input.volumeUsd.toFixed(2)} volume. ${hasEnoughData ? "The minimum execution-evidence gate is met." : "This is not enough to treat the quoted probability as a robust consensus because liquidity, trade count or time-to-expiry remains below the safety gate."}` : "DreamDEX has no executable probability for this campaign, so the chart cannot be converted into a trade recommendation.",
    conflictAnalysis: `Chart bias and DreamDEX pricing are ${conflict}. ${conflict === "aligned" ? "Agreement improves directional coherence, but does not remove binary settlement or liquidity risk." : conflict === "in conflict" ? "The spot chart and prediction-market participants are expressing different views; entering before one side confirms would be a low-quality decision." : "At least one evidence layer is neutral or missing, so apparent direction should be treated as a hypothesis rather than confirmation."}`,
    decisionRationale: action === "WAIT" ? `WAIT is selected because a directional chart impression is weaker than the combined execution gate. Eventra requires usable DreamDEX pricing, at least two trades, $25 observed volume and ten minutes to settlement before local analysis can propose an entry. The current snapshot fails one or more of those conditions.` : `${action} is selected because technical direction and the priced DreamDEX side can be reviewed with bounded exposure. This is still a conditional setup: position size remains capped and the thesis must be abandoned if liquidity or price structure changes.`,
  };

  return {
    action,
    confidence,
    summary: action === "WAIT"
      ? "Local analysis recommends waiting because the current DreamDEX snapshot does not provide enough confirmed liquidity and trade evidence."
      : `Local analysis identifies a ${pricedSide} market lean, but treats it only as a price signal and keeps the proposed exposure tightly bounded.`,
    thesis: hasEnoughData ? [
      `DreamDEX currently prices UP at ${input.marketProbability.toFixed(1)}% and DOWN at ${downProbability.toFixed(1)}%.`,
      `${tradeCount} on-chain trades and $${input.volumeUsd.toFixed(2)} observed volume provide limited support for this snapshot.`,
    ] : [
      "The DreamDEX contract is open and can be monitored on Somnia.",
      "No executable probability should be inferred until real trades and quoted liquidity appear.",
    ],
    counterThesis: [
      "Market odds can reflect thin liquidity rather than informed probability.",
      `${input.minutesRemaining} minutes remain, so the price can still move materially before settlement.`,
    ],
    risks: [
      "Binary contracts can lose the full stake at settlement.",
      "This local engine has no external news or independent spot-price context.",
    ],
    invalidation: "Do not proceed if liquidity disappears, the quoted probability changes materially, or the settlement conditions cannot be independently verified.",
    suggestedMaxStakePercent: action === "WAIT" ? 0 : Math.min(10, Math.max(2, Math.round(confidence / 10))),
    dataGaps,
    report,
  };
}
