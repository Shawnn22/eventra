import type { Address, Hex } from "viem";
export function adviceDomain(params: { chainId: number; verifyingContract: Address }) {
  return { name: "DreamPilotGuard", version: "1", chainId: params.chainId, verifyingContract: params.verifyingContract } as const;
}
export const adviceTypes = {
  Advice: [
    { name: "user", type: "address" }, { name: "marketId", type: "bytes32" },
    { name: "snapshotHash", type: "bytes32" }, { name: "modelHash", type: "bytes32" },
    { name: "action", type: "uint8" }, { name: "confidenceBps", type: "uint16" },
    { name: "stakeRaw", type: "uint128" }, { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" }, { name: "nonce", type: "uint256" },
  ],
} as const;
export type AdviceActionName = "WAIT" | "BUY_YES" | "BUY_NO";
export function adviceActionToEnum(action: AdviceActionName): number {
  if (action === "WAIT") return 0;
  if (action === "BUY_YES") return 1;
  return 2;
}
export type AdviceMessage = {
  user: Address; marketId: Hex; snapshotHash: Hex; modelHash: Hex; action: number;
  confidenceBps: number; stakeRaw: bigint; issuedAt: bigint; expiresAt: bigint; nonce: bigint;
};
