"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Address, Hex, WalletClient } from "viem";
import { fetchUserPositions, type UserPositionRow } from "@/lib/dreamdex/positions";
import { redeemPosition } from "@/lib/dreamdex/settlement";

export function useUserPositions(account: Address | null) {
  const [positions, setPositions] = useState<UserPositionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [redeemingId, setRedeemingId] = useState<string | null>(null);
  const [lastRedeemHash, setLastRedeemHash] = useState<string | null>(null);
  const accountRef = useRef(account); accountRef.current = account;

  const refresh = useCallback(async () => {
    const acc = accountRef.current;
    if (!acc) { setPositions([]); return; }
    setLoading(true); setError(null);
    try { setPositions(await fetchUserPositions(acc)); }
    catch (err) { setError(err instanceof Error ? err.message : "Không tải positions."); setPositions([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void refresh();
    if (!account) return;
    const timer = window.setInterval(() => void refresh(), 6_000);
    return () => window.clearInterval(timer);
  }, [account, refresh]);

  const redeem = useCallback(async (walletClient: WalletClient, row: UserPositionRow, outcomeIdx: 0 | 1, amount: bigint) => {
    if (redeemingId) return { ok: false as const, errorMessageVi: "Đang redeem vị thế khác." };
    if (!row.claimable) return { ok: false as const, errorMessageVi: "Market chưa claimable." };
    setRedeemingId(row.id); setLastRedeemHash(null);
    try {
      const result = await redeemPosition({ walletClient, marketId: row.marketId as Hex, outcomeIdx, amount });
      if (result.ok && result.hash) { setLastRedeemHash(result.hash); await refresh(); }
      return result;
    } finally { setRedeemingId(null); }
  }, [redeemingId, refresh]);

  return { positions, loading, error, refresh, redeem, redeemingId, lastRedeemHash };
}
