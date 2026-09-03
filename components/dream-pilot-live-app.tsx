"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { AdviceResponse } from "@/lib/advice";
import type { DreamDexMarketSnapshot } from "@/lib/dreamdex";
import { advisorModels, productAiModels, type AdvisorModelId } from "@/lib/models";
import { useBrowserWallet } from "@/hooks/use-browser-wallet";
import { useLiveOrderBook } from "@/hooks/use-live-order-book";
import { usePlaceDreamDexOrder } from "@/hooks/use-place-dreamdex-order";
import { useUserOrders } from "@/hooks/use-user-orders";
import { useUserPositions } from "@/hooks/use-user-positions";
import { useAnalysisQuote } from "@/hooks/use-analysis-quote";
import { EVENTRA_ANALYSIS_ESCROW_ADDRESS } from "@/lib/eventra/analysis-escrow";
import { ConnectWallet } from "@/components/wallet/connect-wallet";
import { CollateralReadinessPanel } from "@/components/order/collateral-readiness";
import { TransactionStatus } from "@/components/order/transaction-status";
import type { PlaceOrderOutcome } from "@/lib/dreamdex/trading";
import { OpenOrdersPanel } from "@/components/portfolio/open-orders";
import { PositionsPanel } from "@/components/portfolio/positions";
import { ClosePositionCard } from "@/components/portfolio/close-position-card";
import { AiEdgeTracker } from "@/components/analytics/ai-edge-tracker";
import { ForecastEvidenceReceipt } from "@/components/analytics/forecast-evidence-receipt";
import { createForecastLedgerRecord, readForecastLedger, saveForecastRecord, writeForecastLedger, type ForecastLedgerRecord } from "@/lib/eventra/forecast-ledger";

type CampaignForm = {
  campaignName: string;
  question: string;
  asset: "BTC" | "ETH";
  horizon: "1m" | "5m" | "10m" | "15m" | "45m" | "1h" | "4h";
  marketProbability: number;
  marketProbabilityAvailable: boolean;
  spotMovePercent: number;
  volatilityPercent: number;
  volumeUsd: number;
  minutesRemaining: number;
  riskBudgetUsd: number;
  selectedModel: AdvisorModelId;
  marketId?: string;
  venueId?: string;
  poolAddress?: string;
  tradeCount?: number;
  marketSource: "dreamdex-live" | "manual";
  marketUpdatedAt?: string;
  expiry?: string;
};

type MarketResponse = {
  markets: DreamDexMarketSnapshot[];
  meta: {
    mode: "live" | "test";
    source: string;
    network: string;
    chainId: number;
    venueId: string;
    fetchedAt: string;
    latencyMs: number;
    diagnostics?: {
      indexedTradingMarkets: number;
      supportedOpenMarkets: number;
      onchainVerifiedMarkets: number;
      verificationFailures: number;
      rejectedByOnchainState: number;
    };
  };
};

type AiStatus = {
  configured: boolean;
  localAvailable?: boolean;
  openRouterConfigured?: boolean;
  provider: string;
  keyName: string;
  mode: "live" | "local" | "setup_required";
};

type OnchainVerification = {
  state: "idle" | "checking" | "verified" | "failed";
  marketAddress?: string;
  collateral?: string;
  error?: string;
};

type RadarForecast = {
  asset: "BTC" | "ETH";
  horizon: "1m" | "5m" | "10m" | "15m" | "45m" | "1h" | "4h";
  currentPrice: number;
  predictedPrice: number;
  expectedMovePercent: number;
  direction: "UP" | "DOWN";
  confidence: number;
  candles?: Array<{ time: number; close: number }>;
};

const initialForm: CampaignForm = {
  campaignName: "Loading DreamDEX…",
  question: "Syncing Event Contracts from Somnia testnet…",
  asset: "BTC",
  horizon: "15m",
  marketProbability: 50,
  marketProbabilityAvailable: false,
  spotMovePercent: 0,
  volatilityPercent: 0,
  volumeUsd: 0,
  minutesRemaining: 15,
  riskBudgetUsd: 50,
  selectedModel: "openrouter/free",
  marketSource: "manual",
};

const HISTORY_KEY = "dreampilot:decision-history:v2";
const WATCHLIST_KEY = "dreampilot:watchlist:v1";
const SIMULATED_TRADES_KEY = "dreampilot:simulated-trades:v1";
const TRADE_ACTIVITY_KEY = "eventra:trade-activity:v1";
const RISK_PROFILE_KEY = "eventra:risk-profile:v1";
const EXECUTION_MODE = process.env.NEXT_PUBLIC_EXECUTION_MODE === "live" ? "live" : "demo";

function buildTestCampaigns(): DreamDexMarketSnapshot[] {
  const now = Date.now();
  const fixtures = [
    { asset: "BTC" as const, horizon: "5m" as const, intervalSec: 300, probabilityUp: 54.2, volumeUsd: 1250, tradeCount: 18 },
    { asset: "ETH" as const, horizon: "15m" as const, intervalSec: 900, probabilityUp: 47.6, volumeUsd: 860, tradeCount: 12 },
    { asset: "BTC" as const, horizon: "1h" as const, intervalSec: 3600, probabilityUp: 61.1, volumeUsd: 3240, tradeCount: 31 },
  ];

  return fixtures.map((fixture, index) => {
    const intervalMs = fixture.intervalSec * 1000;
    const expiryMs = Math.ceil(now / intervalMs) * intervalMs;
    const bucket = Math.floor(expiryMs / intervalMs);
    const drift = Math.sin(bucket * 0.73 + index * 1.9) * 8;
    const probabilityUp = Math.max(8, Math.min(92, fixture.probabilityUp + drift));
    return ({
    marketId: `eventra-test-${fixture.asset.toLowerCase()}-${fixture.horizon}-${expiryMs}`,
    poolAddress: "",
    venueId: "eventra-test",
    asset: fixture.asset,
    question: `[TEST] Will ${fixture.asset} close at or above its opening price?`,
    horizon: fixture.horizon,
    intervalSec: fixture.intervalSec,
    expiry: new Date(expiryMs).toISOString(),
    minutesRemaining: Math.max(1, Math.ceil((expiryMs - now) / 60_000)),
    probabilityUp: Number(probabilityUp.toFixed(1)),
    volumeUsd: fixture.volumeUsd,
    tradeCount: fixture.tradeCount,
    lastTradeAt: new Date(now - (index + 1) * 20_000).toISOString(),
  }); });
}

const RISK_PROFILES = {
  conservative: { label: "Conservative", multiplier: 0.5, maxDefaultUsd: 5, minConfidence: 65, description: "Smaller default size and a higher evidence threshold." },
  balanced: { label: "Balanced", multiplier: 1, maxDefaultUsd: 25, minConfidence: 55, description: "Moderate sizing while keeping full wallet control." },
  aggressive: { label: "Aggressive", multiplier: 1.5, maxDefaultUsd: 100, minConfidence: 45, description: "Larger suggested size; execution and binary-loss risk remain." },
} as const;
type RiskProfileId = keyof typeof RISK_PROFILES;

type DecisionHistoryItem = {
  id: string;
  campaign: CampaignForm;
  result: AdviceResponse;
};

type SimulatedTrade = {
  id: string; asset: "BTC" | "ETH"; horizon: CampaignForm["horizon"]; side: "UP" | "DOWN";
  amountUsd: number; priceCents: number | null; createdAt: string;
  marketId?: string; expiry?: string; referencePrice?: number | null;
  shares?: number; remainingShares?: number; returnedUsd?: number; realizedPnlUsd?: number;
  status: "simulated_success" | "open" | "closed" | "settled";
  outcome?: "UP" | "DOWN";
};

type TradeActivity = {
  id: string;
  createdAt: string;
  mode: "demo" | "onchain";
  status: "confirmed" | "resting" | "late" | "reverted";
  asset: CampaignForm["asset"];
  horizon: CampaignForm["horizon"];
  side: "UP" | "DOWN";
  amountUsd: number;
  paidUsd?: number;
  refundedUsd?: number;
  hash?: string;
  orderId?: string;
  message?: string;
};

function actionLabel(action: AdviceResponse["advice"]["action"]) {
  if (action === "BUY_UP") return "Consider UP";
  if (action === "BUY_DOWN") return "Consider DOWN";
  return "Wait";
}

function marketScore(market: DreamDexMarketSnapshot) {
  const priceScore = market.probabilityUp === null ? 0 : 35;
  const tradeScore = Math.min(30, market.tradeCount * 3);
  const volumeScore = Math.min(20, Math.log10(market.volumeUsd + 1) * 7);
  // When liquidity is equal (common on testnet), prefer enough signing time
  // instead of selecting the newest one-minute pool that may close mid-demo.
  const timeScore = market.minutesRemaining >= 10
    ? 20
    : market.minutesRemaining >= 5
      ? 12
      : Math.max(1, market.minutesRemaining * 2);
  return priceScore + tradeScore + volumeScore + timeScore;
}

function marketDirection(market: DreamDexMarketSnapshot) {
  if (market.probabilityUp === null) return "No price yet";
  if (market.probabilityUp >= 55) return `Leaning UP ${market.probabilityUp}%`;
  if (market.probabilityUp <= 45) return `Leaning DOWN ${100 - market.probabilityUp}%`;
  return `Balanced · UP ${market.probabilityUp}%`;
}

function campaignReason(market: DreamDexMarketSnapshot, recommended: boolean) {
  if (market.probabilityUp === null || market.tradeCount === 0) {
    return "Not enough trades for a reliable probability read. Watch first, do not enter yet.";
  }
  if (market.minutesRemaining <= 5) {
    return `${market.minutesRemaining} minutes left: fast price moves and elevated execution risk.`;
  }
  if (recommended) {
    return `Best data now: ${market.tradeCount} trades and $${market.volumeUsd.toLocaleString("en-US")} volume.`;
  }
  return `${market.tradeCount} trades available for analysis; ${market.minutesRemaining} minutes to settlement.`;
}

function forecastEdge(market: DreamDexMarketSnapshot, forecast?: RadarForecast) {
  if (!forecast || market.probabilityUp === null || market.tradeCount === 0) return null;
  const modelUpProbability = forecast.direction === "UP" ? forecast.confidence : 100 - forecast.confidence;
  return modelUpProbability - market.probabilityUp;
}

