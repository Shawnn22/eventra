"use client";
import type { Address, WalletClient } from "viem";
import type { UserPositionRow } from "@/lib/dreamdex/positions";
import { explorerTxUrl } from "@/lib/dreamdex/settlement";
import { RedeemCard } from "@/components/portfolio/redeem-card";
import { ClosePositionCard } from "@/components/portfolio/close-position-card";

export function PositionsPanel(props: {
  positions: UserPositionRow[]; loading: boolean; error: string | null; account: Address | null;
  walletClient: WalletClient | null; isReady: boolean; redeemingId: string | null; lastRedeemHash: string | null;
  onRefresh: () => void; onRedeem: (row: UserPositionRow, outcomeIdx: 0 | 1, amount: bigint) => void;
}) {
  const p = props;
  if (!p.account) return <section className="portfolio-card"><header><b>Positions</b></header></section>;
  return (
    <section className="portfolio-card">
      <header><div><b>Positions</b><small>Grouped by market ID</small></div>
        <button type="button" className="ghost-btn" onClick={p.onRefresh} disabled={p.loading}>{p.loading ? "…" : "Refresh"}</button>
      </header>
      {p.error ? <p className="preview-error">{p.error}</p> : null}
      {p.lastRedeemHash ? <p className="portfolio-hint"><a href={explorerTxUrl(p.lastRedeemHash)} target="_blank" rel="noreferrer">Redeem tx ↗</a></p> : null}
      {p.positions.length === 0 && !p.loading ? <p className="portfolio-empty">No indexed positions yet. A newly filled testnet trade can take a few seconds to appear.</p> : (
        <ul className="portfolio-list positions">{p.positions.map((row) => (
          <li key={row.id}><div className="position-row-summary"><div><strong>{row.asset ?? "Market"} · {row.status}</strong>
            <small>UP {(Number(row.yesRaw) / (10 ** row.quoteDecimals)).toLocaleString()} · DOWN {(Number(row.noRaw) / (10 ** row.quoteDecimals)).toLocaleString()}</small></div>
            <RedeemCard row={row} disabled={!p.isReady || !p.walletClient || p.redeemingId === row.id} busy={p.redeemingId === row.id}
              onRedeem={(oi, amt) => p.onRedeem(row, oi, amt)} /></div>
            <ClosePositionCard row={row} walletClient={p.walletClient} disabled={!p.isReady || p.redeemingId === row.id} onClosed={p.onRefresh} />
          </li>
        ))}</ul>
      )}
    </section>
  );
}
