"use client";

import { useState } from "react";
import { CalendarDays, ChevronRight } from "lucide-react";
import { CiSheet } from "./sheet";
import {
  CARD_PAD,
  CARD_SURFACE,
  CHIP_BASE,
  CHIP_OFF,
  CHIP_ON,
  CiSpineRow,
  CiSpineValue,
  FACT_LABEL,
  ROW_HAIRLINE,
} from "./spine";
import type { CiReasonOption } from "@/lib/ci/types";

// The details step and its reason sheet — frames 6 and 7 of
// docs/mockups/ci/supervisor.html.
//
// Four rows in this order: Received on · Return-type context · Material ·
// Reason, then Remark. The bottom pill is Submit and it stays DISABLED until a
// reason is chosen.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 THIS IS THE SAME OBJECT AS THE READ-ONLY DETAIL SCREEN (step 11)
// ═══════════════════════════════════════════════════════════════════════════
//
// components/ci/submitted-detail.tsx shows these same facts, read rather than
// typed. Until step 11 the two were built differently — this one was full-width
// stacked bands with tiny uppercase letter-spaced labels, that one was the
// approved label-left / value-right spine — so the supervisor met two screens
// where there is one thing.
//
// EVERY token here now comes from components/ci/spine.tsx, which both screens
// import. There is no local size, weight, colour, gutter or hairline in this
// file, and adding one is how the two come apart again.
//
// ⚠ NO HELPER COPY (spec §7). No explanation under a control, no note about
// what "Not moved" means. The mockup has none and the supervisor does this
// daily.
//
// ⚠ The teal header and the sub-header strip are NOT here — they are rendered
// once by new-return.tsx and stay fixed across frames 3 to 7, which is what
// keeps the bill identity on screen while everything below it changes.
//
// ⚠ NO SCROLLER ON THE ROOT. It used to carry `flex-1 overflow-y-auto`, which
// was right in new-return.tsx (a flex child) and WRONG inside
// submitted-detail.tsx, which already provides its own `flex-1 min-h-0
// overflow-y-auto` — two nested scroll regions, the inner one unbounded. The
// caller owns the scrolling; this renders a plain card.

export function CiDetailsStep({
  materialMoved,
  onMaterialMoved,
  receivedOn,
  onReceivedOn,
  reason,
  onOpenReasons,
  remark,
  onRemark,
}: {
  materialMoved: "moved" | "not_moved";
  onMaterialMoved: (v: "moved" | "not_moved") => void;
  /** "YYYY-MM-DD". Defaulted to today IST by the caller. */
  receivedOn: string;
  onReceivedOn: (v: string) => void;
  reason: CiReasonOption | null;
  onOpenReasons: () => void;
  remark: string;
  onRemark: (v: string) => void;
}): React.JSX.Element {
  return (
    <div className={CARD_SURFACE + " mt-3"}>
      {/* ── RECEIVED ON ────────────────────────────────────────────────────
          THE NATIVE DATE CONTROL, deliberately: a hand-rolled picker on a depot
          phone is a support call waiting to happen, and the OS one is the widget
          he already knows, in his locale, at his thumb size.

          🔴 THE WHOLE ROW IS THE TAP TARGET. The bare `<input type="date">` this
          replaces rendered as plain left-aligned text — it did not look tappable
          and it broke the spine, because a date input sizes itself and will not
          sit on the right edge. The input is now a transparent overlay across
          the row: the tap lands on it and opens the picker wherever he presses,
          while what he READS is our own formatted value on the spine.

          ⚠ `opacity-0`, NOT `hidden` or `display:none` — a hidden input cannot
          be tapped and cannot open a picker. It must stay in the layout. */}
      <div className={CARD_PAD + " py-3 flex items-center justify-between gap-4 relative " + ROW_HAIRLINE}>
        <span className={FACT_LABEL + " shrink-0"}>Received on</span>
        <span className="min-w-0 flex items-center justify-end gap-2 text-right">
          <CiSpineValue>{formatDay(receivedOn)}</CiSpineValue>
          {/* The glyph is what says "this opens something". */}
          <CalendarDays size={15} className="text-[#98a2b3] shrink-0" />
        </span>
        <input
          type="date"
          value={receivedOn}
          onChange={(e) => onReceivedOn(e.target.value)}
          aria-label="Date the material was received"
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
      </div>

      {/* ── MATERIAL ───────────────────────────────────────────────────────
          🔴 MOVED FIRST, AND MOVED IS THE DEFAULT (owner ruling, step 11).
          The order flipped and the pre-selected value with it. This is a UI
          default ONLY: the column stays nullable, chk_ci_returns_complete_when_
          not_draft still requires it on any non-draft row, and the submit
          route's validation is untouched — it will still refuse a CI that
          arrives without one.

          🔴 THE SELECTED SIDE IS DARK-FILLED — Picking's TypeFilterPills token
          (see spine.tsx). The segmented control this replaces put WHITE on a
          white pill inside a grey trough, which on a depot phone in daylight is
          no signal at all: he could not tell which side he had picked. */}
      <CiSpineRow label="Material">
        <span className="flex items-center gap-1.5 shrink-0">
          {(["moved", "not_moved"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onMaterialMoved(v)}
              aria-pressed={materialMoved === v}
              className={CHIP_BASE + " " + (materialMoved === v ? CHIP_ON : CHIP_OFF)}
            >
              {v === "moved" ? "Moved" : "Not moved"}
            </button>
          ))}
        </span>
      </CiSpineRow>

      {/* ── REASON — opens the sheet. The only required field beyond the lines.
          The whole row is the target, and the chevron says so. */}
      <CiSpineRow label="Reason" onClick={onOpenReasons} last>
        <CiSpineValue muted={reason === null}>{reason?.label ?? "Choose"}</CiSpineValue>
        <ChevronRight size={15} className="text-[#98a2b3] shrink-0" />
      </CiSpineRow>

      {/* ── REMARK — THE ONE ALLOWED EXCEPTION TO THE SPINE ─────────────────
          A right-aligned text input is miserable to type into: the caret starts
          mid-row, the text grows leftwards, and on a phone keyboard he cannot
          see what he has written. So this row keeps its label ABOVE a
          full-width input.

          ⚠ It is visibly the LAST row — a top border separating it from the
          spine above, and no hairline under it. That border is what stops the
          exception reading as a broken row.

          Optional, and the placeholder says so rather than a note underneath
          (spec §7: no helper copy). */}
      <div className={CARD_PAD + " pt-3 pb-3.5 border-t border-gray-200"}>
        <div className={FACT_LABEL}>Remark</div>
        <textarea
          value={remark}
          onChange={(e) => onRemark(e.target.value)}
          placeholder="Optional"
          rows={2}
          aria-label="Remark"
          className="w-full mt-1.5 text-[13px] text-[#1d2939] bg-transparent outline-none resize-none placeholder:text-[#98a2b3] placeholder:font-medium"
        />
      </div>
    </div>
  );
}

