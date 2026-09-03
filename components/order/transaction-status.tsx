"use client";
import { explorerTxUrl, type PlaceOrderOutcome, type PlaceOrderPhase } from "@/lib/dreamdex/trading";
const PHASE_LABEL: Record<PlaceOrderPhase, string> = {
  idle: "Not submitted", revalidating: "Revalidating draft…", approval_pending: "Waiting for wallet approval…",
  order_pending: "Waiting for placeOrder signature…", filled: "Filled", partial_fill: "Partially filled",
  resting: "Resting", rejected: "Rejected / error", reverted: "Reverted",
};
export function TransactionStatus({ phase, outcome }: { phase: PlaceOrderPhase; outcome: PlaceOrderOutcome | null }) {
  if (phase === "idle" && !outcome) return null;
  if (phase === "filled" || phase === "partial_fill" || phase === "resting") return null;
  const isError = phase === "rejected" || phase === "reverted";
  const isLate = outcome?.errorName === "SubmittedTooLate" || outcome?.errorName === "MarketClosed";
  return (
    <div className={`tx-status ${isLate ? "late" : isError ? "error" : ""}`}>
      <div className="tx-status-head"><b>{isLate ? "Market closed safely" : PHASE_LABEL[phase]}</b>
        {outcome?.hash ? <a href={explorerTxUrl(outcome.hash)} target="_blank" rel="noreferrer">Explorer ↗</a> : null}
      </div>
      {outcome?.errorMessageVi ? <p className="preview-error">{outcome.errorMessageVi}</p> : null}
      {isError && !isLate ? <small className="tx-safe-note">Your portfolio updates only after an on-chain confirmation.</small> : null}
    </div>
  );
}
