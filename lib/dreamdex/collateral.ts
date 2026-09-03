import { createPublicClient, http, maxUint256, type Address, type PublicClient, type WalletClient } from "viem";
import { DREAMDEX_BROWSER } from "@/lib/dreamdex/config";
import { BINARY_DECIMALS } from "@/lib/trading/order-schema";

const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

const faucetAbi = [{ type: "function", name: "faucet", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] }] as const;
const approvalAbi = [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] }] as const;

let publicClient: PublicClient | null = null;
function client(): PublicClient {
  if (!publicClient) publicClient = createPublicClient({ chain: DREAMDEX_BROWSER.chain, transport: http(DREAMDEX_BROWSER.httpRpcUrl) });
  return publicClient;
}
const withGasBuffer = (gas: bigint) => (gas * 120n) / 100n;

export type CollateralReadiness = {
  balanceRaw: bigint; allowanceRaw: bigint; decimals: number;
  balanceUsd: number; allowanceUsd: number; hasBalance: boolean; hasAllowance: boolean;
  collateral: Address; pool: Address;
};

export async function readCollateralReadiness(params: {
  account: Address; pool: Address; maxCollateralRaw: bigint; collateral?: Address;
}): Promise<CollateralReadiness> {
  const token = (params.collateral ?? DREAMDEX_BROWSER.collateral) as Address;
  const c = client();
  const [balanceRaw, allowanceRaw, decimalsRaw] = await Promise.all([
    c.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [params.account] }),
    c.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [params.account, params.pool] }),
    c.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }).catch(() => BINARY_DECIMALS),
  ]);
  const decimals = Number(decimalsRaw);
  const scale = 10 ** decimals;
  return {
    balanceRaw, allowanceRaw, decimals,
    balanceUsd: Number(balanceRaw) / scale, allowanceUsd: Number(allowanceRaw) / scale,
    hasBalance: balanceRaw >= params.maxCollateralRaw, hasAllowance: allowanceRaw >= params.maxCollateralRaw,
    collateral: token, pool: params.pool,
  };
}

export function formatRawUsd(raw: bigint, decimals: number = BINARY_DECIMALS): string {
  return (Number(raw) / 10 ** decimals).toFixed(4);
}

export async function requestTestCollateral(walletClient: WalletClient, account: Address, amount = 100) {
  const c = client();
  const args = [BigInt(amount) * 1_000_000n] as const;
  const gas = await c.estimateContractGas({ account, address: DREAMDEX_BROWSER.collateral, abi: faucetAbi, functionName: "faucet", args });
  const gasPrice = await c.getGasPrice();
  const hash = await walletClient.writeContract({
    account,
    address: DREAMDEX_BROWSER.collateral,
    abi: faucetAbi,
    functionName: "faucet",
    args,
    chain: DREAMDEX_BROWSER.chain,
    gas: withGasBuffer(gas), gasPrice, type: "legacy",
  });
  await c.waitForTransactionReceipt({ hash });
  return hash;
}

export async function enableOneClickOrders(walletClient: WalletClient, account: Address, pool: Address) {
  const c = client();
  const args = [pool, maxUint256] as const;
  const gas = await c.estimateContractGas({ account, address: DREAMDEX_BROWSER.collateral, abi: approvalAbi, functionName: "approve", args });
  const gasPrice = await c.getGasPrice();
  const hash = await walletClient.writeContract({ account, address: DREAMDEX_BROWSER.collateral, abi: approvalAbi, functionName: "approve", args, chain: DREAMDEX_BROWSER.chain, gas: withGasBuffer(gas), gasPrice, type: "legacy" });
  await c.waitForTransactionReceipt({ hash });
  return hash;
}
