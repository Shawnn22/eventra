import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import type { Address, Hash, WalletClient } from "viem";
import { DREAMDEX_BROWSER } from "@/lib/dreamdex/config";

export type OpenOrderRow = { id: string; orderId: string; pool: string; side: string | null; isBid: boolean; price: string; quantityRemaining: string };

export async function fetchUserOpenOrders(account: Address, opts?: { pool?: string; limit?: number }): Promise<OpenOrderRow[]> {
  const exchange = new SomniaMarkets({ indexerUrl: DREAMDEX_BROWSER.indexerUrl, chain: DREAMDEX_BROWSER.chain, wsRpcUrl: DREAMDEX_BROWSER.wsRpcUrl, addresses: SOMNIA_TESTNET_ADDRESSES });
  const rows = await exchange.client.getOpenOrders(account, { pool: opts?.pool, limit: opts?.limit ?? 100 });
  return (rows ?? []).map((o: OpenOrderRow) => ({ id: o.id, orderId: o.orderId, pool: o.pool, side: o.side, isBid: o.isBid, price: o.price, quantityRemaining: o.quantityRemaining }));
}

export async function cancelUserOrder(params: { walletClient: WalletClient; pool: Address; orderId: string | bigint }) {
  try {
    const exchange = new SomniaMarkets({ indexerUrl: DREAMDEX_BROWSER.indexerUrl, chain: DREAMDEX_BROWSER.chain, wsRpcUrl: DREAMDEX_BROWSER.wsRpcUrl, addresses: SOMNIA_TESTNET_ADDRESSES });
    const trader = exchange.client.createTrader({ walletClient: params.walletClient });
    const result = await trader.cancelOrder({ pool: params.pool, orderId: params.orderId });
    const status = result.receipt?.status;
    const success = status === "success";
    if (!success) return { ok: false, hash: result.hash as Hash, errorMessageVi: "Cancel transaction reverted on-chain." };
    return { ok: true, hash: result.hash as Hash };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    if (raw.toLowerCase().includes("user rejected") || raw.toLowerCase().includes("user denied"))
      return { ok: false, errorMessageVi: "The cancel request was rejected in the wallet.", rawError: raw };
    return { ok: false, errorMessageVi: "Unable to cancel this order.", rawError: raw };
  }
}
