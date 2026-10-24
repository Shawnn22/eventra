import { SomniaMarkets } from "@somnia-chain/markets-sdk";
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains";
import { createPublicClient, createWalletClient, custom, erc20Abi, formatUnits, http, parseUnits, type Address } from "viem";
import type { PerpsSide } from "./risk-engine";
import { getInjectedProvider } from "@/lib/wallet/browser-wallet";

const HIDEKI_INDEXER = "https://hideki-dev.smk.somnia.host/v1/graphql";
const alignDown = (value: bigint, step: bigint) => step > 0n ? value / step * step : value;
const alignUp = (value: bigint, step: bigint) => step > 0n ? (value + step - 1n) / step * step : value;

export type PerpsPreflight = {
  placeable: boolean;
  reason: string | null;
  market: string;
  poolAddress: Address;
  marginBank: Address;
  collateralToken: Address;
  crossingPriceRaw: string;
  crossingPrice: string;
  requestedQuantityRaw: string;
  requestedQuantity: string;
  maxQuantity: string;
  minQuantity: string;
  topUpRequired: string;
  topUpRequiredRaw: string;
  approvalAmountRaw: string;
  approvalAmount: string;
  walletBalance: string;
  walletAllowance: string;
  walletAllowanceRaw: string;
  asOfBlock: string;
};

export async function runPerpsPreflight(input: {
  account: Address;
  poolAddress: Address;
  side: PerpsSide;
  quantity: number;
}): Promise<PerpsPreflight> {
  const exchange = new SomniaMarkets({ chain: hidekiTestnet, indexerUrl: HIDEKI_INDEXER });
  try {
    const markets = await exchange.client.listPerpMarkets({ limit: 100 });
    const market = markets.find(item => item.poolAddress.toLowerCase() === input.poolAddress.toLowerCase());
    if (!market?.markPrice || !market.marginBank || !market.quoteToken) throw new Error("Market is unavailable on Hideki");

    const isBid = input.side === "LONG";
    const mark = BigInt(market.markPrice);
    const slippageBps = 50n;
    const unalignedPrice = isBid ? mark * (10_000n + slippageBps) / 10_000n : mark * (10_000n - slippageBps) / 10_000n;
    const tick = BigInt(market.tickSize);
    const crossingPrice = isBid ? alignUp(unalignedPrice, tick) : alignDown(unalignedPrice, tick);
    const quantityInput = parseUnits(input.quantity.toFixed(market.baseDecimals), market.baseDecimals);
    const requestedQuantity = alignDown(quantityInput, BigInt(market.lotSize));
    const [quote, preview] = await Promise.all([
      exchange.client.getMaxPerpOrderSize({
        pool: market.poolAddress,
        marginBank: market.marginBank,
        account: input.account,
        isBid,
        price: crossingPrice,
        autoPull: true,
      }),
      exchange.client.previewPerpOrderMargin({
        pool: market.poolAddress,
        marginBank: market.marginBank,
        account: input.account,
        isBid,
        quantity: requestedQuantity,
        price: crossingPrice,
        autoPull: true,
      }),
    ]);

    if (!quote.priceable || !preview.priceable) throw new Error("Mark price is stale; refresh before signing");
    const aboveMinimum = requestedQuantity >= quote.minQuantity;
    const withinLimit = requestedQuantity <= quote.maxQuantity;
    const walletBalance = preview.wallet?.balance ?? 0n;
    const walletAllowance = preview.wallet?.allowance ?? 0n;
    const approvalAmount = preview.topUpRequired > 0n
      ? ((preview.topUpRequired * 105n + 99n) / 100n > walletBalance ? walletBalance : (preview.topUpRequired * 105n + 99n) / 100n)
      : 0n;
    // Reject an unexecutable size before asking for token approval. Otherwise a
    // user can approve successfully and only then discover the liquidity limit.
    const reason = !aboveMinimum
      ? "below_minimum"
      : !quote.placeable || !withinLimit
        ? quote.limitedBy ?? "priceImpact"
        : !preview.walletCoversTopUp
          ? walletBalance < preview.topUpRequired ? "walletBalance" : "walletAllowance"
          : preview.topUpRequired > 0n
            ? "marginDeposit"
            : !preview.sufficient ? "marginBalance" : null;
    const placeable = reason === null;
    return {
      placeable,
      reason,
      market: `${market.baseSymbol ?? "UNKNOWN"}-PERP`,
      poolAddress: market.poolAddress,
      marginBank: market.marginBank,
      collateralToken: market.quoteToken,
      crossingPriceRaw: crossingPrice.toString(),
      crossingPrice: formatUnits(crossingPrice, market.quoteDecimals),
      requestedQuantityRaw: requestedQuantity.toString(),
      requestedQuantity: formatUnits(requestedQuantity, market.baseDecimals),
      maxQuantity: formatUnits(quote.maxQuantity, market.baseDecimals),
      minQuantity: formatUnits(quote.minQuantity, market.baseDecimals),
      topUpRequired: formatUnits(preview.topUpRequired, market.quoteDecimals),
      topUpRequiredRaw: preview.topUpRequired.toString(),
      approvalAmountRaw: approvalAmount.toString(),
      approvalAmount: formatUnits(approvalAmount, market.quoteDecimals),
      walletBalance: formatUnits(walletBalance, market.quoteDecimals),
      walletAllowance: formatUnits(walletAllowance, market.quoteDecimals),
      walletAllowanceRaw: walletAllowance.toString(),
      asOfBlock: preview.asOfBlock.toString(),
    };
  } finally {
    await exchange.close();
  }
}

