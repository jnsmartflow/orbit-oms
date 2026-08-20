"use client";

// Billing v2 — the Picking tab's bill detail panel.
//
// Opens when the operator clicks a Pending row. Answers one question — "what is
// on this bill, and which line did the floor confirm short?" — and, since
// 2026-08-20, carries the ONE action that follows from the answer: Mark done.
//
// ── WHY IT IS NO LONGER READ-ONLY ──────────────────────────────────────────
// A bill with a supervisor-confirmed finding renders NO checkbox on the list
// (billing-picking-tab.tsx), so it cannot be swept into a Copy OBDs → Mark done
// batch — the whole point being that someone must read the finding before
// invoicing against it. This panel is where they read it, so this panel is
// where the decision gets recorded. The button is shown for EVERY pending bill,
// flagged or not; a second way to do a thing is fine, a bill with no way at all
// is not.
//
// The write itself stays where it always was: POST /api/billing/picking/mark-done
// with a one-element `orderIds`, the same route, the same canEdit gate, the same
// single updateMany the bulk bar uses. This file adds a button and a marker
// pause, not a write path.
//
// ── DELIBERATELY NOT components/floor/detail-panel.tsx ─────────────────────
// That panel is the visual and structural reference — same 472px right-hand
// aside, same backdrop, same fixed-header / scrolling-body / fixed-footer
// split, same Items row geometry (components/floor/detail-items.tsx) — but it
// is NOT imported and NOT reused, for two independent reasons:
//   1. It fetches /api/floor/order/[orderId], gated on `floor`/canView, which
//      the billing operators do not hold (CLAUDE_MAIL_ORDERS §23.3).
//   2. It is an ACTION surface — ship-to, slot, assign, hold, cancel, tabs.
//      This one has a ✕ and a single Mark done. Borrowing it would mean gating
//      nearly all of its controls off from the inside, which is how a shared
//      component ends up owned by nobody (§23.6: "filter/gate at the CALL SITE,
//      never restyle the shared card" — here the honest call is a separate
//      component). One button of overlap does not change that arithmetic.
//
// ── RED = CONFIRMED, AND ONLY CONFIRMED ────────────────────────────────────
// The server sends confirmed findings only, so anything red on this panel has a
// supervisor's name against it. The treatment is the shortfall mockup's
// `.line-card.short` (#fef2f2 fill / #fca5a5 border) plus the note line from
// components/picking/finding-recorder.tsx — same words, same #b91c1c, so the
// floor and the billing desk describe one event identically.
//
// ⚠ The picking board's "do not re-add a row fill" note (finding-recorder.tsx
// :121) does NOT apply here and is not being overridden. That note is about
// tinting LINE ROWS on the mobile picker's bill, where several rows in one bill
// go red and the whole screen reads as alarming. Here the panel is opened FROM
// a flagged row: the operator has already been told this bill is short and is
// looking for WHICH line. The fill is the answer to that question, on one or
// two lines out of many.

import { useCallback, useEffect, useState } from "react";
import { findingReasonLabel, mfgLabel } from "@/lib/picking/findings-reasons";
import { smartTitleCase } from "@/lib/mail-orders/utils";
import { useBillingMarkerPause } from "@/components/billing/billing-marker-provider";
import type { BillingDetailLine, BillingOrderDetail } from "@/lib/billing/types";

const DETAIL_URL = "/api/billing/picking/order";
// The SAME route the bulk bar posts to, with a one-element array — its contract
// is `{ orderIds: number[] }` and a batch of one is an ordinary batch. Not a new
// single-bill endpoint: the write, its canEdit gate, its pending-predicate WHERE
// and its idempotence all stay in one place
// (app/api/billing/picking/mark-done/route.ts).
const MARK_DONE_URL = "/api/billing/picking/mark-done";

// The two red tokens, verbatim from the shortfall mockup's `.line-card.short`
// and finding-recorder.tsx's CONFIRMED_TEXT. Named here rather than inlined so
// the card and its note cannot drift apart.
const SHORT_FILL = "#fef2f2";
const SHORT_BORDER = "#fca5a5";
const SHORT_TEXT = "#b91c1c";

