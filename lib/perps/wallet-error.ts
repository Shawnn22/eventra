export function formatPerpsWalletError(error: unknown, stage: "approving" | "depositing" | "signing") {
  const code = typeof error === "object" && error && "code" in error ? Number((error as { code: unknown }).code) : null;
  const raw = error instanceof Error ? error.message : String(error ?? "Unknown wallet error");
  if (code === 4001 || /user rejected|user denied|rejected the request/i.test(raw)) {
    const action = stage === "approving" ? "approval" : stage === "depositing" ? "margin deposit" : "order signature";
    return `You rejected the ${action}. No later transaction was sent; press Resume when ready.`;
  }
  if (/insufficient funds/i.test(raw)) return "The wallet does not have enough STT for gas on Hideki.";
  if (/allowance/i.test(raw)) return "USDso allowance changed before the margin deposit. Refresh the quote and resume.";
  if (/stale|expired|price/i.test(raw) && /revert|reject|invalid/i.test(raw)) return "The executable quote changed before signing. Refresh the on-chain quote before retrying.";
  if (/revert/i.test(raw)) return `DreamDEX rejected the ${stage === "signing" ? "order" : "funding transaction"}. Refresh the quote; no successful order was recorded. Technical detail: ${raw}`;
  return raw;
}
