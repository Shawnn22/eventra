"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { fetchBinaryOrderBook } from "@/lib/dreamdex/order-book";
import { buildOrderDraft, type BuildOrderDraftInput } from "@/lib/trading/build-order-draft";
import type { BinaryBookSnapshot } from "@/lib/trading/order-math";
import type { OrderDraftResult, ValidatedOrderDraft } from "@/lib/trading/order-schema";
import { QUOTE_TTL_MS } from "@/lib/trading/order-schema";

export function useLiveOrderBook({ pool, enabled = true, pollIntervalMs = 4_000 }: { pool?: string; enabled?: boolean; pollIntervalMs?: number }) {
  const [book, setBook] = useState<BinaryBookSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ValidatedOrderDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const draftInputsRef = useRef<Omit<BuildOrderDraftInput, "book"> | null>(null);
  const poolRef = useRef(pool);
  poolRef.current = pool;

  const rebuildDraft = useCallback((nextBook: BinaryBookSnapshot | null) => {
    const inputs = draftInputsRef.current;
    if (!inputs) { setDraft(null); setDraftError(null); return null; }
    const result = buildOrderDraft({ ...inputs, book: nextBook });
    if (result.ok) { setDraft(result.draft); setDraftError(null); return result.draft; }
    setDraft(null); setDraftError(result.message); return null;
  }, []);

  const refresh = useCallback(async () => {
    const currentPool = poolRef.current;
    if (!currentPool || !enabled) { setBook(null); setError(null); rebuildDraft(null); return null; }
    setLoading(true); setError(null);
    try {
      const next = await fetchBinaryOrderBook(currentPool as Address, { depth: 12 });
      if (poolRef.current !== currentPool) return;
      setBook(next); return rebuildDraft(next);
    } catch (err) {
      if (poolRef.current !== currentPool) return;
      setError(err instanceof Error ? err.message : "Không đọc được order book.");
      setBook(null); rebuildDraft(null); return null;
    } finally { setLoading(false); }
  }, [enabled, rebuildDraft]);

  const setDraftInputs = useCallback((input: Omit<BuildOrderDraftInput, "book"> | null) => {
    draftInputsRef.current = input; rebuildDraft(book);
  }, [book, rebuildDraft]);

  const buildDraft = useCallback((input: Omit<BuildOrderDraftInput, "book">): OrderDraftResult => {
    return buildOrderDraft({ ...input, book });
  }, [book]);

  useEffect(() => {
    setBook(null); setError(null); setDraft(null); setDraftError(null);
    if (pool && enabled) void refresh();
  }, [pool, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pool || !enabled) return;
    const id = window.setInterval(() => void refresh(), pollIntervalMs);
    return () => window.clearInterval(id);
  }, [pool, enabled, pollIntervalMs, refresh]);

  useEffect(() => {
    if (!book) return;
    const remaining = book.fetchedAt + QUOTE_TTL_MS - Date.now();
    if (remaining <= 0) { rebuildDraft(book); return; }
    const id = window.setTimeout(() => rebuildDraft(book), remaining + 50);
    return () => window.clearTimeout(id);
  }, [book, rebuildDraft]);

  return { book, loading, error, refreshedAt: book?.fetchedAt ?? null, refresh, buildDraft, draft, draftError, setDraftInputs };
}
