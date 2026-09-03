"use client";

import { useMemo, useState } from "react";
import { keccak256, toHex } from "viem";
import type { AdviceResponse } from "@/lib/advice";

type ReceiptPayload = {
  schema: "eventra.forecast-receipt.v1";
  chainId: 50312;
  marketId: string;
  poolAddress?: string;
  asset: "BTC" | "ETH";
  horizon: string;
  model: string;
  provider: string;
  generatedAt: string;
  expiry?: string;
  action: AdviceResponse["advice"]["action"];
  confidence: number;
  aiProbabilityUp: number | null;
  dreamdexProbabilityUp: number | null;
  modelEdgePoints: number | null;
  spotAtForecast: number | null;
  targetPrice: number | null;
  riskProfile: string;
  sources: string[];
};

export function ForecastEvidenceReceipt({
  result,
  marketId,
  poolAddress,
  asset,
  horizon,
  expiry,
  dreamdexProbabilityUp,
  modelEdgePoints,
  riskProfile,
  marketContract,
}: {
  result: AdviceResponse;
  marketId?: string;
  poolAddress?: string;
  asset: "BTC" | "ETH";
  horizon: string;
  expiry?: string;
  dreamdexProbabilityUp: number | null;
  modelEdgePoints: number | null;
  riskProfile: string;
  marketContract?: string;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const payload = useMemo<ReceiptPayload>(() => {
    const aiProbabilityUp = result.forecast
      ? result.forecast.direction === "UP" ? result.forecast.confidence : 100 - result.forecast.confidence
      : null;
    return {
      schema: "eventra.forecast-receipt.v1",
      chainId: 50312,
      marketId: marketId ?? "unavailable",
      poolAddress,
      asset,
      horizon,
      model: result.meta.model,
      provider: result.meta.provider === "DreamPilot Local" ? "Eventra Core" : result.meta.provider,
      generatedAt: result.meta.generatedAt,
      expiry,
      action: result.advice.action,
      confidence: result.advice.confidence,
      aiProbabilityUp,
      dreamdexProbabilityUp,
      modelEdgePoints,
      spotAtForecast: result.forecast?.currentPrice ?? null,
      targetPrice: result.forecast?.predictedPrice ?? null,
      riskProfile,
      sources: [result.forecast?.source ?? "Forecast unavailable", "DreamDEX Event Contracts SDK", "Somnia Shannon testnet"],
    };
  }, [asset, dreamdexProbabilityUp, expiry, horizon, marketId, modelEdgePoints, poolAddress, result, riskProfile]);
  const json = useMemo(() => JSON.stringify(payload, null, 2), [payload]);
  const digest = useMemo(() => keccak256(toHex(JSON.stringify(payload))), [payload]);

  async function copyReceipt() {
    try {
      await navigator.clipboard.writeText(json);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1_800);
    } catch {
      setCopyState("failed");
    }
  }

  function downloadReceipt() {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `eventra-${asset.toLowerCase()}-${horizon}-${result.meta.generatedAt.replaceAll(":", "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="forecast-receipt" aria-label="Reproducible forecast evidence receipt">
      <div className="receipt-identity">
        <span>Reproducible evidence receipt</span>
        <h3>{asset} {horizon} · {payload.action.replace("BUY_", "")}</h3>
        <p>A deterministic snapshot of the model output and DreamDEX state used by Eventra. Settlement is reconciled separately from the Somnia market contract.</p>
      </div>
      <dl>
        <div><dt>Snapshot digest</dt><dd><code>{digest.slice(0, 12)}…{digest.slice(-8)}</code></dd></div>
        <div><dt>Market ID</dt><dd><code>{payload.marketId === "unavailable" ? "Unavailable" : `${payload.marketId.slice(0, 10)}…${payload.marketId.slice(-6)}`}</code></dd></div>
        <div><dt>Generated</dt><dd>{new Date(payload.generatedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</dd></div>
        <div><dt>Evidence source</dt><dd>{dreamdexProbabilityUp === null ? "Forecast only · no live odds" : "Forecast + DreamDEX odds"}</dd></div>
      </dl>
      <div className="receipt-actions">
        <button onClick={() => void copyReceipt()} type="button">{copyState === "copied" ? "✓ Copied JSON" : copyState === "failed" ? "Copy unavailable" : "Copy evidence JSON"}</button>
        <button onClick={downloadReceipt} type="button">Download receipt</button>
        {marketContract ? <a href={`https://shannon-explorer.somnia.network/address/${marketContract}`} rel="noreferrer" target="_blank">Verify market ↗</a> : null}
      </div>
    </section>
  );
}
