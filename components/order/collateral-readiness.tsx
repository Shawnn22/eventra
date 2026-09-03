"use client";
import { useEffect, useState } from "react";
import type { Address, WalletClient } from "viem";
import { readCollateralReadiness, enableOneClickOrders, formatRawUsd, requestTestCollateral, type CollateralReadiness } from "@/lib/dreamdex/collateral";

export function CollateralReadinessPanel({ account, walletClient, pool, maxCollateralRaw, enabled = true }: {
  account: Address | null; walletClient?: WalletClient | null; pool?: string; maxCollateralRaw?: bigint; enabled?: boolean;
}) {
  const [data, setData] = useState<CollateralReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [faucetState, setFaucetState] = useState<"idle" | "pending" | "success">("idle");
  const [approvalState, setApprovalState] = useState<"idle" | "pending" | "success">("idle");
  const loadReadiness = async () => {
    if (!account || !pool || maxCollateralRaw === undefined) return;
    const result = await readCollateralReadiness({ account, pool: pool as Address, maxCollateralRaw });
    setData(result);
  };
  useEffect(() => {
    if (!enabled || !account || !pool || maxCollateralRaw === undefined) { setData(null); return; }
    let cancelled = false;
    void readCollateralReadiness({ account, pool: pool as Address, maxCollateralRaw })
      .then((r) => { if (!cancelled) setData(r); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Balance read failed"); });
    return () => { cancelled = true; };
  }, [account, pool, maxCollateralRaw, enabled]);
  if (!enabled || !account) return null;
  return (
    <div className="collateral-panel">
      <span className="collateral-label">Collateral (TestUSDC)</span>
      {error ? <p className="preview-error">{error}</p> : null}
      {data ? (
        <><div className="collateral-grid">
          <p><span>Balance</span><strong>${data.balanceUsd.toFixed(2)} {data.hasBalance ? "✓" : "· low"}</strong></p>
          <p><span>Allowance</span><strong>${data.allowanceUsd.toFixed(2)}</strong></p>
          <p><span>Required</span><strong>${formatRawUsd(maxCollateralRaw ?? 0n, data.decimals)}</strong></p>
        </div>{!data.hasBalance ? <button className="test-collateral-button" disabled={!walletClient || faucetState === "pending"} onClick={async () => {
          if (!walletClient || !account) return;
          setError(null);
          setFaucetState("pending");
          try { await requestTestCollateral(walletClient, account); await loadReadiness(); setFaucetState("success"); }
          catch (reason) { setError(reason instanceof Error ? reason.message : "TestUSDC faucet failed"); setFaucetState("idle"); }
        }} type="button">{faucetState === "pending" ? "Confirm in wallet…" : faucetState === "success" ? "100 TestUSDC received ✓" : "Get 100 TestUSDC"}</button> : !data.hasAllowance ? <button className="test-collateral-button" disabled={!walletClient || approvalState === "pending"} onClick={async () => {
          if (!walletClient || !account || !pool) return;
          setError(null); setApprovalState("pending");
          try { await enableOneClickOrders(walletClient, account, pool as Address); await loadReadiness(); setApprovalState("success"); }
          catch (reason) { setError(reason instanceof Error ? reason.message : "Approval failed"); setApprovalState("idle"); }
        }} type="button">{approvalState === "pending" ? "Confirm once in wallet…" : approvalState === "success" ? "One-click orders enabled ✓" : "Enable one-click orders"}</button> : null}</>
      ) : null}
    </div>
  );
}
