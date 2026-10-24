import { SomniaMarkets } from "@somnia-chain/markets-sdk";
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains";
import { createPublicClient, createWalletClient, custom, formatUnits, http, type Address } from "viem";
import { getInjectedProvider } from "@/lib/wallet/browser-wallet";
import type { PerpsAccountSnapshot } from "./browser-account";

const HIDEKI_INDEXER = "https://hideki-dev.smk.somnia.host/v1/graphql";
const alignDown = (value: bigint, step: bigint) => step > 0n ? value / step * step : value;
const alignUp = (value: bigint, step: bigint) => step > 0n ? (value + step - 1n) / step * step : value;

export function buildPerpsClosePlan(input: {
  signedSize: bigint;
  percentage: 25 | 50 | 100;
  lotSize: bigint;
  markPrice: bigint;
  tickSize: bigint;
  slippageBps?: bigint;
}) {
  if (input.signedSize === 0n) throw new Error("This position is already closed");
  const absoluteSize = input.signedSize < 0n ? -input.signedSize : input.signedSize;
  const requested = input.percentage === 100 ? absoluteSize : absoluteSize * BigInt(input.percentage) / 100n;
  const quantity = alignDown(requested, input.lotSize);
  if (quantity < input.lotSize) throw new Error("Selected close amount is below the market minimum lot");
  const isBid = input.signedSize < 0n;
  const slippageBps = input.slippageBps ?? 75n;
  const rawPrice = isBid
    ? input.markPrice * (10_000n + slippageBps) / 10_000n
    : input.markPrice * (10_000n - slippageBps) / 10_000n;
  const price = isBid ? alignUp(rawPrice, input.tickSize) : alignDown(rawPrice, input.tickSize);
  return { isBid, quantity, price, positionSize: absoluteSize };
}

export async function closePerpsPosition(input: {
  account: Address;
  position: PerpsAccountSnapshot["positions"][number];
  percentage: 25 | 50 | 100;
  onPreflightPassed?: () => void;
}) {
  const provider = getInjectedProvider();
  if (!provider) throw new Error("No injected wallet detected");
  const chainHex = await provider.request({ method: "eth_chainId" }) as string;
  if (Number.parseInt(chainHex, 16) !== hidekiTestnet.id) throw new Error("Switch wallet to Hideki before closing a position");

  const walletClient = createWalletClient({ account: input.account, chain: hidekiTestnet, transport: custom(provider) });
  const exchange = new SomniaMarkets({ chain: hidekiTestnet, indexerUrl: HIDEKI_INDEXER, walletClient });
  try {
    const markets = await exchange.client.listPerpMarkets({ limit: 100 });
    const market = markets.find(item => item.poolAddress.toLowerCase() === input.position.poolAddress.toLowerCase());
    if (!market?.markPrice) throw new Error("DreamDEX market is unavailable; refresh positions and retry");

    const current = await exchange.client.listPerpPositions(input.account, { limit: 100 });
    const indexed = current.find(item => item.pool.toLowerCase() === input.position.poolAddress.toLowerCase());
    if (!indexed || BigInt(indexed.size) === 0n) throw new Error("This position is already closed");
    // Closing is always the opposite side and is capped at the latest indexed
    // position size, so this IOC cannot intentionally flip the account.
    const plan = buildPerpsClosePlan({
      signedSize: BigInt(indexed.size),
      percentage: input.percentage,
      lotSize: BigInt(market.lotSize),
      markPrice: BigInt(market.markPrice),
      tickSize: BigInt(market.tickSize),
    });

    const quote = await exchange.client.getMaxPerpOrderSize({
      pool: market.poolAddress,
      marginBank: market.marginBank,
      account: input.account,
      isBid: plan.isBid,
      price: plan.price,
      autoPull: false,
    });
    if (!quote.priceable) throw new Error("DreamDEX mark price is stale; refresh before closing");
    if (quote.maxQuantity < plan.quantity) {
      const executable = formatUnits(quote.maxQuantity, market.baseDecimals);
      throw new Error(`Only ${executable} ${market.baseSymbol ?? "contracts"} is executable at the current book. Choose a smaller close percentage.`);
    }

    // Build and simulate the exact SDK calldata before opening the wallet. This
    // catches stale position, margin, pool and contract reverts without gas.
    const unsigned = await exchange.trader.buildPlacePerpOrder({
      pool: input.position.poolAddress,
      isBid: plan.isBid,
      price: plan.price,
      quantity: plan.quantity,
      orderType: 2,
      selfMatchingOption: 0,
    });
    const publicClient = createPublicClient({ chain: hidekiTestnet, transport: http(hidekiTestnet.rpcUrls.default.http[0]) });
    await publicClient.call({ account: input.account, to: unsigned.order.to, data: unsigned.order.data, value: unsigned.order.value });
    input.onPreflightPassed?.();

    const result = await exchange.trader.placePerpOrder({
      pool: input.position.poolAddress,
      isBid: plan.isBid,
      price: plan.price,
      quantity: plan.quantity,
      orderType: 2,
      selfMatchingOption: 0,
    });
    if (result.receipt.status !== "success") throw new Error("Close transaction reverted on Hideki");
    return {
      hash: result.hash,
      blockNumber: result.receipt.blockNumber.toString(),
      fills: result.fills.length,
      quantity: formatUnits(plan.quantity, market.baseDecimals),
      percentage: input.percentage,
    };
  } finally {
    await exchange.close();
  }
}
