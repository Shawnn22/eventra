import type { AdviceResponse } from "@/lib/advice";

export const FORECAST_LEDGER_KEY = "eventra:forecast-ledger:v1";

export type ForecastLedgerRecord = {
  id: string;
  createdAt: string;
  marketId: string;
  asset: "BTC" | "ETH";
  horizon: "1m" | "5m" | "10m" | "15m" | "45m" | "1h" | "4h";
  model: string;
  provider: string;
  action: AdviceResponse["advice"]["action"];
  confidence: number;
  aiProbabilityUp: number | null;
  dreamdexProbabilityUp: number | null;
  edgePercent: number | null;
  spotAtForecast: number | null;
  targetPrice: number | null;
  expiry?: string;
  outcome: "UP" | "DOWN" | "VOID" | null;
  status: "forward_testing" | "settled" | "void";
  verification?: "dreamdex-onchain" | "eventra-simulation";
};

export function createForecastLedgerRecord(params: {
  marketId: string;
  asset: ForecastLedgerRecord["asset"];
  horizon: ForecastLedgerRecord["horizon"];
  marketProbabilityAvailable: boolean;
  marketProbability: number;
  expiry?: string;
  result: AdviceResponse;
  verification?: ForecastLedgerRecord["verification"];
}): ForecastLedgerRecord {
  const { result } = params;
  const forecast = result.forecast;
  const aiProbabilityUp = forecast
    ? forecast.direction === "UP" ? forecast.confidence : 100 - forecast.confidence
    : null;
  const dreamdexProbabilityUp = params.marketProbabilityAvailable ? params.marketProbability : null;
  const edgePercent = aiProbabilityUp !== null && dreamdexProbabilityUp !== null
    ? Number((aiProbabilityUp - dreamdexProbabilityUp).toFixed(2))
    : null;

  return {
    id: `${params.marketId}:${result.meta.generatedAt}:${result.meta.model}`,
    createdAt: result.meta.generatedAt,
    marketId: params.marketId,
    asset: params.asset,
    horizon: params.horizon,
    model: result.meta.model,
    provider: result.meta.provider === "DreamPilot Local" ? "Eventra Core" : result.meta.provider,
    action: result.advice.action,
    confidence: result.advice.confidence,
    aiProbabilityUp,
    dreamdexProbabilityUp,
    edgePercent,
    spotAtForecast: forecast?.currentPrice ?? null,
    targetPrice: forecast?.predictedPrice ?? null,
    expiry: params.expiry,
    outcome: null,
    status: "forward_testing",
    verification: params.verification ?? "dreamdex-onchain",
  };
}

export function readForecastLedger(): ForecastLedgerRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(FORECAST_LEDGER_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as unknown;
    return Array.isArray(parsed) ? parsed as ForecastLedgerRecord[] : [];
  } catch {
    window.localStorage.removeItem(FORECAST_LEDGER_KEY);
    return [];
  }
}

export function saveForecastRecord(record: ForecastLedgerRecord) {
  const next = [record, ...readForecastLedger().filter((item) => item.id !== record.id)].slice(0, 100);
  window.localStorage.setItem(FORECAST_LEDGER_KEY, JSON.stringify(next));
  return next;
}

export function writeForecastLedger(records: ForecastLedgerRecord[]) {
  const next = records.slice(0, 100);
  window.localStorage.setItem(FORECAST_LEDGER_KEY, JSON.stringify(next));
  return next;
}
