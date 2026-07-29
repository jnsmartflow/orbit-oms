"use client";

import { ChevronRight } from "lucide-react";
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

// Card shadow — the locked v2 look (docs/mockups/picking/picking-cards-final-v2.html).
// Distinct from SOFT_CARD_SHADOW, which the detail line-item rows still use.
export const CARD_SHADOW_V2 = "0 1px 2px rgba(16,24,40,.03), 0 14px 26px -20px rgba(16,24,40,.2)";

// Route colour dot — colour ONLY, no text (CLAUDE_CORE.md §3 delivery dots +
// design spec §2). Local blue, Upcountry orange, Cross rose; IGT / unknown /
// null → neutral grey. Deliberately NO teal here — the one-teal rule reserves
// teal for the Assign CTA, so a teal IGT dot (UI §3's nominal colour) is
// overridden to grey on this card.
//
// ⚠ Keys on `deliveryType`, NOT on route — there is no route→colour data in the
// payload at all (CLAUDE_UI.md §62.3). The name is the trap.
const ROUTE_DOT_COLOR: Record<string, string> = {
  Local: "#2563eb",
  Upcountry: "#ea580c",
  Cross: "#e11d48",
};
export function RouteDot({ deliveryType }: { deliveryType: string | null }): React.JSX.Element {
  const color = (deliveryType !== null && ROUTE_DOT_COLOR[deliveryType]) || "#9ca3af";
  return <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} aria-hidden="true" />;
}

// Rich-card shelf — the DIVIDER + the grey band + FAMILY CHIPS, plus one
// optional right-hand slot. Both boards render this; the band colour, the
// divider and the fade gradient exist here and nowhere else.
//
// The old goods/breakdown line (articleTag + volume) is gone (Option G,
// 2026-07-21); volume moved to the route line. Chips are ONE horizontally-
// scrollable line that NEVER wraps (flex-nowrap + per-chip shrink-0) so every
// card keeps a uniform height; a right-edge fade cues the overflow, fading the
// chips into whatever occupies the right slot (or the card edge, when nothing
// does).
//
// Layout: a flex row — [chips: flex-1 min-w-0, scrolling] + [right slot: shrink-0].
// `families` arrives already display-resolved + alpha-sorted from
// lib/picking/queue.ts — rendered AS-IS. The "+N unlisted" chip trails only when
// unresolvedLineCount > 0 (UnlistedChip self-guards at 0).
//
// The right slot is filled by EITHER of two mutually-exclusive things:
//
// showViewItems (supervisor Assign only, 2026-07-21) — renders the arrow AND
// forces the shelf to render even with zero chips, so detail stays reachable
// now that a card-body tap toggles SELECTION instead of opening detail. The
// arrow stopPropagation()s and calls onViewItems (= openDetail); it must NEVER
// toggle selection, and it sits at the right edge, away from the card centre,
// so rapid select-taps don't land on it. It owns a 44px min tap target and is
// NOT teal (one-teal rule reserves teal for the selected tint) — a quiet slate
// #eceff3 circle. Supervisor Picking cards pass false and keep the
// null-when-empty behaviour (no arrow, card-body tap still opens detail).
//
// trailing (picker Done tab, 2026-07-29) — an arbitrary already-styled node,
// used for the "done 6:18 PM" receipt. The picker card has no arrow (its whole
// body opens detail, so a second control for the same action would be noise),
// which is exactly why that slot is free for a timestamp. Like showViewItems it
// forces the shelf to render, so a Done bill with no resolved families still
// gets its receipt line.
export function CardShelf({
  row,
  muted = false,
  showViewItems = false,
  onViewItems,
  trailing = null,
}: {
  row: PickingQueueRow;
  muted?: boolean;
  showViewItems?: boolean;
  onViewItems?: () => void;
  trailing?: React.ReactNode;
}): React.JSX.Element | null {
  const hasStrip = row.families.length > 0 || row.unresolvedLineCount > 0;
  if (!hasStrip && !showViewItems && trailing === null) return null;
  return (
    <div className="border-t px-[14px] flex items-stretch gap-1" style={{ background: "#f6f8fa", borderColor: "#eef1f4" }}>
      <div className="relative flex-1 min-w-0 flex items-center py-[10px]">
        <div
          className="flex flex-nowrap gap-1.5 overflow-x-auto pr-[26px] w-full [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: "none" }}
        >
          {row.families.map((f) => (
            <FamilyChip key={f} label={f} muted={muted} />
          ))}
          <UnlistedChip key="__unlisted" count={row.unresolvedLineCount} />
        </div>
        {/* Fade cue — matches the shelf bg so chips dissolve under it, into the
            link (or the card edge on Picking). */}
        <div
          className="absolute top-0 right-0 w-[30px] h-full pointer-events-none"
          style={{ background: "linear-gradient(90deg, rgba(246,248,250,0), #f6f8fa 72%)" }}
          aria-hidden="true"
        />
      </div>
      {showViewItems && (
        // Soft round arrow → open detail. Stops the tap bubbling to the card
        // body (which would toggle select). 30px slate circle inside a ≥44px
        // tap target; NOT teal (one-teal rule).
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onViewItems?.();
          }}
          aria-label="View items"
          className="shrink-0 self-stretch min-h-[44px] min-w-[44px] pl-1.5 flex items-center justify-center active:opacity-60"
        >
          <span
            className="w-[30px] h-[30px] rounded-full flex items-center justify-center shrink-0"
            style={{ background: "#eceff3" }}
          >
            <ChevronRight size={16} style={{ color: "#8b93a0" }} />
          </span>
        </button>
      )}
      {trailing}
    </div>
  );
}