/** "31 Aug 2026" from "YYYY-MM-DD". Matches submitted-detail.tsx's formatter
 *  exactly — the two screens must never print a date differently. */
function formatDay(iso: string): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ── The reason sheet (frame 7) ───────────────────────────────────────────────

/**
 * 🔴 THE LIST IS FETCHED, NEVER HARDCODED. It lives in `ci_reason_master` so the
 * depot can add, relabel or retire a reason without a deploy (spec §3.1). A
 * copy in this file would go stale the first time a row is edited, and the phone
 * would offer a reason the submit route then refuses.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 THE FETCH IS THE CALLER'S. THIS SHEET TAKES `reasons` AS A PROP AND PAINTS
 *    ONCE — DO NOT MOVE THE FETCH BACK INSIDE IT.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * It used to fetch in its own mount effect, and that is what made the sheet
 * "hang while coming up" (reported 2026-09-01). The panel is bottom-anchored
 * with content-driven height, so it painted first as a ~60px "Loading…" strip
 * and then JUMPED to full height when the eight rows landed — a two-stage
 * layout change under the operator's thumb, on depot wifi.
 *
 * ⚠ IT WAS NEVER A MISSING ANIMATION. Adding a transition would have made the
 * jump smoother and just as wrong. Picking's FilterBottomSheet and MRN's
 * LineSheet both take their content as props already in memory and paint once
 * at final height; this now does the same. `CiNewReturn` fetches when the
 * details step opens, so by the time this mounts the rows are already there.
 *
 * The divider is DATA too: three `isPinned` rows above it, the rest under
 * "More". This component does not decide how many are pinned — it renders which
 * ones are, ordered by `sortOrder` within each group (the route already sorts).
 */
export function CiReasonSheet({
  reasons,
  error,
  selectedId,
  onPick,
  onCancel,
}: {
  /** null = still loading (the caller's fetch has not resolved). */
  reasons: CiReasonOption[] | null;
  error: string | null;
  selectedId: number | null;
  onPick: (reason: CiReasonOption) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [showMore, setShowMore] = useState(false);

  const pinned = (reasons ?? []).filter((r) => r.isPinned);
  const rest = (reasons ?? []).filter((r) => !r.isPinned);

  return (
    <CiSheet label="Reason" onDismiss={onCancel}>
      <div className="px-[14px] pb-2 text-[15px] font-semibold text-gray-900">Reason</div>

      {error !== null && <p className="px-[14px] py-6 text-[13px] text-[#b42318]">{error}</p>}

      {/* Reached only if the sheet is somehow opened before the caller's fetch
          resolves — the details step prefetches, so in practice this never
          paints. `min-h` holds the panel at roughly its filled height so even
          that case does not jump. */}
      {reasons === null && error === null && (
        <p className="px-[14px] py-6 text-[13px] text-gray-400">Loading…</p>
      )}

      {pinned.map((r) => (
        <ReasonRow key={r.id} reason={r} selected={r.id === selectedId} onPick={onPick} />
      ))}

      {rest.length > 0 && (
        <>
          {/* The divider IS the "three common ones first" rule, drawn. */}
          <div className="h-px bg-gray-200 mx-[14px] my-1.5" />
          {showMore ? (
            rest.map((r) => (
              <ReasonRow key={r.id} reason={r} selected={r.id === selectedId} onPick={onPick} />
            ))
          ) : (
            <button
              type="button"
              onClick={() => setShowMore(true)}
              className="w-full text-left px-[14px] py-3.5 text-[15px] font-semibold text-teal-700 active:bg-gray-50"
            >
              More
            </button>
          )}
        </>
      )}
    </CiSheet>
  );
}

function ReasonRow({
  reason,
  selected,
  onPick,
}: {
  reason: CiReasonOption;
  selected: boolean;
  onPick: (r: CiReasonOption) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onPick(reason)}
      className="w-full text-left px-[14px] py-3.5 flex items-center justify-between gap-3 active:bg-gray-50"
    >
      <span className="text-[15px] text-gray-900 truncate min-w-0">{reason.label}</span>
      {selected && <span className="text-teal-600 shrink-0 text-[15px]">✓</span>}
    </button>
  );
}
