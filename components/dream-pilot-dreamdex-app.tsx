"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { AdviceResponse } from "@/lib/advice";
import type { DreamDexMarketSnapshot } from "@/lib/dreamdex";
import { advisorModels, type AdvisorModelId } from "@/lib/models";
import { useBrowserWallet } from "@/hooks/use-browser-wallet";
import { useLiveOrderBook } from "@/hooks/use-live-order-book";
import { usePlaceDreamDexOrder } from "@/hooks/use-place-dreamdex-order";
import { useUserOrders } from "@/hooks/use-user-orders";
import { useUserPositions } from "@/hooks/use-user-positions";
import { ConnectWallet, walletStatusLabel } from "@/components/wallet/connect-wallet";
import { CollateralReadinessPanel } from "@/components/order/collateral-readiness";
import { TransactionStatus } from "@/components/order/transaction-status";
import { OpenOrdersPanel } from "@/components/portfolio/open-orders";
import { PositionsPanel } from "@/components/portfolio/positions";

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
};

type MarketResponse = {
  markets: DreamDexMarketSnapshot[];
  meta: {
    mode: "live";
    source: string;
    network: string;
    chainId: number;
    venueId: string;
    fetchedAt: string;
    latencyMs: number;
  };
};

type AiStatus = {
  configured: boolean;
  provider: string;
  keyName: string;
  mode: "live" | "setup_required";
};