function formatCountdown(totalSeconds: number) {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function demoMarkPrice(trade: SimulatedTrade, spotPrice: number | null) {
  if (!trade.priceCents) return null;
  if (!spotPrice || !trade.referencePrice) return trade.priceCents;
  const spotMove = ((spotPrice / trade.referencePrice) - 1) * 100;
  const directionalMove = trade.side === "UP" ? spotMove : -spotMove;
  return Math.max(1, Math.min(99, trade.priceCents + directionalMove * 18));
}

function PriceChart({ candles, direction, targetPrice }: { candles: Array<{ time: number; close: number }>; direction: "UP" | "DOWN"; targetPrice?: number }) {
  const width = 760;
  const height = 220;
  const leftPad = 18;
  const rightPad = 86;
  const topPad = 18;
  const bottomPad = 18;
  const plotRight = width - rightPad;
  const prices = candles.map((item) => item.close);
  const scalePrices = targetPrice ? [...prices, targetPrice] : prices;
  const min = Math.min(...scalePrices);
  const max = Math.max(...scalePrices);
  const range = Math.max(max - min, max * 0.001);
  const yForPrice = (price: number) => height - bottomPad - ((price - min) / range) * (height - topPad - bottomPad);
  const points = candles.map((item, index) => {
    const x = leftPad + (index / Math.max(1, candles.length - 1)) * (plotRight - leftPad);
    const y = yForPrice(item.close);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const area = `${leftPad},${height - bottomPad} ${points} ${plotRight},${height - bottomPad}`;
  const priceTicks = [max, (max + min) / 2, min];
  const first = candles[0];
  const last = candles.at(-1);

  return (
    <div className="live-price-chart">
      <svg aria-label={`${direction} price trend across ${candles.length} candles`} role="img" viewBox={`0 0 ${width} ${height}`}>
        <defs><linearGradient id="price-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#7c5cff" stopOpacity=".3" /><stop offset="100%" stopColor="#7c5cff" stopOpacity="0" /></linearGradient></defs>
        {priceTicks.map((price) => <g className="chart-y-tick" key={price}><line x1={leftPad} x2={plotRight} y1={yForPrice(price)} y2={yForPrice(price)} /><text x={width - 7} y={yForPrice(price) + 3} textAnchor="end">${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</text></g>)}
        {targetPrice ? <g className="chart-target"><line x1={leftPad} x2={plotRight} y1={yForPrice(targetPrice)} y2={yForPrice(targetPrice)} /><text x={plotRight - 6} y={Math.max(12, yForPrice(targetPrice) - 6)} textAnchor="end">AI target ${targetPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}</text></g> : null}
        <polygon fill="url(#price-area)" points={area} />
        <polyline className={direction.toLowerCase()} points={points} />
      </svg>
      <div className="chart-axis"><span>{first ? new Date(first.time * 1000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "—"}</span><b>Live spot price</b><span>{last ? "Now" : "—"}</span></div>
    </div>
  );
}

function useAnimatedNumber(target: number, durationMs = 700) {
  const [value, setValue] = useState(target);
  const valueRef = useRef(target);
  useEffect(() => {
    const from = valueRef.current;
    const startedAt = performance.now();
    let frame = 0;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      const next = from + (target - from) * eased;
      valueRef.current = next;
      setValue(next);
      if (progress < 1) frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [durationMs, target]);
  return value;
}

function SmoothPriceChart({ candles, direction, targetPrice }: { candles: Array<{ time: number; close: number }>; direction: "UP" | "DOWN"; targetPrice?: number }) {
  const target = candles.at(-1)?.close ?? 0;
  const animated = useAnimatedNumber(target);
  const displayCandles = useMemo(() => candles.map((candle, index) => index === candles.length - 1 ? { ...candle, close: animated } : candle), [animated, candles]);
  return <PriceChart candles={displayCandles} direction={direction} targetPrice={targetPrice} />;
}

function AnimatedPriceNumber({ value }: { value: number }) {
  const animated = useAnimatedNumber(value);
  return <>${animated.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>;
}

function MarketSparkline({ candles, direction }: { candles?: Array<{ time: number; close: number }>; direction?: "UP" | "DOWN" }) {
  if (!candles?.length) return <div className="market-sparkline empty">Loading price chart…</div>;
  const prices = candles.map((item) => item.close);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = Math.max(max - min, max * .001);
  const points = candles.map((item, index) => `${(index / Math.max(1, candles.length - 1) * 320).toFixed(1)},${(82 - ((item.close - min) / range) * 70).toFixed(1)}`).join(" ");
  const area = `0,92 ${points} 320,92`;
  return <div className="market-sparkline"><svg aria-label="Recent spot price trend used beside live DreamDEX Event Contract odds" role="img" viewBox="0 0 320 92"><line x1="0" x2="320" y1="46" y2="46" /><polygon className={direction?.toLowerCase()} points={area} /><polyline className={direction?.toLowerCase()} points={points} /></svg><span>Spot trend · <b>Powered by DreamDEX</b></span><small>Spot candles: Coinbase · Contract odds: DreamDEX</small></div>;
}

function MetricInput({
  label,
  suffix,
  value,
  onChange,
  step = 1,
  readOnly = false,
}: {
  label: string;
  suffix: string;
  value: number;
  onChange?: (value: number) => void;
  step?: number;
  readOnly?: boolean;
}) {
  return (
    <label className={`metric-input ${readOnly ? "read-only" : ""}`}>
      <span>{label}</span>
      <span className="metric-control">
        <input
          type="number"
          value={value}
          step={step}
          readOnly={readOnly}
          onChange={(event) => onChange?.(Number(event.target.value))}
        />
        <b>{suffix}</b>
      </span>
    </label>
  );
}

export function DreamPilotApp() {
  const [activeStep, setActiveStep] = useState<1 | 2 | 3 | 4>(1);
  const [form, setForm] = useState<CampaignForm>(initialForm);
  const [result, setResult] = useState<AdviceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<DecisionHistoryItem[]>([]);
  const [markets, setMarkets] = useState<DreamDexMarketSnapshot[]>([]);
  const [liveMarkets, setLiveMarkets] = useState<DreamDexMarketSnapshot[]>([]);
  const [discoveryMode, setDiscoveryMode] = useState<"live" | "test">("live");
  const [selectedMarketId, setSelectedMarketId] = useState("");
  const [marketState, setMarketState] = useState<"loading" | "live" | "test" | "error">("loading");
  const [marketMeta, setMarketMeta] = useState<MarketResponse["meta"] | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [discoveryAsset, setDiscoveryAsset] = useState<"ALL" | "BTC" | "ETH">("ALL");
  const [showAllCampaigns, setShowAllCampaigns] = useState(false);
  const [onchainVerification, setOnchainVerification] = useState<OnchainVerification>({ state: "idle" });
  const [radarForecasts, setRadarForecasts] = useState<Record<string, RadarForecast>>({});
  const [radarLoading, setRadarLoading] = useState(false);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [selectedAiOption, setSelectedAiOption] = useState("local");
  const [walletPickerRequest, setWalletPickerRequest] = useState(0);
  const [tradeSide, setTradeSide] = useState<"UP" | "DOWN">("UP");
  const [tradeAmountUsd, setTradeAmountUsd] = useState(3);
  const [executionMode, setExecutionMode] = useState<"demo" | "live">(EXECUTION_MODE);
  const [liveTicks, setLiveTicks] = useState<Array<{ time: number; close: number }>>([]);
  const [liveSpotPrice, setLiveSpotPrice] = useState<number | null>(null);
  const [spotUpdatedAt, setSpotUpdatedAt] = useState<number | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [lastTrade, setLastTrade] = useState<(Pick<PlaceOrderOutcome, "hash" | "orderId" | "settlement"> & { phase: PlaceOrderOutcome["phase"] | "simulated_success"; simulated?: boolean; marketId?: string }) | null>(null);
  const [simulatedTrades, setSimulatedTrades] = useState<SimulatedTrade[]>([]);
  const [tradeActivity, setTradeActivity] = useState<TradeActivity[]>([]);
  const [riskProfile, setRiskProfile] = useState<RiskProfileId>("balanced");
  const [forecastLedger, setForecastLedger] = useState<ForecastLedgerRecord[]>([]);
  const [judgeMode, setJudgeMode] = useState(false);
  const [rolloverNotice, setRolloverNotice] = useState("");
  const activeMarketIdRef = useRef("");
  const activeStepRef = useRef(activeStep);
  const portfolioRef = useRef<HTMLElement>(null);
  const tradeTerminalRef = useRef<HTMLElement>(null);
  const rolledMarketRef = useRef("");
  const pendingRolloverRef = useRef<{ asset: CampaignForm["asset"]; horizon: CampaignForm["horizon"]; previousMarketId: string } | null>(null);

  const wallet = useBrowserWallet();
  const isTestCampaign = marketMeta?.mode === "test";
  const orderBook = useLiveOrderBook({
    pool: form.poolAddress,
    enabled: !isTestCampaign && Boolean(form.poolAddress) && Boolean(result),
    pollIntervalMs: 4_000,
  });
  const placer = usePlaceDreamDexOrder();
  const userOrders = useUserOrders(wallet.account);
  const userPositions = useUserPositions(wallet.account);
  const analysisQuote = useAnalysisQuote(selectedAiOption);

  useEffect(() => { try { const stored = localStorage.getItem(SIMULATED_TRADES_KEY); if (stored) setSimulatedTrades(JSON.parse(stored) as SimulatedTrade[]); } catch { /* ignore invalid local demo data */ } }, []);
  useEffect(() => { try { const stored = localStorage.getItem(TRADE_ACTIVITY_KEY); if (stored) setTradeActivity(JSON.parse(stored) as TradeActivity[]); } catch { /* ignore invalid local activity */ } }, []);
  useEffect(() => {
    const stored = localStorage.getItem(RISK_PROFILE_KEY);
    if (stored && stored in RISK_PROFILES) setRiskProfile(stored as RiskProfileId);
  }, []);
  useEffect(() => { setForecastLedger(readForecastLedger()); }, []);
  useEffect(() => { activeStepRef.current = activeStep; }, [activeStep]);

  useEffect(() => {
    const pendingIds = [...new Set(forecastLedger
      .filter((record) => record.verification !== "eventra-simulation" && record.status === "forward_testing" && (!record.expiry || new Date(record.expiry).getTime() <= Date.now()))
      .map((record) => record.marketId))];
    if (pendingIds.length === 0) return;
    const controller = new AbortController();
    const reconcile = async () => {
      try {
        const response = await fetch("/api/markets/outcomes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ marketIds: pendingIds.slice(0, 20) }),
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = await response.json() as { outcomes: Array<{ marketId: string; isResolved: boolean; isVoided: boolean; winningOutcome: 0 | 1 | null }> };
        const byMarket = new Map(payload.outcomes.map((outcome) => [outcome.marketId.toLowerCase(), outcome]));
        setForecastLedger((current) => {
          let changed = false;
          const next = current.map((record) => {
            if (record.status !== "forward_testing") return record;
            const outcome = byMarket.get(record.marketId.toLowerCase());
            if (!outcome || (!outcome.isResolved && !outcome.isVoided)) return record;
            changed = true;
            return {
              ...record,
              status: outcome.isVoided ? "void" as const : "settled" as const,
              outcome: outcome.isVoided ? "VOID" as const : outcome.winningOutcome === 0 ? "UP" as const : "DOWN" as const,
            };
          });
          return changed ? writeForecastLedger(next) : current;
        });
      } catch {
        // Keep records pending when the RPC or settlement oracle is unavailable.
      }
    };
    void reconcile();
    const timer = window.setInterval(() => void reconcile(), 30_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [forecastLedger]);

  useEffect(() => {
    return wallet.onSessionInvalidated(() => {
      orderBook.setDraftInputs(null);
      placer.reset();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.onSessionInvalidated]);

  useEffect(() => {
    if (!result || !form.poolAddress || !form.marketId || !form.venueId) {
      orderBook.setDraftInputs(null);
      return;
    }
    orderBook.setDraftInputs({
      account: wallet.account,
      chainId: wallet.chainId,
      marketId: form.marketId,
      venueId: form.venueId,
      pool: form.poolAddress,
      action: tradeSide === "UP" ? "BUY_UP" : "BUY_DOWN",
      riskBudgetUsd: form.riskBudgetUsd,
      suggestedMaxStakePercent: result.advice.suggestedMaxStakePercent,
      maxSpendUsd: tradeAmountUsd,
      minutesRemaining: form.minutesRemaining,
      advicePayload: { aiAction: result.advice.action, userSide: tradeSide, confidence: result.advice.confidence, model: result.meta.model, marketId: form.marketId },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, tradeSide, tradeAmountUsd, form.poolAddress, form.marketId, form.venueId, form.riskBudgetUsd, form.minutesRemaining, wallet.account, wallet.chainId, orderBook.book]);


  const selectedModel = advisorModels.find((model) => model.id === form.selectedModel) ?? advisorModels[0];
  const selectedProductModel = productAiModels.find((model) => model.id === selectedAiOption);

  function applyMarket(market: DreamDexMarketSnapshot, fetchedAt: string, mode: MarketResponse["meta"]["mode"] = "live") {
    const marketChanged = activeMarketIdRef.current !== market.marketId;
    activeMarketIdRef.current = market.marketId;
    setSelectedMarketId(market.marketId);
    if (marketChanged) {
      setResult(null);
    }
    setForm((current) => ({
      ...current,
      campaignName: `${market.asset} ${market.horizon} · ${market.marketId.slice(-6)}`,
      question: market.question,
      asset: market.asset,
      horizon: market.horizon,
      marketProbability: market.probabilityUp ?? 50,
      marketProbabilityAvailable: market.probabilityUp !== null,
      volumeUsd: market.volumeUsd,
      minutesRemaining: Math.max(1, market.minutesRemaining),
      marketId: market.marketId,
      venueId: market.venueId,
      poolAddress: market.poolAddress,
      tradeCount: market.tradeCount,
      marketSource: mode === "live" ? "dreamdex-live" : "manual",
      marketUpdatedAt: fetchedAt,
      expiry: market.expiry,
    }));
  }

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(HISTORY_KEY);
      if (!stored) return;
      const envelope = JSON.parse(stored) as { version?: number; items?: DecisionHistoryItem[] };
      if (envelope.version === 2 && Array.isArray(envelope.items)) {
        setHistory((current) => current.length > 0 ? current : envelope.items!.slice(0, 5));
      }
    } catch {
      window.localStorage.removeItem(HISTORY_KEY);
    }
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(WATCHLIST_KEY);
      if (stored) setWatchlist(JSON.parse(stored) as string[]);
    } catch {
      window.localStorage.removeItem(WATCHLIST_KEY);
    }
  }, []);

  function toggleWatchlist(marketId: string) {
    setWatchlist((current) => {
      const next = current.includes(marketId) ? current.filter((id) => id !== marketId) : [...current, marketId];
      window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
      return next;
    });
  }

  useEffect(() => {
    const timer = window.setInterval(
      () => setRefreshNonce((value) => value + 1),
      liveMarkets.length === 0 ? 10_000 : 30_000,
    );
    return () => window.clearInterval(timer);
  }, [liveMarkets.length]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/advice", { signal: controller.signal })
      .then((response) => response.json())
      .then((payload: AiStatus) => setAiStatus(payload))
      .catch(() => setAiStatus(null));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setMarketState("loading");
    setError("");

    void fetch(`/api/markets?refresh=${Date.now()}&nonce=${refreshNonce}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load markets.");
        return payload as MarketResponse;
      })
      .then((payload) => {
        const noLiveCampaigns = payload.markets.length === 0;
        setLiveMarkets(payload.markets);
        const useTestArena = discoveryMode === "test" || noLiveCampaigns;
        const fallbackMarkets = useTestArena ? buildTestCampaigns() : payload.markets;
        const effectiveMeta: MarketResponse["meta"] = useTestArena
          ? { ...payload.meta, mode: "test", source: "Eventra test fixtures", fetchedAt: new Date().toISOString() }
          : payload.meta;
        setMarkets(fallbackMarkets);
        setMarketMeta(effectiveMeta);
        setMarketState(useTestArena ? "test" : "live");
        if (useTestArena) setExecutionMode("demo");
        const rankedMarkets = [...fallbackMarkets].sort((a, b) => marketScore(b) - marketScore(a));
        const currentMarket = rankedMarkets.find((market) => market.marketId === activeMarketIdRef.current);
        const rollover = pendingRolloverRef.current;
        const rolloverMarket = rollover
          ? rankedMarkets.find((market) => market.marketId !== rollover.previousMarketId && market.asset === rollover.asset && market.horizon === rollover.horizon)
          : undefined;
        if (currentMarket) applyMarket(currentMarket, effectiveMeta.fetchedAt, effectiveMeta.mode);
        else if (rollover && rolloverMarket) {
          applyMarket(rolloverMarket, effectiveMeta.fetchedAt, effectiveMeta.mode);
          pendingRolloverRef.current = null;
          setRolloverNotice(`${rollover.asset} ${rollover.horizon} settled. Eventra loaded the next live campaign.`);
          setActiveStep(1);
        }
        else if (activeStepRef.current === 1 && rankedMarkets[0]) applyMarket(rankedMarkets[0], effectiveMeta.fetchedAt, effectiveMeta.mode);
        else if (activeStepRef.current !== 1) {
          // Preserve the campaign snapshot used by an in-progress or completed
          // analysis. A background market refresh must never replace its report.
        }
        else {
          activeMarketIdRef.current = "";
          setSelectedMarketId("");
          setForm((current) => ({ ...current, marketSource: "manual" }));
        }
      })
      .catch((marketError) => {
        if (controller.signal.aborted) return;
        setMarketState("error");
        setMarkets([]);
        setError(marketError instanceof Error ? marketError.message : "DreamDEX API unavailable.");
      });

    return () => controller.abort();
  }, [discoveryMode, refreshNonce]);

  const rankedMarkets = useMemo(
    () => [...markets].sort((a, b) => marketScore(b) - marketScore(a)),
    [markets],
  );

  useEffect(() => {
    if (markets.length === 0) return;
    const controller = new AbortController();
    const uniquePairs = [...new Map(markets.map((market) => [`${market.asset}-${market.horizon}`, market])).values()];
    setRadarLoading(true);
    void Promise.all(uniquePairs.map(async (market) => {
      const response = await fetch(`/api/forecast?asset=${market.asset}&horizon=${market.horizon}`, { signal: controller.signal });
      if (!response.ok) return null;
      return await response.json() as RadarForecast;
    })).then((forecasts) => {
      if (controller.signal.aborted) return;
      setRadarForecasts(Object.fromEntries(forecasts.filter((item): item is RadarForecast => Boolean(item)).map((item) => [`${item.asset}-${item.horizon}`, item])));
    }).finally(() => { if (!controller.signal.aborted) setRadarLoading(false); });
    return () => controller.abort();
  }, [markets]);
  const visibleMarkets = useMemo(
    () => rankedMarkets.filter((market) => discoveryAsset === "ALL" || market.asset === discoveryAsset),
    [discoveryAsset, rankedMarkets],
  );
  const recommendedMarket = visibleMarkets.find(
    (market) => market.probabilityUp !== null && market.tradeCount > 0,
  ) ?? visibleMarkets[0];
  const hasTradableEvidence = Boolean(
    recommendedMarket?.probabilityUp !== null && recommendedMarket && recommendedMarket.tradeCount > 0,
  );
  const displayedMarkets = showAllCampaigns ? visibleMarkets : visibleMarkets.slice(0, 3);
  const selectedMarket = markets.find((market) => market.marketId === selectedMarketId) ?? null;
  const activePosition = userPositions.positions.find((position) => position.marketId.toLowerCase() === form.marketId?.toLowerCase()) ?? null;
  const positionIndexing = Boolean(lastTrade && lastTrade.marketId === form.marketId && (lastTrade.phase === "filled" || lastTrade.phase === "partial_fill"));
  const tradableMarketCount = markets.filter((market) => market.probabilityUp !== null && market.tradeCount > 0).length;
  const watchedMarkets = markets.filter((market) => watchlist.includes(market.marketId));
  const activeAlertCount = watchedMarkets.filter((market) => Math.abs(forecastEdge(market, radarForecasts[`${market.asset}-${market.horizon}`]) ?? 0) >= 8).length;

  function startFastDemo() {
    if (!recommendedMarket || !marketMeta) return;
    applyMarket(recommendedMarket, marketMeta.fetchedAt);
    setSelectedAiOption("local");
    setJudgeMode(true);
    setError("");
    setActiveStep(3);
  }

  useEffect(() => {
    if (!form.marketId || !form.poolAddress) {
      setOnchainVerification({ state: "idle" });
      return;
    }

    // Verify the exact market/pool snapshot used by the order form. The market
    // list refreshes independently, so deriving either value from that list can
    // temporarily pair a new market with a stale pool and produce a false 409.
    const marketId = form.marketId;
    const pool = form.poolAddress;
    const controller = new AbortController();
    setOnchainVerification({ state: "checking" });
    void fetch("/api/markets/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ marketId, pool }),
      cache: "no-store",
      signal: controller.signal,
    }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok || !payload.verified) throw new Error(payload.error || "On-chain verification failed");
      setOnchainVerification({ state: "verified", marketAddress: payload.marketAddress, collateral: payload.collateral });
    }).catch((verificationError) => {
      if (!controller.signal.aborted) setOnchainVerification({ state: "failed", error: verificationError instanceof Error ? verificationError.message : "Verification failed" });
    });
    return () => controller.abort();
  }, [form.marketId, form.poolAddress]);

  const selectedRiskProfile = RISK_PROFILES[riskProfile];
  const suggestedStake = result
    ? Math.min(
        selectedRiskProfile.maxDefaultUsd,
        (form.riskBudgetUsd * result.advice.suggestedMaxStakePercent * selectedRiskProfile.multiplier) / 100,
      )
    : 0;

  useEffect(() => {
    if (!result?.forecast) return;
    setLiveTicks(result.forecast.candles ?? []);
    setLiveSpotPrice(result.forecast.currentPrice);
    setSpotUpdatedAt(Date.now());
  }, [result?.meta.generatedAt, result?.forecast]);

  useEffect(() => {
    if (!result?.forecast || activeStep !== 4) return;
    let stopped = false;
    const controller = new AbortController();
    const refreshTicker = async () => {
      try {
        const response = await fetch(`/api/spot?asset=${form.asset}&t=${Date.now()}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const payload = await response.json() as { price: number; time: string };
        if (stopped || !Number.isFinite(payload.price)) return;
        const tick = { time: Math.floor(new Date(payload.time).getTime() / 1000), close: payload.price };
        setLiveSpotPrice(payload.price);
        setSpotUpdatedAt(Date.now());
        setLiveTicks((current) => {
          const withoutSameTick = current.filter((item) => item.time !== tick.time);
          return [...withoutSameTick, tick].slice(-60);
        });
      } catch {
        // Keep the last verified price visible when a single ticker request fails.
      }
    };
    void refreshTicker();
    const timer = window.setInterval(() => void refreshTicker(), 2_000);
    return () => { stopped = true; controller.abort(); window.clearInterval(timer); };
  }, [activeStep, form.asset, result?.meta.generatedAt, result?.forecast]);

  useEffect(() => {
    const updateCountdown = () => {
      const expiryMs = form.expiry ? new Date(form.expiry).getTime() : Date.now() + form.minutesRemaining * 60_000;
      setSecondsRemaining(Math.max(0, Math.ceil((expiryMs - Date.now()) / 1000)));
    };
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1_000);
    return () => window.clearInterval(timer);
  }, [form.expiry, form.minutesRemaining]);

  useEffect(() => {
    if (!form.marketId || secondsRemaining > 0 || rolledMarketRef.current === form.marketId) return;
    if (isTestCampaign && liveSpotPrice && form.marketId) {
      const outcome = result?.forecast && liveSpotPrice >= result.forecast.currentPrice ? "UP" as const : "DOWN" as const;
      setSimulatedTrades((current) => {
        const next = current.map((trade) => {
          if (trade.marketId !== form.marketId || (trade.status !== "open" && trade.status !== "simulated_success")) return trade;
          const shares = trade.remainingShares ?? trade.shares ?? 0;
          const won = trade.side === outcome;
          const settlementValue = won ? shares : 0;
          const returnedUsd = (trade.returnedUsd ?? 0) + settlementValue;
          return { ...trade, remainingShares: 0, returnedUsd, realizedPnlUsd: returnedUsd - trade.amountUsd, status: "settled" as const, outcome };
        });
        localStorage.setItem(SIMULATED_TRADES_KEY, JSON.stringify(next));
        return next;
      });
      setForecastLedger((current) => {
        let changed = false;
        const next = current.map((record) => {
          if (record.marketId !== form.marketId || record.verification !== "eventra-simulation" || record.status !== "forward_testing") return record;
          changed = true;
          return { ...record, status: "settled" as const, outcome };
        });
        return changed ? writeForecastLedger(next) : current;
      });
    }
    rolledMarketRef.current = form.marketId;
    pendingRolloverRef.current = { asset: form.asset, horizon: form.horizon, previousMarketId: form.marketId };
    setRolloverNotice(`${form.asset} ${form.horizon} has settled. Looking for the next live campaign…`);
    setRefreshNonce((value) => value + 1);
  }, [form.asset, form.horizon, form.marketId, isTestCampaign, liveSpotPrice, result?.forecast, secondsRemaining]);

  useEffect(() => {
    if (!result) return;
    setTradeSide(result.advice.action === "BUY_UP" ? "UP" : result.advice.action === "BUY_DOWN" ? "DOWN" : result.forecast?.direction ?? "UP");
    setTradeAmountUsd(result.advice.action === "WAIT" ? 1 : Math.max(0.1, Number(suggestedStake.toFixed(2))));
    // Reset user controls only when a new AI result is generated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.meta.generatedAt, riskProfile]);

  function selectRiskProfile(profile: RiskProfileId) {
    setRiskProfile(profile);
    localStorage.setItem(RISK_PROFILE_KEY, profile);
  }

  const liveBookPrices = useMemo(() => {
    if (!orderBook.book) return null;
    const scale = 10 ** orderBook.book.decimals;
    const yes = orderBook.book.yesAsks[0]?.price;
    const no = orderBook.book.noAsks[0]?.price;
    return {
      up: yes ? Number(((Number(yes) / scale) * 100).toFixed(2)) : null,
      down: no ? Number(((Number(no) / scale) * 100).toFixed(2)) : null,
    };
  }, [orderBook.book]);

  const tradeEstimate = useMemo(() => {
    const bookPrice = tradeSide === "UP" ? liveBookPrices?.up : liveBookPrices?.down;
    const snapshotPrice = form.marketProbabilityAvailable
      ? (tradeSide === "UP" ? form.marketProbability : 100 - form.marketProbability)
      : null;
    const probability = bookPrice ?? snapshotPrice;
    if (probability === null) return null;
    if (probability <= 0) return null;
    const estimatedPayout = tradeAmountUsd / (probability / 100);
    return {
      priceCents: probability,
      shares: estimatedPayout,
      payoutUsd: estimatedPayout,
      profitUsd: Math.max(0, estimatedPayout - tradeAmountUsd),
    };
  }, [form.marketProbability, form.marketProbabilityAvailable, liveBookPrices, tradeAmountUsd, tradeSide]);

  const displaySpotPrice = liveSpotPrice ?? result?.forecast?.currentPrice ?? 0;
  const liveSpotMovePercent = result?.forecast?.currentPrice
    ? ((displaySpotPrice / result.forecast.currentPrice) - 1) * 100
    : 0;
  const selectedLiveAsk = tradeSide === "UP" ? liveBookPrices?.up : liveBookPrices?.down;
  const modelProbabilityUp = result?.forecast
    ? result.forecast.direction === "UP" ? result.forecast.confidence : 100 - result.forecast.confidence
    : null;
  const liveModelEdge = modelProbabilityUp !== null && form.marketProbabilityAvailable
    ? modelProbabilityUp - form.marketProbability
    : null;
  const marketClosed = Boolean(result) && secondsRemaining <= 0;
  const marketClosingSoon = Boolean(result) && secondsRemaining > 0 && secondsRemaining <= 60;

  useEffect(() => {
    // A generic SDK error from the previous pool must never survive a campaign
    // rollover. A fresh market starts with a clean execution ticket.
    placer.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.marketId]);

  useEffect(() => {
    // Clear the stale generic error shown in the reported screenshot. New late
    // races are classified as SubmittedTooLate by placeDreamDexOrder above.
    if (marketClosed && !placer.isBusy && placer.outcome?.errorName === "Unknown") placer.reset();
  }, [marketClosed, placer]);

  const liveTradeBlockReason = marketClosed
    ? "Market closed"
    : selectedLiveAsk === null || selectedLiveAsk === undefined
      ? (orderBook.loading ? "Syncing DreamDEX orderbook…" : `No ${tradeSide} liquidity`)
      : null;

  const canRequestAdvice =
    !loading && (aiStatus?.configured === true || aiStatus?.localAvailable === true) && (form.marketSource === "dreamdex-live" || isTestCampaign);

  async function requestAdvice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActiveStep(4);
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/advice?mode=local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to generate advice.");
      const adviceResult = payload as AdviceResponse;
      setResult(adviceResult);
      if (form.marketId) {
        const ledgerRecord = createForecastLedgerRecord({
          marketId: form.marketId,
          asset: form.asset,
          horizon: form.horizon,
          marketProbabilityAvailable: form.marketProbabilityAvailable,
          marketProbability: form.marketProbability,
          expiry: form.expiry,
          result: adviceResult,
          verification: isTestCampaign ? "eventra-simulation" : "dreamdex-onchain",
        });
        setForecastLedger(saveForecastRecord(ledgerRecord));
      }
      setHistory((current) => {
        const next = [
          {
            id: `${adviceResult.meta.generatedAt}:${form.selectedModel}`,
            campaign: { ...form },
            result: adviceResult,
          },
          ...current,
        ].slice(0, 5);
        window.localStorage.setItem(
          HISTORY_KEY,
          JSON.stringify({ version: 2, items: next }),
        );
        return next;
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function goHome() {
    setActiveStep(1);
    setJudgeMode(false);
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const selectedAnalysisPrice = analysisQuote.state === "live"
    ? analysisQuote.feeUsd
    : selectedProductModel?.analysisPriceUsd ?? 0;

  function recordTradeActivity(activity: TradeActivity) {
    setTradeActivity((current) => {
      const next = [activity, ...current.filter((item) => item.id !== activity.id)].slice(0, 12);
      localStorage.setItem(TRADE_ACTIVITY_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function placeCurrentOrder() {
    if (!wallet.walletClient) return;
    placer.reset();
    const freshDraft = await orderBook.refresh();
    if (!freshDraft) return;
    void placer.place({ draft: freshDraft, walletClient: wallet.walletClient, marketExpiryIso: form.expiry, minutesRemaining: form.minutesRemaining }).then((outcome) => {
      if (outcome.phase === "filled" || outcome.phase === "partial_fill" || outcome.phase === "resting") {
        if (outcome.hash) setLastTrade({ hash: outcome.hash, phase: outcome.phase, orderId: outcome.orderId, settlement: outcome.settlement, marketId: form.marketId });
        recordTradeActivity({
          id: outcome.hash ?? outcome.orderId ?? `CHAIN-${Date.now()}`,
          createdAt: new Date().toISOString(), mode: "onchain", status: outcome.phase === "resting" ? "resting" : "confirmed",
          asset: form.asset, horizon: form.horizon, side: tradeSide, amountUsd: tradeAmountUsd,
          paidUsd: outcome.settlement?.netSpentUsd, refundedUsd: outcome.settlement?.refundedUsd,
          hash: outcome.hash, orderId: outcome.orderId,
        });
        window.setTimeout(() => { void userOrders.refresh(); void userPositions.refresh(); }, 1_500);
        window.setTimeout(() => portfolioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 450);
      } else if (outcome.phase === "rejected" || outcome.phase === "reverted") {
        recordTradeActivity({
          id: outcome.hash ?? `FAILED-${Date.now()}`, createdAt: new Date().toISOString(), mode: "onchain",
          status: outcome.errorName === "SubmittedTooLate" || outcome.errorName === "MarketClosed" ? "late" : "reverted",
          asset: form.asset, horizon: form.horizon, side: tradeSide, amountUsd: tradeAmountUsd,
          refundedUsd: tradeAmountUsd, hash: outcome.hash, message: outcome.errorMessageVi,
        });
      }
    });
  }

  function placeSimulatedOrder() {
    const bookPrice = tradeSide === "UP" ? liveBookPrices?.up : liveBookPrices?.down;
    const snapshotPrice = form.marketProbabilityAvailable ? (tradeSide === "UP" ? form.marketProbability : 100 - form.marketProbability) : null;
    const priceCents = bookPrice ?? snapshotPrice;
    const shares = priceCents ? tradeAmountUsd / (priceCents / 100) : 0;
    const trade: SimulatedTrade = {
      id: `SIM-${Date.now()}`, asset: form.asset, horizon: form.horizon, side: tradeSide,
      amountUsd: tradeAmountUsd, priceCents, createdAt: new Date().toISOString(), status: "open",
      marketId: form.marketId, expiry: form.expiry, referencePrice: liveSpotPrice ?? result?.forecast?.currentPrice ?? null,
      shares, remainingShares: shares, returnedUsd: 0, realizedPnlUsd: 0,
    };
    setSimulatedTrades((current) => { const next = [trade, ...current].slice(0, 20); localStorage.setItem(SIMULATED_TRADES_KEY, JSON.stringify(next)); return next; });
    recordTradeActivity({ id: trade.id, createdAt: trade.createdAt, mode: "demo", status: "confirmed", asset: trade.asset, horizon: trade.horizon, side: trade.side, amountUsd: trade.amountUsd, paidUsd: 0, message: "Simulation completed. No funds were used." });
    setLastTrade({ phase: "simulated_success", orderId: trade.id, simulated: true });
    window.setTimeout(() => portfolioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 250);
  }

  function closeSimulatedPosition(id: string, fraction: number) {
    setSimulatedTrades((current) => {
      const next = current.map((trade) => {
        if (trade.id !== id || trade.status !== "open") return trade;
        const mark = demoMarkPrice(trade, liveSpotPrice);
        const remaining = trade.remainingShares ?? trade.shares ?? 0;
        if (!mark || remaining <= 0) return trade;
        const sharesSold = remaining * fraction;
        const proceeds = sharesSold * (mark / 100);
        const returnedUsd = (trade.returnedUsd ?? 0) + proceeds;
        const remainingShares = Math.max(0, remaining - sharesSold);
        const closed = remainingShares < 0.000001;
        const costBasisSold = trade.amountUsd * (sharesSold / (trade.shares || sharesSold));
        return {
          ...trade,
          remainingShares,
          returnedUsd,
          realizedPnlUsd: (trade.realizedPnlUsd ?? 0) + proceeds - costBasisSold,
          status: closed ? "closed" as const : "open" as const,
        };
      });
      localStorage.setItem(SIMULATED_TRADES_KEY, JSON.stringify(next));
      return next;
    });
  }

  return (
    <main className={`app-shell step-${activeStep} ${activeStep === 4 ? "report-mode" : ""}`}>
      <div className="market-canvas" aria-hidden="true">
        <span className="canvas-orbit orbit-left" />
        <span className="canvas-orbit orbit-right" />
        <span className="canvas-node node-a" />
        <span className="canvas-node node-b" />
        <span className="canvas-node node-c" />
        <span className="canvas-pulse" />
        <span className="canvas-label label-left">SIGNAL / 50312</span>
        <span className="canvas-label label-right">AI × EVENT MARKETS</span>
      </div>
      <header className="topbar">
        <button aria-label="Back to Eventra home" className="brand" onClick={goHome} type="button"><span className="brand-mark"><img alt="" src="/brand/eventra-mark.svg" /></span><span className="eventra-wordmark">Eventra</span><i className="brand-divider">×</i><span className="dreamdex-wordmark"><img alt="DreamDEX" src="/brand/dreamdex-wordmark.svg" /></span></button>
        <span className="safety-note">AI execution copilot for Event Contracts</span>
        <div className="topbar-right">
          <span className={`network-badge ${marketState}`}>
            <span className={`connection-dot ${marketState}`} /> Somnia testnet
          </span>
          <ConnectWallet openSignal={walletPickerRequest} wallet={wallet} />
        </div>
      </header>

      {activeStep === 1 ? <section className="home-brief">
        <span>Eventra Intelligence · Powered by DreamDEX</span>
        <h1>Read the event before you trade it.</h1>
        <p>Live odds, AI conviction and wallet-controlled execution in one terminal.</p>
        <div className="hero-actions">
          <button className="hero-primary-cta" disabled={!recommendedMarket || !marketMeta} onClick={startFastDemo} type="button">
            <span>{marketState === "loading" ? "Finding best live market…" : "Launch 90-second Judge Demo"}</span>
            <b>{recommendedMarket ? `${recommendedMarket.asset} · ${recommendedMarket.horizon}` : "DreamDEX"} →</b>
          </button>
          <a href="#live-markets">Explore all markets ↓</a>
        </div>
        <div className="hero-proof-strip" aria-label="Live Eventra system status">
          <span><small>DreamDEX feed</small><b className={marketState}>{marketState === "live" ? "Live" : marketState === "test" ? "No live campaigns" : marketState === "loading" ? "Syncing" : "Offline"}</b></span>
          <span><small>{isTestCampaign ? "Test campaigns" : "Open markets"}</small><b>{markets.length || "—"}</b></span>
          <span><small>Executable evidence</small><b>{isTestCampaign ? "Demo only" : `${tradableMarketCount} markets`}</b></span>
          <span><small>AI analyst</small><b>Eventra Core ready</b></span>
        </div>
        <div className="hero-signal-row" aria-label="Eventra product capabilities"><span><i className="live" />DreamDEX live markets</span><span><i />AI decision support</span><span><i />Non-custodial execution</span></div>
      </section> : <section className="focus-banner"><span>Eventra AI Workspace</span><b>{form.asset} · {form.horizon}</b><small>{activeStep === 2 ? "Select an analysis engine" : activeStep === 3 ? "Review the analysis fee" : "Forecast → evidence → controlled action"}</small></section>}

      {rolloverNotice ? <div className="rollover-notice" role="status"><span><i />{rolloverNotice}</span><button onClick={() => setRolloverNotice("")} type="button">Dismiss</button></div> : null}
      {judgeMode && activeStep !== 1 ? <div className="judge-demo-bar" role="status"><span><b>Judge Demo</b> · Best live market selected · Eventra Core · wallet-controlled execution</span><div><i className={activeStep >= 3 ? "complete" : ""}>1</i><em>Report</em><i className={activeStep >= 4 ? "complete" : ""}>2</i><em>Evidence</em><i className={lastTrade ? "complete" : ""}>3</i><em>{lastTrade ? "Receipt" : "Trade"}</em></div><button onClick={() => { setJudgeMode(false); setActiveStep(1); }} type="button">Exit</button></div> : null}

      <section className="workspace-shell">
        <div className="workspace-content">
      <form className="flow-shell" onSubmit={requestAdvice}>
        {activeStep === 1 ? (
          <section className="flow-card market-step" id="live-markets">
            <div className="flow-heading">
              <div><span>Market discovery</span><h2>Choose a market to analyze</h2><p>Live DreamDEX campaigns when available, or a clearly labelled test scenario.</p></div>
            </div>

            <div className="market-mode-switch" aria-label="Market data mode">
              <button className={discoveryMode === "live" && !isTestCampaign ? "active" : ""} disabled={liveMarkets.length === 0} onClick={() => { setDiscoveryMode("live"); setShowAllCampaigns(false); setResult(null); }} type="button"><span>DreamDEX Live</span><b>{liveMarkets.length ? `${liveMarkets.length} open` : "No open market"}</b></button>
              <button className={isTestCampaign ? "active test" : ""} onClick={() => { setDiscoveryMode("test"); setShowAllCampaigns(false); setResult(null); }} type="button"><span>Test Arena</span><b>3 always available</b></button>
            </div>
            <div className={`market-availability ${liveMarkets.length ? "available" : "waiting"}`} role="status">
              <span><i />{liveMarkets.length ? `${liveMarkets.length} DreamDEX market${liveMarkets.length === 1 ? "" : "s"} ready` : "No live campaign right now — Test Arena is ready"}</span>
              <button aria-label="Refresh DreamDEX markets" onClick={() => { setDiscoveryMode("live"); setRefreshNonce((value) => value + 1); }} type="button">Refresh</button>
            </div>
            <div className="simple-market-toolbar"><div><b>{isTestCampaign ? "Test campaigns" : "Open Event Contracts"}</b><span>{markets.length} {isTestCampaign ? "test" : "live"} · click a market to continue</span></div><div className="campaign-filter">{(["ALL", "BTC", "ETH"] as const).map((asset) => <button className={discoveryAsset === asset ? "active" : ""} key={asset} onClick={() => { setDiscoveryAsset(asset); setShowAllCampaigns(false); }} type="button">{asset}</button>)}</div></div>
            {visibleMarkets.length > 0 ? <div className="campaign-list">{displayedMarkets.map((market) => {
              const isRecommended = market.marketId === recommendedMarket?.marketId;
              const lacksEvidence = market.probabilityUp === null || market.tradeCount === 0;
              const radar = radarForecasts[`${market.asset}-${market.horizon}`];
              return <button className={`campaign-card simple-market-card ${lacksEvidence ? "low-data" : ""} ${isTestCampaign ? "test-campaign" : ""}`} key={market.marketId} onClick={() => { if (!marketMeta) return; applyMarket(market, marketMeta.fetchedAt, marketMeta.mode); setActiveStep(2); }} type="button">
                <span className="campaign-rank">{isTestCampaign ? "Test scenario" : isRecommended ? (hasTradableEvidence ? "Best live data" : "Best to watch") : market.minutesRemaining <= 5 ? "Closing soon" : lacksEvidence ? "Low data" : "Live market"}<i>Choose →</i></span>
                <span className="campaign-main"><span className="asset-badge">{market.asset}</span><span><b>Will {market.asset} close at or above its opening price?</b><small>Binary contract · {market.horizon} · {market.minutesRemaining} min left</small></span></span>
                <MarketSparkline candles={radar?.candles} direction={radar?.direction} />
                <span className="contract-prices">
                  <span className="price-side up"><small>UP</small><b>{market.probabilityUp === null ? "—" : `${market.probabilityUp.toFixed(1)}¢`}</b></span>
                  <span className="price-track" aria-label="UP and DOWN price ratio"><i style={{ width: `${market.probabilityUp ?? 50}%` }} /></span>
                  <span className="price-side down"><small>DOWN</small><b>{market.probabilityUp === null ? "—" : `${(100 - market.probabilityUp).toFixed(1)}¢`}</b></span>
                </span>
                <span className="campaign-signal"><b>{marketDirection(market)}</b><small>{market.tradeCount} {isTestCampaign ? "sample trades" : "trades"} · ${market.volumeUsd.toLocaleString("en-US")} {isTestCampaign ? "sample volume · simulated" : "volume · on-chain"}</small></span>
                {radar ? <span className={`campaign-ai-signal ${radar.direction.toLowerCase()}`}>AI forecast {radar.direction} · {radar.expectedMovePercent >= 0 ? "+" : ""}{radar.expectedMovePercent.toFixed(2)}% · {radar.confidence}% confidence</span> : null}
              </button>;
            })}{visibleMarkets.length > 3 ? <button className="show-more-campaigns" onClick={() => setShowAllCampaigns((current) => !current)} type="button">{showAllCampaigns ? "Show fewer" : `Show ${visibleMarkets.length - 3} more markets`} <span>{showAllCampaigns ? "↑" : "↓"}</span></button> : null}</div> : <div className="market-empty">{marketState === "loading" ? "Finding eligible markets…" : "No open markets match this filter."}</div>}

            {error ? <p className="error-message">{error}</p> : null}
          </section>
        ) : null}

        {activeStep === 2 ? (
          <section className="flow-card model-step">
            <div className="flow-heading"><div><span>AI analyst desk</span><h2>Choose your AI analyst</h2><p>Eventra Core works now. Additional providers remain visible and unlock when their server APIs are configured.</p></div><span className="free-pill">1 ready · 5 planned</span></div>

            <div className="advisor-grid">
              <button className={`advisor-card ${selectedAiOption === "local" ? "selected" : ""}`} onClick={() => setSelectedAiOption("local")} type="button"><span className="advisor-icon eventra-core"><img alt="" src="/brand/eventra-mark.svg" /></span><div><span className="advisor-title"><b>Eventra Core</b><em>Ready</em></span><small>Transparent risk engine · Free</small><p>Works now without an API key.</p></div><span className="select-mark">{selectedAiOption === "local" ? "✓" : ""}</span></button>
              {productAiModels.map((model) => (
                <button className={`advisor-card provider-planned ${selectedAiOption === model.id ? "selected" : ""}`} key={model.id} onClick={() => setSelectedAiOption(model.id)} type="button">
                  <span className={`advisor-icon ${model.id}`}><img alt={`${model.name} logo`} src={model.id === "surf" ? "/ai/surf.png" : model.id === "grok" ? "/ai/grok.jpg" : `/ai/${model.id}.svg`} /></span>
                  <div><span className="advisor-title"><b>{model.name}</b><em>API required</em></span><small>{model.provider} · {model.specialty} · {"provisionalPrice" in model ? "Est. " : ""}${model.analysisPriceUsd.toFixed(2)}/analysis</small><p>{model.description}</p></div>
                  <span className="select-mark">{selectedAiOption === model.id ? "✓" : ""}</span>
                </button>
              ))}
            </div>

            {selectedProductModel ? <p className="provider-note"><b>{selectedProductModel.name} selected.</b> Add its server API key to enable analysis. You can switch back to Eventra Core for the working demo.</p> : null}

            {error ? <p className="error-message">{error}</p> : null}
            <div className="flow-actions"><button className="back-button" onClick={() => setActiveStep(1)} type="button">← Back</button><button className="main-cta" disabled={!canRequestAdvice} onClick={() => setActiveStep(3)} type="button">Review analysis fee <span>→</span></button></div>
          </section>
        ) : null}

        {activeStep === 3 ? (
          <section className="flow-card analysis-checkout-step">
            <div className="flow-heading"><div><span>Analysis checkout</span><h2>Confirm your AI report</h2><p>The fee is read directly from Eventra&apos;s Somnia escrow. It is released only after a valid report is returned.</p></div><span className={`source-pill ${analysisQuote.state === "live" ? "live" : ""}`}>{analysisQuote.state === "live" ? "● On-chain quote" : analysisQuote.state === "loading" ? "Reading Somnia…" : "Quote unavailable"}</span></div>

            <div className="analysis-checkout-frame">
              <div className="checkout-model-summary">
                <span className={`advisor-icon ${selectedProductModel?.id ?? "eventra-core"}`}><img alt="" src={selectedProductModel ? selectedProductModel.id === "surf" ? "/ai/surf.png" : selectedProductModel.id === "grok" ? "/ai/grok.jpg" : `/ai/${selectedProductModel.id}.svg` : "/brand/eventra-mark.svg"} /></span>
                <div><small>Selected analyst</small><h3>{selectedProductModel?.name ?? "Eventra Core"}</h3><p>{selectedProductModel?.specialty ?? "Transparent risk engine"}</p></div>
                <strong>{analysisQuote.state === "loading" ? "…" : selectedAnalysisPrice === 0 ? "Free" : `$${selectedAnalysisPrice.toFixed(2)}`}</strong>
              </div>

              <div className="checkout-credit-ledger onchain-ledger">
                <div><small>Network</small><b>Somnia Testnet</b><span>Chain 50312</span></div>
                <i>→</i>
                <div><small>Escrow quote</small><b>{selectedAnalysisPrice === 0 ? "Free" : `${selectedAnalysisPrice.toFixed(2)} tUSDC`}</b><span>{analysisQuote.enabled ? "Model enabled on-chain" : "Model unavailable"}</span></div>
                <i>→</i>
                <div className="credit-after"><small>Settlement policy</small><b>Pay on success</b><span>Failure or expiry: full refund</span></div>
              </div>

              <div className="checkout-contract-proof"><span><small>Live contract</small><code>{EVENTRA_ANALYSIS_ESCROW_ADDRESS.slice(0, 8)}…{EVENTRA_ANALYSIS_ESCROW_ADDRESS.slice(-6)}</code></span><a href={`https://shannon-explorer.somnia.network/address/${EVENTRA_ANALYSIS_ESCROW_ADDRESS}`} rel="noreferrer" target="_blank">Verify on Somnia ↗</a></div>

              <div className="checkout-policy"><span>✓ Fee locked in escrow</span><span>✓ Released after report hash</span><span>✓ Failed or expired request is refundable</span><span>✓ DreamDEX trade fee is separate</span></div>

              {selectedProductModel ? <div className="checkout-unavailable"><b>{selectedProductModel.name} pricing is live on-chain</b><span>Its AI API is not connected yet, so Eventra will not request or lock payment until a valid report can be delivered.</span></div> : null}
              {analysisQuote.state === "error" ? <div className="checkout-unavailable"><b>Could not verify the Somnia quote</b><span>Payment remains disabled until the contract can be read again.</span></div> : null}
            </div>

            <div className="flow-actions"><button className="back-button" onClick={() => setActiveStep(2)} type="button">← Change AI</button><button className="main-cta" disabled={Boolean(selectedProductModel) || !canRequestAdvice || loading} type="submit">{selectedProductModel ? `${selectedProductModel.name} API required` : loading ? "Generating report…" : "Confirm free analysis"} <span>→</span></button></div>
          </section>
        ) : null}

        {activeStep === 4 ? (
          <section className="flow-card result-step">
            <div className="flow-heading"><div><span>Decision intelligence</span><h2>Trade thesis for {form.asset} {form.horizon}</h2><p>Decision support only. Nothing is sent until you approve it in your wallet.</p></div>{result ? <span className="source-pill live">● {result.meta.mode === "local" ? "Local analysis" : "Cloud AI live"}</span> : null}</div>

            {loading ? <div className="analysis-loading"><div className="loading-orbit"><span /></div><h3>{selectedModel.name} is analyzing</h3><p>Comparing market price, time remaining, liquidity and risk…</p></div> : null}
            {!loading && error ? <div className="result-error"><b>Unable to generate a thesis</b><p>{error}</p><button onClick={() => setActiveStep(2)} type="button">Choose another model</button></div> : null}
            {!loading && !error && result ? (
              <div className="advice-result">
                <section className={`report-key-metrics ${result.advice.action.toLowerCase()}`} aria-label="Key decision metrics">
                  <div className="report-key-verdict"><span>AI decision</span><b>{actionLabel(result.advice.action)}</b><small>{result.meta.provider === "DreamPilot Local" ? "Eventra Core" : result.meta.provider}</small></div>
                  <div><span>Confidence</span><b>{result.advice.confidence}%</b><small>Evidence-weighted</small></div>
                  <div><span>AI target move</span><b>{result.forecast ? `${result.forecast.expectedMovePercent >= 0 ? "+" : ""}${result.forecast.expectedMovePercent.toFixed(2)}%` : "—"}</b><small>{result.forecast ? `$${result.forecast.predictedPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "Forecast unavailable"}</small></div>
                  <div><span>DreamDEX UP</span><b>{form.marketProbabilityAvailable ? `${form.marketProbability.toFixed(1)}¢` : "—"}</b><small>{form.marketProbabilityAvailable ? `DOWN ${(100 - form.marketProbability).toFixed(1)}¢` : "No live odds"}</small></div>
                  <div><span>Time left</span><b>{formatCountdown(secondsRemaining)}</b><small>{form.horizon} settlement</small></div>
                  <div><span>Model edge</span><b>{liveModelEdge === null ? "—" : `${liveModelEdge >= 0 ? "+" : ""}${liveModelEdge.toFixed(1)} pts`}</b><small>AI probability vs DreamDEX</small></div>
                </section>
                <section className="risk-profile-panel" aria-label="Personal risk profile">
                  <div><span>Personalized execution</span><h3>{selectedRiskProfile.label} risk profile</h3><p>{selectedRiskProfile.description} This changes Eventra&apos;s suggested default, never your ability to choose the final order.</p></div>
                  <div className="risk-profile-options">{(Object.keys(RISK_PROFILES) as RiskProfileId[]).map((profile) => <button className={riskProfile === profile ? "active" : ""} key={profile} onClick={() => selectRiskProfile(profile)} type="button"><b>{RISK_PROFILES[profile].label}</b><small>{RISK_PROFILES[profile].multiplier}× sizing</small></button>)}</div>
                  <dl><div><dt>Suggested default</dt><dd>${suggestedStake.toFixed(2)}</dd></div><div><dt>Evidence threshold</dt><dd>{selectedRiskProfile.minConfidence}%</dd></div><div><dt>Current AI confidence</dt><dd className={result.advice.confidence >= selectedRiskProfile.minConfidence ? "pass" : "fail"}>{result.advice.confidence}% · {result.advice.confidence >= selectedRiskProfile.minConfidence ? "passes" : "below profile"}</dd></div></dl>
                </section>
                <ForecastEvidenceReceipt
                  result={result}
                  marketId={form.marketId}
                  poolAddress={form.poolAddress}
                  asset={form.asset}
                  horizon={form.horizon}
                  expiry={form.expiry}
                  dreamdexProbabilityUp={form.marketProbabilityAvailable ? form.marketProbability : null}
                  modelEdgePoints={liveModelEdge}
                  riskProfile={selectedRiskProfile.label}
                  marketContract={onchainVerification.state === "verified" ? onchainVerification.marketAddress : undefined}
                />
                <div className="decision-layers"><div className="complete"><span>1 · Predict</span><b>{result.forecast ? `${result.forecast.direction} · $${result.forecast.predictedPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "Forecast unavailable"}</b><small>External price model</small></div><i>→</i><div className={form.marketProbabilityAvailable ? "complete" : "blocked"}><span>2 · Compare</span><b>{form.marketProbabilityAvailable ? `DreamDEX UP ${form.marketProbability.toFixed(1)}%` : "No market odds"}</b><small>DreamDEX executable evidence</small></div><i>→</i><div className={result.advice.action === "WAIT" ? "blocked" : "complete"}><span>3 · Decide</span><b>{actionLabel(result.advice.action)}</b><small>{result.advice.action === "WAIT" ? "AI advises waiting · manual trade available" : "Ready for wallet review"}</small></div></div>
                <section className={`ai-verdict ${result.advice.action.toLowerCase()}`} aria-label="AI decision summary">
                  <div className="ai-verdict-main"><span>Eventra AI verdict</span><strong>{actionLabel(result.advice.action)}</strong><p>{result.advice.summary}</p><small>{result.advice.action === "WAIT" ? "AI advises no entry. You remain in control." : `Suggested maximum stake · $${suggestedStake.toFixed(2)}`}</small><button className="verdict-trade-cta" onClick={() => tradeTerminalRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} type="button">Review live DreamDEX order ↓</button></div>
                  <div className="ai-confidence"><span>Confidence</span><b>{result.advice.confidence}<i>%</i></b><small>Evidence-weighted, not certainty</small></div>
                </section>
                {result.advice.report ? <article className="deep-analysis-report" aria-label="Full AI market report">
                  <header><div><span>{result.meta.provider === "DreamPilot Local" ? "Eventra Core" : result.meta.provider} · Deep research</span><h3>{result.advice.report.headline}</h3></div><em>{form.asset} · {form.horizon} · {form.minutesRemaining} min</em></header>
                  <section className="report-executive"><span>Executive assessment</span><p>{result.advice.report.executiveSummary}</p></section>
                  {result.technical?.advancedMetrics?.length ? <section className="advanced-metric-section"><div><span>Quantitative diagnostics</span><h4>Deeper chart measurements</h4><p>Second-layer metrics for evaluating signal quality, path efficiency and nearby price constraints.</p></div><div className="advanced-metric-grid">{result.technical.advancedMetrics.map((metric) => <article key={metric.label}><span>{metric.label}</span><b>{metric.value}</b><p>{metric.interpretation}</p></article>)}</div></section> : null}
                  <div className="report-prose-grid">
                    <section><span>01 · Regime classification</span><h4>Volatility and settlement environment</h4><p>{result.advice.report.marketRegime}</p></section>
                    <section><span>02 · Price structure</span><h4>Trend, range and momentum structure</h4><p>{result.advice.report.priceAction}</p></section>
                    <section><span>03 · Signal confluence</span><h4>Indicator agreement and signal quality</h4><p>{result.advice.report.technicalSynthesis}</p></section>
                    <section><span>04 · Market microstructure</span><h4>DreamDEX pricing and executable evidence</h4><p>{result.advice.report.dreamdexRead}</p></section>
                    <section className="report-conflict"><span>05 · Evidence divergence</span><h4>Chart versus prediction-market positioning</h4><p>{result.advice.report.conflictAnalysis}</p></section>
                    <section className={`report-decision ${result.advice.action.toLowerCase()}`}><span>06 · Execution decision</span><h4>{actionLabel(result.advice.action)} decision framework</h4><p>{result.advice.report.decisionRationale}</p></section>
                  </div>
                </article> : null}
                {result.technical ? <section className="technical-evidence" aria-label="Technical evidence behind the AI decision">
                  <header>
                    <div><span>Quick Predict</span><h3>Signal snapshot and decision gate</h3><p>Important chart indicators, DreamDEX confirmation and the final outcome supplied by {result.meta.provider === "DreamPilot Local" ? "Eventra Core" : result.meta.provider}.</p></div>
                    <div className={`technical-bias ${result.technical.bias.toLowerCase()}`}><small>Chart bias</small><b>{result.technical.bias}</b><span>Score {result.technical.score > 0 ? "+" : ""}{result.technical.score}</span></div>
                  </header>
                  <div className="technical-signal-grid">{result.technical.signals.map((signal) => <article key={signal.id} className={signal.signal.toLowerCase()}>
                    <div><span>{signal.label}</span><em>{signal.signal}</em></div><b>{signal.value}</b><p>{signal.explanation}</p>
                  </article>)}</div>
                  <div className="evidence-decision-bridge">
                    <div><span>Technical read</span><b>{result.technical.summary}</b><small>Support ${result.technical.support.toLocaleString("en-US", { maximumFractionDigits: 2 })} · Resistance ${result.technical.resistance.toLocaleString("en-US", { maximumFractionDigits: 2 })}</small></div>
                    <i>+</i>
                    <div><span>DreamDEX confirmation</span><b>{form.marketProbabilityAvailable && (form.tradeCount ?? 0) >= 2 && form.volumeUsd >= 25 && form.minutesRemaining >= 10 ? `Odds, liquidity and ${form.tradeCount} trades align` : "Liquidity or expiry gate not met"}</b><small>{form.marketProbabilityAvailable ? `UP ${form.marketProbability.toFixed(1)}% · DOWN ${(100 - form.marketProbability).toFixed(1)}%` : "No live market odds"} · ${form.volumeUsd.toFixed(2)} volume · {form.minutesRemaining} min remaining</small></div>
                    <i>=</i>
                    <div className={`final-gate ${result.advice.action.toLowerCase()}`}><span>Final AI gate</span><b>{actionLabel(result.advice.action)}</b><small>{result.advice.action === "WAIT" ? "Chart direction is not enough without tradable evidence." : `Evidence supports a controlled ${tradeSide} review.`}</small></div>
                  </div>
                  <footer>{result.technical.methodology}</footer>
                </section> : null}
                {result.forecast ? (
                  <section className="market-intelligence" aria-label="Live market intelligence powered by DreamDEX" ref={tradeTerminalRef}>
                    <header>
                      <div><span>{isTestCampaign ? "Eventra Test Arena · Coinbase live spot" : "Powered by DreamDEX · Live Market Terminal"}</span><b>{result.forecast.asset} / USD · {result.forecast.horizon}</b></div>
                      <div className="terminal-live-meta"><span className="terminal-live"><i /> Live</span><b>{formatCountdown(secondsRemaining)}</b><small>to settlement</small></div>
                      <div className="chart-legend"><span><i className="spot" /> Coinbase ticker · 2s</span><span><i className="odds" /> {isTestCampaign ? "Simulated contract odds" : "DreamDEX book · 4s"}</span></div>
                    </header>
                    <div className="terminal-layout">
                      <div className="terminal-market-pane">
                        <div className="market-intelligence-grid"><div>{liveTicks.length ? <SmoothPriceChart candles={liveTicks} direction={liveSpotMovePercent >= 0 ? "UP" : "DOWN"} targetPrice={result.forecast.predictedPrice} /> : <div className="chart-empty">Connecting to live ticker…</div>}</div><aside><div className="spot-live"><span>Spot now · Live</span><b className="live-number"><AnimatedPriceNumber value={displaySpotPrice} /></b><small className={liveSpotMovePercent >= 0 ? "tick-up" : "tick-down"}>{liveSpotMovePercent >= 0 ? "+" : ""}{liveSpotMovePercent.toFixed(3)}% · {spotUpdatedAt ? "updated now" : "connecting"}</small></div><div><span>AI target</span><b>${result.forecast.predictedPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}</b><small>{result.forecast.direction} {result.forecast.expectedMovePercent >= 0 ? "+" : ""}{result.forecast.expectedMovePercent.toFixed(2)}%</small></div><div className="dreamdex-odds"><span>DreamDEX best asks</span><b>{liveBookPrices?.up !== null && liveBookPrices?.up !== undefined ? `UP ${liveBookPrices.up.toFixed(1)}¢` : form.marketProbabilityAvailable ? `UP ${form.marketProbability.toFixed(1)}¢` : "No UP ask"}</b><small>{liveBookPrices?.down !== null && liveBookPrices?.down !== undefined ? `DOWN ${liveBookPrices.down.toFixed(1)}¢ · live book` : form.marketProbabilityAvailable ? `DOWN ${(100 - form.marketProbability).toFixed(1)}¢ · last trade` : orderBook.loading ? "Syncing orderbook…" : "No DOWN ask"}</small></div></aside></div>
                        <div className="market-context-panel">
                          <div className="context-copy"><span>AI trade context</span><b>{result.advice.action === "WAIT" ? "No automated entry" : `${actionLabel(result.advice.action)} setup`}</b><p>{result.advice.action === "WAIT" ? "The order ticket remains available for manual execution. Eventra does not override your wallet decision." : `Eventra caps the suggested exposure at $${suggestedStake.toFixed(2)} while you retain final wallet control.`}</p></div>
                          <div className="context-metrics"><span><small>AI confidence</small><b>{result.advice.confidence}%</b></span><span><small>Selected side</small><b>{tradeSide}</b></span><span><small>Time left</small><b>{formatCountdown(secondsRemaining)}</b></span></div>
                        </div>
                        <footer>{result.forecast.candleCount} spot candles · {result.forecast.source}. {isTestCampaign ? "Contract odds and orders are simulated by Eventra for product testing; Coinbase supplies the live spot reference." : "DreamDEX powers the Event Contract odds and execution; Coinbase supplies the independent spot reference."}</footer>
                      </div>
                    <div className="chart-trade-ticket" tabIndex={-1}>
                      <div className="ticket-order-top"><b>Buy order</b><div className="execution-mode-switch" aria-label="Execution mode"><button className={executionMode === "demo" ? "active" : ""} onClick={() => { placer.reset(); setExecutionMode("demo"); }} type="button">Demo</button><button className={executionMode === "live" ? "active live" : ""} disabled={isTestCampaign} title={isTestCampaign ? "Test campaigns support simulated orders only." : undefined} onClick={() => { placer.reset(); setExecutionMode("live"); }} type="button">{isTestCampaign ? "Live unavailable" : "Testnet Live"}</button></div></div>
                      <div className="chart-ticket-heading">
                        <span>Trade on DreamDEX</span>
                        <b>{`Buy ${tradeSide}`}</b>
                        <small>{result.advice.action === "WAIT" ? `Manual order · ${form.asset} ${form.horizon}` : `${form.asset} ${form.horizon} · live DreamDEX order`}</small>
                      </div>
                      <>
                          <div className="chart-ticket-quote">
                            <div className="ticket-controls" aria-label="Order controls">
                              <div className="ticket-side-toggle" aria-label="Choose contract side">
                                <button className={tradeSide === "UP" ? "active up" : ""} onClick={() => setTradeSide("UP")} type="button"><span>UP</span><b>{liveBookPrices?.up?.toFixed(1) ?? "—"}¢</b></button>
                                <button className={tradeSide === "DOWN" ? "active down" : ""} onClick={() => setTradeSide("DOWN")} type="button"><span>DOWN</span><b>{liveBookPrices?.down?.toFixed(1) ?? "—"}¢</b></button>
                              </div>
                              <label><span>Spend</span><span className="ticket-amount"><b>$</b><input aria-label="Trade amount in TestUSDC" min="0.1" onChange={(event) => setTradeAmountUsd(Math.max(0.1, Number(event.target.value) || 0.1))} step="0.1" type="number" value={tradeAmountUsd} /><small>TestUSDC</small></span></label>
                            </div>
                            <div className="amount-presets" aria-label="Quick trade amounts">{[10, 25, 50, 100].map((amount) => <button className={tradeAmountUsd === amount ? "active" : ""} key={amount} onClick={() => setTradeAmountUsd(amount)} type="button">${amount}</button>)}</div>
                            <div className="eventra-fee-line"><span>Eventra assisted execution fee</span><b>0% · Testnet</b></div>
                            {!wallet.isReady ? <div className="ticket-estimate"><span><small>Market price</small><b>{tradeEstimate ? `${tradeEstimate.priceCents.toFixed(1)}¢` : "—"}</b></span><span><small>Est. shares</small><b>{tradeEstimate ? tradeEstimate.shares.toFixed(2) : "—"}</b></span><span><small>Est. payout</small><b>{tradeEstimate ? `$${tradeEstimate.payoutUsd.toFixed(2)}` : "—"}</b></span><span><small>Max profit</small><b>{tradeEstimate ? `$${tradeEstimate.profitUsd.toFixed(2)}` : "—"}</b></span><p>Estimate from displayed DreamDEX odds. Connect wallet for an executable orderbook quote.</p></div>
                              : orderBook.draftError ? <p className="preview-error">{orderBook.draftError}</p>
                              : orderBook.draft ? <div className="ticket-metrics"><p><span>Best ask</span><strong>{orderBook.draft.display.bestAskProbability.toFixed(2)}¢</strong></p><p><span>Limit</span><strong>{orderBook.draft.display.limitProbability.toFixed(2)}¢</strong></p><p><span>Max spend</span><strong>${orderBook.draft.display.maxSpendUsd.toFixed(2)}</strong></p><p><span>Est. payout</span><strong>${orderBook.draft.display.potentialPayoutUsd.toFixed(2)}</strong></p></div>
                              : <p>{orderBook.loading ? "Loading live DreamDEX quote…" : "Preparing order quote…"}</p>}
                            {executionMode === "live" && wallet.isReady ? <CollateralReadinessPanel account={wallet.account} walletClient={wallet.walletClient} pool={orderBook.draft?.pool} maxCollateralRaw={orderBook.draft?.maxCollateralRaw} enabled={Boolean(orderBook.draft)} /> : null}
                            {executionMode === "live" ? <TransactionStatus phase={placer.phase} outcome={placer.outcome} /> : <p className="demo-execution-note">Demo order only · no funds or blockchain transaction.</p>}
                            {executionMode === "live" && activePosition ? <div className="inline-exit-position"><span className="inline-exit-label">Your live position · exit before settlement</span><ClosePositionCard row={activePosition} walletClient={wallet.walletClient} disabled={!wallet.isReady || placer.isBusy} onClosed={userPositions.refresh} /></div> : null}
                            {executionMode === "live" && !activePosition && positionIndexing ? <p className="position-indexing-note">Order confirmed. DreamDEX is indexing your position; Sell controls will appear here automatically.</p> : null}
                            {executionMode === "live" && marketClosingSoon && !marketClosed ? <p className="expiry-risk-note"><b>Final seconds.</b> You can still sign. If Somnia confirms the order after expiry, the trade reverts automatically and no TestUSDC is charged; network gas may still be spent.</p> : null}
                            {executionMode === "live" && placer.isBusy && marketClosed ? <p className="preview-error">The market expired while the wallet request was open. A late on-chain order will revert automatically; TestUSDC is not charged, but network gas cannot be refunded.</p> : null}
                          </div>
                          <div className="chart-ticket-actions">
                            {executionMode === "demo" ? <button type="button" onClick={placeSimulatedOrder}>{`Simulate Buy ${tradeSide}`}</button> : liveTradeBlockReason ? <button type="button" disabled>{liveTradeBlockReason}</button> : !wallet.isReady ? <button type="button" onClick={() => setWalletPickerRequest((value) => value + 1)}>Connect wallet for Testnet Live</button> : (
                              <button type="button" disabled={!wallet.walletClient || Boolean(liveTradeBlockReason) || !orderBook.draft || placer.isBusy} onClick={() => void placeCurrentOrder()}>{liveTradeBlockReason ?? (placer.isBusy ? "Waiting for wallet…" : `Buy ${tradeSide} on-chain`)}</button>
                            )}
                            {executionMode === "live" ? <p className={`trade-readiness ${liveTradeBlockReason ? "blocked" : marketClosingSoon ? "warning" : "ready"}`}><i />{liveTradeBlockReason ?? (marketClosingSoon ? `Final ${secondsRemaining}s · late transactions revert automatically` : wallet.isReady ? "Live quote ready · wallet confirmation required" : "Connect wallet to prepare an on-chain order")}</p> : null}
                          </div>
                      </>
                      </div>
                    </div>
                  </section>
                ) : null}
              </div>
            ) : null}

            <div className="flow-actions"><button className="back-button" onClick={() => setActiveStep(2)} type="button">← Change AI</button>{result ? <button className="secondary-cta" onClick={() => setActiveStep(1)} type="button">Analyze another market</button> : null}</div>
          </section>
        ) : null}
      </form>
        </div>
      </section>

      {history.length > 0 ? <section className="recent-decisions"><div><span>Recent decisions</span><small>Stored on this device</small></div>{history.slice(0, 3).map((item) => <button key={item.id} onClick={() => { setForm(item.campaign); setResult(item.result); setActiveStep(4); }} type="button"><span><b>{item.campaign.campaignName}</b><small>{item.result.meta.provider === "DreamPilot Local" ? "Eventra Core" : item.result.meta.provider}</small></span><strong>{actionLabel(item.result.advice.action)}</strong></button>)}</section> : null}

      <AiEdgeTracker records={forecastLedger} />

      <section className="portfolio-section" ref={portfolioRef}>
        <div className="portfolio-heading"><span>Portfolio</span><small>Open orders · positions · redeem</small></div>
        {lastTrade ? <div className={`portfolio-trade-success ${lastTrade.simulated ? "simulated" : "onchain"}`}>
          <span className="success-icon" aria-hidden="true">✓</span>
          <div className="success-summary"><span>{lastTrade.simulated ? "Demo completed" : "On-chain order confirmed"}</span><b>{lastTrade.simulated ? "Added to your demo portfolio" : lastTrade.phase === "resting" ? "Order is live on DreamDEX" : "Your position is updated"}</b><small>{lastTrade.orderId ? `Order #${lastTrade.orderId}` : lastTrade.simulated ? "No funds used" : "Matched by the DreamDEX pool"}</small></div>
          {lastTrade.settlement ? <div className="portfolio-settlement"><span><small>Paid</small><b>${lastTrade.settlement.netSpentUsd.toFixed(3)}</b></span><span><small>Returned</small><b className="refund">+${lastTrade.settlement.refundedUsd.toFixed(3)}</b></span><em>0% Eventra fee</em></div> : <em className="demo-badge">Simulation</em>}
          {lastTrade.hash ? <a href={`https://shannon-explorer.somnia.network/tx/${lastTrade.hash}`} target="_blank" rel="noreferrer">Open receipt ↗</a> : null}
        </div> : null}
        {tradeActivity.length ? <section className="trade-activity" aria-label="Recent trade activity">
          <header><div><span>Trade activity</span><b>Receipts that survive a reload</b></div><small>Demo + Somnia testnet</small></header>
          <div className="trade-activity-list">{tradeActivity.slice(0, 5).map((activity) => <article key={activity.id} className={`trade-activity-row ${activity.status}`}>
            <span className="activity-status-icon" aria-hidden="true">{activity.status === "confirmed" || activity.status === "resting" ? "✓" : activity.status === "late" ? "↺" : "!"}</span>
            <div className="activity-market"><span>{activity.mode === "demo" ? "Demo" : "On-chain"} · {activity.status === "resting" ? "Open" : activity.status}</span><b>{activity.asset} {activity.horizon} · {activity.side}</b><small>{new Date(activity.createdAt).toLocaleString("en-US")}</small></div>
            <div className="activity-money"><span><small>Order</small><b>{"$" + activity.amountUsd.toFixed(2)}</b></span><span><small>Paid</small><b>{activity.paidUsd !== undefined ? "$" + activity.paidUsd.toFixed(3) : "—"}</b></span><span><small>Returned</small><b className={activity.refundedUsd !== undefined && activity.refundedUsd > 0 ? "refund" : undefined}>{activity.refundedUsd !== undefined && activity.refundedUsd > 0 ? "+$" + activity.refundedUsd.toFixed(3) : "—"}</b></span></div>
            <div className="activity-receipt">{activity.hash ? <a href={`https://shannon-explorer.somnia.network/tx/${activity.hash}`} target="_blank" rel="noreferrer">Explorer ↗</a> : <span>{activity.mode === "demo" ? "Local receipt" : "Not submitted"}</span>}{activity.message ? <small title={activity.message}>{activity.message}</small> : activity.orderId ? <small>Order #{activity.orderId}</small> : null}</div>
          </article>)}</div>
        </section> : null}
        {simulatedTrades.length ? <section className="simulated-orders test-arena-portfolio"><header><div><b>Test Arena positions</b><small>Live-marked simulations · stored on this device · never sent on-chain</small></div><span>SIMULATED</span></header><ul>{simulatedTrades.map((trade) => {
          const mark = demoMarkPrice(trade, trade.marketId === form.marketId ? liveSpotPrice : null);
          const totalShares = trade.shares ?? (trade.priceCents ? trade.amountUsd / (trade.priceCents / 100) : 0);
          const remainingShares = trade.remainingShares ?? totalShares;
          const openValue = mark === null ? 0 : remainingShares * (mark / 100);
          const totalValue = (trade.returnedUsd ?? 0) + openValue;
          const pnl = trade.status === "settled" || trade.status === "closed" ? (trade.realizedPnlUsd ?? totalValue - trade.amountUsd) : totalValue - trade.amountUsd;
          return <li className={`arena-position ${trade.status}`} key={trade.id}>
            <div className="arena-market"><span>{trade.status === "open" ? "Open position" : trade.status}</span><b>{trade.asset} {trade.horizon} · {trade.side}</b><small>{new Date(trade.createdAt).toLocaleString("en-US")}</small></div>
            <span><small>Entry</small><b>{trade.priceCents === null ? "—" : `${trade.priceCents.toFixed(1)}¢`}</b></span>
            <span><small>Mark</small><b>{mark === null ? "—" : `${mark.toFixed(1)}¢`}</b></span>
            <span><small>Position</small><b>{remainingShares.toFixed(2)} shares</b></span>
            <span><small>Current value</small><b>${totalValue.toFixed(2)}</b></span>
            <span className={pnl >= 0 ? "arena-pnl profit" : "arena-pnl loss"}><small>P&amp;L</small><b>{pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}</b></span>
            {trade.status === "open" ? <div className="arena-exit-actions"><button onClick={() => closeSimulatedPosition(trade.id, .25)} type="button">Sell 25%</button><button onClick={() => closeSimulatedPosition(trade.id, .5)} type="button">Sell 50%</button><button onClick={() => closeSimulatedPosition(trade.id, 1)} type="button">Sell all</button></div> : <em>{trade.outcome ? `${trade.outcome} settled` : "Closed"}</em>}
          </li>;
        })}</ul></section> : null}
        <div className="portfolio-grid">
          <OpenOrdersPanel orders={userOrders.orders} loading={userOrders.loading} error={userOrders.error} account={wallet.account}
            walletClient={wallet.walletClient} isReady={wallet.isReady} cancellingId={userOrders.cancellingId} lastCancelHash={userOrders.lastCancelHash}
            onRefresh={() => void userOrders.refresh()} onCancel={(order) => { if (wallet.walletClient) void userOrders.cancel(wallet.walletClient, order); }} />
          <PositionsPanel positions={userPositions.positions} loading={userPositions.loading} error={userPositions.error} account={wallet.account}
            walletClient={wallet.walletClient} isReady={wallet.isReady} redeemingId={userPositions.redeemingId} lastRedeemHash={userPositions.lastRedeemHash}
            onRefresh={() => void userPositions.refresh()} onRedeem={(row, oi, amt) => { if (wallet.walletClient) void userPositions.redeem(wallet.walletClient, row, oi, amt); }} />
        </div>
      </section>
      <footer><span>Eventra v0.5 · DreamDEX-native</span><p>Non-custodial AI · No autonomous execution · No guaranteed returns</p></footer>
    </main>
  );
}
