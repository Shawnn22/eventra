import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { somniaShannonTestnet } from "@/lib/chain/somnia";
import { BINARY_DECIMALS, ONE_BASE } from "@/lib/trading/order-schema";
import type { BinaryBookSnapshot, BookLevel } from "@/lib/trading/order-math";

const getBookLevelsAbi = [{
  type: "function", name: "getBookLevels", stateMutability: "view",
  inputs: [{ name: "isBid", type: "bool" }, { name: "numLevels", type: "uint64" }],
  outputs: [{ name: "levels", type: "tuple[]", components: [
    { name: "price", type: "uint256" }, { name: "quantity", type: "uint256" },
  ]}],
}] as const;

const orderBookParametersAbi = [{
  type: "function", name: "getOrderBookParameters", stateMutability: "view",
  inputs: [], outputs: [{ name: "parameters", type: "tuple", components: [
    { name: "tickSize", type: "uint256" }, { name: "minQuantity", type: "uint256" }, { name: "lotSize", type: "uint256" },
  ]}],
}] as const;

let sharedPublicClient: PublicClient | null = null;
function getPublicClient(): PublicClient {
  if (!sharedPublicClient) {
    sharedPublicClient = createPublicClient({
      chain: somniaShannonTestnet,
      transport: http(somniaShannonTestnet.rpcUrls.default.http[0]),
    });
  }
  return sharedPublicClient;
}

function normalizeLevels(raw: readonly { price: bigint; quantity: bigint }[]): BookLevel[] {
  return raw.filter((l) => l.price > 0n && l.quantity > 0n).map((l) => ({ price: l.price, quantity: l.quantity }));
}

export function toBinaryBook(yesBids: BookLevel[], yesAsks: BookLevel[], oneBase: bigint = ONE_BASE) {
  const noBids = yesAsks.map((l) => ({ price: oneBase - l.price, quantity: l.quantity })).filter((l) => l.price > 0n)
    .sort((a, b) => (a.price > b.price ? -1 : 1));
  const noAsks = yesBids.map((l) => ({ price: oneBase - l.price, quantity: l.quantity })).filter((l) => l.price > 0n)
    .sort((a, b) => (a.price > b.price ? 1 : -1));
  return {
    yesBids: [...yesBids].sort((a, b) => (a.price > b.price ? -1 : 1)),
    yesAsks: [...yesAsks].sort((a, b) => (a.price > b.price ? 1 : -1)),
    noBids, noAsks,
  };
}

export async function fetchBinaryOrderBook(
  pool: Address,
  opts?: { depth?: number; decimals?: number; client?: PublicClient },
): Promise<BinaryBookSnapshot> {
  const client = opts?.client ?? getPublicClient();
  const depth = BigInt(opts?.depth ?? 10);
  const decimals = opts?.decimals ?? BINARY_DECIMALS;
  const oneBase = 10n ** BigInt(decimals);
  const [rawBids, rawAsks, blockNumber, parameters] = await Promise.all([
    client.readContract({ address: pool, abi: getBookLevelsAbi, functionName: "getBookLevels", args: [true, depth] }),
    client.readContract({ address: pool, abi: getBookLevelsAbi, functionName: "getBookLevels", args: [false, depth] }),
    client.getBlockNumber(),
    client.readContract({ address: pool, abi: orderBookParametersAbi, functionName: "getOrderBookParameters" }),
  ]);
  const yesBids = normalizeLevels(rawBids as { price: bigint; quantity: bigint }[]);
  const yesAsks = normalizeLevels(rawAsks as { price: bigint; quantity: bigint }[]);
  return {
    ...toBinaryBook(yesBids, yesAsks, oneBase), decimals, fetchedAt: Date.now(), blockNumber,
    tickSize: parameters.tickSize,
    minQuantity: parameters.minQuantity,
    lotSize: parameters.lotSize,
  };
}
