"use client";

import { useEffect, useMemo, useState } from "react";
import { calculatePerpsRisk, type PerpsSide } from "../../lib/perps/risk-engine";
import { approvePerpsCollateral, depositPerpsMargin, executePerpsOrder, runPerpsPreflight, type PerpsPreflight } from "../../lib/perps/browser-preflight";
import { readConnectedPerpsAccount, type PerpsAccountSnapshot } from "../../lib/perps/browser-account";
import { readPerpsWalletBalance, type PerpsWalletBalance } from "../../lib/perps/browser-balance";
import { buildPerpsAIDecision, type PerpsAIDecision } from "../../lib/perps/ai-decision";
import { formatPerpsWalletError } from "../../lib/perps/wallet-error";
import { closePerpsPosition } from "../../lib/perps/browser-close";
import { bollingerSeries, calculatePerpsTechnicalSnapshot, emaSeries } from "../../lib/perps/technical-indicators";
import { usePerpsWallet } from "../../hooks/use-perps-wallet";
import type { Address } from "viem";
import "./perps.css";
import "./position-management.css";

type PerpsMarket = {
  symbol: string;
  price: number;
  change: number;
  funding: number;
  poolAddress?: string;
  markPriceUpdatedAt?: string | null;
  openInterest?: number;
  tradeCount?: number;
  candles?: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number; trades: number }>;
};

const fallbackMarkets: PerpsMarket[] = [
  { symbol: "BTC-PERP", price: 108420.6, change: 2.84, funding: 0.0081 },
  { symbol: "ETH-PERP", price: 3884.2, change: 1.37, funding: -0.0032 },
  { symbol: "SOL-PERP", price: 186.44, change: -0.72, funding: 0.0054 },
];

const money = (value: number, digits = 2) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits }).format(value);

const preflightReasonCopy: Record<string, string> = {
  walletBalance: "Insufficient USDso in the connected wallet",
  walletAllowance: "USDso approval is required before DreamDEX can pull margin",
  marginBalance: "Insufficient available margin",
  marginDeposit: "USDso is approved but must be deposited into the DreamDEX MarginBank before signing",
  below_minimum: "Order size is below the market minimum",
  openInterest: "Market open-interest limit reached",
  priceImpact: "Executable liquidity is insufficient for this size",
};

function chartPath(candles: NonNullable<PerpsMarket["candles"]>) {
  const values = candles.map(candle => candle.close);
  if (values.length < 2) return null;
  const ema9 = emaSeries(values, 9);
  const ema21 = emaSeries(values, 21);
  const bands = bollingerSeries(values);
  const bandValues = bands.flatMap(band => band ? [band.upper, band.lower] : []);
  const low = Math.min(...candles.map(candle => candle.low), ...bandValues);
  const high = Math.max(...candles.map(candle => candle.high), ...bandValues);
  const spread = high - low || 1;
  const point = (value: number, index: number) => {
    const x = index / (values.length - 1) * 900;
    const y = 205 - (value - low) / spread * 155;
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  };
  const points = values.map(point);
  const path = (series: number[]) => `M${series.map(point).join(" L")}`;
  const upper = bands.map((band, index) => band ? point(band.upper, index) : null).filter((value): value is string => Boolean(value));
  const lower = bands.map((band, index) => band ? point(band.lower, index) : null).filter((value): value is string => Boolean(value));
  return { line: `M${points.join(" L")}`, area: `M${points.join(" L")} L900 230 L0 230 Z`, ema9: path(ema9), ema21: path(ema21), upper: upper.length > 1 ? `M${upper.join(" L")}` : null, lower: lower.length > 1 ? `M${lower.join(" L")}` : null, low, high };
}

