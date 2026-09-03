"use client";
import type { UserPositionRow } from "@/lib/dreamdex/positions";
export function RedeemCard({ row, disabled, busy, onRedeem }: {
  row: UserPositionRow; disabled?: boolean; busy?: boolean; onRedeem: (outcomeIdx: 0 | 1, amount: bigint) => void;
}) {
  if (!row.claimable) return <button type="button" disabled>Not claimable</button>;
  const yes = BigInt(row.yesRaw || "0"); const no = BigInt(row.noRaw || "0");
  const canRedeemYes = yes > 0n && (row.status === "voided" || row.winningOutcome === 0);
  const canRedeemNo = no > 0n && (row.status === "voided" || row.winningOutcome === 1);
  if (!canRedeemYes && !canRedeemNo) return <span className="portfolio-loss">Settled · no redeemable payout</span>;
  return (
    <div className="redeem-actions">
      {canRedeemYes ? <button type="button" disabled={disabled || busy} onClick={() => onRedeem(0, yes)}>{busy ? "…" : "Redeem UP"}</button> : null}
      {canRedeemNo ? <button type="button" disabled={disabled || busy} onClick={() => onRedeem(1, no)}>{busy ? "…" : "Redeem DOWN"}</button> : null}
    </div>
  );
}
