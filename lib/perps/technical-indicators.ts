export type TechnicalCandle = { open: number; high: number; low: number; close: number; volume: number; trades: number };

export type PerpsTechnicalSnapshot = {
  ema9: number; ema21: number; emaSpreadPct: number; rsi14: number; atr14: number; atrPct: number;
  bollingerUpper: number; bollingerMiddle: number; bollingerLower: number; bollingerPosition: number;
  volumeRatio: number; support: number; resistance: number;
  regime: "TRENDING_UP" | "TRENDING_DOWN" | "RANGE" | "INSUFFICIENT_DATA";
};

const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

export function emaSeries(values: number[], period: number) {
  if (!values.length) return [];
  const multiplier = 2 / (period + 1);
  return values.reduce<number[]>((series, value, index) => {
    series.push(index === 0 ? value : value * multiplier + series[index - 1] * (1 - multiplier));
    return series;
  }, []);
}

export function bollingerSeries(values: number[], period = 20, deviation = 2) {
  return values.map((_, index) => {
    const window = values.slice(Math.max(0, index - period + 1), index + 1);
    if (window.length < period) return null;
    const middle = average(window);
    const width = Math.sqrt(average(window.map(value => (value - middle) ** 2))) * deviation;
    return { upper: middle + width, middle, lower: middle - width };
  });
}

function rsi(values: number[], period = 14) {
  if (values.length <= period) return 50;
  const changes = values.slice(1).map((value, index) => value - values[index]).slice(-period);
  const gains = average(changes.map(change => Math.max(0, change)));
  const losses = average(changes.map(change => Math.max(0, -change)));
  return losses === 0 ? gains === 0 ? 50 : 100 : 100 - 100 / (1 + gains / losses);
}

function atr(candles: TechnicalCandle[], period = 14) {
  if (candles.length < 2) return 0;
  const ranges = candles.slice(1).map((candle, index) => Math.max(candle.high - candle.low, Math.abs(candle.high - candles[index].close), Math.abs(candle.low - candles[index].close)));
  return average(ranges.slice(-period));
}

export function calculatePerpsTechnicalSnapshot(candles: TechnicalCandle[]): PerpsTechnicalSnapshot {
  const valid = candles.filter(candle => [candle.open, candle.high, candle.low, candle.close].every(value => Number.isFinite(value) && value > 0));
  const closes = valid.map(candle => candle.close);
  const last = closes.at(-1) ?? 0;
  if (valid.length < 5) return { ema9: last, ema21: last, emaSpreadPct: 0, rsi14: 50, atr14: 0, atrPct: 0, bollingerUpper: last, bollingerMiddle: last, bollingerLower: last, bollingerPosition: .5, volumeRatio: 1, support: last, resistance: last, regime: "INSUFFICIENT_DATA" };
  const ema9 = emaSeries(closes, 9).at(-1) ?? last;
  const ema21 = emaSeries(closes, 21).at(-1) ?? last;
  const bands = bollingerSeries(closes).at(-1) ?? { upper: Math.max(...closes), middle: average(closes), lower: Math.min(...closes) };
  const atr14 = atr(valid);
  const recentVolume = average(valid.slice(-5).map(candle => candle.volume));
  const baselineVolume = average(valid.slice(-20, -5).map(candle => candle.volume)) || average(valid.map(candle => candle.volume)) || 1;
  const support = Math.min(...valid.slice(-20).map(candle => candle.low));
  const resistance = Math.max(...valid.slice(-20).map(candle => candle.high));
  const emaSpreadPct = last ? (ema9 - ema21) / last * 100 : 0;
  const atrPct = last ? atr14 / last * 100 : 0;
  const regime = valid.length < 20 ? "INSUFFICIENT_DATA" : Math.abs(emaSpreadPct) < Math.max(.015, atrPct * .12) ? "RANGE" : emaSpreadPct > 0 ? "TRENDING_UP" : "TRENDING_DOWN";
  return { ema9, ema21, emaSpreadPct, rsi14: rsi(closes), atr14, atrPct, bollingerUpper: bands.upper, bollingerMiddle: bands.middle, bollingerLower: bands.lower, bollingerPosition: bands.upper === bands.lower ? .5 : Math.max(0, Math.min(1, (last - bands.lower) / (bands.upper - bands.lower))), volumeRatio: recentVolume / baselineVolume, support, resistance, regime };
}
