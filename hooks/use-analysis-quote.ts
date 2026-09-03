"use client";

import { useEffect, useState } from "react";
import { createSomniaPublicClient } from "@/lib/wallet/browser-wallet";
import {
  EVENTRA_ANALYSIS_ESCROW_ADDRESS,
  analysisModelKey,
  eventraAnalysisEscrowAbi,
  formatAnalysisFee,
} from "@/lib/eventra/analysis-escrow";

type AnalysisQuoteState = {
  state: "loading" | "live" | "error";
  feeRaw: bigint;
  feeUsd: number;
  enabled: boolean;
  error?: string;
};

export function useAnalysisQuote(modelId: string): AnalysisQuoteState {
  const [quote, setQuote] = useState<AnalysisQuoteState>({
    state: "loading",
    feeRaw: 0n,
    feeUsd: 0,
    enabled: false,
  });

  useEffect(() => {
    let cancelled = false;
    setQuote((current) => ({ ...current, state: "loading", error: undefined }));

    void createSomniaPublicClient()
      .readContract({
        address: EVENTRA_ANALYSIS_ESCROW_ADDRESS,
        abi: eventraAnalysisEscrowAbi,
        functionName: "quote",
        args: [analysisModelKey(modelId)],
      })
      .then(([feeRaw, enabled]) => {
        if (cancelled) return;
        setQuote({ state: "live", feeRaw, feeUsd: formatAnalysisFee(feeRaw), enabled });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setQuote({
          state: "error",
          feeRaw: 0n,
          feeUsd: 0,
          enabled: false,
          error: error instanceof Error ? error.message : "Unable to read the on-chain quote.",
        });
      });

    return () => { cancelled = true; };
  }, [modelId]);

  return quote;
}
