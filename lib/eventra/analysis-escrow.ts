import { keccak256, toBytes, type Address } from "viem";

export const EVENTRA_ANALYSIS_ESCROW_ADDRESS = (
  process.env.NEXT_PUBLIC_EVENTRA_ANALYSIS_ESCROW_ADDRESS ??
  "0xc4a0e9fB3f004392c22cA4d666f8756E9e99ec8C"
) as Address;

export const EVENTRA_ANALYSIS_TOKEN_ADDRESS = (
  process.env.NEXT_PUBLIC_EVENTRA_ANALYSIS_TOKEN_ADDRESS ??
  "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E"
) as Address;

export const eventraAnalysisEscrowAbi = [
  {
    type: "function",
    name: "quote",
    stateMutability: "view",
    inputs: [{ name: "modelId", type: "bytes32" }],
    outputs: [
      { name: "feeRaw", type: "uint96" },
      { name: "enabled", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "requestAnalysis",
    stateMutability: "nonpayable",
    inputs: [
      { name: "modelId", type: "bytes32" },
      { name: "requestHash", type: "bytes32" },
      { name: "expiresAt", type: "uint64" },
    ],
    outputs: [{ name: "requestId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "claimExpiredRefund",
    stateMutability: "nonpayable",
    inputs: [{ name: "requestId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "event",
    name: "AnalysisRequested",
    anonymous: false,
    inputs: [
      { indexed: true, name: "requestId", type: "bytes32" },
      { indexed: true, name: "user", type: "address" },
      { indexed: true, name: "modelId", type: "bytes32" },
      { indexed: false, name: "requestHash", type: "bytes32" },
      { indexed: false, name: "feeRaw", type: "uint96" },
      { indexed: false, name: "expiresAt", type: "uint64" },
    ],
  },
] as const;

export const analysisPaymentTokenAbi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export function analysisModelKey(modelId: string) {
  return keccak256(toBytes(modelId === "local" ? "eventra-core" : modelId));
}

export function formatAnalysisFee(feeRaw: bigint) {
  return Number(feeRaw) / 1_000_000;
}
