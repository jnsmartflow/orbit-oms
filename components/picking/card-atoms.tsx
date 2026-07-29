"use client";

import type { PickingQueueRow } from "@/lib/picking/types";

// ── Shared Picking card atoms ───────────────────────────────────────────────
// Extracted 2026-07-29 from components/picking/picking-board-mobile.tsx, where
// all three lived inline, when the picker's "My Picks" card gained the same
// signals. Both boards import from here.
//
// Why these three and nothing more: each encodes a RULE (a colour scale, a
// chip's exact token pair) that would drift the day someone edits one copy.
// The card itself is deliberately NOT shared — the two cards genuinely differ
// (the picker has no lock, no selection tint, no elapsed pill, no released
// chip), and a shared card would carry supervisor-only props for no reason.
//
// This file lives under components/picking/, not components/shared/, because
// AgeBadge is typed on PickingQueueRow: these are the picking module's atoms,
// shared BETWEEN ITS TWO BOARDS, not app-wide primitives.
//
// Markup below is byte-identical to the inline originals — same classNames,
// same inline style objects, same null-returns. Nothing was restyled in the
// move.

// Age badge for the Due-now zone. Reads `ageDays` straight off the row
// (computed server-side in queue.ts) — never recomputed here, so the board
// and the server can never disagree about how stale a bill is.
//
// The scale, per the approved mockups:
//   0d   → NOTHING. Absence IS the "fresh" signal; a grey "0d" chip on the
//          majority of cards would bury the amber ones it exists to surface.
//   1d   → subtle amber, no border (a nudge; yesterday is not a crisis)
//   2-3d → solid amber + border (ONE band, not two — the eye cannot resolve
//          a separate 2d and 3d treatment at card scale)
//   4d+  → red. The forgotten pick, and the only red on this board.
//
// noDispatchDate wins over all of it: a missing date is a DATA GAP, not
// staleness, so it gets a NEUTRAL grey chip. Amber would assert an urgency
// the data cannot support, and would make ageDays:null look like ageDays:999.
//
// ⚠ THE COLOUR SCALE LIVES HERE AND ONLY HERE. Both picking boards render
// this component; never re-map days→colour at a call site.
export function AgeBadge({ row }: { row: PickingQueueRow }): React.JSX.Element | null {
  if (row.noDispatchDate) {
    return (
      <span className="text-[10.5px] font-semibold px-2 py-[3px] rounded-full shrink-0 whitespace-nowrap bg-gray-100 text-gray-500">
        no date
      </span>
    );
  }
  const days = row.ageDays;
  if (days === null || days <= 0) return null;
  const cls =
    days >= 4
      ? "bg-red-50 text-red-700 border border-red-200"
      : days >= 2
        ? "bg-amber-100 text-amber-800 border border-amber-300"
        : "bg-amber-50 text-amber-700";
  return (
    <span
      className={
        "text-[10.5px] font-semibold px-2 py-[3px] rounded-full shrink-0 whitespace-nowrap tabular-nums " + cls
      }
    >
      {days}d
    </span>
  );
}

// One product-family chip. `families` arrives already display-resolved and
// alpha-sorted from lib/picking/queue.ts — rendered AS-IS, never re-sorted or
// re-cased at the call site.
//
// `muted` is the supervisor's locked/checked-card treatment (assignLocked,
// doneChecked). It defaults to false, which is the CLAUDE_UI.md §60 token pair
// (#667085 on #eef1f5) — so a caller with no muted state, like the picker
// board, gets the documented default by omission.
//
// shrink-0 + whitespace-nowrap are part of the atom on purpose: every consumer
// puts these in a single non-wrapping scroll row, and a chip that shrinks or
// wraps breaks the uniform card height that layout depends on.
export function FamilyChip({
  label,
  muted = false,
}: {
  label: string;
  muted?: boolean;
}): React.JSX.Element {
  return (
    <span
      className="shrink-0 whitespace-nowrap text-[10.5px] font-semibold rounded-[7px] py-[3px] px-[8px]"
      style={{ color: muted ? "#8a929c" : "#667085", background: muted ? "#f1f3f6" : "#eef1f5" }}
    >
      {label}
    </span>
  );
}

// The "+N unlisted" honesty chip — trails the family chips when the bill has
// active lines whose SAP code resolved to no family (the ~27% of codes in
// neither catalog table, CLAUDE_PICKING.md §7's blank-pack landmine). Counts
// LINES, not distinct codes.
//
// Dashed and grey by design: it is an admission that the catalog is
// incomplete, NOT a product family, so it must never read as one more chip in
// the list. Renders nothing at 0 — the caller need not guard.
export function UnlistedChip({ count }: { count: number }): React.JSX.Element | null {
  if (count <= 0) return null;
  return (
    <span
      className="shrink-0 whitespace-nowrap text-[11.5px] font-semibold rounded-[8px] px-[9px] py-1 border border-dashed"
      style={{ color: "#9aa2ac", borderColor: "#d8dce1" }}
    >
      +{count} unlisted
    </span>
  );
}
