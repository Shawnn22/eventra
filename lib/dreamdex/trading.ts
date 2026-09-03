import { ORDER_TYPE, SOMNIA_TESTNET_ADDRESSES, SomniaMarkets } from "@somnia-chain/markets-sdk";
import { createPublicClient, decodeEventLog, formatUnits, http, parseAbi, type Address, type Hash, type WalletClient } from "viem";
import { DREAMDEX_BROWSER, isAllowedDreamDexPool } from "@/lib/dreamdex/config";
import { fetchBinaryOrderBook } from "@/lib/dreamdex/order-book";
import { bestAsk } from "@/lib/trading/order-math";
import type { ValidatedOrderDraft } from "@/lib/trading/order-schema";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const collateralAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const binaryPoolPreflightAbi = parseAbi([
  "function marketExpiryNs() view returns (uint64)",
  "function finalized() view returns (bool)",
]);
const orderEventsAbi = [
  { type: "event", name: "OrderPlaced", inputs: [{ name: "orderId", type: "uint128", indexed: true }, { name: "placedOrder", type: "tuple", indexed: false, components: [{ name: "orderId", type: "uint128" }, { name: "isBid", type: "bool" }, { name: "owner", type: "address" }, { name: "userData", type: "uint64" }, { name: "price", type: "uint256" }, { name: "fullQuantity", type: "uint256" }, { name: "quantityRemaining", type: "uint256" }, { name: "expireTimestampNs", type: "uint64" }] }], anonymous: false },
  { type: "event", name: "OrderFilled", inputs: [{ name: "takerOrderId", type: "uint128", indexed: true }, { name: "makerOrderId", type: "uint128", indexed: true }, { name: "quantityFilled", type: "uint256", indexed: false }, { name: "takerRemainingQuantity", type: "uint256", indexed: false }, { name: "makerRemainingQuantity", type: "uint256", indexed: false }, { name: "fillPrice", type: "uint256", indexed: false }], anonymous: false },
] as const;
const publicClient = createPublicClient({ chain: DREAMDEX_BROWSER.chain, transport: http(DREAMDEX_BROWSER.httpRpcUrl) });

function createDreamDexExchange() {
  return new SomniaMarkets({
    indexerUrl: DREAMDEX_BROWSER.indexerUrl,
    chain: DREAMDEX_BROWSER.chain,
    wsRpcUrl: DREAMDEX_BROWSER.wsRpcUrl,
    addresses: SOMNIA_TESTNET_ADDRESSES,
  });
}

export type PlaceOrderPhase =
  | "idle" | "revalidating" | "approval_pending" | "order_pending"
  | "filled" | "partial_fill" | "resting" | "rejected" | "reverted";

export type PlaceOrderOutcome = {
  phase: PlaceOrderPhase; hash?: Hash; orderId?: string;
  fills: Array<{ fillPrice: string; quantityFilled: string; takerRemainingQuantity: string }>;
  settlement?: {
    token: "TestUSDC";
    maxSentRaw: string;
    refundedRaw: string;
    netSpentRaw: string;
    maxSentUsd: number;
    refundedUsd: number;
    netSpentUsd: number;
    counterpartyCount: number;
    counterparties: string[];
  };
  receiptStatus?: "success" | "reverted"; errorName?: string; errorMessageVi: string; rawError?: string;
};

function mapErrorToVi(err: unknown) {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const lower = raw.toLowerCase();
  if (lower.includes("user rejected") || lower.includes("user denied") || lower.includes("rejected the request"))
    return { name: "UserRejectedRequest", messageVi: "The wallet request was rejected. No transaction was submitted.", raw };
  if (lower.includes("insufficient funds for gas") || lower.includes("insufficient native"))
    return { name: "InsufficientGas", messageVi: "Not enough STT to pay Somnia testnet gas.", raw };
  if (lower.includes("expired") || lower.includes("expiry") || lower.includes("marketclosed") || lower.includes("market closed"))
    return { name: "SubmittedTooLate", messageVi: "The market expired before the order reached DreamDEX. No TestUSDC was charged; collateral changes were reverted automatically. Network gas is not refundable.", raw };
  if (lower.includes("insufficient")) return { name: "InsufficientFunds", messageVi: "Insufficient TestUSDC collateral balance.", raw };
  if (lower.includes("invalidprice")) return { name: "InvalidPrice", messageVi: "The limit price is not aligned to the DreamDEX pool tick size. Refresh the quote and try again.", raw };
  if (lower.includes("placebinaryorder") || lower.includes("unknown reason") || lower.includes("execution reverted"))
    return { name: "ExecutionChanged", messageVi: "DreamDEX rejected the order because the market state changed before execution. No collateral was retained. Refresh the live quote or switch to the next campaign.", raw };
  return { name: "Unknown", messageVi: "DreamDEX could not execute this order. No confirmed position was created. Refresh the quote before trying again.", raw };
}

