"use client";

import { useEffect, useMemo, useState } from "react";
import type { WalletClient } from "viem";
import type { UserPositionRow } from "@/lib/dreamdex/positions";
import {
  executePositionExit,
  quotePositionExit,
  type ExitSide,
  type PositionExitOutcome,
  type PositionExitQuote,
} from "@/lib/dreamdex/position-exit";
import { explorerTxUrl } from "@/lib/dreamdex/settlement";

const EXIT_PERCENTAGES = [25, 50, 100] as const;

export function ClosePositionCard({ row, walletClient, disabled, onClosed }: {
  row: UserPositionRow;
  walletClient: WalletClient | null;
  disabled?: boolean;
  onClosed: () => Promise<void> | void;
}) {
  const availableSides = useMemo(() => [
    ...(BigInt(row.yesRaw || "0") > 0n ? ["UP" as const] : []),
    ...(BigInt(row.noRaw || "0") > 0n ? ["DOWN" as const] : []),
  ], [row.noRaw, row.yesRaw]);
  const [side, setSide] = useState<ExitSide>(availableSides[0] ?? "UP");
  const [percentage, setPercentage] = useState(100);
  const [quote, setQuote] = useState<PositionExitQuote | null>(null);
  const [outcome, setOutcome] = useState<PositionExitOutcome | null>(null);
  const [busy, setBusy] = useState<"quote" | "sign" | null>(null);

  const settled = row.status === "resolved" || row.status === "voided" || row.status === "finalized" || row.status === "redeemed";
  const balanceRaw = BigInt(side === "UP" ? row.yesRaw : row.noRaw);
  const requestedRaw = (balanceRaw * BigInt(percentage)) / 100n;

  useEffect(() => {
    if (settled || row.claimable || !row.pool || availableSides.length === 0 || requestedRaw <= 0n) return;
    let cancelled = false;
    setQuote(null);
    const updateQuote = () => {
      setBusy("quote");
      void quotePositionExit({ pool: row.pool as `0x${string}`, side, quantityRaw: requestedRaw })
        .then((next) => { if (!cancelled) setQuote(next); })
        .finally(() => { if (!cancelled) setBusy(null); });
    };
    const timer = window.setTimeout(updateQuote, 350);
    const interval = window.setInterval(updateQuote, 4_000);
    return () => { cancelled = true; window.clearTimeout(timer); window.clearInterval(interval); };
  }, [availableSides.length, requestedRaw, row.claimable, row.pool, settled, side]);

  if (availableSides.length === 0) return null;

  if (row.claimable || settled) return (
    <div className="position-exit-card settled">
      <div className="position-exit-title"><div><small>Position closed</small><b>Sell window has ended</b></div><span>{row.status}</span></div>
      <p className="position-exit-hint">This Event Contract is finalized. DreamDEX no longer accepts secondary-market sells; only a winning outcome (or either side of a voided market) can be redeemed.</p>
    </div>
  );

  if (!row.pool) return (
    <div className="position-exit-card unavailable">
      <div className="position-exit-title"><div><small>Exit position</small><b>Sell temporarily unavailable</b></div></div>
      <p className="position-exit-hint">DreamDEX has not indexed the pool address for this position yet. Refresh in a few seconds.</p>
    </div>
  );

  async function refreshQuote() {
    setBusy("quote");
    setOutcome(null);
    try {
      setQuote(await quotePositionExit({ pool: row.pool as `0x${string}`, side, quantityRaw: requestedRaw }));
    } finally {
      setBusy(null);
    }
  }

  async function closePosition() {
    if (!walletClient || !quote) return;
    setBusy("sign");
    const next = await executePositionExit({ walletClient, quote });
    setOutcome(next);
    setBusy(null);
    if (next.ok) {
      setQuote(null);
      await onClosed();
    }
  }

  function changeSide(next: ExitSide) {
    setSide(next);
    setQuote(null);
    setOutcome(null);
  }

  function changePercentage(next: number) {
    setPercentage(next);
    setQuote(null);
    setOutcome(null);
  }

  const scale = 10 ** row.quoteDecimals;
  const positionTokens = Number(balanceRaw) / scale;
  const selectedTokens = Number(requestedRaw) / scale;
  const avgEntryCents = row.avgCostRaw ? (Number(row.avgCostRaw) / scale) * 100 : null;
  const selectedCostUsd = row.avgCostRaw
    ? (Number(row.avgCostRaw) * Number(requestedRaw)) / (scale * scale)
    : null;
  const totalBalanceRaw = BigInt(row.yesRaw || "0") + BigInt(row.noRaw || "0");
  const selectedMarkUsd = row.markValueRaw && totalBalanceRaw > 0n
    ? (Number(row.markValueRaw) / scale) * (Number(requestedRaw) / Number(totalBalanceRaw))
    : null;
  const selectedMarkPnlUsd = selectedMarkUsd !== null && selectedCostUsd !== null ? selectedMarkUsd - selectedCostUsd : null;
  const selectedMarkPnlPercent = selectedMarkPnlUsd !== null && selectedCostUsd && selectedCostUsd > 0
    ? (selectedMarkPnlUsd / selectedCostUsd) * 100
    : null;
  const estimatedCostUsd = quote && row.avgCostRaw
    ? (Number(row.avgCostRaw) * Number(quote.fillableQuantityRaw)) / (scale * scale)
    : null;
  const estimatedPnlUsd = quote && estimatedCostUsd !== null ? quote.estimatedProceedsUsd - estimatedCostUsd : null;
  const estimatedPnlPercent = estimatedPnlUsd !== null && estimatedCostUsd && estimatedCostUsd > 0
    ? (estimatedPnlUsd / estimatedCostUsd) * 100
    : null;

  return (
    <div className="position-exit-card">
      <div className="position-exit-title"><div><small>Exit position</small><b>Sell before settlement</b></div><span>DreamDEX IOC</span></div>
      <div className="position-exit-sides">
        {availableSides.map((item) => <button className={side === item ? "active" : ""} key={item} onClick={() => changeSide(item)} type="button">{item}</button>)}
      </div>
      <div className="position-current-snapshot" aria-label="Current position and selected exit value">
        <span><small>Current position</small><b>{positionTokens.toLocaleString("en-US", { maximumFractionDigits: 3 })} {side}</b></span>
        <span><small>Average entry</small><b>{avgEntryCents === null ? "Indexing…" : `${avgEntryCents.toFixed(2)}¢`}</b></span>
        <span><small>Selected to sell</small><b>{selectedTokens.toLocaleString("en-US", { maximumFractionDigits: 3 })} · {percentage}%</b></span>
        <span className={selectedMarkPnlUsd === null ? "" : selectedMarkPnlUsd >= 0 ? "pnl-positive" : "pnl-negative"}><small>Current mark P/L</small><b>{selectedMarkPnlUsd === null ? "Indexing…" : `${selectedMarkPnlUsd >= 0 ? "+" : "-"}$${Math.abs(selectedMarkPnlUsd).toFixed(3)}${selectedMarkPnlPercent === null ? "" : ` · ${selectedMarkPnlPercent >= 0 ? "+" : ""}${selectedMarkPnlPercent.toFixed(1)}%`}`}</b></span>
      </div>
      <label className="position-exit-slider"><span><small>Position to sell</small><b>{percentage}%</b></span><input aria-label="Percentage of position to sell" min="1" max="100" step="1" type="range" value={percentage} onChange={(event) => changePercentage(Number(event.target.value))} /><em><span>1%</span><span>100%</span></em></label>
      <div className="position-exit-percentages quick">
        {EXIT_PERCENTAGES.map((item) => <button className={percentage === item ? "active" : ""} key={item} onClick={() => changePercentage(item)} type="button">{item}%</button>)}
      </div>
      {quote ? <div className="position-exit-quote">
        <span><small>Best executable bid</small><b>{quote.bestBidCents.toFixed(2)}¢</b></span>
        <span><small>Est. proceeds</small><b>${quote.estimatedProceedsUsd.toFixed(3)}</b></span>
        <span><small>Book coverage</small><b>{quote.fillPercent.toFixed(1)}%</b></span>
        <span><small>Tokens sold</small><b>{(Number(quote.fillableQuantityRaw) / scale).toLocaleString("en-US", { maximumFractionDigits: 3 })}</b></span>
        {estimatedCostUsd !== null ? <span><small>Est. cost basis</small><b>${estimatedCostUsd.toFixed(3)}</b></span> : null}
        {estimatedPnlUsd !== null ? <span className={estimatedPnlUsd >= 0 ? "pnl-positive" : "pnl-negative"}><small>Estimated P/L</small><b>{estimatedPnlUsd >= 0 ? "+" : "-"}${Math.abs(estimatedPnlUsd).toFixed(3)}{estimatedPnlPercent !== null ? ` (${estimatedPnlPercent >= 0 ? "+" : ""}${estimatedPnlPercent.toFixed(1)}%)` : ""}</b></span> : null}
        {quote.partial ? <em>Partial liquidity: only the quoted coverage can fill; the remainder will cancel automatically.</em> : null}
      </div> : null}
      {!quote && !busy ? <p className="position-exit-hint">No executable bid is available for this size. Try a smaller percentage or wait for liquidity.</p> : null}
      {outcome ? <p className={`position-exit-result ${outcome.ok ? "success" : "error"}`}>{outcome.message}{outcome.hash ? <> <a href={explorerTxUrl(outcome.hash)} target="_blank" rel="noreferrer">Transaction ↗</a></> : null}</p> : null}
      <div className="position-exit-actions">
        <button disabled={disabled || busy !== null || requestedRaw <= 0n} onClick={refreshQuote} type="button">{busy === "quote" ? "Updating estimate…" : quote ? "Refresh estimate" : "Retry quote"}</button>
        <button className="close-primary" disabled={disabled || !walletClient || !quote || busy !== null} onClick={closePosition} type="button">{busy === "sign" ? "Waiting for wallet…" : `Close ${percentage}% ${side}`}</button>
      </div>
    </div>
  );
}
