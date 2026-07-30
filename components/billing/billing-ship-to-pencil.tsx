"use client";

// Billing v2 — the ✎ pencil on the Ship-To card (mockup billing-final-mockup.html
// `.pencil`). Opens a dealer search; picking one records a ship-to override on
// the MAIL ORDER, which enrichment carries to the OBD at import (:269-274).
//
// ⚠ RENDERS ONLY WHEN billingV2 IS ON. It reaches ShipToCard through a NEW
// OPTIONAL `actionSlot` prop that defaults to `undefined` — so for every user
// without the flag the card renders `{undefined}`, which React emits as nothing
// at all: no element, no comment node, no layout shift. The card's existing
// markup is untouched.
//
// PUNCHED ORDERS: the pencil is disabled with the reason on the tooltip, for
// the same non-propagation reason as the action ribbon.
//
// Search hits /api/billing/ship-to-search (mail_orders/canView), NOT Floor's —
// billing_operator has no `floor` permission and Floor's route would 403 for
// the real end users. See that route's header.

import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { postMailOrderAction } from "@/lib/billing/mo-actions";
import { smartTitleCase } from "@/lib/mail-orders/utils";

interface DealerHit {
  id: number;
  customerCode: string | null;
  customerName: string;
  area: string | null;
  route: string | null;
  deliveryType: string | null;
}

export function BillingShipToPencil({
  moOrderId,
  isPunched,
  hasOverride,
  onSaved,
}: {
  moOrderId: number;
  isPunched: boolean;
  hasOverride: boolean;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<DealerHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  // Close on outside click — same pattern as the existing customer popover in
  // review-view.tsx.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Debounced search. The route itself ignores anything under 2 chars.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    const seq = ++seqRef.current;
    setSearching(true);
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/billing/ship-to-search?q=${encodeURIComponent(term)}`, { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { results?: DealerHit[] };
        if (seq !== seqRef.current) return;
        setHits(body.results ?? []);
      } catch {
        // Silent — a blocked search must not break the detail view.
      } finally {
        if (seq === seqRef.current) setSearching(false);
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, open]);

  async function apply(customerId: number | null) {
    setBusy(true);
    setErr(null);
    const res = await postMailOrderAction(moOrderId, { action: "shipTo", customerId });
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setOpen(false);
    setQ("");
    onSaved();
  }

  return (
    <span ref={boxRef} className="mo-print-hide relative inline-flex">
      <button
        type="button"
        disabled={isPunched || busy}
        onClick={() => setOpen((v) => !v)}
        title={isPunched ? "Punched — manage on Floor Control." : "Change ship-to"}
        aria-label="Change ship-to"
        className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] border border-gray-200 bg-white text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Pencil size={12} />
      </button>

      {open && (
        <div className="absolute right-0 top-[30px] z-40 w-[300px] rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
          <input
            type="text"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search dealer by name or code…"
            className="mb-1.5 h-[28px] w-full rounded-md border border-gray-200 px-2 text-[11px] outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10"
          />

          {searching && <p className="px-1 py-2 text-[11px] text-gray-400">Searching…</p>}
          {!searching && q.trim().length >= 2 && hits.length === 0 && (
            <p className="px-1 py-2 text-[11px] text-gray-400">No dealers found</p>
          )}

          <div className="max-h-[240px] overflow-y-auto">
            {hits.map((h) => (
              <div
                key={h.id}
                onClick={() => void apply(h.id)}
                className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-gray-50"
              >
                <span className="flex-shrink-0 font-mono text-[11px] text-gray-800">{h.customerCode ?? "—"}</span>
                <div className="min-w-0">
                  <div className="truncate text-[11px] text-gray-600">{smartTitleCase(h.customerName)}</div>
                  {(h.area || h.route) && (
                    <div className="truncate text-[10px] text-gray-400">
                      {[h.area, h.route].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {hasOverride && (
            <div className="mt-1.5 border-t border-gray-100 pt-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => void apply(null)}
                className="text-[11px] font-medium text-gray-500 hover:text-gray-800 disabled:opacity-50"
              >
                Clear ship-to redirect
              </button>
            </div>
          )}

          {err && <p className="mt-1.5 px-1 text-[10.5px] font-medium text-red-600">{err}</p>}
        </div>
      )}
    </span>
  );
}
