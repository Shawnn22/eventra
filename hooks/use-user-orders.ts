"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Address, WalletClient } from "viem";
import { cancelUserOrder, fetchUserOpenOrders, type OpenOrderRow } from "@/lib/dreamdex/open-orders";

export function useUserOrders(account: Address | null) {
  const [orders, setOrders] = useState<OpenOrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [lastCancelHash, setLastCancelHash] = useState<string | null>(null);
  const accountRef = useRef(account); accountRef.current = account;

  const refresh = useCallback(async () => {
    const acc = accountRef.current;
    if (!acc) { setOrders([]); setError(null); return; }
    setLoading(true); setError(null);
    try { setOrders(await fetchUserOpenOrders(acc)); }
    catch (err) { setError(err instanceof Error ? err.message : "Không tải open orders."); setOrders([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [account, refresh]);

  const cancel = useCallback(async (walletClient: WalletClient, order: OpenOrderRow) => {
    if (cancellingId) return { ok: false as const, errorMessageVi: "Đang hủy lệnh khác." };
    setCancellingId(order.id); setLastCancelHash(null);
    try {
      const result = await cancelUserOrder({ walletClient, pool: order.pool as Address, orderId: order.orderId });
      if (result.ok && result.hash) { setLastCancelHash(result.hash); await refresh(); }
      return result;
    } finally { setCancellingId(null); }
  }, [cancellingId, refresh]);

  return { orders, loading, error, refresh, cancel, cancellingId, lastCancelHash };
}
