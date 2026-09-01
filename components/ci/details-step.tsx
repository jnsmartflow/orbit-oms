"use client";

import { useState } from "react";
import { CalendarDays, ChevronRight } from "lucide-react";
import { CiSheet } from "./sheet";
import {
  CARD_PAD,
  CARD_SURFACE,
  CiSheetOption,
  CiSpineRow,
  CiSpineValue,
  FACT_LABEL,
  ROW_GLYPH,
  INPUT_TEXT,
  ROW_GLYPH_SIZE,
  SHEET_ACTION,
  SHEET_NOTE,
  SECTION_HEAD,
  SECTION_INSET,
  SHEET_TITLE,
  SUMMARY_CHIP,
  formatCiDay,
} from "./spine";
import type { CiReturnSummary } from "@/lib/ci/derive";
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
  onOpenMaterial,
  receivedOn,
  onReceivedOn,
  reason,
  onOpenReasons,
  remark,
  onRemark,
  summary,
}: {
  materialMoved: "moved" | "not_moved";
  /** Opens the material sheet. The step no longer sets the value itself — the
   *  sheet does, through the caller, exactly as Reason already worked. */
  onOpenMaterial: () => void;
  /** "YYYY-MM-DD". Defaulted to today IST by the caller. */
  receivedOn: string;
  onReceivedOn: (v: string) => void;
  reason: CiReasonOption | null;
  onOpenReasons: () => void;
  remark: string;
  onRemark: (v: string) => void;
  /**
   * What he is about to submit. OMITTED on the read-only detail screen, which
   * shows the same facts elsewhere and does not need a pre-submit statement.
   */
  summary?: { mode: "full" | "part"; totals: CiReturnSummary };
}): React.JSX.Element {
  return (
    <>
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
      <CiSpineRow
        label="Received on"
        overlay={
          <input
            type="date"
            value={receivedOn}
            onChange={(e) => onReceivedOn(e.target.value)}
            aria-label="Date the material was received"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        }
      >
        <CiSpineValue>{formatCiDay(receivedOn)}</CiSpineValue>
        {/* The glyph is what says "this opens something". */}
        <CalendarDays size={ROW_GLYPH_SIZE} className={ROW_GLYPH} />
      </CiSpineRow>

      {/* ── MATERIAL ───────────────────────────────────────────────────────
          🔴 A SPINE ROW THAT OPENS A SHEET — IDENTICAL TO REASON (step 12).

          It was a pair of CHIPS sitting on the right of the row. Two problems,
          and the second is why they are gone rather than restyled:
            • the chips set their own height and pushed this row taller than the
              two beside it, so a card of four rows looked broken;
            • Material and Reason are the SAME KIND OF QUESTION — pick one of a
              short closed list — and answering them two different ways made the
              card read as two unrelated controls.

          Material and Reason are now visually indistinguishable as rows: same
          ROW_BASE, same CiSpineValue, same ROW_GLYPH chevron, same sheet. If
          they ever differ in a single token, one of them is wrong.

          🔴 MOVED IS FIRST AND IS THE DEFAULT (owner ruling, step 11) — a UI
          default ONLY. The column stays nullable,
          chk_ci_returns_complete_when_not_draft still requires it on any
          non-draft row, and the submit route's validation is untouched. */}
      <CiSpineRow label="Material" onClick={onOpenMaterial}>
        <CiSpineValue>{materialMoved === "moved" ? "Moved" : "Not moved"}</CiSpineValue>
        <ChevronRight size={ROW_GLYPH_SIZE} className={ROW_GLYPH} />
      </CiSpineRow>

      {/* ── REASON — opens the sheet. The only required field beyond the lines.
          The whole row is the target, and the chevron says so. */}
      <CiSpineRow label="Reason" onClick={onOpenReasons} last>
        <CiSpineValue muted={reason === null}>{reason?.label ?? "Choose"}</CiSpineValue>
        <ChevronRight size={ROW_GLYPH_SIZE} className={ROW_GLYPH} />
      </CiSpineRow>

      {/* ── REMARK — THE ONE ALLOWED EXCEPTION TO THE SPINE ─────────────────
          A right-aligned text input is miserable to type into: the caret starts
          mid-row, the text grows leftwards, and on a phone keyboard he cannot
          see what he has written. So this row keeps its label ABOVE a
          full-width input.

          ⚠ It is visibly the LAST row — a top border separating it from the
          spine above, and no hairline under it. That border is what stops the
          exception reading as a broken row.

          🔴 NO PLACEHOLDER (step 12). It read "Optional", and that word was
          doing nothing: the field IS optional, he leaves it blank, and nobody
          has ever been stopped by an empty remark. What placeholder text
          actually costs is a grey line that looks like a value already entered
          — on a glance down the card, "Optional" reads as content. The label
          and an empty box say everything. Do not put different words here. */}
      <div className={CARD_PAD + " pt-3 pb-3.5 border-t border-gray-200"}>
        <div className={FACT_LABEL}>Remark</div>
        <textarea
          value={remark}
          onChange={(e) => onRemark(e.target.value)}
          rows={2}
          aria-label="Remark"
          className={"w-full mt-1.5 resize-none " + INPUT_TEXT}
        />
      </div>
      </div>

      {summary !== undefined && <CiReturnSummaryBlock {...summary} />}
      </>
  );
}