function rsiPath(candles: NonNullable<PerpsMarket["candles"]>) {
  if (candles.length < 15) return null;
  const points = candles.slice(14).map((_, offset) => {
    const value = calculatePerpsTechnicalSnapshot(candles.slice(0, offset + 15)).rsi14;
    const x = offset / Math.max(1, candles.length - 15) * 900;
    const y = 92 - value / 100 * 72;
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return `M${points.join(" L")}`;
}

export default function PerpsWorkspace() {
  const wallet = usePerpsWallet();
  const [markets, setMarkets] = useState(fallbackMarkets);
  const [dataMode, setDataMode] = useState<"loading" | "live" | "demo">("loading");
  const [updatedAt, setUpdatedAt] = useState<string>("");
  const [marketIndex, setMarketIndex] = useState(0);
  const [side, setSide] = useState<PerpsSide>("LONG");
  // A small live-test preset that clears current BTC/ETH/SOL minimum lots while
  // keeping the first Hideki transaction inexpensive and easy to verify.
  const [collateral, setCollateral] = useState(5.5);
  const [leverage, setLeverage] = useState(2);
  const [preflight, setPreflight] = useState<PerpsPreflight | null>(null);
  const [preflightError, setPreflightError] = useState<string>("");
  const [isReviewing, setIsReviewing] = useState(false);
  const [pipelineStage, setPipelineStage] = useState<"idle" | "approving" | "depositing" | "signing">("idle");
  const [approvalReceipt, setApprovalReceipt] = useState<{ hash: string; blockNumber: string; amount: string } | null>(null);
  const [depositReceipt, setDepositReceipt] = useState<{ hash: string; blockNumber: string; amount: string } | null>(null);
  const [executionReceipt, setExecutionReceipt] = useState<{ hash: string; orderId: string | null; fills: number; blockNumber: string } | null>(null);
  const [accountSnapshot, setAccountSnapshot] = useState<PerpsAccountSnapshot | null>(null);
  const [accountState, setAccountState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [walletBalance, setWalletBalance] = useState<PerpsWalletBalance | null>(null);
  const [balanceState, setBalanceState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [closeSymbol, setCloseSymbol] = useState<string | null>(null);
  const [closePercentage, setClosePercentage] = useState<25 | 50 | 100>(100);
  const [closeState, setCloseState] = useState<"idle" | "checking" | "signing" | "confirmed" | "error">("idle");
  const [closeMessage, setCloseMessage] = useState("");
  const [geminiDecision, setGeminiDecision] = useState<PerpsAIDecision | null>(null);
  const [aiMeta, setAiMeta] = useState<{ provider: "gemini" | "local"; model: string; latencyMs: number; fallbackReason?: string } | null>(null);
  const [aiState, setAiState] = useState<"loading" | "ready">("loading");
  const market = markets[marketIndex];
  const direction = side === "LONG" ? 1 : -1;
  const stopLoss = market.price * (1 - direction * 0.018);
  const takeProfit = market.price * (1 + direction * 0.042);
  const risk = useMemo(() => calculatePerpsRisk({
    side,
    markPrice: market.price,
    entryPrice: market.price,
    collateral,
    leverage,
    stopLoss,
    takeProfit,
  }), [side, market, collateral, leverage, stopLoss, takeProfit]);
  const geometry = useMemo(() => chartPath(market.candles ?? []), [market.candles]);
  const technical = useMemo(() => calculatePerpsTechnicalSnapshot(market.candles ?? []), [market.candles]);
  const rsiGeometry = useMemo(() => rsiPath(market.candles ?? []), [market.candles]);
  const candleVolume = useMemo(() => (market.candles ?? []).reduce((sum, candle) => sum + candle.volume, 0), [market.candles]);
  const firstClose = market.candles?.[0]?.close ?? market.price;
  const trendUp = market.price >= firstClose;
  const aiInput = useMemo(() => ({
    symbol: market.symbol,
    price: market.price,
    change: market.change,
    funding: market.funding,
    openInterest: market.openInterest ?? 0,
    tradeCount: market.tradeCount ?? 0,
    candles: market.candles ?? [],
  }), [market]);
  const localAiDecision = useMemo(() => buildPerpsAIDecision(aiInput), [aiInput]);
  const aiDecision = geminiDecision ?? localAiDecision;
  const pipelineBusy = pipelineStage !== "idle";

  useEffect(() => {
    let active = true;
    fetch("/api/perps/markets", { cache: "no-store" })
      .then(response => response.json())
      .then(payload => {
        if (!active) return;
        if (Array.isArray(payload.markets) && payload.markets.length) setMarkets(payload.markets);
        setDataMode(payload.mode === "live" ? "live" : "demo");
        setUpdatedAt(payload.updatedAt ?? "");
      })
      .catch(() => active && setDataMode("demo"));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setGeminiDecision(null);
    setAiMeta(null);
    setAiState("loading");
    const timer = setTimeout(() => {
      fetch("/api/perps/ai-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(aiInput),
        signal: controller.signal,
        cache: "no-store",
      })
        .then(response => response.ok ? response.json() : Promise.reject(new Error("AI analysis unavailable")))
        .then(payload => {
          if (!active || !payload?.decision) return;
          setGeminiDecision(payload.decision);
          setAiMeta(payload.meta ?? null);
        })
        .catch(error => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          if (active) setAiMeta({ provider: "local", model: "eventra-risk-engine", latencyMs: 0, fallbackReason: "AI endpoint unavailable" });
        })
        .finally(() => active && setAiState("ready"));
    }, 250);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [aiInput]);

  useEffect(() => {
    let active = true;
    if (!wallet.account || !wallet.isReady) {
      setAccountSnapshot(null);
      setAccountState("idle");
      return;
    }
    setAccountState("loading");
    readConnectedPerpsAccount(wallet.account)
      .then(snapshot => {
        if (!active) return;
        setAccountSnapshot(snapshot);
        setAccountState("ready");
      })
      .catch(() => active && setAccountState("error"));
    return () => { active = false; };
  }, [wallet.account, wallet.isReady, executionReceipt]);

  useEffect(() => {
    let active = true;
    if (!wallet.account || !wallet.isReady) {
      setWalletBalance(null);
      setBalanceState("idle");
      return;
    }
    setBalanceState("loading");
    readPerpsWalletBalance(wallet.account)
      .then(balance => {
        if (!active) return;
        setWalletBalance(balance);
        setBalanceState("ready");
      })
      .catch(() => {
        if (!active) return;
        setWalletBalance(null);
        setBalanceState("error");
      });
    return () => { active = false; };
  }, [wallet.account, wallet.isReady, approvalReceipt, depositReceipt, executionReceipt]);

  useEffect(() => {
    setPreflight(null);
    setPreflightError("");
    setExecutionReceipt(null);
    setApprovalReceipt(null);
    setDepositReceipt(null);
  }, [marketIndex, side, collateral, leverage, wallet.account]);

  const reviewOrder = async () => {
    if (wallet.status === "wrong_chain") { await wallet.switchChain(); return; }
    if (!wallet.isReady || !wallet.account) { await wallet.connect(); return; }
    if (dataMode !== "live" || !market.poolAddress) {
      setPreflightError("Verified dreamDEX market data is required before order review.");
      return;
    }
    setIsReviewing(true);
    setPreflightError("");
    try {
      const result = await runPerpsPreflight({
        account: wallet.account,
        poolAddress: market.poolAddress as Address,
        side,
        quantity: risk.quantity,
      });
      setPreflight(result);
    } catch (error) {
      setPreflightError(error instanceof Error ? error.message : "Unable to verify this order on Hideki.");
    } finally {
      setIsReviewing(false);
    }
  };

  const fitToExecutableSize = () => {
    if (!preflight) return;
    const maxQuantity = Number(preflight.maxQuantity);
    const minQuantity = Number(preflight.minQuantity);
    if (!Number.isFinite(maxQuantity) || !Number.isFinite(minQuantity) || maxQuantity < minQuantity || maxQuantity <= 0) return;
    const targetQuantity = Math.max(minQuantity, maxQuantity * .98);
    const nextCollateral = targetQuantity * market.price / leverage;
    setCollateral(Number(nextCollateral.toFixed(4)));
  };

  const completeOnChainOrder = async () => {
    if (!wallet.account || !wallet.isReady || !preflight || !market.poolAddress || pipelineStage !== "idle") return;
    setPreflightError("");
    let current = preflight;
    let activeStage: "approving" | "depositing" | "signing" = current.reason === "walletAllowance" ? "approving" : current.reason === "marginDeposit" ? "depositing" : "signing";
    const refresh = () => runPerpsPreflight({ account: wallet.account as Address, poolAddress: market.poolAddress as Address, side, quantity: risk.quantity });
    const waitForChange = async (blockedReason: string) => {
      let latest = await refresh();
      for (let attempt = 0; latest.reason === blockedReason && attempt < 8; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 750));
        latest = await refresh();
      }
      return latest;
    };
    try {
      if (current.reason === "walletAllowance") {
        activeStage = "approving";
        setPipelineStage("approving");
        const approval = await approvePerpsCollateral({ account: wallet.account, preflight: current });
        setApprovalReceipt(approval);
        current = await waitForChange("walletAllowance");
        setPreflight(current);
        if (current.reason === "walletAllowance") throw new Error("Approval confirmed but allowance is not visible on the latest Hideki block yet. Refresh and resume shortly.");
      }
      if (current.reason === "marginDeposit") {
        activeStage = "depositing";
        setPipelineStage("depositing");
        const deposit = await depositPerpsMargin({ account: wallet.account, preflight: current });
        setDepositReceipt(deposit);
        current = await waitForChange("marginDeposit");
        setPreflight(current);
        if (current.reason === "marginDeposit") throw new Error("Deposit confirmed but MarginBank balance is not visible on the latest Hideki block yet. Refresh and resume shortly.");
      }
      if (!current.placeable) {
        const reason = current.reason ? preflightReasonCopy[current.reason] ?? current.reason : "Order is not executable at the latest block";
        throw new Error(reason);
      }
      activeStage = "signing";
      setPipelineStage("signing");
      const receipt = await executePerpsOrder({ account: wallet.account, side, preflight: current });
      setExecutionReceipt(receipt);
      setPreflight(current);
    } catch (error) {
      setPreflightError(formatPerpsWalletError(error, activeStage));
    } finally {
      setPipelineStage("idle");
    }
  };

  const submitClosePosition = async (position: PerpsAccountSnapshot["positions"][number]) => {
    if (!wallet.account || !wallet.isReady || closeState === "checking" || closeState === "signing") return;
    setCloseState("checking");
    setCloseMessage("");
    try {
      setCloseMessage("Checking the latest position and simulating the close on Hideki…");
      const result = await closePerpsPosition({
        account: wallet.account,
        position,
        percentage: closePercentage,
        onPreflightPassed: () => {
          setCloseState("signing");
          setCloseMessage("Preflight passed. Confirm the close transaction in your wallet.");
        },
      });
      setCloseState("confirmed");
      setCloseMessage(`${result.quantity} ${position.symbol.replace("-PERP", "")} closed · ${result.fills} fill${result.fills === 1 ? "" : "s"} · ${result.hash.slice(0, 10)}…`);
      await new Promise(resolve => setTimeout(resolve, 1200));
      setAccountSnapshot(await readConnectedPerpsAccount(wallet.account));
      setWalletBalance(await readPerpsWalletBalance(wallet.account));
    } catch (error) {
      setCloseState("error");
      setCloseMessage(error instanceof Error ? error.message : "Unable to close this position on DreamDEX.");
    }
  };

  return (
    <main className="perps-shell">
      <div className="perps-orb perps-orb-one" />
      <div className="perps-orb perps-orb-two" />
      <header className="perps-nav">
        <a className="perps-brand" href="/" aria-label="Eventra home">
          <span className="perps-brand-mark">E</span>
          <span>Eventra</span>
          <small>PERPS</small>
        </a>
        <div className={`perps-network ${dataMode}`}><i /> {dataMode === "live" ? "dreamDEX live data" : dataMode === "loading" ? "Checking dreamDEX" : "Perps demo · Hideki 50383"}</div>
        <div className="perps-wallet-cluster">
          {wallet.account && wallet.isReady && (
            <div className="perps-wallet-balance" title={walletBalance ? `Read at Hideki block ${walletBalance.blockNumber}` : "Reading Hideki balance"}>
              <span>AVAILABLE</span>
              <strong>{balanceState === "loading" ? "Syncing…" : walletBalance ? `${Number(walletBalance.usdso).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDso` : "Balance unavailable"}</strong>
              {walletBalance && <small>{Number(walletBalance.native).toLocaleString(undefined, { maximumFractionDigits: 4 })} STT gas</small>}
            </div>
          )}
          <button
            className="perps-wallet"
            onClick={() => wallet.status === "wrong_chain" ? wallet.switchChain() : wallet.connect()}
            type="button"
          >
            {wallet.status === "connecting"
              ? "Connecting…"
              : wallet.status === "wrong_chain"
                ? "Switch to Hideki"
                : wallet.account
                  ? `${wallet.account.slice(0, 6)}…${wallet.account.slice(-4)}`
                  : "Connect wallet"}
          </button>
        </div>
      </header>

      <section className="perps-hero">
        <div>
          <p className="perps-kicker">AI RISK &amp; EXECUTION COPILOT</p>
          <h1>Trade the thesis.<br /><em>Control the downside.</em></h1>
          <p className="perps-subtitle">An evidence-first Perps workspace for dreamDEX—analysis, liquidation risk and execution in one decision surface.</p>
        </div>
        <div className="perps-verdict">
          <span>{aiMeta?.provider === "gemini" ? "GEMINI LIVE VERDICT" : aiState === "loading" ? "AI ANALYZING" : "EVENTRA LOCAL VERDICT"}</span>
          <strong>{aiDecision.side}</strong>
          <div><b>{aiDecision.confidence}%</b> confidence · {aiDecision.quality.toLowerCase()} evidence</div>
        </div>
      </section>

      <section className="perps-market-strip">
        {markets.map((item, index) => (
          <button className={index === marketIndex ? "active" : ""} key={item.symbol} onClick={() => setMarketIndex(index)} disabled={pipelineBusy}>
            <span>{item.symbol}</span>
            <strong>{money(item.price)}</strong>
            <small className={item.change >= 0 ? "positive" : "negative"}>{item.change >= 0 ? "+" : ""}{item.change.toFixed(2)}%</small>
          </button>
        ))}
      </section>

      <div className="perps-grid">
        <section className="perps-panel perps-analysis">
          <div className="perps-panel-head">
            <div><span>LIVE MARKET INTELLIGENCE</span><h2>{market.symbol} decision map</h2></div>
            <div className={`perps-live ${dataMode}`}><i /> {dataMode === "live" ? "LIVE" : dataMode === "loading" ? "VERIFYING" : "DEMO DATA"}{updatedAt ? ` · ${new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}</div>
          </div>
          <div className={`perps-ai-brief ${aiDecision.side.toLowerCase()}`}>
            <div className="perps-ai-score"><span>{aiMeta?.provider === "gemini" ? "GEMINI · LIVE ANALYSIS" : aiState === "loading" ? "GEMINI · ANALYZING" : "EVENTRA · LOCAL FALLBACK"}</span><strong>{aiDecision.side}</strong><b>{aiDecision.confidence}%</b><small>{aiDecision.quality} EVIDENCE{aiMeta ? ` · ${aiMeta.model}` : ""}</small></div>
            <div className="perps-ai-thesis"><h3>{aiDecision.summary}</h3><ul>{aiDecision.drivers.map(driver => <li key={driver}>{driver}</li>)}</ul></div>
            <div className="perps-ai-risk"><span>COUNTER-THESIS</span><p>{aiDecision.counterThesis}</p><span>INVALIDATION</span><p>{aiDecision.invalidation}</p></div>
          </div>
          <div className={`perps-ai-status ${aiMeta?.provider === "gemini" ? "live" : "local"}`}><i /><b>{aiMeta?.provider === "gemini" ? "Gemini analysis verified" : aiState === "loading" ? "Requesting Gemini analysis…" : "Deterministic fallback active"}</b><span>{aiMeta ? `${aiMeta.latencyMs} ms · AI advises only; wallet confirmation remains required.` : "Market snapshot is being analyzed server-side."}</span></div>
          <div className="perps-chart" aria-label={`${market.symbol} live one-minute price chart`}>
            <div className="perps-chart-label"><span>MARK PRICE · 1M OHLCV</span><strong>{money(market.price)}</strong></div>
            <div className="perps-chart-legend"><span className="price">PRICE</span><span className="fast">EMA 9</span><span className="slow">EMA 21</span><span className="bands">BOLLINGER 20,2</span></div>
            <svg viewBox="0 0 900 250" preserveAspectRatio="none" role="img">
              <defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7657ff" stopOpacity=".34"/><stop offset="100%" stopColor="#7657ff" stopOpacity="0"/></linearGradient></defs>
              {geometry ? <><path className="chart-area" d={geometry.area} />{geometry.upper && <path className="chart-band" d={geometry.upper} />}{geometry.lower && <path className="chart-band" d={geometry.lower} />}<path className="chart-ema-fast" d={geometry.ema9} /><path className="chart-ema-slow" d={geometry.ema21} /><path className="chart-line" d={geometry.line} /><line x1="0" x2="900" y1="128" y2="128" className="chart-dash" /></> : <text x="450" y="135" textAnchor="middle" className="chart-empty">Waiting for indexed fills</text>}
            </svg>
            <div className="perps-chart-foot"><span>{market.candles?.[0] ? new Date(market.candles[0].time * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "30m window"}</span><span>{geometry ? `Range ${money(geometry.low)}–${money(geometry.high)}` : "Live indexer"}</span><span>Now</span></div>
          </div>

          <div className="perps-rsi-panel">
            <div><span>RSI 14 · MOMENTUM</span><strong className={technical.rsi14 >= 70 ? "negative" : technical.rsi14 <= 30 ? "positive" : ""}>{technical.rsi14.toFixed(1)}</strong><small>{technical.rsi14 >= 70 ? "Overbought zone" : technical.rsi14 <= 30 ? "Oversold zone" : "Neutral momentum"}</small></div>
            <svg viewBox="0 0 900 110" preserveAspectRatio="none" role="img" aria-label={`RSI 14 is ${technical.rsi14.toFixed(1)}`}><line x1="0" x2="900" y1="42" y2="42" className="rsi-threshold"/><line x1="0" x2="900" y1="70" y2="70" className="rsi-threshold"/>{rsiGeometry && <path d={rsiGeometry} className="rsi-line"/>}</svg>
            <div className="perps-rsi-scale"><span>70</span><span>30</span></div>
          </div>

          <div className="perps-technical-grid">
            <article><span>EMA STRUCTURE</span><strong className={technical.emaSpreadPct >= 0 ? "positive" : "negative"}>{technical.emaSpreadPct >= 0 ? "+" : ""}{technical.emaSpreadPct.toFixed(3)}%</strong><p>EMA 9 {technical.ema9 >= technical.ema21 ? "above" : "below"} EMA 21 · {technical.regime.replaceAll("_", " ").toLowerCase()}.</p></article>
            <article><span>VOLATILITY · ATR 14</span><strong>{technical.atrPct.toFixed(3)}%</strong><p>{money(technical.atr14)} average true range per one-minute candle.</p></article>
            <article><span>VOLUME CONFIRMATION</span><strong className={technical.volumeRatio >= 1 ? "positive" : ""}>{technical.volumeRatio.toFixed(2)}×</strong><p>Recent five-candle volume versus the preceding baseline.</p></article>
            <article><span>PRICE LOCATION</span><strong>{(technical.bollingerPosition * 100).toFixed(0)}% of band</strong><p>Support {money(technical.support)} · resistance {money(technical.resistance)}.</p></article>
          </div>

          <div className="perps-evidence">
            <article><span>01 · 30M TREND</span><strong>{trendUp ? "Positive momentum" : "Negative momentum"}</strong><p>{market.change >= 0 ? "+" : ""}{market.change.toFixed(2)}% across {market.candles?.length ?? 0} indexed one-minute candles.</p></article>
            <article><span>02 · FUNDING</span><strong>{market.funding >= 0 ? "Longs paying" : "Shorts paying"} {Math.abs(market.funding).toFixed(4)}%</strong><p>Live eight-hour rate from the latest DreamDEX funding update.</p></article>
            <article><span>03 · MARKET ACTIVITY</span><strong>{market.tradeCount ?? 0} fills · {money(candleVolume, 0)}</strong><p>Indexed trade count and quote volume in the visible chart window.</p></article>
            <article><span>04 · OPEN INTEREST</span><strong>{(market.openInterest ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 })} {market.symbol.split("-")[0]}</strong><p>Current protocol position exposure; not a simulated liquidity score.</p></article>
          </div>
        </section>

        <aside className="perps-panel perps-ticket">
          <div className="perps-panel-head"><div><span>ORDER SIMULATOR</span><h2>Build your position</h2></div><b className={`risk-pill ${risk.health.toLowerCase()}`}>{risk.health}</b></div>
          <div className="side-switch">
            <button className={side === "LONG" ? "long active" : "long"} onClick={() => setSide("LONG")} disabled={pipelineBusy}>Long</button>
            <button className={side === "SHORT" ? "short active" : "short"} onClick={() => setSide("SHORT")} disabled={pipelineBusy}>Short</button>
          </div>
          <label className="perps-field"><span>COLLATERAL <b>{walletBalance ? `Balance ${Number(walletBalance.usdso).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDso` : wallet.isReady ? balanceState === "loading" ? "Reading balance…" : "Balance unavailable" : "Wallet USDso margin"}</b></span><div><input type="number" min="1" max="1000" value={collateral} onChange={event => setCollateral(Number(event.target.value) || 0)} disabled={pipelineBusy} /><strong>USDso</strong></div>{walletBalance && <small className="perps-gas-balance">Gas reserve · {Number(walletBalance.native).toLocaleString(undefined, { maximumFractionDigits: 4 })} STT</small>}</label>
          <label className="leverage-field"><span>LEVERAGE <b>{leverage}×</b></span><input type="range" min="1" max="20" value={leverage} onChange={event => setLeverage(Number(event.target.value))} disabled={pipelineBusy} /><div><small>1×</small><small>5×</small><small>10×</small><small>20×</small></div></label>

          <div className="perps-risk-grid">
            <div><span>POSITION SIZE</span><strong>{money(risk.notional)}</strong></div>
            <div><span>LIQ. PRICE</span><strong>{money(risk.liquidationPrice)}</strong></div>
            <div><span>MAX RISK</span><strong className="negative">−{money(risk.riskAmount)}</strong></div>
            <div><span>AI TARGET</span><strong className="positive">+{money(risk.rewardAmount)}</strong></div>
          </div>

          <div className="perps-rr">
            <div><span>RISK / REWARD</span><strong>1 : {risk.riskRewardRatio.toFixed(2)}</strong></div>
            <div className="rr-bar"><i style={{ width: `${Math.min(100, risk.riskRewardRatio / 3 * 100)}%` }} /></div>
            <p>Liquidation buffer: <b>{risk.liquidationDistancePct.toFixed(1)}%</b> from mark price.</p>
          </div>

          <div className="perps-guard"><span>EVENTRA GUARD</span><p>{risk.health === "DANGER" ? "Leverage is too aggressive for the current volatility regime." : "Position passes sizing, liquidation and reward-to-risk checks."}</p></div>
          {wallet.error && <div className="perps-wallet-error"><b>Wallet network error</b><p>{wallet.error}</p><small>Required: Hideki Testnet · Chain 50383</small></div>}
          {preflight && (
            <div className={`perps-preflight ${preflight.placeable ? "pass" : "blocked"}`}>
              <div><span>ON-CHAIN PREFLIGHT · BLOCK {preflight.asOfBlock}</span><strong>{preflight.placeable ? "Ready to sign" : "Order blocked"}</strong></div>
              <dl>
                <div><dt>Requested</dt><dd>{preflight.requestedQuantity}</dd></div>
                <div><dt>Account max</dt><dd>{preflight.maxQuantity}</dd></div>
                <div><dt>Crossing price</dt><dd>${Number(preflight.crossingPrice).toLocaleString()}</dd></div>
                <div><dt>Wallet top-up</dt><dd>{Number(preflight.topUpRequired).toFixed(2)} USDso</dd></div>
                <div><dt>USDso balance</dt><dd>{Number(preflight.walletBalance).toFixed(2)}</dd></div>
                <div><dt>Bank allowance</dt><dd>{Number(preflight.walletAllowance).toFixed(2)}</dd></div>
              </dl>
              {!preflight.placeable && <p>{preflight.reason ? preflightReasonCopy[preflight.reason] ?? `Blocked by ${preflight.reason.replaceAll("_", " ")}` : "This order is not executable at the latest block."}</p>}
              {!preflight.placeable && (preflight.reason === "priceImpact" || preflight.reason === "openInterest") && Number(preflight.maxQuantity) >= Number(preflight.minQuantity) && <button className="perps-fit-size" type="button" onClick={fitToExecutableSize}>Use executable size · ≈ {money(Number(preflight.maxQuantity) * .98 * market.price / leverage)} collateral <span>→</span></button>}
            </div>
          )}
          {preflightError && <div className="perps-preflight-error">{preflightError}</div>}
          {pipelineBusy && <div className="perps-wallet-prompt"><i /><div><b>{pipelineStage === "approving" ? "Wallet prompt 1 · Approve USDso" : pipelineStage === "depositing" ? "Wallet prompt 2 · Deposit margin" : "Wallet prompt 3 · Sign order"}</b><p>Keep this page open and confirm the request in your wallet. Parameters are locked until this step resolves.</p></div></div>}
          {preflight && (
            <div className="perps-order-progress" aria-label="On-chain order progress">
              <div className={preflight.reason !== "walletAllowance" ? "done" : "active"}><b>1</b><span>Allowance<small>{preflight.reason === "walletAllowance" ? "Approval required" : "Ready"}</small></span></div>
              <i />
              <div className={preflight.topUpRequired === "0" ? "done" : preflight.reason === "marginDeposit" ? "active" : ""}><b>2</b><span>Margin<small>{preflight.topUpRequired === "0" ? "Funded" : `${Number(preflight.topUpRequired).toFixed(2)} USDso`}</small></span></div>
              <i />
              <div className={preflight.placeable ? "active" : ""}><b>3</b><span>Order<small>{preflight.placeable ? "Ready to sign" : "Pending"}</small></span></div>
            </div>
          )}
          {approvalReceipt && <div className="perps-approval-receipt"><span>USDso APPROVED · BLOCK {approvalReceipt.blockNumber}</span><p>{Number(approvalReceipt.amount).toFixed(2)} USDso approved for this margin requirement.</p><code>{approvalReceipt.hash.slice(0, 12)}…{approvalReceipt.hash.slice(-8)}</code></div>}
          {depositReceipt && <div className="perps-deposit-receipt"><span>MARGIN DEPOSITED · BLOCK {depositReceipt.blockNumber}</span><p>{Number(depositReceipt.amount).toFixed(2)} USDso moved into the DreamDEX MarginBank.</p><code>{depositReceipt.hash.slice(0, 12)}…{depositReceipt.hash.slice(-8)}</code></div>}
          {executionReceipt && (
            <div className="perps-receipt">
              <span>TRANSACTION CONFIRMED · BLOCK {executionReceipt.blockNumber}</span>
              <strong>{executionReceipt.fills > 0 ? "Position updated" : "Order submitted"}</strong>
              <p>{executionReceipt.orderId ? `Order #${executionReceipt.orderId}` : `${executionReceipt.fills} immediate fill${executionReceipt.fills === 1 ? "" : "s"}`}</p>
              <code>{executionReceipt.hash.slice(0, 12)}…{executionReceipt.hash.slice(-8)}</code>
            </div>
          )}
          {preflight && (preflight.placeable || preflight.reason === "walletAllowance" || preflight.reason === "marginDeposit") && !executionReceipt && (
            <button className="perps-complete" onClick={completeOnChainOrder} type="button" disabled={pipelineStage !== "idle"}>
              {pipelineStage === "approving" ? "1/3 · Confirm USDso approval…" : pipelineStage === "depositing" ? "2/3 · Confirm margin deposit…" : pipelineStage === "signing" ? "3/3 · Sign order in wallet…" : preflight.placeable ? `${depositReceipt ? "Resume & sign" : "Sign"} ${side.toLowerCase()} order` : approvalReceipt ? "Resume funding & sign" : "Complete on-chain order"} <span>↗</span>
            </button>
          )}
          <button
            className="perps-submit"
            onClick={reviewOrder}
            type="button"
            disabled={isReviewing || pipelineBusy}
          >
            {isReviewing ? "Checking account on-chain…" : wallet.status === "wrong_chain" ? "Add Hideki network" : wallet.isReady ? preflight ? "Refresh on-chain quote" : `Review ${side.toLowerCase()} order` : "Connect wallet to continue"} <span>→</span>
          </button>
          <small className="perps-disclaimer">{dataMode === "live" ? "Verified market feed" : "Clearly labelled demo data"} · Wallet signature required for testnet execution</small>
        </aside>
      </div>

      <section className="perps-account perps-panel">
        <div className="perps-account-head">
          <div><span>CONNECTED ACCOUNT</span><h2>Positions &amp; execution activity</h2></div>
          <small>{!wallet.account ? "Connect wallet to load" : accountState === "loading" ? "Syncing Hideki…" : accountState === "error" ? "Indexer unavailable" : accountSnapshot ? `Updated ${new Date(accountSnapshot.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Waiting"}</small>
        </div>
        {!wallet.account ? <div className="perps-account-empty"><b>Portfolio stays private until you connect.</b><p>Eventra reads positions and order activity directly in this browser.</p></div> : accountState === "loading" ? <div className="perps-account-empty"><b>Reading your DreamDEX account…</b><p>Positions, open orders and recent fills are being synchronized.</p></div> : accountSnapshot && (accountSnapshot.positions.length || accountSnapshot.openOrders.length || accountSnapshot.trades.length) ? <div className="perps-account-layout">
          <div className="perps-positions"><h3>Open positions <span>{accountSnapshot.positions.length}</span></h3>{accountSnapshot.positions.length ? accountSnapshot.positions.map(position => {
            const active = closeSymbol === position.symbol;
            const closeSize = position.size * closePercentage / 100;
            const pnl = position.unrealizedPnl * closePercentage / 100;
            return <article className="perps-position-row" key={position.symbol}>
              <div className="perps-position-main"><div><b>{position.symbol}</b><em className={position.side === "LONG" ? "positive" : "negative"}>{position.side}</em></div><small>{position.size.toLocaleString(undefined, { maximumFractionDigits: 6 })} contracts</small></div>
              <dl><div><dt>Entry</dt><dd>{money(position.entryPrice)}</dd></div><div><dt>Mark</dt><dd>{money(position.markPrice)}</dd></div><div><dt>Unrealized PnL</dt><dd className={position.unrealizedPnl >= 0 ? "positive" : "negative"}>{position.unrealizedPnl >= 0 ? "+" : ""}{money(position.unrealizedPnl)}</dd></div></dl>
              <button className="perps-close-toggle" type="button" onClick={() => { setCloseSymbol(active ? null : position.symbol); setCloseState("idle"); setCloseMessage(""); }}>Close</button>
              {active && <div className="perps-close-drawer">
                <div className="perps-close-head"><div><span>CLOSE POSITION</span><b>{position.side === "LONG" ? "Sell" : "Buy"} {position.symbol}</b></div><small>Market · reduce position only</small></div>
                <div className="perps-close-percent">{([25, 50, 100] as const).map(value => <button className={closePercentage === value ? "active" : ""} key={value} type="button" onClick={() => setClosePercentage(value)}>{value === 100 ? "Close all" : `${value}%`}</button>)}</div>
                <div className="perps-close-summary"><span><small>Close size</small><b>{closeSize.toLocaleString(undefined, { maximumFractionDigits: 6 })}</b></span><span><small>Est. realized PnL</small><b className={pnl >= 0 ? "positive" : "negative"}>{pnl >= 0 ? "+" : ""}{money(pnl)}</b></span></div>
                <p>IOC order at the live DreamDEX book. Final fill and PnL may change with slippage.</p>
                {closeMessage && <div className={`perps-close-message ${closeState}`}>{closeMessage}</div>}
                <button className="perps-close-submit" disabled={closeState === "checking" || closeState === "signing"} type="button" onClick={() => submitClosePosition(position)}>{closeState === "checking" ? "Checking close…" : closeState === "signing" ? "Confirm in wallet…" : `${position.side === "LONG" ? "Sell" : "Buy"} to close ${closePercentage}%`}</button>
              </div>}
            </article>;
          }) : <p>No open position.</p>}</div>
          <div className="perps-account-secondary">
            <div><h3>Open orders <span>{accountSnapshot.openOrders.length}</span></h3>{accountSnapshot.openOrders.length ? accountSnapshot.openOrders.map(order => <article key={order.orderId}><div><b>{order.symbol}</b><em>{order.side}</em></div><p>{order.remaining} remaining at {money(order.price)}</p></article>) : <p>No resting order.</p>}</div>
            <div><h3>Recent fills <span>{accountSnapshot.trades.length}</span></h3>{accountSnapshot.trades.length ? accountSnapshot.trades.slice(0, 4).map(trade => <article key={trade.id}><div><b>{trade.symbol}</b><em>{trade.side}</em></div><p>{trade.quantity} at {money(trade.price)} · {money(trade.quoteQuantity)}</p></article>) : <p>No indexed fill yet.</p>}</div>
          </div>
        </div> : <div className="perps-account-empty"><b>No Perps activity on Hideki yet.</b><p>Your first confirmed position, resting order or fill will appear here automatically.</p></div>}
      </section>

      <section className="perps-proof">
        <div><span>WHY THIS TRADE</span><h2>A decision receipt, not a black-box signal.</h2></div>
        <ol><li><b>01</b><span>Snapshot market evidence</span></li><li><b>02</b><span>Stress-test liquidation</span></li><li><b>03</b><span>Sign manually on dreamDEX</span></li></ol>
      </section>
    </main>
  );
}
