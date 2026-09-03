export type TechnicalSignal = {
  id: "trend" | "momentum" | "rsi" | "volatility" | "range";
  label: string;
  signal: "UP" | "DOWN" | "NEUTRAL" | "RISK";
  value: string;
  explanation: string;
};

export type TechnicalAnalysis = {
  bias: "UP" | "DOWN" | "WAIT";
  score: number;
  summary: string;
  support: number;
  resistance: number;
  signals: TechnicalSignal[];
  methodology: string;
  advancedMetrics: Array<{ label: string; value: string; interpretation: string }>;
};

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function percent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)}%`;
}

function ema(values: number[], period: number) {
  const multiplier = 2 / (period + 1);
  return values.slice(1).reduce((value, next) => next * multiplier + value * (1 - multiplier), values[0]);
}

export function computeTechnicalAnalysis(closes: number[]): TechnicalAnalysis {
  if (closes.length < 8) throw new Error("At least 8 close observations are required");
  const current = closes.at(-1)!;
  const sma5 = average(closes.slice(-5));
  const sma20 = average(closes.slice(-Math.min(20, closes.length)));
  const trendSpread = (sma5 / sma20 - 1) * 100;
  const momentum3 = (current / closes[Math.max(0, closes.length - 4)] - 1) * 100;
  const returns = closes.slice(1).map((close, index) => (close / closes[index] - 1) * 100);
  const meanReturn = average(returns);
  const volatility = Math.sqrt(average(returns.map((value) => (value - meanReturn) ** 2)));
  const rsiWindow = closes.slice(-15);
  const deltas = rsiWindow.slice(1).map((close, index) => close - rsiWindow[index]);
  const averageGain = average(deltas.map((delta) => Math.max(0, delta)));
  const averageLoss = average(deltas.map((delta) => Math.max(0, -delta)));
  const rsi = averageLoss === 0 ? 100 : 100 - (100 / (1 + averageGain / averageLoss));
  const support = Math.min(...closes);
  const resistance = Math.max(...closes);
  const rangePosition = resistance === support ? 50 : ((current - support) / (resistance - support)) * 100;
  const totalPath = closes.slice(1).reduce((sum, close, index) => sum + Math.abs(close - closes[index]), 0);
  const netPath = Math.abs(current - closes[0]);
  const directionalEfficiency = totalPath === 0 ? 0 : (netPath / totalPath) * 100;
  const positiveCloseRatio = (returns.filter((value) => value > 0).length / Math.max(1, returns.length)) * 100;
  let runningPeak = closes[0];
  let maxDrawdown = 0;
  for (const close of closes) {
    runningPeak = Math.max(runningPeak, close);
    maxDrawdown = Math.min(maxDrawdown, (close / runningPeak - 1) * 100);
  }
  const supportDistance = (current / support - 1) * 100;
  const resistanceDistance = (resistance / current - 1) * 100;
  const rangeWidth = (resistance / support - 1) * 100;
  const volatilityAdjustedMomentum = volatility === 0 ? 0 : momentum3 / volatility;
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdSeries = closes.slice(25).map((_, index) => {
    const sample = closes.slice(0, index + 26);
    return ema(sample, 12) - ema(sample, 26);
  });
  const macd = ema12 - ema26;
  const macdSignal = macdSeries.length ? ema(macdSeries, Math.min(9, macdSeries.length)) : macd;
  const macdHistogram = macd - macdSignal;
  const last20 = closes.slice(-20);
  const mean20 = average(last20);
  const std20 = Math.sqrt(average(last20.map((value) => (value - mean20) ** 2)));
  const upperBand = mean20 + 2 * std20;
  const lowerBand = mean20 - 2 * std20;
  const bollingerPosition = upperBand === lowerBand ? 50 : ((current - lowerBand) / (upperBand - lowerBand)) * 100;
  const bollingerBandwidth = mean20 === 0 ? 0 : ((upperBand - lowerBand) / mean20) * 100;
  const priceZScore = std20 === 0 ? 0 : (current - mean20) / std20;
  const downsideReturns = returns.filter((value) => value < 0);
  const downsideDeviation = Math.sqrt(average(downsideReturns.map((value) => value ** 2)));
  const returnStd = volatility || 1;
  const returnSkew = average(returns.map((value) => ((value - meanReturn) / returnStd) ** 3));
  const lagPairs = returns.slice(1).map((value, index) => [returns[index], value] as const);
  const lagNumerator = lagPairs.reduce((sum, [previous, next]) => sum + (previous - meanReturn) * (next - meanReturn), 0);
  const lagDenominator = returns.reduce((sum, value) => sum + (value - meanReturn) ** 2, 0);
  const lagOneAutocorrelation = lagDenominator === 0 ? 0 : lagNumerator / lagDenominator;
  const xMean = (closes.length - 1) / 2;
  const yValues = closes.map((value) => Math.log(value));
  const yMean = average(yValues);
  const regressionNumerator = yValues.reduce((sum, value, index) => sum + (index - xMean) * (value - yMean), 0);
  const regressionDenominator = yValues.reduce((sum, _value, index) => sum + (index - xMean) ** 2, 0);
  const regressionSlope = regressionDenominator === 0 ? 0 : regressionNumerator / regressionDenominator;
  const fitted = yValues.map((_value, index) => yMean + regressionSlope * (index - xMean));
  const totalVariation = yValues.reduce((sum, value) => sum + (value - yMean) ** 2, 0);
  const residualVariation = yValues.reduce((sum, value, index) => sum + (value - fitted[index]) ** 2, 0);
  const regressionR2 = totalVariation === 0 ? 0 : Math.max(0, 1 - residualVariation / totalVariation);

  const trendPoints = trendSpread > .02 ? 24 : trendSpread < -.02 ? -24 : 0;
  const momentumPoints = momentum3 > .02 ? 22 : momentum3 < -.02 ? -22 : 0;
  const rsiPoints = rsi >= 55 && rsi < 72 ? 16 : rsi <= 45 && rsi > 28 ? -16 : rsi >= 72 ? -8 : rsi <= 28 ? 8 : 0;
  const rangePoints = rangePosition >= 62 ? 12 : rangePosition <= 38 ? -12 : 0;
  const riskPenalty = volatility > .35 ? 18 : volatility > .18 ? 8 : 0;
  const directionalScore = trendPoints + momentumPoints + rsiPoints + rangePoints;
  const score = Math.max(-100, Math.min(100, directionalScore > 0 ? directionalScore - riskPenalty : directionalScore < 0 ? directionalScore + riskPenalty : 0));
  const bias = Math.abs(score) < 28 ? "WAIT" : score > 0 ? "UP" : "DOWN";

  const signals: TechnicalSignal[] = [
    {
      id: "trend", label: "Trend", signal: trendSpread > .02 ? "UP" : trendSpread < -.02 ? "DOWN" : "NEUTRAL",
      value: `SMA5 ${percent(trendSpread)} vs SMA20`,
      explanation: trendSpread > .02 ? "Short-term average is above the broader average." : trendSpread < -.02 ? "Short-term average is below the broader average." : "Short and broader averages are nearly aligned.",
    },
    {
      id: "momentum", label: "Momentum", signal: momentum3 > .02 ? "UP" : momentum3 < -.02 ? "DOWN" : "NEUTRAL",
      value: `3-period ${percent(momentum3)}`,
      explanation: momentum3 > .02 ? "Recent closes are accelerating upward." : momentum3 < -.02 ? "Recent closes are losing ground." : "Recent movement is too small to confirm direction.",
    },
    {
      id: "rsi", label: "RSI (14)", signal: rsi >= 72 || rsi <= 28 ? "RISK" : rsi >= 55 ? "UP" : rsi <= 45 ? "DOWN" : "NEUTRAL",
      value: rsi.toFixed(1),
      explanation: rsi >= 72 ? "Overbought risk can weaken an UP continuation." : rsi <= 28 ? "Oversold risk can weaken a DOWN continuation." : rsi >= 55 ? "Buy-side momentum is stronger." : rsi <= 45 ? "Sell-side momentum is stronger." : "Momentum remains balanced.",
    },
    {
      id: "volatility", label: "Volatility", signal: volatility > .18 ? "RISK" : "NEUTRAL",
      value: `${volatility.toFixed(3)}% / period`,
      explanation: volatility > .35 ? "High noise materially reduces directional confidence." : volatility > .18 ? "Price noise warrants a smaller position." : "Observed price noise is contained.",
    },
    {
      id: "range", label: "Range position", signal: rangePosition >= 62 ? "UP" : rangePosition <= 38 ? "DOWN" : "NEUTRAL",
      value: `${rangePosition.toFixed(0)}% of observed range`,
      explanation: rangePosition >= 62 ? "Price is holding in the upper part of the range." : rangePosition <= 38 ? "Price is trading in the lower part of the range." : "Price is near the middle of the observed range.",
    },
  ];

  return {
    bias, score, support, resistance, signals,
    summary: bias === "WAIT" ? "Technical signals are mixed or too weak to justify a directional entry." : `${bias} has the stronger technical alignment, after applying a volatility penalty.`,
    methodology: `Calculated deterministically from ${closes.length} Coinbase close observations. Indicators are evidence, not guarantees.`,
    advancedMetrics: [
      { label: "Regression slope", value: `${(regressionSlope * 100).toFixed(4)}% / period`, interpretation: `Log-price trend with ${(regressionR2 * 100).toFixed(1)}% explanatory fit.` },
      { label: "Trend R²", value: regressionR2.toFixed(3), interpretation: regressionR2 >= .6 ? "Observed path is strongly trend-like." : "Trend explains a limited share of price variation." },
      { label: "MACD histogram", value: `$${macdHistogram.toFixed(3)}`, interpretation: macdHistogram > 0 ? "EMA momentum is above its signal line." : "EMA momentum is below its signal line." },
      { label: "Bollinger position", value: `${bollingerPosition.toFixed(1)}%`, interpretation: "Current price location between the 20-period ±2σ bands." },
      { label: "Bollinger bandwidth", value: `${bollingerBandwidth.toFixed(3)}%`, interpretation: "Normalized width of the current volatility envelope." },
      { label: "Price z-score", value: priceZScore.toFixed(2), interpretation: "Standard deviations from the 20-period mean." },
      { label: "Directional efficiency", value: `${directionalEfficiency.toFixed(1)}%`, interpretation: directionalEfficiency >= 45 ? "Net move has limited backtracking." : "Price path is noisy relative to its net move." },
      { label: "Vol-adjusted momentum", value: volatilityAdjustedMomentum.toFixed(2), interpretation: "Three-period return relative to realized volatility." },
      { label: "Max drawdown", value: `${maxDrawdown.toFixed(3)}%`, interpretation: "Largest peak-to-trough decline in the sampled window." },
      { label: "Downside deviation", value: `${downsideDeviation.toFixed(3)}%`, interpretation: "Dispersion of negative close-to-close returns." },
      { label: "Return skew", value: returnSkew.toFixed(2), interpretation: returnSkew < 0 ? "Return tail is tilted toward negative shocks." : "Return tail is tilted toward positive shocks." },
      { label: "Lag-1 autocorrelation", value: lagOneAutocorrelation.toFixed(2), interpretation: lagOneAutocorrelation > .15 ? "Recent returns show persistence." : lagOneAutocorrelation < -.15 ? "Recent returns show mean reversion." : "Little serial dependence is visible." },
      { label: "Positive close ratio", value: `${positiveCloseRatio.toFixed(1)}%`, interpretation: "Share of close-to-close returns above zero." },
      { label: "Range width", value: `${rangeWidth.toFixed(3)}%`, interpretation: "Observed support-to-resistance distance." },
      { label: "Support distance", value: `${supportDistance.toFixed(3)}%`, interpretation: "Current price cushion above observed support." },
      { label: "Resistance distance", value: `${resistanceDistance.toFixed(3)}%`, interpretation: "Move required to retest observed resistance." },
    ],
  };
}