// ── The pre-submit summary (step 13) ─────────────────────────────────────────

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 THE LAST THING HE READS BEFORE SUBMITTING — SO IT MUST BE TRUE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every figure here comes from lib/ci/derive.ts's `summariseCiReturn`, which
 * mirrors what app/api/ci/[ciId]/lines/route.ts will actually store: full means
 * every active line at its delivered quantity, part means the chosen pairs, and
 * litres are ALWAYS litresPerTin × tins. Nothing is accumulated as he taps.
 * The summary cannot claim something the submitted CI does not contain.
 *
 * 🔴 BOTH BRANCHES GET THIS BLOCK, and FULL BILL needs it most: that branch
 * never renders a line list, so this is the ONLY statement on the whole screen
 * of what "full bill" actually amounts to. Submitting a whole invoice back
 * without ever being shown the quantity is how a wrong return gets signed.
 *
 * The first two are the same 60px spine rows as everything above, so the block
 * reads as a continuation of the card and not as a new kind of thing. The pack
 * chips WRAP and come last — they are the breakdown behind the quantity above
 * them, and they are statements, not filters: nothing here is tappable.
 */
function CiReturnSummaryBlock({
  mode,
  totals,
}: {
  mode: "full" | "part";
  totals: CiReturnSummary;
}): React.JSX.Element {
  return (
    <>
      <div className={"pt-4 pb-2 " + SECTION_INSET}>
        <span className={SECTION_HEAD}>Material received</span>
      </div>
      <div className={CARD_SURFACE}>
        {/* 🔴 THE ONLY PLACE THE RETURN TYPE IS STATED on this step. The bill
            screen behind it carries the Full bill / Part control; here it is a
            fact being confirmed, not a choice being offered. */}
        <CiSpineRow label="Return">
          <CiSpineValue>{mode === "full" ? "Full bill" : "Part bill"}</CiSpineValue>
        </CiSpineRow>
        <CiSpineRow label="Quantity" last={totals.packs.length === 0}>
          <CiSpineValue>
            {totals.totalTins} tin{totals.totalTins === 1 ? "" : "s"} · {totals.totalLitres} L
          </CiSpineValue>
        </CiSpineRow>
        {totals.packs.length > 0 && (
          /* ⚠ SMALLEST PACK FIRST — the order is derive.ts's, via the shared
             sortPackLabels, which is the SAME function the line list's chip
             strip uses on the previous screen. The two cannot disagree.
             ⚠ WRAPS, NEVER SCROLLS: Picking moved off an overflow-x chip strip
             on 2026-08-20 and its source says it must not go back — chips past
             the right edge sat behind a drag nobody had reason to believe in. */
          <div className={CARD_PAD + " pb-3.5 flex flex-wrap gap-1.5"}>
            {totals.packs.map((p) => (
              <span key={p.label} className={SUMMARY_CHIP}>
                {p.label} × {p.tins}
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );
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
      <div className={SHEET_TITLE}>Reason</div>

      {error !== null && <p className={SHEET_NOTE + " text-[#b42318]"}>{error}</p>}

      {/* Reached only if the sheet is somehow opened before the caller's fetch
          resolves — the details step prefetches, so in practice this never
          paints. `min-h` holds the panel at roughly its filled height so even
          that case does not jump. */}
      {reasons === null && error === null && (
        <p className={SHEET_NOTE + " text-gray-400"}>Loading…</p>
      )}

      {pinned.map((r) => (
        <ReasonRow key={r.id} reason={r} selected={r.id === selectedId} onPick={onPick} />
      ))}

      {rest.length > 0 && (
        <>
          {/* The divider IS the "three common ones first" rule, drawn. */}
          <div className="h-px bg-gray-200 mx-4 my-1.5" />
          {showMore ? (
            rest.map((r) => (
              <ReasonRow key={r.id} reason={r} selected={r.id === selectedId} onPick={onPick} />
            ))
          ) : (
            <button
              type="button"
              onClick={() => setShowMore(true)}
              className={SHEET_ACTION}
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
    <CiSheetOption label={reason.label} selected={selected} onPick={() => onPick(reason)} />
  );
}

// ── The material sheet (step 12) ─────────────────────────────────────────────

/**
 * 🔴 THE SAME CiSheet AS THE REASON PICKER, NOT A SECOND IMPLEMENTATION.
 * Same shell (components/ci/sheet.tsx), same title type, same option rows
 * (CiSheetOption in spine.tsx). The two pickers answer the same shape of
 * question and must look and behave identically; anything either one grows
 * later belongs in the shared pieces, not in one of them.
 *
 * ⚠ TWO OPTIONS AND NO "MORE" DIVIDER — the reason sheet's divider is DATA (the
 * three pinned reasons above the rest), and there is nothing to pin in a list of
 * two. MOVED IS FIRST, matching the row's default.
 *
 * ⚠ The list is HARDCODED here, and that is correct where the reason list is
 * not: these two values are the `materialMoved` CHECK constraint itself
 * (isCiMaterialMoved in lib/ci/types.ts), not depot-editable rows. Adding a
 * third would be a schema change, and it would fail loudly rather than silently
 * offering something the submit route refuses.
 */
export function CiMaterialSheet({
  value,
  onPick,
  onCancel,
}: {
  value: "moved" | "not_moved";
  onPick: (v: "moved" | "not_moved") => void;
  onCancel: () => void;
}): React.JSX.Element {
  return (
    <CiSheet label="Material" onDismiss={onCancel}>
      <div className={SHEET_TITLE}>Material</div>
      {(["moved", "not_moved"] as const).map((v) => (
        <CiSheetOption
          key={v}
          label={v === "moved" ? "Moved" : "Not moved"}
          selected={value === v}
          onPick={() => onPick(v)}
        />
      ))}
    </CiSheet>
  );
}