/** "08 Aug 2026 · 14:32" — the same formatter Floor's panel header uses. */
function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso)
    .toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Kolkata",
    })
    .replace(",", " ·");
}

export function BillingOrderDetailPanel({
  orderId,
  onClose,
  onMarkedDone,
}: {
  orderId: number;
  onClose: () => void;
  /**
   * Fired AFTER the server has acknowledged the mark-done write for this bill.
   * The parent closes the panel and refetches its list; this component does not
   * call `onClose` itself on success, so there is exactly one place that decides
   * what "done" looks like on the list behind it.
   */
  onMarkedDone: (orderId: number) => void;
}) {
  const [detail, setDetail] = useState<BillingOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The write's own state, kept apart from `loading`/`error`, which belong to
  // the fetch. A failed mark-done must not blank a panel that loaded fine.
  const [marking, setMarking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  /**
   * Hold the SHARED billing marker while the write is in flight — the same
   * contract the tab's bulk actions use (`useBillingMarkerPause`,
   * components/billing/billing-marker-provider.tsx), under its OWN key so the
   * two holders cannot clobber each other.
   *
   * Without it the 30s poll can land mid-write and re-render the list under the
   * operator. Released on unmount by the hook itself, which matters here: on
   * success this panel unmounts before `marking` ever flips back to false.
   */
  useBillingMarkerPause("picking-detail-mark-done", marking);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${DETAIL_URL}/${orderId}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { detail: BillingOrderDetail };
      setDetail(json.detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void fetchDetail();
  }, [fetchDetail]);

  /**
   * Mark THIS bill done — the panel's only write, and the only route to
   * invoicing a bill that carries a confirmed finding (those get no checkbox on
   * the list, see billing-picking-tab.tsx).
   *
   * Deliberately the same shape as the tab's `post()`: POST, read the body,
   * surface a shortfall rather than swallowing it, let the parent refetch. The
   * route is IDEMPOTENT (its pending predicate is AND-ed into the updateMany),
   * so a double-tap is a 0-row no-op, not a double invoice — `marking` guards
   * the second click anyway.
   *
   * `updated === 0` is the interesting case and NOT an error: someone else
   * marked it, or SAP invoiced it, between opening the panel and clicking. The
   * bill is genuinely done, so the honest response is to say so and re-fetch —
   * `isPending` comes back false and the button removes itself.
   */
  const markDone = async () => {
    if (!detail || marking) return;
    setMarking(true);
    setActionError(null);
    try {
      const res = await fetch(MARK_DONE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: [detail.orderId] }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        updated?: number;
        error?: string;
      };
      if (!res.ok) {
        setActionError(body.error ?? `Failed (HTTP ${res.status}).`);
        return;
      }
      if (body.updated === 0) {
        setActionError("This bill had already moved on — nothing left to mark.");
        await fetchDetail();
        return;
      }
      onMarkedDone(detail.orderId);
    } catch {
      setActionError("Could not reach the server.");
    } finally {
      // Safe after the success path too: React 18 does not warn on a setState
      // into an unmounted tree, and the pause is released by the hook's own
      // unmount cleanup, not by this line.
      setMarking(false);
    }
  };

  // Esc closes. CAPTURE PHASE + stopPropagation, the convention every other
  // overlay in this module follows (review-view.tsx:368-375,
  // slot-completion-modal.tsx:32-38) — the mail-orders screen has its own
  // keyboard handling underneath, and a bubble-phase listener here would let
  // one Esc close this panel AND act on whatever is behind it. Mounted only
  // while the panel is open, so it costs the list nothing when closed.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey, { capture: true });
    return () => document.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[110]">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-[472px] flex-col bg-white shadow-[-14px_0_40px_rgba(17,24,39,0.10)]">
        {loading && !detail ? (
          <div className="flex flex-1 items-center justify-center text-[11.5px] text-gray-400">
            Loading&hellip;
          </div>
        ) : error && !detail ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="text-[12px] text-gray-500">Couldn&rsquo;t load this bill. {error}</div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-200 px-3 py-1.5 text-[11.5px] text-gray-600"
            >
              Close
            </button>
          </div>
        ) : detail ? (
          <>
            {/* ── Header (fixed) ─────────────────────────────────────────── */}
            <div className="border-b border-gray-200 px-5 pb-3.5 pt-3.5">
              <div className="flex items-baseline gap-2.5">
                <span className="font-mono text-[19px] font-bold leading-none tracking-[-0.02em] text-gray-900">
                  {detail.obdNumber}
                </span>
                <span className="text-[11px] tabular-nums text-gray-400">
                  {fmtDateTime(detail.obdDateTime)}
                </span>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="ml-auto self-center text-gray-400 hover:text-gray-600"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[16px] font-bold text-gray-900">
                  {detail.customerName ? smartTitleCase(detail.customerName) : "(Unmatched)"}
                </span>
                {detail.customerCode && (
                  <span className="font-mono text-[11.5px] text-gray-400">{detail.customerCode}</span>
                )}
                {/* The name above is the OVERRIDE dealer when one is set, not the
                    SAP bill-to — say so, or it silently contradicts the invoice
                    the operator is about to raise. Same ⚑ the list row uses. */}
                {detail.isShipToOverride && (
                  <span
                    title="Ship-to overridden"
                    className="rounded border border-amber-200 bg-amber-50 px-1.5 py-px text-[9.5px] font-bold text-amber-700"
                  >
                    ⚑ Ship-to changed
                  </span>
                )}
              </div>
            </div>

            {/* ── Items (scrolls) ────────────────────────────────────────── */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {detail.lines.length === 0 ? (
                <div className="px-5 py-10 text-center text-[11.5px] text-gray-400">
                  No line items on this bill.
                </div>
              ) : (
                detail.lines.map((line, i) => (
                  <DetailLineRow key={line.id} line={line} index={i + 1} />
                ))
              )}
            </div>

            {/* ── Total (fixed foot) ─────────────────────────────────────── */}
            {/* Counts EVERY active line, flagged or not. A short line is still a
                line on the bill — netting it out here would quietly disagree
                with the SAP invoice the operator raises next. */}
            <div className="flex border-t border-gray-200 bg-[#fafafa] px-5 py-[11px] text-[12px] font-semibold text-[#374151]">
              <span>
                {detail.lineCount} line{detail.lineCount === 1 ? "" : "s"}
              </span>
              <span className="ml-auto tabular-nums">{detail.totalLitres} L</span>
            </div>

            {/* ── Action bar (fixed foot) ────────────────────────────────── */}
            {/* A SEPARATE strip below the total, never a button dropped into
                it: the total row is a fact about the bill and the operator
                reads it right before invoicing, so nothing clickable belongs
                on that line.

                Shown while the bill is still pending — `detail.isPending`
                straight off the payload, which the route computes from
                buildBillingPendingWhere() itself, so the button cannot appear
                on a bill the write would refuse. Also shown while an
                actionError stands, so the "already moved on" message survives
                the refetch that flips isPending false. */}
            {(detail.isPending || actionError) && (
              <div className="flex items-center gap-3 border-t border-gray-200 bg-white px-5 py-[11px]">
                {actionError && (
                  <span className="min-w-0 flex-1 text-[11px] leading-snug text-amber-700">
                    {actionError}
                  </span>
                )}
                {detail.isPending && (
                  /* The SAME ghost styling as the bulk bar's Mark done
                     (billing-picking-tab.tsx). One action, one look, wherever
                     it is reached from. Not teal: on this screen teal means the
                     primary CTA (Copy OBDs) and the live pip, and a teal button
                     here would read as a different action. */
                  <button
                    type="button"
                    onClick={markDone}
                    disabled={marking}
                    className="ml-auto inline-flex h-[34px] shrink-0 items-center gap-2 rounded-md border border-gray-300 bg-white px-[13px] text-[12px] font-medium text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {marking ? "Marking…" : "Mark done"}
                  </button>
                )}
              </div>
            )}
          </>
        ) : null}
      </aside>
    </div>
  );
}

