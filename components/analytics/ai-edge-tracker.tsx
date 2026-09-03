"use client";

import { useMemo, useState } from "react";
import type { ForecastLedgerRecord } from "@/lib/eventra/forecast-ledger";

function formatEdge(value: number | null) {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)} pts`;
}

export function AiEdgeTracker({ records }: { records: ForecastLedgerRecord[] }) {
  const [providerFilter, setProviderFilter] = useState("all");
  const verifiedRecords = records.filter((record) => record.verification !== "eventra-simulation");
  const simulatedRecords = records.filter((record) => record.verification === "eventra-simulation");
  const forwardTests = verifiedRecords.filter((record) => record.status === "forward_testing");
  const settled = verifiedRecords.filter((record) => record.status === "settled" && record.outcome);
  const scored = verifiedRecords.filter((record) => record.edgePercent !== null);
  const averageEdge = scored.length
    ? scored.reduce((sum, record) => sum + Math.abs(record.edgePercent ?? 0), 0) / scored.length
    : null;
  const directionalWins = settled.filter((record) =>
    (record.action === "BUY_UP" && record.outcome === "UP") ||
    (record.action === "BUY_DOWN" && record.outcome === "DOWN"),
  ).length;
  const directionalCalls = settled.filter((record) => record.action !== "WAIT");
  const brierRecords = settled.filter((record) => record.aiProbabilityUp !== null && record.outcome !== "VOID");
  const meanBrier = brierRecords.length
    ? brierRecords.reduce((sum, record) => {
        const probability = (record.aiProbabilityUp ?? 50) / 100;
        const observed = record.outcome === "UP" ? 1 : 0;
        return sum + (probability - observed) ** 2;
      }, 0) / brierRecords.length
    : null;
  const modelPerformance = useMemo(() => {
    const providers = new Map<string, ForecastLedgerRecord[]>();
    verifiedRecords.forEach((record) => {
      providers.set(record.provider, [...(providers.get(record.provider) ?? []), record]);
    });

    return [...providers.entries()].map(([provider, providerRecords]) => {
      const providerSettled = providerRecords.filter((record) => record.status === "settled" && record.outcome && record.outcome !== "VOID");
      const tradeCalls = providerSettled.filter((record) => record.action !== "WAIT");
      const wins = tradeCalls.filter((record) =>
        (record.action === "BUY_UP" && record.outcome === "UP") ||
        (record.action === "BUY_DOWN" && record.outcome === "DOWN"),
      ).length;
      const providerBrier = providerSettled.filter((record) => record.aiProbabilityUp !== null);
      const brier = providerBrier.length
        ? providerBrier.reduce((sum, record) => {
            const probability = (record.aiProbabilityUp ?? 50) / 100;
            return sum + (probability - (record.outcome === "UP" ? 1 : 0)) ** 2;
          }, 0) / providerBrier.length
        : null;
      const edgeRecords = providerRecords.filter((record) => record.edgePercent !== null);
      const edge = edgeRecords.length
        ? edgeRecords.reduce((sum, record) => sum + Math.abs(record.edgePercent ?? 0), 0) / edgeRecords.length
        : null;

      return {
        provider,
        forecasts: providerRecords.length,
        forwardTests: providerRecords.filter((record) => record.status === "forward_testing").length,
        settled: providerSettled.length,
        accuracy: tradeCalls.length ? wins / tradeCalls.length : null,
        calls: tradeCalls.length,
        brier,
        edge,
      };
    }).sort((a, b) => {
      if (a.settled !== b.settled) return b.settled - a.settled;
      if (a.brier !== null && b.brier !== null && a.brier !== b.brier) return a.brier - b.brier;
      return b.forecasts - a.forecasts;
    });
  }, [verifiedRecords]);
  const visibleRecords = providerFilter === "all"
    ? records
    : records.filter((record) => record.provider === providerFilter);

  return (
    <section className="edge-tracker" aria-label="AI forecast performance">
      <header>
        <div><span>Forward-tested intelligence</span><h2>AI Edge Tracker</h2><p>Every report is timestamped against the DreamDEX price visible at analysis time. Accuracy appears only after a verifiable settlement.</p></div>
        <em>{settled.length ? `${settled.length} settled` : "Building evidence"}</em>
      </header>
      <div className="edge-scoreboard">
        <article><span>Forecasts recorded</span><b>{records.length}</b><small>{simulatedRecords.length ? `${simulatedRecords.length} Test Arena · ${verifiedRecords.length} on-chain` : "Stored on this device"}</small></article>
        <article><span>Forward tests</span><b>{forwardTests.length}</b><small>Awaiting settlement</small></article>
        <article><span>Mean model divergence</span><b>{averageEdge === null ? "—" : `${averageEdge.toFixed(1)} pts`}</b><small>AI probability vs DreamDEX</small></article>
        <article><span>Verified accuracy</span><b>{directionalCalls.length ? `${Math.round((directionalWins / directionalCalls.length) * 100)}%` : "Pending"}</b><small>{directionalCalls.length ? `${directionalWins}/${directionalCalls.length} trade calls` : "On-chain outcomes only"}</small></article>
        <article><span>Brier score</span><b>{meanBrier === null ? "Pending" : meanBrier.toFixed(3)}</b><small>Lower is better · settlement verified</small></article>
      </div>
      {modelPerformance.length ? <section className="model-leaderboard" aria-label="Model performance leaderboard">
        <div className="model-leaderboard-head">
          <div><span>Settlement-verified benchmark</span><h3>Model leaderboard</h3></div>
          <small>Accuracy and Brier score unlock only after DreamDEX settlement.</small>
        </div>
        <div className="model-performance-list">
          {modelPerformance.map((model, index) => <button
            className={providerFilter === model.provider ? "model-performance-row active" : "model-performance-row"}
            type="button"
            key={model.provider}
            onClick={() => setProviderFilter(providerFilter === model.provider ? "all" : model.provider)}
            aria-pressed={providerFilter === model.provider}
          >
            <span className="model-rank">{model.settled ? String(index + 1).padStart(2, "0") : "—"}</span>
            <span className="model-name"><b>{model.provider}</b><small>{model.settled ? `${model.settled} settled · ${model.calls} trade calls` : `${model.forwardTests} forward tests`}</small></span>
            <span><small>Accuracy</small><b>{model.accuracy === null ? "Pending" : `${Math.round(model.accuracy * 100)}%`}</b></span>
            <span><small>Brier</small><b>{model.brier === null ? "Pending" : model.brier.toFixed(3)}</b></span>
            <span><small>Avg divergence</small><b>{model.edge === null ? "—" : `${model.edge.toFixed(1)} pts`}</b></span>
            <em>{model.settled ? "Verified" : "Forward testing"}</em>
          </button>)}
        </div>
      </section> : null}
      {records.length ? <div className="edge-history-head">
        <div><b>Forecast history</b><span>{providerFilter === "all" ? "All models" : providerFilter}</span></div>
        {providerFilter !== "all" ? <button type="button" onClick={() => setProviderFilter("all")}>Clear filter</button> : null}
      </div> : null}
      {records.length ? <div className="edge-table" role="table" aria-label="Recent AI forecasts">
        <div className="edge-row edge-head" role="row"><span>Market</span><span>Model</span><span>Call</span><span>AI / DreamDEX</span><span>Edge</span><span>Status</span></div>
        {visibleRecords.slice(0, 5).map((record) => <div className="edge-row" role="row" key={record.id}>
          <span><b>{record.asset} · {record.horizon}</b><small>{new Date(record.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</small></span>
          <span>{record.provider}</span>
          <span className={record.action === "BUY_UP" ? "up" : record.action === "BUY_DOWN" ? "down" : "wait"}>{record.action === "BUY_UP" ? "UP" : record.action === "BUY_DOWN" ? "DOWN" : "WAIT"}</span>
          <span>{record.aiProbabilityUp === null ? "—" : `${record.aiProbabilityUp.toFixed(0)}%`} / {record.dreamdexProbabilityUp === null ? "—" : `${record.dreamdexProbabilityUp.toFixed(1)}%`}</span>
          <span>{formatEdge(record.edgePercent)}</span>
          <span><i className={record.status} />{record.verification === "eventra-simulation" ? record.status === "forward_testing" ? "Test Arena · pending" : `Simulated · ${record.outcome}` : record.status === "forward_testing" ? "Forward test" : record.status === "void" ? "Void" : `Settled · ${record.outcome}`}</span>
        </div>)}
        {!visibleRecords.length ? <div className="edge-filter-empty">No forecasts from this model yet.</div> : null}
      </div> : <div className="edge-empty"><b>No forecasts recorded yet</b><span>Run the Judge Demo or analyze a live market to start a transparent performance history.</span></div>}
    </section>
  );
}
