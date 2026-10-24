import type { PerpsSide } from "./risk-engine";

type Candle = { open: number; high: number; low: number; close: number; volume: number; trades: number };

export type PerpsAIDecision = {
  side: PerpsSide | "WAIT";
  confidence: number;
  quality: "HIGH" | "MEDIUM" | "LOW";
  summary: string;
  drivers: string[];
  counterThesis: string;
  invalidation: string;
};

export function buildPerpsAIDecision(input: {
  symbol: string;
  price: number;
  change: number;
  funding: number;
  openInterest: number;
  tradeCount: number;
  candles: Candle[];
}): PerpsAIDecision {
  const closes = input.candles.map(candle => candle.close).filter(Number.isFinite);
  const first = closes[0] ?? input.price;
  const momentum = first > 0 ? (input.price - first) / first * 100 : input.change;
  const ranges = input.candles.map(candle => candle.open > 0 ? (candle.high - candle.low) / candle.open * 100 : 0);
  const volatility = ranges.length ? ranges.reduce((sum, value) => sum + value, 0) / ranges.length : 0;
  const trendScore = Math.max(-2, Math.min(2, momentum * 12 + input.change * .45));
  const fundingScore = Math.max(-1, Math.min(1, -input.funding * 35));
  const score = trendScore + fundingScore;
  const enoughEvidence = input.candles.length >= 20 && input.tradeCount >= 3;
  const side: PerpsAIDecision["side"] = !enoughEvidence || Math.abs(score) < .28 ? "WAIT" : score > 0 ? "LONG" : "SHORT";
  const confidence = side === "WAIT"
    ? Math.round(Math.max(38, Math.min(58, 46 + input.candles.length / 5 - volatility * 8)))
    : Math.round(Math.max(52, Math.min(82, 56 + Math.abs(score) * 8 + Math.min(input.tradeCount, 12) - volatility * 6)));
  const quality = confidence >= 70 ? "HIGH" : confidence >= 56 ? "MEDIUM" : "LOW";
  const directionWord = momentum >= 0 ? "upward" : "downward";
  const crowded = input.funding > .01 ? "long positioning is crowded" : input.funding < -.01 ? "short positioning is crowded" : "funding remains balanced";
  const invalidationPrice = side === "SHORT" ? input.price * 1.008 : input.price * .992;

  return {
    side,
    confidence,
    quality,
    summary: side === "WAIT"
      ? `${input.symbol} does not yet have enough aligned market evidence for a directional entry.`
      : `${input.symbol} has a ${side.toLowerCase()} bias, but execution remains conditional on live DreamDEX liquidity and account preflight.`,
    drivers: [
      `30m price structure is ${directionWord} (${momentum >= 0 ? "+" : ""}${momentum.toFixed(2)}%).`,
      `${crowded}; the current rate is ${input.funding.toFixed(4)}%.`,
      `${input.tradeCount} indexed fills and ${input.candles.length} candles support a ${quality.toLowerCase()}-quality read.`,
    ],
    counterThesis: volatility > .35
      ? `Average intrabar range is ${volatility.toFixed(2)}%, so noise can invalidate the directional signal quickly.`
      : `The opposing case strengthens if momentum reverses while funding moves further against the proposed side.`,
    invalidation: side === "WAIT"
      ? "Wait for aligned momentum, executable size and a fresh preflight before signing."
      : `Reassess below/above ${invalidationPrice.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 })} or if executable size falls below the order.`,
  };
}