/**
 * One line. Geometry lifted from components/floor/detail-items.tsx (index ·
 * name · SKU + pack chip · qty · litres) so the two panels read as one family.
 *
 * A confirmed finding adds the fill, the left border and the note — and changes
 * NOTHING else about the row. The quantity shown stays the quantity ORDERED:
 * what was actually found is stated in the note, in words, next to the name of
 * the person who confirmed it. Silently swapping in `qtyFound` would make the
 * panel disagree with the SAP order the operator is invoicing against.
 */
function DetailLineRow({ line, index }: { line: BillingDetailLine; index: number }) {
  const f = line.finding;
  // Same shared formatter the picking boards' FindingNote uses, so one event
  // cannot print as "Mar 2024" on the floor and something else on this desk.
  // Null on short_quantity, and on a legacy old_mfg row that predates the
  // columns — in both cases the note simply omits the segment.
  const mfg = f ? mfgLabel(f.mfgMonth, f.mfgYear) : null;
  return (
    <div
      className="flex items-start gap-[11px] border-b border-[#f5f5f5] px-5 py-[9px]"
      style={
        f
          ? { background: SHORT_FILL, borderLeft: `3px solid ${SHORT_BORDER}`, paddingLeft: 17 }
          : undefined
      }
    >
      <span className="w-[14px] pt-[3px] text-[10px] tabular-nums text-[#d1d5db]">{index}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium leading-[1.4] text-[#111827]">
          {line.name ?? <span className="italic text-[#9ca3af]">{line.sku}</span>}
          {line.isTint && (
            <span className="ml-1.5 inline-block h-[7px] w-[7px] rounded-full bg-[#7c3aed] align-[1px]" />
          )}
        </div>
        <div className="mt-[3px] font-mono text-[10px] text-[#9ca3af]">
          {line.sku}
          {line.pack && (
            <span className="ml-[5px] rounded-[3px] bg-[#f3f4f6] px-[5px] py-px text-[#6b7280]">
              {line.pack}
            </span>
          )}
        </div>
        {/* The note. Wording tracks finding-recorder.tsx's FindingNote —
            "Found <n> · <reason>" — and was trimmed with it (2026-08-08): the
            "✓ Confirmed:" prefix and the "of <ordered>" both went. The prefix
            is redundant here for a different reason than on the picking boards:
            this panel shows CONFIRMED findings ONLY (the route filters
            recordedById IS NOT NULL), so "Confirmed" was true of every note on
            the screen and distinguished nothing. The ordered qty sits in its own
            column on the same row, two elements away.
            The NAME stays, and only here — this is the one screen whose reader
            did not confirm it and has to know who to go and ask. The picking
            boards omit it because there the supervisor IS the reader.
            ⚠ ORDER MATTERS (2026-08-09): the MFG date goes immediately after
            the reason it qualifies — "Found 9 · Old MFG · Mar 2024 · Name" —
            NOT after the name. The date belongs to the finding; the name
            belongs to the act of confirming it, and it stays last so the tail
            of every note on this panel is the same shape. Short-quantity rows
            get no date segment at all (mfgLabel returns null), so they read
            "Found 0 · Short quantity · Name" exactly as before. */}
        {f && (
          <div className="mt-1 text-[11.5px] leading-[1.45]" style={{ color: SHORT_TEXT }}>
            <span className="font-bold tabular-nums">Found {f.qtyFound}</span>
            {" · "}
            {findingReasonLabel(f.reason)}
            {mfg && <> · {mfg}</>}
            {f.recordedByName && <> · {f.recordedByName}</>}
          </div>
        )}
      </div>
      <span className="whitespace-nowrap pt-px text-[12.5px] font-semibold text-[#374151]">
        {line.qty}&times;
      </span>
      <span className="w-[56px] pt-[2px] text-right text-[11px] tabular-nums text-[#9ca3af]">
        {line.litres ? `${line.litres} L` : "—"}
      </span>
    </div>
  );
}
