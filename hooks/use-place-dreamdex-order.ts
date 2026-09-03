"use client";
import { useCallback, useRef, useState } from "react";
import type { WalletClient } from "viem";
import { placeDreamDexOrder, type PlaceOrderOutcome, type PlaceOrderPhase } from "@/lib/dreamdex/trading";
import type { ValidatedOrderDraft } from "@/lib/trading/order-schema";

export function usePlaceDreamDexOrder() {
  const [phase, setPhase] = useState<PlaceOrderPhase>("idle");
  const [outcome, setOutcome] = useState<PlaceOrderOutcome | null>(null);
  const busyRef = useRef(false);

  const reset = useCallback(() => {
    if (busyRef.current) return;
    setPhase("idle"); setOutcome(null);
  }, []);

  const place = useCallback(async (args: {
    draft: ValidatedOrderDraft; walletClient: WalletClient; marketExpiryIso?: string; minutesRemaining?: number;
  }) => {
    if (busyRef.current) return { phase: "rejected" as const, fills: [], errorName: "Busy", errorMessageVi: "Đang xử lý giao dịch trước đó." };
    busyRef.current = true; setOutcome(null); setPhase("revalidating");
    try {
      const result = await placeDreamDexOrder({ ...args, autoApprove: true }, (p) => setPhase(p));
      setPhase(result.phase); setOutcome(result); return result;
    } finally { busyRef.current = false; }
  }, []);

  return {
    phase, outcome,
    isBusy: phase === "approval_pending" || phase === "order_pending" || phase === "revalidating",
    place, reset,
  };
}