export function computeExpireTimestampNs(opts: { marketExpiryIso?: string; minutesRemaining?: number }): bigint {
  const nowSec = Math.floor(Date.now() / 1000);
  let marketExpirySec = nowSec + 3600;
  if (opts.marketExpiryIso) {
    const t = Math.floor(new Date(opts.marketExpiryIso).getTime() / 1000);
    if (Number.isFinite(t) && t > nowSec) marketExpirySec = t;
  } else if (opts.minutesRemaining && opts.minutesRemaining > 0) {
    marketExpirySec = nowSec + Math.max(60, Math.floor(opts.minutesRemaining * 60));
  }
  return BigInt(Math.min(marketExpirySec, nowSec + 15 * 60)) * 1_000_000_000n;
}

export async function placeDreamDexOrder(
  params: { draft: ValidatedOrderDraft; walletClient: WalletClient; marketExpiryIso?: string; minutesRemaining?: number; autoApprove?: boolean },
  onPhase?: (phase: PlaceOrderPhase) => void,
): Promise<PlaceOrderOutcome> {
  const { draft, walletClient } = params;
  if (Date.now() > draft.quoteExpiresAt)
    return { phase: "rejected", fills: [], errorName: "StaleQuote", errorMessageVi: "Quote expired." };
  if (draft.quantityRaw <= 0n || draft.limitPriceRaw <= 0n)
    return { phase: "rejected", fills: [], errorName: "InvalidDraft", errorMessageVi: "Invalid order draft." };
  if (!isAllowedDreamDexPool(draft.pool))
    return { phase: "rejected", fills: [], errorName: "UnverifiedPool", errorMessageVi: "Pool is not on-chain verified; trading is safety locked." };
  onPhase?.("revalidating");
  try {
    const verificationResponse = await fetch("/api/markets/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ marketId: draft.marketId, pool: draft.pool }),
      cache: "no-store",
    });
    const verification = await verificationResponse.json() as { verified?: boolean; error?: string };
    if (!verificationResponse.ok || !verification.verified)
      return { phase: "rejected", fills: [], errorName: "OnchainVerificationFailed", errorMessageVi: verification.error ?? "Market/pool failed DreamDEX on-chain verification." };
    const [marketExpiryNs, finalized] = await Promise.all([
      publicClient.readContract({ address: draft.pool as Address, abi: binaryPoolPreflightAbi, functionName: "marketExpiryNs" }),
      publicClient.readContract({ address: draft.pool as Address, abi: binaryPoolPreflightAbi, functionName: "finalized" }),
    ]);
    const nowNs = BigInt(Date.now()) * 1_000_000n;
    if (finalized || marketExpiryNs <= nowNs)
      return { phase: "rejected", fills: [], errorName: "MarketClosed", errorMessageVi: "This DreamDEX market is already closed. Choose the next live market." };
    // The pool is the source of truth. Equal-to-market expiry is valid and
    // avoids a stale UI timestamp exceeding the pool cap by a few seconds.
    const expireNs = marketExpiryNs;
    let currentBook = await fetchBinaryOrderBook(draft.pool as Address);
    let currentAsk = bestAsk(currentBook, draft.side);
    if (!currentAsk || currentBook.blockNumber === undefined || currentAsk.price > draft.maxSidePriceRaw || currentBook.blockNumber < draft.quoteBlock)
      return { phase: "rejected", fills: [], errorName: "QuoteChanged", errorMessageVi: "Price or liquidity changed. Review the refreshed quote." };
    const collateral = DREAMDEX_BROWSER.collateral as Address;
    const [balance, allowance] = await Promise.all([
      publicClient.readContract({ address: collateral, abi: collateralAbi, functionName: "balanceOf", args: [draft.account] }),
      publicClient.readContract({ address: collateral, abi: collateralAbi, functionName: "allowance", args: [draft.account, draft.pool as Address] }),
    ]);
    if (balance < draft.maxCollateralRaw)
      return { phase: "rejected", fills: [], errorName: "InsufficientCollateral", errorMessageVi: "Insufficient TestUSDC balance for this order." };
    if (allowance < draft.maxCollateralRaw) {
      if (params.autoApprove === false)
        return { phase: "rejected", fills: [], errorName: "ApprovalRequired", errorMessageVi: "Enable TestUSDC spending before placing this order." };
      onPhase?.("approval_pending");
    }
    onPhase?.("order_pending");
    // Use DreamDEX's official writer. It owns the complete ABI/error table,
    // wallet fee fields and one-time collateral approval flow. This avoids OKX
    // rendering our previous hand-built call as an "unknown transaction".
    const trader = createDreamDexExchange().client.createTrader({ walletClient });
    const placed = await trader.placeOrder({
      pool: draft.pool as Address,
      side: draft.side,
      price: draft.limitPriceRaw,
      quantity: draft.quantityRaw,
      expireTimestampNs: expireNs,
      orderType: ORDER_TYPE.MARKET,
      autoApprove: params.autoApprove !== false,
    });
    const hash = placed.hash;
    const receipt = placed.receipt;
    const status = receipt.status === "success" ? "success" : "reverted";
    if (status === "reverted") {
      const submittedTooLate = BigInt(Date.now()) * 1_000_000n >= marketExpiryNs;
      return submittedTooLate
        ? { phase: "reverted", hash, fills: [], receiptStatus: "reverted", errorName: "SubmittedTooLate", errorMessageVi: "The order reached Somnia after market expiry. No TestUSDC was charged; collateral changes were reverted automatically. Network gas is not refundable.", rawError: hash }
        : { phase: "reverted", hash, fills: [], receiptStatus: "reverted", errorName: "Reverted", errorMessageVi: "Transaction reverted on-chain. No TestUSDC transfer was retained.", rawError: hash };
    }
    let orderId: string | undefined = placed.orderId?.toString();
    const fills: PlaceOrderOutcome["fills"] = placed.fills.map((fill) => ({
      fillPrice: fill.fillPrice.toString(),
      quantityFilled: fill.quantityFilled.toString(),
      takerRemainingQuantity: fill.takerRemainingQuantity.toString(),
    }));
    let sentToPoolRaw = 0n;
    let refundedRaw = 0n;
    const counterparties = new Set<string>();
    const account = draft.account.toLowerCase();
    const pool = draft.pool.toLowerCase();
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: orderEventsAbi, data: log.data, topics: log.topics });
        if (decoded.eventName === "OrderPlaced" && !orderId) orderId = decoded.args.orderId.toString();
      } catch { /* unrelated order log */ }
      if (log.address.toLowerCase() !== collateral.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({ abi: collateralAbi, data: log.data, topics: log.topics });
        if (decoded.eventName !== "Transfer") continue;
        const from = decoded.args.from.toLowerCase();
        const to = decoded.args.to.toLowerCase();
        const value = decoded.args.value;
        if (from === account && to === pool) sentToPoolRaw += value;
        if (from === pool && to === account) refundedRaw += value;
        if (from === pool && to !== account && to !== ZERO_ADDRESS) counterparties.add(decoded.args.to);
      } catch { /* unrelated collateral log */ }
    }
    const filledQty = fills.reduce((acc, f) => acc + BigInt(f.quantityFilled), 0n);
    let phase: PlaceOrderPhase = "filled";
    if (fills.length === 0 && orderId !== undefined) phase = "resting";
    else if (fills.length > 0 && filledQty < draft.quantityRaw) phase = "partial_fill";
    else if (fills.length > 0) phase = "filled";
    else phase = "resting";
    const netSpentRaw = sentToPoolRaw > refundedRaw ? sentToPoolRaw - refundedRaw : 0n;
    const settlement = sentToPoolRaw > 0n ? {
      token: "TestUSDC" as const,
      maxSentRaw: sentToPoolRaw.toString(),
      refundedRaw: refundedRaw.toString(),
      netSpentRaw: netSpentRaw.toString(),
      maxSentUsd: Number(formatUnits(sentToPoolRaw, 6)),
      refundedUsd: Number(formatUnits(refundedRaw, 6)),
      netSpentUsd: Number(formatUnits(netSpentRaw, 6)),
      counterpartyCount: counterparties.size,
      counterparties: [...counterparties],
    } : undefined;
    return { phase, hash: hash as Hash, orderId, fills, settlement, receiptStatus: "success", errorMessageVi: "" };
  } catch (err) {
    const mapped = mapErrorToVi(err);
    const configuredExpiryMs = params.marketExpiryIso ? new Date(params.marketExpiryIso).getTime() : Number.NaN;
    // The SDK may only recover `unknown reason` when a short-lived pool closes
    // between preflight and wallet broadcast. The pool expiry is authoritative,
    // so classify that race as a late submission instead of a generic failure.
    if (mapped.name === "Unknown" && Number.isFinite(configuredExpiryMs) && Date.now() >= configuredExpiryMs) {
      return {
        phase: "rejected",
        fills: [],
        errorName: "SubmittedTooLate",
        errorMessageVi: "The market closed while the wallet request was being processed. No TestUSDC was charged; contract state was reverted automatically. Network gas, if broadcast, is not refundable.",
        rawError: mapped.raw,
      };
    }
    return { phase: "rejected", fills: [], errorName: mapped.name, errorMessageVi: mapped.messageVi, rawError: mapped.raw };
  }
}

export function explorerTxUrl(hash: string): string {
  return `https://shannon-explorer.somnia.network/tx/${hash}`;
}
