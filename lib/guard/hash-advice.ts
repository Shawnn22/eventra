import { hashTypedData, type Address, type Hex } from "viem";
import { adviceDomain, adviceTypes, type AdviceMessage } from "@/lib/guard/eip712";
export function hashAdvicePayload(params: { chainId: number; verifyingContract: Address; advice: AdviceMessage }): Hex {
  return hashTypedData({ domain: adviceDomain({ chainId: params.chainId, verifyingContract: params.verifyingContract }), types: adviceTypes, primaryType: "Advice", message: params.advice });
}
