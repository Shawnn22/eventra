import {
  ORDER_TYPE,
  SOMNIA_TESTNET_ADDRESSES,
  SomniaMarkets,
  quoteBinarySellOverBook,
  type BinarySellQuote,
} from "@somnia-chain/markets-sdk";
import type { Address, WalletClient } from "viem";
import { DREAMDEX_BROWSER, isAllowedDreamDexPool } from "@/lib/dreamdex/config";
import { fetchBinaryOrderBook } from "@/lib/dreamdex/order-book";
import { ONE_BASE } from "@/lib/trading/order-schema";

export type ExitSide = "UP" | "DOWN";

export type PositionExitQuote = {
  pool: Address;
  side: ExitSide;
  quantityRaw: bigint;
  fillableQuantityRaw: bigint;
  limitPriceRaw: bigint;
  bestBidCents: number;
  estimatedProceedsUsd: number;
  fillPercent: number;
  partial: boolean;
  quotedAt: number;
  sdkQuote: BinarySellQuote;
};

export type PositionExitOutcome = {
  ok: boolean;
  hash?: string;
  filledQuantityRaw?: bigint;
  proceedsUsd?: number;
  partial?: boolean;
  message: string;
};

function exchange() {
  return new SomniaMarkets({
    indexerUrl: DREAMDEX_BROWSER.indexerUrl,
    chain: DREAMDEX_BROWSER.chain,
    wsRpcUrl: DREAMDEX_BROWSER.wsRpcUrl,
    addresses: SOMNIA_TESTNET_ADDRESSES,
  });
}

export async function quotePositionExit(params: {
  pool: Address;
  side: ExitSide;
  quantityRaw: bigint;
}): Promise<PositionExitQuote | null> {
  if (!isAllowedDreamDexPool(params.pool) || params.quantityRaw <= 0n) return null;
  const book = await fetchBinaryOrderBook(params.pool, { depth: 20 });
  const sdkQuote = quoteBinarySellOverBook(
    book,
    params.side === "UP" ? "SELL_YES" : "SELL_NO",
    params.quantityRaw,
    ONE_BASE,
    {
      tickSize: book.tickSize,
      lotSize: book.lotSize,
      minQuantity: book.minQuantity,
      slippageBps: 200n,
      slippageMinTicks: 5n,
    },
  );
  if (!sdkQuote || sdkQuote.fillableQuantity <= 0n) return null;
  const bestBid = (params.side === "UP" ? book.yesBids : book.noBids)[0]?.price ?? sdkQuote.limitPrice;
  const fillPercent = Number((sdkQuote.fillableQuantity * 10_000n) / sdkQuote.quantity) / 100;
  return {
    pool: params.pool,
    side: params.side,
    quantityRaw: sdkQuote.quantity,
    fillableQuantityRaw: sdkQuote.fillableQuantity,
    limitPriceRaw: sdkQuote.limitPrice,
    bestBidCents: Number(bestBid) / 10_000,
    estimatedProceedsUsd: Number(sdkQuote.estProceeds) / 1_000_000,
    fillPercent,
    partial: sdkQuote.fillableQuantity < sdkQuote.quantity,
    quotedAt: Date.now(),
    sdkQuote,
  };
}

export async function executePositionExit(params: {
  walletClient: WalletClient;
  quote: PositionExitQuote;
}): Promise<PositionExitOutcome> {
  if (Date.now() - params.quote.quotedAt > 8_000) {
    return { ok: false, message: "Exit quote expired. Refresh it before signing." };
  }
  if (!isAllowedDreamDexPool(params.quote.pool)) {
    return { ok: false, message: "This pool is not approved for live Eventra execution." };
  }
  try {
    const trader = exchange().client.createTrader({ walletClient: params.walletClient });
    const result = await trader.placeOrder({
      pool: params.quote.pool,
      side: params.quote.side === "UP" ? "SELL_YES" : "SELL_NO",
      price: params.quote.sdkQuote.yesPrice,
      quantity: params.quote.quantityRaw,
      orderType: ORDER_TYPE.MARKET,
      autoApprove: true,
    });
    const filledQuantityRaw = result.fills.reduce((sum, fill) => sum + fill.quantityFilled, 0n);
    const proceedsRaw = result.fills.reduce((sum, fill) => {
      const ownPrice = params.quote.side === "UP" ? fill.fillPrice : ONE_BASE - fill.fillPrice;
      return sum + (fill.quantityFilled * ownPrice) / ONE_BASE;
    }, 0n);
    if (filledQuantityRaw === 0n) {
      return { ok: false, hash: result.hash, filledQuantityRaw, proceedsUsd: 0, message: "No bid remained when the IOC order reached DreamDEX." };
    }
    const partial = filledQuantityRaw < params.quote.quantityRaw;
    return {
      ok: true,
      hash: result.hash,
      filledQuantityRaw,
      proceedsUsd: Number(proceedsRaw) / 1_000_000,
      partial,
      message: partial ? "Position partially closed; the unfilled remainder was cancelled." : "Position closed successfully.",
    };
  } catch (cause) {
    const raw = cause instanceof Error ? cause.message : String(cause);
    const rejected = raw.toLowerCase().includes("user rejected");
    return { ok: false, message: rejected ? "The close request was rejected in the wallet." : "Unable to close this position on DreamDEX." };
  }
}
