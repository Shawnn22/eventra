import { NextResponse } from "next/server";
import { isAddress, isHex, type Address, type Hex } from "viem";
import { createSomniaPublicClient } from "@/lib/wallet/browser-wallet";
import {
  DREAM_PILOT_GUARD_ADDRESS,
  FORECAST_REGISTRY_ADDRESS,
  dreamPilotGuardAbi,
  forecastRegistryAbi,
} from "@/lib/guard/contracts";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const accountValue = params.get("account");
  const marketValue = params.get("marketId");
  const txValue = params.get("txHash");
  const account = accountValue && isAddress(accountValue) ? accountValue as Address : null;
  const marketId = marketValue && isHex(marketValue) && marketValue.length === 66 ? marketValue as Hex : null;
  const txHash = txValue && isHex(txValue) && txValue.length === 66 ? txValue as Hex : null;
  const client = createSomniaPublicClient();

  try {
    const [guardCode, registryCode, owner, signer, policy, marketAllowed, receipt] = await Promise.all([
      client.getBytecode({ address: DREAM_PILOT_GUARD_ADDRESS }),
      client.getBytecode({ address: FORECAST_REGISTRY_ADDRESS }),
      client.readContract({ address: DREAM_PILOT_GUARD_ADDRESS, abi: dreamPilotGuardAbi, functionName: "owner" }),
      account
        ? client.readContract({ address: FORECAST_REGISTRY_ADDRESS, abi: forecastRegistryAbi, functionName: "forecastSigners", args: [account] })
        : Promise.resolve(false),
      account
        ? client.readContract({ address: DREAM_PILOT_GUARD_ADDRESS, abi: dreamPilotGuardAbi, functionName: "policies", args: [account] })
        : Promise.resolve(null),
      account && marketId
        ? client.readContract({ address: DREAM_PILOT_GUARD_ADDRESS, abi: dreamPilotGuardAbi, functionName: "marketAllowed", args: [account, marketId] })
        : Promise.resolve(false),
      txHash ? client.getTransactionReceipt({ hash: txHash }).catch(() => null) : Promise.resolve(null),
    ]);

    return NextResponse.json({
      contractsLive: Boolean(guardCode && guardCode !== "0x" && registryCode && registryCode !== "0x"),
      owner,
      authorizedSigner: signer,
      policyActive: policy?.[6] ?? false,
      marketEnabled: marketAllowed,
      receiptStatus: receipt?.status ?? "pending",
    });
  } catch (error) {
    console.error("DreamPilot contract status read failed", error);
    return NextResponse.json({ contractsLive: false, error: "Unable to verify DreamPilot contracts on Somnia." }, { status: 502 });
  }
}