export async function depositPerpsMargin(input: {
  account: Address;
  preflight: PerpsPreflight;
}) {
  if (input.preflight.reason !== "marginDeposit") throw new Error("Margin deposit is not required for this order");
  const required = BigInt(input.preflight.topUpRequiredRaw);
  const allowance = BigInt(input.preflight.walletAllowanceRaw);
  const buffered = BigInt(input.preflight.approvalAmountRaw);
  const amount = buffered < allowance ? buffered : allowance;
  if (required <= 0n || amount < required) throw new Error("Approved USDso is below the required margin deposit; refresh the quote");
  const provider = getInjectedProvider();
  if (!provider) throw new Error("No injected wallet detected");
  const chainHex = await provider.request({ method: "eth_chainId" }) as string;
  if (Number.parseInt(chainHex, 16) !== hidekiTestnet.id) throw new Error("Switch wallet to Hideki before depositing margin");
  const walletClient = createWalletClient({ account: input.account, chain: hidekiTestnet, transport: custom(provider) });
  const exchange = new SomniaMarkets({ chain: hidekiTestnet, indexerUrl: HIDEKI_INDEXER, walletClient });
  try {
    const result = await exchange.trader.depositMargin({
      marginBank: input.preflight.marginBank,
      collateral: input.preflight.collateralToken,
      amount,
      autoApprove: false,
    });
    if (result.receipt.status !== "success") throw new Error("Margin deposit reverted on Hideki");
    return {
      hash: result.hash,
      blockNumber: result.receipt.blockNumber.toString(),
      amountRaw: amount.toString(),
      amount: formatUnits(amount, 18),
    };
  } finally {
    await exchange.close();
  }
}

export async function approvePerpsCollateral(input: {
  account: Address;
  preflight: PerpsPreflight;
}) {
  if (input.preflight.reason !== "walletAllowance") throw new Error("Collateral approval is not required for this order");
  const amount = BigInt(input.preflight.approvalAmountRaw);
  if (amount <= 0n) throw new Error("Approval amount is unavailable; refresh the quote");
  const provider = getInjectedProvider();
  if (!provider) throw new Error("No injected wallet detected");
  const chainHex = await provider.request({ method: "eth_chainId" }) as string;
  if (Number.parseInt(chainHex, 16) !== hidekiTestnet.id) throw new Error("Switch wallet to Hideki before approving USDso");
  const walletClient = createWalletClient({ account: input.account, chain: hidekiTestnet, transport: custom(provider) });
  const publicClient = createPublicClient({ chain: hidekiTestnet, transport: http(hidekiTestnet.rpcUrls.default.http[0]) });
  const hash = await walletClient.writeContract({
    address: input.preflight.collateralToken,
    abi: erc20Abi,
    functionName: "approve",
    args: [input.preflight.marginBank, amount],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("USDso approval reverted on Hideki");
  return { hash, blockNumber: receipt.blockNumber.toString(), amount: input.preflight.approvalAmount };
}

export async function executePerpsOrder(input: {
  account: Address;
  side: PerpsSide;
  preflight: PerpsPreflight;
}) {
  if (!input.preflight.placeable) throw new Error("Order did not pass the latest on-chain preflight");
  const provider = getInjectedProvider();
  if (!provider) throw new Error("No injected wallet detected");
  const chainHex = await provider.request({ method: "eth_chainId" }) as string;
  if (Number.parseInt(chainHex, 16) !== hidekiTestnet.id) throw new Error("Switch wallet to Hideki before signing");

  const walletClient = createWalletClient({
    account: input.account,
    chain: hidekiTestnet,
    transport: custom(provider),
  });
  const exchange = new SomniaMarkets({
    chain: hidekiTestnet,
    indexerUrl: HIDEKI_INDEXER,
    walletClient,
  });
  try {
    const result = await exchange.trader.placePerpOrder({
      pool: input.preflight.poolAddress,
      isBid: input.side === "LONG",
      price: BigInt(input.preflight.crossingPriceRaw),
      quantity: BigInt(input.preflight.requestedQuantityRaw),
      orderType: 2,
      selfMatchingOption: 0,
    });
    return {
      hash: result.hash,
      orderId: result.orderId?.toString() ?? null,
      fills: result.fills.length,
      status: result.receipt.status,
      blockNumber: result.receipt.blockNumber.toString(),
    };
  } finally {
    await exchange.close();
  }
}
