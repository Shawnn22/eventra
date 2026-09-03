import { keccak256, stringToHex, type Address } from "viem";
import { adviceActionToBuySide, BINARY_DECIMALS, DEFAULT_SLIPPAGE_BPS, QUOTE_TTL_MS, type OrderDraftResult, type ValidatedOrderDraft } from "@/lib/trading/order-schema";
import { availableLiquidityUpTo, bestAsk, collateralFromRiskBudget, collateralFromUsd, limitPriceWithSlippage, potentialPayoutRaw, priceToProbabilityPercent, sizeBuyFromCollateral, type BinaryBookSnapshot } from "@/lib/trading/order-math";
import { SOMNIA_CHAIN_ID } from "@/lib/chain/somnia";
import { isAllowedDreamDexPool } from "@/lib/dreamdex/config";

export type BuildOrderDraftInput = {
  account: Address | null; chainId: number | null; marketId: string; venueId: string; pool: string;
  action: "BUY_UP" | "BUY_DOWN" | "WAIT"; riskBudgetUsd: number; suggestedMaxStakePercent: number;
  maxSpendUsd?: number;
  minutesRemaining: number; book: BinaryBookSnapshot | null; slippageBps?: number; advicePayload?: unknown;
  quoteTtlMs?: number; minQuantityRaw?: bigint;
};

export function buildOrderDraft(input: BuildOrderDraftInput): OrderDraftResult {
  const side = adviceActionToBuySide(input.action);
  if (!side) return { ok: false, reason: "WAIT", message: "AI recommends WAIT — no order draft created." };
  if (!input.account) return { ok: false, reason: "NO_WALLET", message: "Connect a wallet first." };
  if (input.chainId !== SOMNIA_CHAIN_ID) return { ok: false, reason: "WRONG_CHAIN", message: "Wrong network — chain 50312 required." };
  if (input.minutesRemaining <= 0) return { ok: false, reason: "EXPIRED_MARKET", message: "This market has expired." };
  if (!input.book) return { ok: false, reason: "MISSING_PRICE", message: "Live orderbook unavailable." };
  const age = Date.now() - input.book.fetchedAt;
  const ttl = input.quoteTtlMs ?? QUOTE_TTL_MS;
  if (age > ttl) return { ok: false, reason: "STALE_QUOTE", message: "Quote expired. Refresh before signing." };
  const ask = bestAsk(input.book, side);
  if (!ask) return { ok: false, reason: "NO_LIQUIDITY", message: "No ask-side liquidity." };
  const slippageBps = input.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  const oneBase = 10n ** BigInt(input.book.decimals ?? BINARY_DECIMALS);
  const maxSidePriceRaw = limitPriceWithSlippage(ask.price, slippageBps, oneBase, input.book.tickSize);
  // BinaryPool always expects the YES-side price, including BUY_NO orders.
  const limitPriceRaw = side === "BUY_YES" ? maxSidePriceRaw : oneBase - maxSidePriceRaw;
  const collateralCap = input.maxSpendUsd === undefined
    ? collateralFromRiskBudget(input.riskBudgetUsd, input.suggestedMaxStakePercent, input.book.decimals)
    : collateralFromUsd(input.maxSpendUsd, input.book.decimals);
  if (collateralCap <= 0n) return { ok: false, reason: "EXCEEDS_RISK_BUDGET", message: "Risk budget is too low." };
  const { quantityRaw, maxEscrowRaw } = sizeBuyFromCollateral(collateralCap, maxSidePriceRaw, input.book.decimals, input.book.lotSize);
  const minimumQuantity = input.minQuantityRaw ?? input.book.minQuantity;
  if (quantityRaw < minimumQuantity) return { ok: false, reason: "BELOW_MIN_SIZE", message: "Order size is below the pool minimum." };
  if (!/^0x[a-fA-F0-9]{40}$/.test(input.pool)) return { ok: false, reason: "INVALID_INPUT", message: "Invalid pool address." };
  if (!isAllowedDreamDexPool(input.pool)) return { ok: false, reason: "INVALID_INPUT", message: "Pool is not on-chain verified; live trading is safety locked." };
  const askLevels = side === "BUY_YES" ? input.book.yesAsks : input.book.noAsks;
  const available = availableLiquidityUpTo(askLevels, maxSidePriceRaw);
  const adviceHash = (input.advicePayload
    ? keccak256(stringToHex(JSON.stringify(input.advicePayload)))
    : ("0x" + "00".repeat(32))) as `0x${string}`;
  const decimals = input.book.decimals ?? BINARY_DECIMALS;
  const scale = 10 ** decimals;
  const draft: ValidatedOrderDraft = {
    account: input.account, chainId: 50312,
    marketId: (input.marketId.startsWith("0x") ? input.marketId : `0x${input.marketId}`) as `0x${string}`,
    venueId: (input.venueId.startsWith("0x") ? input.venueId : `0x${input.venueId}`) as `0x${string}`,
    pool: input.pool as `0x${string}`, side, limitPriceRaw, maxSidePriceRaw, quantityRaw, maxCollateralRaw: maxEscrowRaw,
    slippageBps, quoteBlock: input.book.blockNumber ?? 0n, quoteExpiresAt: input.book.fetchedAt + ttl, adviceHash,
    display: {
      sideLabel: side === "BUY_YES" ? "UP" : "DOWN",
      limitProbability: priceToProbabilityPercent(maxSidePriceRaw, decimals),
      maxSpendUsd: Number(maxEscrowRaw) / scale,
      potentialPayoutUsd: Number(potentialPayoutRaw(quantityRaw)) / scale,
      bestAskProbability: priceToProbabilityPercent(ask.price, decimals),
      availableLiquidityRaw: available,
    },
  };
  return { ok: true, draft };
}
