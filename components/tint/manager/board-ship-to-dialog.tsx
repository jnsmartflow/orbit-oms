"use client";

// Tint Manager — Change ship-to for ONE bill (2026-10-01, tabs build step 6).
//
// ⚠ A MINIMAL STAND-IN. Floor's ShipToEditor is a private component inside
// components/floor/detail-panel.tsx; its extraction to a shared file is build
// step 7 (plan §A), when the detail panel is rebuilt. Until then the bar's
// "Change ship-to" uses this small search + pick, on the Tint Manager's own
// routes:
//   GET  /api/tint/manager/ship-to-search?q=  (min 2 letters, bare array)
//   POST /api/tint/manager/ship-to { orderId, customerId | null }
// Both call lib/floor/ship-to.ts — the same search and write Floor uses. A bill
// on a trip is refused with Billing's words (owner 2026-10-01); this shows them.
//
// ⚠ NO KEY LISTENER — tint-manager-content.tsx is the single Esc owner.

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BAR_PRIMARY, BAR_SECONDARY } from "@/components/floor/floor-action-bar";

interface Hit {
  id: number;
  customerName: string;
  area: string | null;
}

export function BoardShipToDialog({
  orderId,
  obdNumber,
  currentSite,
  originalSite,
  onDone,
  onBusyChange,
  onClose,
}: {
  orderId:      number;
  obdNumber:    string;
  /** The site the board shows now (the redirect, when one is set). */
  currentSite:  string;
  /** The bill's own site when a redirect is set, else null. */
  originalSite: string | null;
  onDone:       () => void;
  onBusyChange: (busy: boolean) => void;
  onClose:      () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [pick, setPick] = useState<Hit | null>(null);
  const [busy, setBusyState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);

  const setBusy = (b: boolean) => { setBusyState(b); onBusyChange(b); };
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  // Debounced search; the newest request wins.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); return; }
    const seq = ++reqRef.current;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tint/manager/ship-to-search?q=${encodeURIComponent(term)}`, { cache: "no-store" });
        const body = (await res.json().catch(() => null)) as Hit[] | { error?: string } | null;
        if (seq !== reqRef.current) return;
        if (!res.ok || !Array.isArray(body)) {
          setError((body && !Array.isArray(body) && body.error) || `Search failed — HTTP ${res.status}`);
          return;
        }
        setError(null);
        setHits(body);
      } catch {
        if (seq === reqRef.current) setError("Could not reach the server.");
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function save(customerId: number | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tint/manager/ship-to", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, customerId }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; changed?: boolean };
      if (!res.ok) {
        setError(body.error ?? `Could not change the ship-to — HTTP ${res.status}`);
        return;
      }
      toast.success(
        customerId === null ? `${obdNumber} ships to its own site again`
        : body.changed === false ? "Already shipping there"
        : `${obdNumber} now ships to ${pick?.customerName ?? "the new site"}`,
      );
      onDone();
      onClose();
    } catch {
      setError("Could not reach the server — nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" onClick={busy ? undefined : onClose}>
      <div role="dialog" aria-modal="true" className="w-full max-w-[460px] rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5">
          <h3 className="text-[18px] font-bold text-ink-900">Change ship-to</h3>
          <p className="mt-1 text-[13px] text-ink-500">
            <span className="font-mono">{obdNumber}</span> · now ships to <b className="text-ink-900">{currentSite}</b>
            {originalSite && <> (redirected from {originalSite})</>}
          </p>

          <input
            autoFocus
            value={q}
            onChange={(e) => { setQ(e.target.value); setPick(null); }}
            disabled={busy}
            placeholder="Search site (min 2 letters)"
            className="mt-4 w-full rounded-lg border border-ink-200 px-3 py-2 text-[13px] focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
          />
          <div className="mt-2 max-h-[240px] overflow-y-auto rounded-lg border border-ink-100">
            {hits.length === 0 ? (
              <p className="px-3 py-3 text-[12px] text-ink-400">{q.trim().length < 2 ? "Type at least 2 letters." : "No site found."}</p>
            ) : (
              hits.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => setPick(h)}
                  disabled={busy}
                  className={`flex w-full items-baseline justify-between gap-3 border-b border-ink-50 px-3 py-2 text-left text-[13px] last:border-b-0 ${
                    pick?.id === h.id ? "bg-brand-50 text-ink-900" : "hover:bg-ink-25 text-ink-700"
                  }`}
                >
                  <span className="truncate font-medium">{h.customerName}</span>
                  <span className="shrink-0 text-[11px] text-ink-400">{h.area ?? ""}</span>
                </button>
              ))
            )}
          </div>
          {error && (
            <p className="mt-3 rounded-[9px] border border-danger-bd bg-danger-bg px-3 py-2 text-[12.5px] text-danger-text">{error}</p>
          )}
        </div>
        <div className="flex items-center justify-between gap-2.5 border-t border-ink-100 px-6 py-4">
          {originalSite ? (
            <button type="button" onClick={() => { void save(null); }} disabled={busy} className={BAR_SECONDARY}>
              Back to own site
            </button>
          ) : <span />}
          <div className="flex gap-2.5">
            <button type="button" onClick={onClose} disabled={busy} className={BAR_SECONDARY}>Cancel</button>
            <button type="button" onClick={() => { if (pick) void save(pick.id); }} disabled={busy || pick === null} className={BAR_PRIMARY}>
              {busy ? "Saving…" : "Ship here"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
