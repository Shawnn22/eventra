import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES, type PortfolioPosition } from "@somnia-chain/markets-sdk";
import type { Address } from "viem";
import { DREAMDEX_BROWSER } from "@/lib/dreamdex/config";

export type UserPositionRow = {
  id: string;
  marketId: string;
  pool?: string;
  yesRaw: string;
  noRaw: string;
  quoteDecimals: number;
  costBasisRaw?: string;
  avgCostRaw?: string;
  markValueRaw?: string;
  unrealizedPnlRaw?: string;
  status: "trading" | "resolved" | "voided" | "finalized" | "redeemed" | "unknown";
  claimable: boolean;
  winningOutcome?: 0 | 1 | null;
  asset?: string;
  question?: string;
};

function normaliseStatus(value: string): UserPositionRow["status"] {
  const status = value.toLowerCase();
  if (status === "trading" || status === "listed") return "trading";
  if (status === "resolved") return "resolved";
  if (status === "voided") return "voided";
  if (status === "finalized") return "finalized";
  return "unknown";
}

/**
 * The DreamDEX SDK returns one portfolio row per outcome token. Eventra groups
 * those rows by market so a wallet can see (and sell) both UP and DOWN balances.
 */
export async function fetchUserPositions(account: Address): Promise<UserPositionRow[]> {
  const exchange = new SomniaMarkets({
    indexerUrl: DREAMDEX_BROWSER.indexerUrl,
    chain: DREAMDEX_BROWSER.chain,
    wsRpcUrl: DREAMDEX_BROWSER.wsRpcUrl,
    addresses: SOMNIA_TESTNET_ADDRESSES,
  });
  const [portfolio, pnlResult] = await Promise.all([
    exchange.client.getPortfolio(account, { ordersLimit: 0, tradesLimit: 0 }),
    exchange.client.getOpenPositionsWithPnL(account).catch(() => []),
  ]);
  const pnlByMarket = new Map(pnlResult.map((position) => [position.market.id.toLowerCase(), position]));
  const grouped = new Map<string, UserPositionRow>();

  for (const position of portfolio.positions as PortfolioPosition[]) {
    if (!position.market?.id) continue;
    const market = position.market;
    const current = grouped.get(market.id) ?? {
      id: market.id,
      marketId: market.id,
      pool: market.poolAddress,
      yesRaw: "0",
      noRaw: "0",
      quoteDecimals: market.quoteDecimals,
      status: normaliseStatus(market.status),
      claimable: ["Resolved", "Voided", "Finalized"].includes(market.status),
      winningOutcome: market.winningOutcome === 0 || market.winningOutcome === 1 ? market.winningOutcome : null,
      asset: market.asset,
      question: market.question,
    } satisfies UserPositionRow;

    if (position.outcomeIndex === 0) current.yesRaw = position.balance;
    if (position.outcomeIndex === 1) current.noRaw = position.balance;
    const pnl = pnlByMarket.get(market.id.toLowerCase());
    if (pnl) {
      current.costBasisRaw = pnl.costBasis.toString();
      current.avgCostRaw = pnl.avgCost.toString();
      current.markValueRaw = (pnl.markValue ?? 0n).toString();
      current.unrealizedPnlRaw = (pnl.unrealizedPnl ?? 0n).toString();
    }
    grouped.set(market.id, current);
  }

  return [...grouped.values()];
}
