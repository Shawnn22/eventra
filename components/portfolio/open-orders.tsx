"use client";
import type { Address, WalletClient } from "viem";
import type { OpenOrderRow } from "@/lib/dreamdex/open-orders";
import { explorerTxUrl } from "@/lib/dreamdex/trading";

export function OpenOrdersPanel(props: {
  orders: OpenOrderRow[]; loading: boolean; error: string | null; account: Address | null;
  walletClient: WalletClient | null; isReady: boolean; cancellingId: string | null; lastCancelHash: string | null;
  onRefresh: () => void; onCancel: (order: OpenOrderRow) => void;
}) {
  const { orders, loading, error, account, walletClient, isReady, cancellingId, lastCancelHash, onRefresh, onCancel } = props;
  if (!account) return <section className="portfolio-card"><header><b>Open orders</b><small>Connect wallet</small></header></section>;
  return (
    <section className="portfolio-card">
      <header><div><b>Open orders</b><small>Orders for the connected wallet</small></div>
        <button type="button" className="ghost-btn" onClick={onRefresh} disabled={loading}>{loading ? "…" : "Refresh"}</button>
      </header>
      {error ? <p className="preview-error">{error}</p> : null}
      {lastCancelHash ? <p className="portfolio-hint"><a href={explorerTxUrl(lastCancelHash)} target="_blank" rel="noreferrer">Cancel tx ↗</a></p> : null}
      {orders.length === 0 && !loading ? <p className="portfolio-empty">No resting orders.</p> : (
        <ul className="portfolio-list">{orders.map((o) => (
          <li key={o.id}><div><strong>{o.side ?? (o.isBid ? "BID" : "ASK")}</strong>
            <small>pool {o.pool.slice(0, 8)}… · id {o.orderId}</small>
            <small>price {o.price} · rem {o.quantityRemaining}</small></div>
            <button type="button" disabled={!isReady || !walletClient || cancellingId === o.id} onClick={() => onCancel(o)}>
              {cancellingId === o.id ? "…" : "Cancel"}
            </button>
          </li>
        ))}</ul>
      )}
    </section>
  );
}
