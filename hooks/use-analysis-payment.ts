"use client";

import { useCallback, useState } from "react";
import {
  decodeEventLog,
  keccak256,
  toBytes,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import {
  EVENTRA_ANALYSIS_ESCROW_ADDRESS,
  EVENTRA_ANALYSIS_TOKEN_ADDRESS,
  analysisModelKey,
  analysisPaymentTokenAbi,
  eventraAnalysisEscrowAbi,
} from "@/lib/eventra/analysis-escrow";
import { createSomniaPublicClient } from "@/lib/wallet/browser-wallet";

type PaymentPhase =
  | "idle"
  | "checking_allowance"
  | "approving"
  | "requesting"
  | "pending_report"
  | "refunding"
  | "refunded"
  | "error";

type StartAnalysisInput = {
  walletClient: WalletClient;
  account: Address;
  modelId: string;
  feeRaw: bigint;
  requestPayload: unknown;
  ttlSeconds?: number;
};

export function useAnalysisPayment() {
  const [phase, setPhase] = useState<PaymentPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transactionHash, setTransactionHash] = useState<Hex | null>(null);
  const [requestId, setRequestId] = useState<Hex | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setTransactionHash(null);
    setRequestId(null);
    setExpiresAt(null);
  }, []);

  const start = useCallback(async ({
    walletClient,
    account,
    modelId,
    feeRaw,
    requestPayload,
    ttlSeconds = 15 * 60,
  }: StartAnalysisInput) => {
    const publicClient = createSomniaPublicClient();
    setError(null);

    try {
      if (feeRaw > 0n) {
        setPhase("checking_allowance");
        const allowance = await publicClient.readContract({
          address: EVENTRA_ANALYSIS_TOKEN_ADDRESS,
          abi: analysisPaymentTokenAbi,
          functionName: "allowance",
          args: [account, EVENTRA_ANALYSIS_ESCROW_ADDRESS],
        });

        if (allowance < feeRaw) {
          setPhase("approving");
          const approvalHash = await walletClient.writeContract({
            account,
            chain: walletClient.chain,
            address: EVENTRA_ANALYSIS_TOKEN_ADDRESS,
            abi: analysisPaymentTokenAbi,
            functionName: "approve",
            args: [EVENTRA_ANALYSIS_ESCROW_ADDRESS, feeRaw],
          });
          await publicClient.waitForTransactionReceipt({ hash: approvalHash });
        }
      }

      setPhase("requesting");
      const expiry = Math.floor(Date.now() / 1000) + Math.min(Math.max(ttlSeconds, 60), 86_400);
      const requestHash = keccak256(toBytes(JSON.stringify(requestPayload)));
      const hash = await walletClient.writeContract({
        account,
        chain: walletClient.chain,
        address: EVENTRA_ANALYSIS_ESCROW_ADDRESS,
        abi: eventraAnalysisEscrowAbi,
        functionName: "requestAnalysis",
        args: [analysisModelKey(modelId), requestHash, BigInt(expiry)],
      });
      setTransactionHash(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Analysis request reverted on Somnia.");

      const requestedLog = receipt.logs.map((log) => {
        try {
          return decodeEventLog({ abi: eventraAnalysisEscrowAbi, data: log.data, topics: log.topics });
        } catch {
          return null;
        }
      }).find((log) => log?.eventName === "AnalysisRequested");

      if (!requestedLog || requestedLog.eventName !== "AnalysisRequested") {
        throw new Error("AnalysisRequested event was not found in the receipt.");
      }

      setRequestId(requestedLog.args.requestId);
      setExpiresAt(expiry);
      setPhase("pending_report");
      return { hash, requestId: requestedLog.args.requestId, expiresAt: expiry, requestHash };
    } catch (cause) {
      setPhase("error");
      const message = cause instanceof Error ? cause.message : "Unable to create the analysis request.";
      setError(message);
      throw cause;
    }
  }, []);

  const claimExpiredRefund = useCallback(async (walletClient: WalletClient, account: Address) => {
    if (!requestId) throw new Error("No analysis request is available for refund.");
    setPhase("refunding");
    setError(null);
    try {
      const hash = await walletClient.writeContract({
        account,
        chain: walletClient.chain,
        address: EVENTRA_ANALYSIS_ESCROW_ADDRESS,
        abi: eventraAnalysisEscrowAbi,
        functionName: "claimExpiredRefund",
        args: [requestId],
      });
      const receipt = await createSomniaPublicClient().waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Refund reverted on Somnia.");
      setTransactionHash(hash);
      setPhase("refunded");
      return hash;
    } catch (cause) {
      setPhase("error");
      setError(cause instanceof Error ? cause.message : "Unable to claim the refund.");
      throw cause;
    }
  }, [requestId]);

  return { phase, error, transactionHash, requestId, expiresAt, start, claimExpiredRefund, reset };
}