const initialForm: CampaignForm = {
  campaignName: "Đang tải DreamDEX…",
  question: "Đang đồng bộ Event Contract từ Somnia testnet…",
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

type DecisionHistoryItem = {
  id: string;
  campaign: CampaignForm;
  result: AdviceResponse;
};

function actionLabel(action: AdviceResponse["advice"]["action"]) {
  if (action === "BUY_UP") return "Cân nhắc UP";
  if (action === "BUY_DOWN") return "Cân nhắc DOWN";
  return "Chờ thêm";
}

function marketScore(market: DreamDexMarketSnapshot) {
  const priceScore = market.probabilityUp === null ? 0 : 35;
  const tradeScore = Math.min(30, market.tradeCount * 3);
  const volumeScore = Math.min(20, Math.log10(market.volumeUsd + 1) * 7);
  const timeScore = market.minutesRemaining >= 5 ? 15 : 5;
  return priceScore + tradeScore + volumeScore + timeScore;
}

function marketDirection(market: DreamDexMarketSnapshot) {
  if (market.probabilityUp === null) return "Chưa có giá";
  if (market.probabilityUp >= 55) return `Nghiêng UP ${market.probabilityUp}%`;
  if (market.probabilityUp <= 45) return `Nghiêng DOWN ${100 - market.probabilityUp}%`;
  return `Đang cân bằng · UP ${market.probabilityUp}%`;
}

function campaignReason(market: DreamDexMarketSnapshot, recommended: boolean) {
  if (market.probabilityUp === null || market.tradeCount === 0) {
    return "Chưa có đủ giao dịch để AI đánh giá xác suất. Nên theo dõi, chưa nên vào lệnh.";
  }
  if (market.minutesRemaining <= 5) {
    return `Còn ${market.minutesRemaining} phút: biến động có thể nhanh, phù hợp người chấp nhận rủi ro cao.`;
  }
  if (recommended) {
    return `Dữ liệu tốt nhất hiện tại: ${market.tradeCount} giao dịch và $${market.volumeUsd.toLocaleString("en-US")} volume.`;
  }
  return `Có ${market.tradeCount} giao dịch để AI phân tích; còn ${market.minutesRemaining} phút trước settlement.`;
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
  const [activeStep, setActiveStep] = useState<1 | 2 | 3>(1);
  const [form, setForm] = useState<CampaignForm>(initialForm);
  const [result, setResult] = useState<AdviceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [history, setHistory] = useState<DecisionHistoryItem[]>([]);
  const [markets, setMarkets] = useState<DreamDexMarketSnapshot[]>([]);
  const [selectedMarketId, setSelectedMarketId] = useState("");
  const [marketState, setMarketState] = useState<"loading" | "live" | "error">("loading");
  const [marketMeta, setMarketMeta] = useState<MarketResponse["meta"] | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [discoveryAsset, setDiscoveryAsset] = useState<"ALL" | "BTC" | "ETH">("ALL");
  const [showAllCampaigns, setShowAllCampaigns] = useState(false);
  const activeMarketIdRef = useRef("");

  const wallet = useBrowserWallet();
  const orderBook = useLiveOrderBook({
    pool: form.poolAddress,
    enabled: Boolean(form.poolAddress) && result?.advice.action !== "WAIT",
  });
  const placer = usePlaceDreamDexOrder();
  const userOrders = useUserOrders(wallet.account);
  const userPositions = useUserPositions(wallet.account);

  useEffect(() => {
    return wallet.onSessionInvalidated(() => {
      setReviewOpen(false);
      orderBook.setDraftInputs(null);
      placer.reset();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.onSessionInvalidated]);

  useEffect(() => {
    if (!result || result.advice.action === "WAIT" || !form.poolAddress || !form.marketId || !form.venueId) {
      orderBook.setDraftInputs(null);
      return;
    }
    orderBook.setDraftInputs({
      account: wallet.account,
      chainId: wallet.chainId,
      marketId: form.marketId,
      venueId: form.venueId,
      pool: form.poolAddress,
      action: result.advice.action,
      riskBudgetUsd: form.riskBudgetUsd,
      suggestedMaxStakePercent: result.advice.suggestedMaxStakePercent,
      minutesRemaining: form.minutesRemaining,
      advicePayload: { action: result.advice.action, confidence: result.advice.confidence, model: result.meta.model, marketId: form.marketId },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, form.poolAddress, form.marketId, form.venueId, form.riskBudgetUsd, form.minutesRemaining, wallet.account, wallet.chainId, orderBook.book]);


  const selectedModel = advisorModels.find((model) => model.id === form.selectedModel) ?? advisorModels[0];
  const resultModel = result
    ? advisorModels.find((model) => model.id === result.meta.model) ?? selectedModel
    : selectedModel;

  function applyMarket(market: DreamDexMarketSnapshot, fetchedAt: string) {
    const marketChanged = activeMarketIdRef.current !== market.marketId;
    activeMarketIdRef.current = market.marketId;
    setSelectedMarketId(market.marketId);
    if (marketChanged) {
      setResult(null);
      setReviewOpen(false);
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
      marketSource: "dreamdex-live",
      marketUpdatedAt: fetchedAt,
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
    const timer = window.setInterval(() => setRefreshNonce((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

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

    void fetch("/api/markets", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Không đọc được market.");
        return payload as MarketResponse;
      })
      .then((payload) => {
        setMarkets(payload.markets);
        setMarketMeta(payload.meta);
        setMarketState("live");
        const rankedMarkets = [...payload.markets].sort((a, b) => marketScore(b) - marketScore(a));
        const currentMarket = rankedMarkets.find((market) => market.marketId === activeMarketIdRef.current);
        if (currentMarket ?? rankedMarkets[0]) applyMarket(currentMarket ?? rankedMarkets[0], payload.meta.fetchedAt);
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
        setError(marketError instanceof Error ? marketError.message : "DreamDEX API lỗi.");
      });

    return () => controller.abort();
  }, [refreshNonce]);

  const rankedMarkets = useMemo(
    () => [...markets].sort((a, b) => marketScore(b) - marketScore(a)),
    [markets],
  );
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

  const suggestedStake = result
    ? (form.riskBudgetUsd * result.advice.suggestedMaxStakePercent) / 100
    : 0;

  const canRequestAdvice =
    !loading && aiStatus?.configured === true && form.marketSource === "dreamdex-live";

  async function requestAdvice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActiveStep(3);
    setLoading(true);
    setError("");
    setReviewOpen(false);

    try {
      const response = await fetch("/api/advice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Không thể tạo lời khuyên.");
      const adviceResult = payload as AdviceResponse;
      setResult(adviceResult);
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
      setError(requestError instanceof Error ? requestError.message : "Đã có lỗi xảy ra.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">DP</span><span>DreamPilot</span><i>×</i><span className="dreamdex-wordmark"><em>◈</em> DreamDEX</span></div>
        <span className="safety-note">AI copilot cho Event Contracts</span>
        <div className="topbar-right">
          <span className={`network-badge ${marketState}`}>
            <span className={`connection-dot ${marketState}`} /> Somnia testnet
          </span>
          <ConnectWallet wallet={wallet} />
        </div>
      </header>

      <section className="intro">
        <p className="eyebrow"><span>Powered by DreamDEX</span> Event Contracts · Somnia</p>
        <h1>Đọc xác suất.<br />Trade có kiểm soát.</h1>
        <div className="intro-side"><p className="intro-copy">AI giải thích giá UP/DOWN, phản biện luận điểm và tạo order draft. Ví của bạn luôn là bước xác nhận cuối.</p><div className="protocol-rail"><span><i>01</i> Live contracts</span><span><i>02</i> AI analysis</span><span><i>03</i> Wallet confirm</span></div></div>
      </section>

      <nav className="stepper" aria-label="Tiến trình phân tích">
        {([
          [1, "Khám phá", selectedMarketId ? `${form.asset} · ${form.horizon}` : "Tìm campaign"],
          [2, "Chọn AI", selectedModel.name],
          [3, "Xem lời khuyên", result ? actionLabel(result.advice.action) : "Chưa phân tích"],
        ] as const).map(([step, title, subtitle]) => (
          <button
            key={step}
            className={`${activeStep === step ? "active" : ""} ${activeStep > step || (step === 3 && result) ? "complete" : ""}`}
            disabled={step === 3 && !result && !loading}
            onClick={() => setActiveStep(step)}
            type="button"
          >
            <span>{step}</span>
            <div><b>{title}</b><small>{subtitle}</small></div>
          </button>
        ))}
      </nav>

      <form className="flow-shell" onSubmit={requestAdvice}>
        {activeStep === 1 ? (
          <section className="flow-card market-step">
            <div className="flow-heading">
              <div><span>Bước 1/3</span><h2>Campaign nào đáng xem lúc này?</h2><p>DreamPilot xếp hạng các Event Contract đang mở theo chất lượng dữ liệu — không theo lời hứa lợi nhuận.</p></div>
              <span className={`source-pill ${marketState}`}>{marketState === "live" ? "● Live" : marketState === "loading" ? "Đang tải" : "Mất kết nối"}</span>
            </div>

            <div className="discovery-intro">
              <div><span className="discovery-kicker">{hasTradableEvidence ? "Đề xuất hiện tại" : "Trạng thái hiện tại"}</span><h3>{hasTradableEvidence ? `${recommendedMarket?.asset} ${recommendedMarket?.horizon} có dữ liệu tốt nhất` : "Chưa có campaign đủ dữ liệu để vào lệnh"}</h3><p>{hasTradableEvidence ? "Đây là campaign dễ phân tích nhất lúc này, không đồng nghĩa chắc chắn thắng." : "Bạn vẫn có thể chọn một campaign để AI theo dõi, nhưng DreamPilot sẽ ưu tiên khuyến nghị CHỜ."}</p></div>
              <div className="discovery-guide"><span>DreamPilot ưu tiên</span><b>Giá thật</b><b>Nhiều giao dịch</b><b>Đủ thời gian</b></div>
            </div>

            <div className="campaign-toolbar"><span><i className="dex-glyph">◈</i> DreamDEX markets đang mở</span><div className="campaign-filter">{(["ALL", "BTC", "ETH"] as const).map((asset) => <button className={discoveryAsset === asset ? "active" : ""} key={asset} onClick={() => { setDiscoveryAsset(asset); setShowAllCampaigns(false); }} type="button">{asset === "ALL" ? "Tất cả" : asset}</button>)}</div></div>

            {visibleMarkets.length > 0 ? <div className="campaign-list">{displayedMarkets.map((market) => {
              const isRecommended = market.marketId === recommendedMarket?.marketId;
              const isSelected = market.marketId === selectedMarketId;
              const lacksEvidence = market.probabilityUp === null || market.tradeCount === 0;
              return <button className={`campaign-card ${isSelected ? "selected" : ""} ${lacksEvidence ? "low-data" : ""}`} key={market.marketId} onClick={() => marketMeta && applyMarket(market, marketMeta.fetchedAt)} type="button">
                <span className="campaign-rank">{isRecommended ? (hasTradableEvidence ? "Đáng phân tích nhất" : "Dễ theo dõi nhất") : market.minutesRemaining <= 5 ? "Sắp đóng" : lacksEvidence ? "Thiếu dữ liệu" : "Lựa chọn khác"}</span>
                <span className="campaign-main"><span className="asset-badge">{market.asset}</span><span><b>{market.asset} sẽ đóng bằng hoặc cao hơn giá mở cửa?</b><small>Binary contract · {market.horizon} · còn {market.minutesRemaining} phút</small></span></span>
                <span className="contract-prices">
                  <span className="price-side up"><small>UP</small><b>{market.probabilityUp === null ? "—" : `${market.probabilityUp.toFixed(1)}¢`}</b></span>
                  <span className="price-track" aria-label="Tỷ lệ giá UP và DOWN"><i style={{ width: `${market.probabilityUp ?? 50}%` }} /></span>
                  <span className="price-side down"><small>DOWN</small><b>{market.probabilityUp === null ? "—" : `${(100 - market.probabilityUp).toFixed(1)}¢`}</b></span>
                </span>
                <span className="campaign-signal"><b>{marketDirection(market)}</b><small>{market.tradeCount} trades · ${market.volumeUsd.toLocaleString("en-US")} volume · on-chain</small></span>
                <span className="campaign-reason">{campaignReason(market, isRecommended)}</span>
                <span className="campaign-select">{isSelected ? "✓ Đã chọn" : "Chọn campaign"}</span>
              </button>;
            })}{visibleMarkets.length > 3 ? <button className="show-more-campaigns" onClick={() => setShowAllCampaigns((current) => !current)} type="button">{showAllCampaigns ? "Thu gọn danh sách" : `Xem thêm ${visibleMarkets.length - 3} campaign`} <span>{showAllCampaigns ? "↑" : "↓"}</span></button> : null}</div> : <div className="market-empty">{marketState === "loading" ? "Đang tìm campaign phù hợp…" : "Hiện chưa có campaign đang mở cho bộ lọc này."}</div>}

            {selectedMarketId ? <div className="selected-summary"><span>Đã chọn để AI phân tích</span><b>{form.asset} · {form.horizon}</b><p>{form.question}</p></div> : null}

            {selectedMarket && marketMeta ? (
              <section className="dreamdex-proof" aria-label="DreamDEX market proof">
                <header>
                  <div><span className="proof-logo">◈</span><div><b>DreamDEX Market Proof</b><small>Dữ liệu trực tiếp qua Markets SDK · không phải dữ liệu AI tự tạo</small></div></div>
                  <span className="sync-status"><i /> Synced {marketMeta.latencyMs} ms</span>
                </header>
                <div className="proof-grid">
                  <div><span>Network</span><b>Somnia Shannon</b><small>Chain ID {marketMeta.chainId}</small></div>
                  <div><span>Market contract</span><b className="mono">{selectedMarket.marketId.slice(0, 10)}…{selectedMarket.marketId.slice(-6)}</b><small>Event Contract</small></div>
                  <div><span>Trading pool</span><b className="mono">{selectedMarket.poolAddress.slice(0, 10)}…{selectedMarket.poolAddress.slice(-6)}</b><small>UP / DOWN liquidity</small></div>
                  <div><span>SDK snapshot</span><b>{new Date(marketMeta.fetchedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</b><small>{marketMeta.source}</small></div>
                </div>
                <footer>
                  <span><i /> Venue <code>{marketMeta.venueId.slice(0, 10)}…{marketMeta.venueId.slice(-6)}</code></span>
                  <div><button onClick={() => setRefreshNonce((value) => value + 1)} type="button">↻ Đồng bộ lại</button><a href={`https://shannon-explorer.somnia.network/address/${selectedMarket.poolAddress}`} rel="noreferrer" target="_blank">Kiểm chứng pool ↗</a></div>
                </footer>
              </section>
            ) : null}

            <details className="advanced-inputs">
              <summary>Tín hiệu bổ sung <span>Tùy chọn</span></summary>
              <p>Hai dữ liệu này do bạn nhập, không đến từ DreamDEX.</p>
              <div className="manual-grid">
                <MetricInput label="Spot move" suffix="%" step={0.01} value={form.spotMovePercent} onChange={(value) => setForm({ ...form, spotMovePercent: value })} />
                <MetricInput label="Volatility" suffix="%" step={0.1} value={form.volatilityPercent} onChange={(value) => setForm({ ...form, volatilityPercent: value })} />
                <MetricInput label="Risk budget" suffix="USD" value={form.riskBudgetUsd} onChange={(value) => setForm({ ...form, riskBudgetUsd: value })} />
              </div>
              {form.marketId ? <div className="market-proof"><span>Market ID</span><code>{form.marketId}</code></div> : null}
            </details>

            {error ? <p className="error-message">{error}</p> : null}
            <div className="flow-actions end"><button className="main-cta" disabled={form.marketSource !== "dreamdex-live"} onClick={() => setActiveStep(2)} type="button">Phân tích campaign đã chọn <span>→</span></button></div>
          </section>
        ) : null}

        {activeStep === 2 ? (
          <section className="flow-card model-step">
            <div className="flow-heading"><div><span>Bước 2/3</span><h2>Chọn cách AI phân tích</h2><p>Mỗi model dùng cùng một snapshot market. Auto Free phù hợp nhất để bắt đầu.</p></div><span className="free-pill">{advisorModels.length} model miễn phí</span></div>

            <div className={`key-banner ${aiStatus?.configured ? "ready" : "setup"}`}>
              <span className="key-icon">{aiStatus?.configured ? "✓" : "!"}</span>
              <div><b>{aiStatus?.configured ? "AI API đã sẵn sàng" : "Cần thêm API key để phân tích"}</b><p>{aiStatus?.configured ? "Key được giữ ở server và không lộ ra trình duyệt." : "Tạo OpenRouter key miễn phí, dán vào .env.local rồi khởi động lại app."}</p></div>
              {!aiStatus?.configured ? <a href="https://openrouter.ai/keys" rel="noreferrer" target="_blank">Tạo key miễn phí ↗</a> : null}
            </div>

            <div className="advisor-grid">
              {advisorModels.map((model, index) => (
                <button className={`advisor-card ${form.selectedModel === model.id ? "selected" : ""}`} key={model.id} onClick={() => setForm({ ...form, selectedModel: model.id })} type="button">
                  <span className="advisor-icon" style={{ background: model.color }}>{model.short}</span>
                  <div><span className="advisor-title"><b>{model.name}</b>{index === 0 ? <em>Khuyên dùng</em> : null}</span><small>{model.specialty}</small><p>{model.description}</p></div>
                  <span className="select-mark">{form.selectedModel === model.id ? "✓" : ""}</span>
                </button>
              ))}
            </div>

            {error ? <p className="error-message">{error}</p> : null}
            <div className="flow-actions"><button className="back-button" onClick={() => setActiveStep(1)} type="button">← Quay lại</button><button className="main-cta" disabled={!canRequestAdvice} type="submit">{!aiStatus?.configured ? "Thêm API key để tiếp tục" : loading ? "Đang phân tích…" : `Phân tích với ${selectedModel.name}`} <span>→</span></button></div>
          </section>
        ) : null}

        {activeStep === 3 ? (
          <section className="flow-card result-step">
            <div className="flow-heading"><div><span>Bước 3/3</span><h2>Lời khuyên cho {form.asset} {form.horizon}</h2><p>Kết quả hỗ trợ quyết định; không phải lệnh giao dịch.</p></div>{result ? <span className="source-pill live">● AI live</span> : null}</div>

            {loading ? <div className="analysis-loading"><div className="loading-orbit"><span /></div><h3>{selectedModel.name} đang phân tích</h3><p>Đang đối chiếu giá market, thời gian còn lại và rủi ro…</p></div> : null}
            {!loading && error ? <div className="result-error"><b>Chưa thể tạo lời khuyên</b><p>{error}</p><button onClick={() => setActiveStep(2)} type="button">Chọn model khác</button></div> : null}
            {!loading && !error && result ? (
              <div className="advice-result">
                <div className={`action-card ${result.advice.action.toLowerCase()}`}><div><span>Đề xuất của {resultModel.name}</span><strong>{actionLabel(result.advice.action)}</strong><small>{result.advice.action === "WAIT" ? "Không tạo order draft" : `Stake tối đa đề xuất: $${suggestedStake.toFixed(2)}`}</small></div><div className="confidence-ring" style={{ "--score": `${result.advice.confidence * 3.6}deg` } as React.CSSProperties}><b>{result.advice.confidence}</b><small>% tin cậy</small></div></div>
                <p className="summary">{result.advice.summary}</p>
                <div className="reason-columns"><div><h3><span className="up-dot" /> Vì sao có thể đúng</h3><ul>{result.advice.thesis.map((item) => <li key={item}>{item}</li>)}</ul></div><div><h3><span className="down-dot" /> Vì sao có thể sai</h3><ul>{result.advice.counterThesis.map((item) => <li key={item}>{item}</li>)}</ul></div></div>
                <div className="invalidation-box"><span>Dừng luận điểm khi</span><p>{result.advice.invalidation}</p></div>
                <details className="risk-details"><summary>Rủi ro và dữ liệu còn thiếu <span>{result.advice.risks.length + result.advice.dataGaps.length}</span></summary><div>{[...result.advice.risks, ...result.advice.dataGaps].map((item) => <p key={item}>— {item}</p>)}</div></details>
                <div className="order-draft">
                  <div><span>Bước tiếp theo</span>
                    <b>{result.advice.action === "WAIT" ? "Theo dõi market, chưa vào lệnh" : `Review lệnh ${result.advice.action === "BUY_UP" ? "UP" : "DOWN"}`}</b>
                  </div>
                  <button disabled={result.advice.action === "WAIT" || !wallet.isReady} onClick={() => setReviewOpen(true)} type="button"
                    title={result.advice.action === "WAIT" ? "WAIT" : wallet.isReady ? "Review" : walletStatusLabel(wallet.status)}>
                    Review order
                  </button>
                </div>
                {reviewOpen ? (
                  <div className="review-banner order-preview">
                    <div>
                      <b>Review lệnh DreamDEX</b>
                      {!wallet.isReady ? <p>{walletStatusLabel(wallet.status)}</p>
                        : orderBook.draftError ? <p className="preview-error">{orderBook.draftError}</p>
                        : orderBook.draft ? (
                          <div className="draft-grid">
                            <p><span>Side</span><strong>{orderBook.draft.side} · {orderBook.draft.display.sideLabel}</strong></p>
                            <p><span>Limit</span><strong>{orderBook.draft.display.limitProbability}% (raw {orderBook.draft.limitPriceRaw.toString()})</strong></p>
                            <p><span>Max spend</span><strong>${orderBook.draft.display.maxSpendUsd.toFixed(4)} · qty {orderBook.draft.quantityRaw.toString()}</strong></p>
                            <p><span>Pool</span><strong className="mono">{orderBook.draft.pool.slice(0,12)}…</strong></p>
                            <p className="draft-note">IOC bounded. AI không tự gửi. Có thể 1–2 prompt ví (approve + place).</p>
                          </div>
                        ) : <p>Chưa có draft hợp lệ.</p>}
                      <CollateralReadinessPanel account={wallet.account} pool={orderBook.draft?.pool} maxCollateralRaw={orderBook.draft?.maxCollateralRaw} enabled={Boolean(orderBook.draft) && wallet.isReady} />
                      <TransactionStatus phase={placer.phase} outcome={placer.outcome} />
                    </div>
                    <div className="review-actions">
                      <button type="button" className="secondary-cta" disabled={orderBook.loading || placer.isBusy} onClick={() => { placer.reset(); void orderBook.refresh(); }}>Làm mới quote</button>
                      <button type="button" disabled={!wallet.isReady || !wallet.walletClient || !orderBook.draft || placer.isBusy || Date.now() > (orderBook.draft?.quoteExpiresAt ?? 0)}
                        onClick={() => {
                          if (!orderBook.draft || !wallet.walletClient) return;
                          void placer.place({ draft: orderBook.draft, walletClient: wallet.walletClient, minutesRemaining: form.minutesRemaining }).then((o) => {
                            if (o.phase === "filled" || o.phase === "partial_fill" || o.phase === "resting") { void userOrders.refresh(); void userPositions.refresh(); }
                          });
                        }}>
                        {placer.isBusy ? "Đang chờ ví…" : "Place Order (ký ví)"}
                      </button>
                      <button type="button" onClick={() => { setReviewOpen(false); placer.reset(); }}>Đóng</button>
                    </div>
                  </div>
                ) : null}
                <div className="audit-line"><span>{result.meta.model}</span><span>DreamDEX SDK · chain 50312</span><span>{result.meta.latencyMs} ms</span></div>
              </div>
            ) : null}

            <div className="flow-actions"><button className="back-button" onClick={() => setActiveStep(2)} type="button">← Đổi AI</button>{result ? <button className="secondary-cta" onClick={() => setActiveStep(1)} type="button">Phân tích market khác</button> : null}</div>
          </section>
        ) : null}
      </form>

      {history.length > 0 ? <section className="recent-decisions"><div><span>Lịch sử gần đây</span><small>Lưu trên thiết bị</small></div>{history.slice(0, 3).map((item) => <button key={item.id} onClick={() => { setForm(item.campaign); setResult(item.result); setReviewOpen(false); setActiveStep(3); }} type="button"><span><b>{item.campaign.campaignName}</b><small>{item.result.meta.provider}</small></span><strong>{actionLabel(item.result.advice.action)}</strong></button>)}</section> : null}

      <section className="portfolio-section">
        <div className="portfolio-heading"><span>Portfolio</span><small>Open orders · positions · redeem</small></div>
        <div className="portfolio-grid">
          <OpenOrdersPanel orders={userOrders.orders} loading={userOrders.loading} error={userOrders.error} account={wallet.account}
            walletClient={wallet.walletClient} isReady={wallet.isReady} cancellingId={userOrders.cancellingId} lastCancelHash={userOrders.lastCancelHash}
            onRefresh={() => void userOrders.refresh()} onCancel={(order) => { if (wallet.walletClient) void userOrders.cancel(wallet.walletClient, order); }} />
          <PositionsPanel positions={userPositions.positions} loading={userPositions.loading} error={userPositions.error} account={wallet.account}
            walletClient={wallet.walletClient} isReady={wallet.isReady} redeemingId={userPositions.redeemingId} lastRedeemHash={userPositions.lastRedeemHash}
            onRefresh={() => void userPositions.refresh()} onRedeem={(row, oi, amt) => { if (wallet.walletClient) void userPositions.redeem(wallet.walletClient, row, oi, amt); }} />
        </div>
      </section>
      <footer><span>DreamPilot v0.3 · Full M0–M8</span><p>AI không giữ ví · Không tự đặt lệnh · Không đảm bảo lợi nhuận</p></footer>
    </main>
  );
}
