import { BINARY_DECIMALS, ONE_BASE, type BinaryBuySide } from "@/lib/trading/order-schema";

export type BookLevel = { price: bigint; quantity: bigint };

export type BinaryBookSnapshot = {
  yesBids: BookLevel[];
  yesAsks: BookLevel[];
  noBids: BookLevel[];
  noAsks: BookLevel[];
  decimals: number;
  fetchedAt: number;
  blockNumber?: bigint;
  tickSize: bigint;
  minQuantity: bigint;
  lotSize: bigint;
};

export function bestAsk(book: BinaryBookSnapshot, side: BinaryBuySide): BookLevel | null {
  const levels = side === "BUY_YES" ? book.yesAsks : book.noAsks;
  if (!levels.length || levels[0].price <= 0n || levels[0].quantity <= 0n) return null;
  return levels[0];
}

export function limitPriceWithSlippage(
  bestAskPrice: bigint,
  slippageBps: number,
  oneBase: bigint = ONE_BASE,
  tickSize: bigint = 1n,
): bigint {
  if (bestAskPrice <= 0n) return 0n;
  if (slippageBps < 0) return bestAskPrice;
  const bump = (bestAskPrice * BigInt(slippageBps)) / 10_000n;
  const tick = tickSize > 0n ? tickSize : 1n;
  let limit = bestAskPrice + bump;
  // BinaryPool rejects prices that are not on its tick grid. For a buy limit,
  // round UP so the requested slippage tolerance is not accidentally reduced.
  limit = ((limit + tick - 1n) / tick) * tick;
  const maxAligned = ((oneBase - 1n) / tick) * tick;
  if (limit >= oneBase) limit = maxAligned;
  if (limit <= 0n) limit = 1n;
  return limit;
}

export function sizeBuyFromCollateral(
  collateralRaw: bigint,
  limitPriceRaw: bigint,
  decimals: number = BINARY_DECIMALS,
  lotSize: bigint = 1n,
): { quantityRaw: bigint; maxEscrowRaw: bigint } {
  if (collateralRaw <= 0n || limitPriceRaw <= 0n) return { quantityRaw: 0n, maxEscrowRaw: 0n };
  const scale = 10n ** BigInt(decimals);
  const lot = lotSize > 0n ? lotSize : 1n;
  const unalignedQuantity = (collateralRaw * scale) / limitPriceRaw;
  const quantityRaw = (unalignedQuantity / lot) * lot;
  if (quantityRaw <= 0n) return { quantityRaw: 0n, maxEscrowRaw: 0n };
  const maxEscrowRaw = (limitPriceRaw * quantityRaw + scale - 1n) / scale;
  return { quantityRaw, maxEscrowRaw };
}

export function collateralFromRiskBudget(
  riskBudgetUsd: number,
  suggestedMaxStakePercent: number,
  decimals: number = BINARY_DECIMALS,
): bigint {
  const pct = Math.max(0, Math.min(25, suggestedMaxStakePercent));
  const usd = Math.max(0, riskBudgetUsd) * (pct / 100);
  return collateralFromUsd(usd, decimals);
}

export function collateralFromUsd(
  usd: number,
  decimals: number = BINARY_DECIMALS,
): bigint {
  if (!Number.isFinite(usd) || usd <= 0) return 0n;
  return BigInt(Math.floor(usd * 10 ** decimals));
}

export function priceToProbabilityPercent(priceRaw: bigint, decimals: number = BINARY_DECIMALS): number {
  const scale = Number(10n ** BigInt(decimals));
  if (scale <= 0) return 0;
  return Number(((Number(priceRaw) / scale) * 100).toFixed(2));
}

export function probabilityPercentToPrice(percent: number, decimals: number = BINARY_DECIMALS): bigint {
  const scale = 10n ** BigInt(decimals);
  const clamped = Math.max(0.01, Math.min(99.99, percent));
  return BigInt(Math.round((clamped / 100) * Number(scale)));
}

export function potentialPayoutRaw(quantityRaw: bigint): bigint {
  return quantityRaw;
}

export function availableLiquidityUpTo(levels: BookLevel[], limitPriceRaw: bigint): bigint {
  let total = 0n;
  for (const level of levels) {
    if (level.price > limitPriceRaw) break;
    total += level.quantity;
  }
  return total;
}

export function assertSizingInvariants(
  collateralRaw: bigint,
  limitPriceRaw: bigint,
  decimals: number = BINARY_DECIMALS,
): boolean {
  const { quantityRaw, maxEscrowRaw } = sizeBuyFromCollateral(collateralRaw, limitPriceRaw, decimals);
  if (quantityRaw <= 0n) return false;
  const scale = 10n ** BigInt(decimals);
  const notional = (limitPriceRaw * quantityRaw) / scale;
  if (maxEscrowRaw < notional) return false;
  if (maxEscrowRaw > collateralRaw + 1n) return false;
  return true;
}
