"use client";

// Billing v2 — the Picking tab's read-only bill detail panel.
//
// Opens when the operator clicks a Pending row. Answers exactly one question:
// "what is on this bill, and which line did the floor confirm short?" Nothing
// on it writes.
//
// ── DELIBERATELY NOT components/floor/detail-panel.tsx ─────────────────────
// That panel is the visual and structural reference — same 472px right-hand
// aside, same backdrop, same fixed-header / scrolling-body / fixed-footer
// split, same Items row geometry (components/floor/detail-items.tsx) — but it
// is NOT imported and NOT reused, for two independent reasons:
//   1. It fetches /api/floor/order/[orderId], gated on `floor`/canView, which
//      the billing operators do not hold (CLAUDE_MAIL_ORDERS §23.3).
//   2. It is an ACTION surface — ship-to, slot, assign, hold, cancel, tabs.
//      This one has a ✕ and nothing else. Borrowing it would mean gating half
//      its controls off from the inside, which is how a shared component ends
//      up owned by nobody (§23.6: "filter/gate at the CALL SITE, never restyle
//      the shared card" — here the honest call is a separate component).
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
import { findingReasonLabel } from "@/lib/picking/findings-reasons";
import { smartTitleCase } from "@/lib/mail-orders/utils";
import type { BillingDetailLine, BillingOrderDetail } from "@/lib/billing/types";

const DETAIL_URL = "/api/billing/picking/order";

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
}: {
  orderId: number;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<BillingOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
            boards omit it because there the supervisor IS the reader. */}
        {f && (
          <div className="mt-1 text-[11.5px] leading-[1.45]" style={{ color: SHORT_TEXT }}>
            <span className="font-bold tabular-nums">Found {f.qtyFound}</span>
            {" · "}
            {findingReasonLabel(f.reason)}
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
