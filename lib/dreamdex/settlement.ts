import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import type { Hash, Hex, WalletClient } from "viem";
import { DREAMDEX_BROWSER } from "@/lib/dreamdex/config";

export async function redeemPosition(params: { walletClient: WalletClient; marketId: Hex; outcomeIdx: 0 | 1; amount: bigint; venueId?: Hex }) {
  if (params.amount <= 0n) return { ok: false, errorMessageVi: "Redeem amount must be greater than zero." };
  try {
    const exchange = new SomniaMarkets({ indexerUrl: DREAMDEX_BROWSER.indexerUrl, chain: DREAMDEX_BROWSER.chain, wsRpcUrl: DREAMDEX_BROWSER.wsRpcUrl, addresses: SOMNIA_TESTNET_ADDRESSES });
    const trader = exchange.client.createTrader({ walletClient: params.walletClient });
    const result = await trader.redeem({ marketId: params.marketId, outcomeIdx: params.outcomeIdx, amount: params.amount, venueId: (params.venueId ?? DREAMDEX_BROWSER.venueId) as Hex, autoApprove: true });
    const status = result.receipt?.status;
    const success = status === "success";
    if (!success) return { ok: false, hash: result.hash as Hash, errorMessageVi: "Redeem transaction reverted on-chain." };
    return { ok: true, hash: result.hash as Hash };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    if (raw.toLowerCase().includes("user rejected")) return { ok: false, errorMessageVi: "The redeem request was rejected in the wallet.", rawError: raw };
    return { ok: false, errorMessageVi: "Redeem failed.", rawError: raw };
  }
}

export function explorerTxUrl(hash: string) { return `https://shannon-explorer.somnia.network/tx/${hash}`; }
