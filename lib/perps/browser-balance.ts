import { BridgeToken, getBridgeToken, hidekiTestnet } from "@somnia-chain/markets-sdk/chains";
import { createPublicClient, erc20Abi, formatEther, formatUnits, http, type Address } from "viem";

export type PerpsWalletBalance = {
  usdso: string;
  native: string;
  blockNumber: string;
};

export async function readPerpsWalletBalance(account: Address): Promise<PerpsWalletBalance> {
  const usdso = getBridgeToken(BridgeToken.USDso, hidekiTestnet.id);
  if (!usdso) throw new Error("USDso is not configured on Hideki");
  const client = createPublicClient({ chain: hidekiTestnet, transport: http(hidekiTestnet.rpcUrls.default.http[0]) });
  const [tokenBalance, nativeBalance, blockNumber] = await Promise.all([
    client.readContract({ address: usdso.address as Address, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
    client.getBalance({ address: account }),
    client.getBlockNumber(),
  ]);
  return {
    usdso: formatUnits(tokenBalance, usdso.decimals),
    native: formatEther(nativeBalance),
    blockNumber: blockNumber.toString(),
  };
}
