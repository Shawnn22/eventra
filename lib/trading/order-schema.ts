/**
 * Order draft types for DreamPilot → DreamDEX binary Event Contracts.
 */
export type BinaryBuySide = "BUY_YES" | "BUY_NO";

export function adviceActionToBuySide(
  action: "BUY_UP" | "BUY_DOWN" | "WAIT",
): BinaryBuySide | null {
  if (action === "BUY_UP") return "BUY_YES";
  if (action === "BUY_DOWN") return "BUY_NO";
  return null;
}

export type ValidatedOrderDraft = {
  account: `0x${string}`;
  chainId: 50312;
  marketId: `0x${string}`;
  venueId: `0x${string}`;
  pool: `0x${string}`;
  side: BinaryBuySide;
  /** YES-side contract price passed to BinaryPool for every OrderKind. */
  limitPriceRaw: bigint;
  /** User-facing side price (YES for BUY_YES, NO for BUY_NO). */
  maxSidePriceRaw: bigint;
  quantityRaw: bigint;
  maxCollateralRaw: bigint;
  slippageBps: number;
  quoteBlock: bigint;
  quoteExpiresAt: number;
  adviceHash: `0x${string}`;
  display: {
    sideLabel: "UP" | "DOWN";
    limitProbability: number;
    maxSpendUsd: number;
    potentialPayoutUsd: number;
    bestAskProbability: number;
    availableLiquidityRaw: bigint;
  };
};

export type OrderDraftRejectionReason =
  | "WAIT" | "NO_WALLET" | "WRONG_CHAIN" | "NO_LIQUIDITY" | "STALE_QUOTE"
  | "EXPIRED_MARKET" | "MISSING_PRICE" | "BELOW_MIN_SIZE" | "EXCEEDS_RISK_BUDGET" | "INVALID_INPUT";

export type OrderDraftResult =
  | { ok: true; draft: ValidatedOrderDraft }
  | { ok: false; reason: OrderDraftRejectionReason; message: string };

export const QUOTE_TTL_MS = 8_000;
export const DEFAULT_SLIPPAGE_BPS = 100;
export const BINARY_DECIMALS = 6;
export const ONE_BASE = 10n ** BigInt(BINARY_DECIMALS);
