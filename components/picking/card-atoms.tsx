"use client";

import { ChevronRight } from "lucide-react";
import type { PickingQueueRow } from "@/lib/picking/types";
// The duplicate-SO red is owned by ONE file — never re-type its hexes here.
// These atoms only need to know how to survive ON that fill, which is what the
// `onRed` prop below does.
import {
  DUP_SO_BADGE_CLASS,
  DUP_SO_BAND,
  DUP_SO_MUTED,
  DUP_SO_WASH,
  DUP_SO_WASH_BORDER,
} from "@/components/shared/duplicate-so-tag";

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
//
// ⚠ `onRed` — the duplicate-SO card fill (components/shared/duplicate-so-tag.tsx)
// is solid #dc2626, and EVERY tier above is a red or amber wash that disappears
// into it. On such a card the badge flips to the shared white pill with #b91c1c
// text. The SCALE is unchanged — the badge still only renders for the same days
// — only its skin swaps, so "how stale" still reads the same on both.
// Optional and defaulted false, so the picker board and every existing call
// site render byte-identical DOM.
export function AgeBadge({
  row,
  onRed = false,
}: {
  row: PickingQueueRow;
  onRed?: boolean;
}): React.JSX.Element | null {
  if (row.noDispatchDate) {
    return (
      <span
        className={
          "text-[10.5px] font-semibold px-2 py-[3px] rounded-full shrink-0 whitespace-nowrap " +
          (onRed ? DUP_SO_BADGE_CLASS : "bg-gray-100 text-gray-500")
        }
      >
        no date
      </span>
    );
  }
  const days = row.ageDays;
  if (days === null || days <= 0) return null;
  const cls = onRed
    ? DUP_SO_BADGE_CLASS
    : days >= 4
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

// ── SMU badge ───────────────────────────────────────────────────────────────
// Marks the two PROJECT SMUs, and ONLY those two.
//
// ⚠ THE SILENCE IS THE FEATURE. Renders for smuCode "74" (Decorative Projects)
// and "77" (Retail Offtake). EVERY other value — "70", "76", "10", null, or
// anything unrecognised — renders NOTHING. This is the same rule AgeBadge
// applies to `0d` and for the identical reason: on a live board (measured
// 2026-08-19) "70" Deco Retail is 87 of 112 bills, so a badge on it would sit
// on ~78% of cards and bury the ~19% it exists to surface. A signal that is
// almost always present is not a signal.
//
// The two colours are CLAUDE_UI.md §1209's SMU palette — Decorative Projects
// indigo #4f46e5, Retail Offtake cyan #0891b2 — which is the source of truth
// for these two SMUs app-wide. NEVER invent a colour for either.
//
// Hardcoded rather than imported ON PURPOSE: the only other implementation is
// `SMU_DOT` in components/reports/tint-summary-document.tsx, which is a
// module-PRIVATE const (not exported), keyed by SMU *name* rather than code,
// and holds one dot colour rather than the bg/text pair a pill needs. Nothing
// importable exists. If that map is ever promoted to a shared export, this is
// the second call site to repoint.
//
// Geometry mirrors AgeBadge above (rounded-full, px-2 py-[3px], shrink-0,
// whitespace-nowrap, tabular-nums) so the two sit on a row as siblings — no new
// spacing scale was invented for this.
//
// ⚠ 700 is heavier than CLAUDE_UI.md §60's "chips cap at 600". Deliberate and
// specified: this is a rare accent (≈19% of cards), not a per-card chip, and
// the weight is what separates a two-digit code from the 12px/500 area text
// beside it. If the board ever reads heavy, this is a documented place to look.
const SMU_BADGE_STYLE: Record<string, { bg: string; fg: string }> = {
  "74": { bg: "#eef2ff", fg: "#4f46e5" }, // Decorative Projects — UI §1209 indigo
  "77": { bg: "#ecfeff", fg: "#0891b2" }, // Retail Offtake      — UI §1209 cyan
};

/**
 * Does this code get a badge? The gate rule, exported so a CALLER can decide
 * whether to render a wrapper/row at all without duplicating the "74"/"77"
 * literals. SmuBadge still self-guards, so a caller that skips this check gets
 * nothing rendered rather than something wrong.
 */
export function isSmuBadged(code: string | null): boolean {
  return code !== null && code in SMU_BADGE_STYLE;
}

export function SmuBadge({ code }: { code: string | null }): React.JSX.Element | null {
  if (code === null) return null;
  const style = SMU_BADGE_STYLE[code];
  if (style === undefined) return null;
  return (
    <span
      className="text-[11px] font-bold px-2 py-[3px] rounded-full shrink-0 whitespace-nowrap tabular-nums"
      style={{ background: style.bg, color: style.fg }}
    >
      {code}
    </span>
  );
}

// One shelf chip. Named for its original and still-default content — the
// product family, which arrives already display-resolved and alpha-sorted from
// lib/picking/queue.ts — but the STYLE is the point: whatever a caller feeds
// the shelf renders through this one component, never a hand-rolled span.
// (The supervisor board feeds it article-tag pieces since 2026-08-14; see
// CardShelf's `chips` prop.) Labels are rendered AS-IS, never re-sorted or
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
//
// `onRed` wins over `muted` — on a duplicate-SO card the slate chip is
// invisible, so it becomes a white alpha wash with pale-red text. A locked
// duplicate card is still first a duplicate.
export function FamilyChip({
  label,
  muted = false,
  onRed = false,
}: {
  label: string;
  muted?: boolean;
  onRed?: boolean;
}): React.JSX.Element {
  return (
    <span
      className="shrink-0 whitespace-nowrap text-[10.5px] font-semibold rounded-[7px] py-[3px] px-[8px]"
      style={
        onRed
          ? { color: DUP_SO_MUTED, background: DUP_SO_WASH }
          : { color: muted ? "#8a929c" : "#667085", background: muted ? "#f1f3f6" : "#eef1f5" }
      }
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
export function UnlistedChip({
  count,
  onRed = false,
}: {
  count: number;
  onRed?: boolean;
}): React.JSX.Element | null {
  if (count <= 0) return null;
  return (
    <span
      className="shrink-0 whitespace-nowrap text-[11.5px] font-semibold rounded-[8px] px-[9px] py-1 border border-dashed"
      style={
        onRed
          ? { color: DUP_SO_MUTED, borderColor: DUP_SO_WASH_BORDER }
          : { color: "#9aa2ac", borderColor: "#d8dce1" }
      }
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
//
// ⚠ `onRed` KEEPS THE COLOUR and adds a white ring — it does NOT recolour the
// dot. Blue/rose on a #dc2626 fill is muddy, but painting the dot white would
// destroy the only thing it carries (which lane this bill is on), and the
// Assign board is exactly where a supervisor reads lanes. A 1.5px white ring
// restores the contrast and keeps the hue. Costs no layout: a box-shadow ring
// does not affect the 8px box.
export function RouteDot({
  deliveryType,
  onRed = false,
}: {
  deliveryType: string | null;
  onRed?: boolean;
}): React.JSX.Element {
  const color = (deliveryType !== null && ROUTE_DOT_COLOR[deliveryType]) || "#9ca3af";
  return (
    <span
      className="w-2 h-2 rounded-full shrink-0"
      style={{ background: color, ...(onRed ? { boxShadow: "0 0 0 1.5px #ffffff" } : null) }}
      aria-hidden="true"
    />
  );
}

// Rich-card shelf — the DIVIDER + the grey band + CHIPS, plus one optional
// right-hand slot. Both boards render this; the band colour, the divider and
// the fade gradient exist here and nowhere else.
//
// The old goods/breakdown line (articleTag + volume) is gone (Option G,
// 2026-07-21); volume moved to the route line. Chips are ONE horizontally-
// scrollable line that NEVER wraps (flex-nowrap + per-chip shrink-0) so every
// card keeps a uniform height; a right-edge fade cues the overflow, fading the
// chips into whatever occupies the right slot (or the card edge, when nothing
// does).
//
// Layout: a flex row — [chips: flex-1 min-w-0, scrolling] + [right slot: shrink-0].
//
// ── WHAT GOES IN THE CHIPS (2026-08-14) ───────────────────────────────────
// TWO sources, chosen by whether the caller passes `chips`:
//
//   chips OMITTED (the picker board) — FAMILIES, unchanged in every respect.
//   `row.families` arrives already display-resolved + alpha-sorted from
//   lib/picking/queue.ts and is rendered AS-IS, and the "+N unlisted" chip
//   trails when unresolvedLineCount > 0 (UnlistedChip self-guards at 0).
//
//   chips PASSED (the supervisor board) — those labels, verbatim, and NO
//   "+N unlisted". That pill counts lines whose SAP code resolved to no
//   family, so it is meaningful ONLY against the family list; trailing it
//   after article-tag pieces would be an unlisted-count for a list nothing
//   was resolved against.
//
// An EMPTY `chips` array behaves exactly like an empty `families` array: the
// shelf renders only if something else needs it (showViewItems / trailing),
// so the Assign card keeps its arrow — and therefore its route to detail —
// on a bill with nothing to chip (CLAUDE_UI.md §62).
//
// ⚠ The prop is a chip LIST, never a chip SOURCE: no formatting, splitting,
// sorting or casing happens in here. A caller hands over the exact strings it
// wants on screen.
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
//
// ⚠ `onRed` — on a duplicate-SO card the grey band would read as a hole punched
// in the fill, so it becomes an opaque DARKER red (DUP_SO_BAND) and every chip,
// the "+N unlisted" pill and the arrow circle go to the white alpha wash. The
// band is opaque rather than a wash for one specific reason: the right-edge
// overflow cue is a GRADIENT, and a gradient whose end stop is semi-transparent
// composites against the red parent differently along its length, which shows
// as a smear. Opaque keeps that fade behaving exactly as it does on white.
export function CardShelf({
  row,
  chips,
  muted = false,
  onRed = false,
  showViewItems = false,
  onViewItems,
  trailing = null,
}: {
  row: PickingQueueRow;
  /** Chip labels, rendered verbatim. OMIT for the family chips + "+N unlisted". */
  chips?: readonly string[];
  muted?: boolean;
  onRed?: boolean;
  showViewItems?: boolean;
  onViewItems?: () => void;
  trailing?: React.ReactNode;
}): React.JSX.Element | null {
  // `chips === undefined` is the discriminator, NOT `chips.length` — an empty
  // array is a caller saying "this bill has nothing to chip", which must not
  // fall back to families.
  const ownChips = chips !== undefined;
  const labels: readonly string[] = chips ?? row.families;
  const hasStrip = labels.length > 0 || (!ownChips && row.unresolvedLineCount > 0);
  if (!hasStrip && !showViewItems && trailing === null) return null;
  const bandBg = onRed ? DUP_SO_BAND : "#f6f8fa";
  return (
    <div
      className="border-t px-[14px] flex items-stretch gap-1"
      style={{ background: bandBg, borderColor: onRed ? DUP_SO_WASH_BORDER : "#eef1f4" }}
    >
      <div className="relative flex-1 min-w-0 flex items-center py-[10px]">
        <div
          className="flex flex-nowrap gap-1.5 overflow-x-auto pr-[26px] w-full [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: "none" }}
        >
          {/* Keyed by index+label, not by label alone: families are distinct by
              construction (a Set upstream) but a caller-supplied list can
              legitimately repeat a value ("2 Drum, 2 Drum"). Same rendered
              markup either way — these are static text spans with no state. */}
          {labels.map((label, i) => (
            <FamilyChip key={`${i}-${label}`} label={label} muted={muted} onRed={onRed} />
          ))}
          {!ownChips && <UnlistedChip key="__unlisted" count={row.unresolvedLineCount} onRed={onRed} />}
        </div>
        {/* Fade cue — matches the shelf bg so chips dissolve under it, into the
            link (or the card edge on Picking). Both stops track `bandBg`, so
            the red band fades to itself exactly as the grey one does. */}
        <div
          className="absolute top-0 right-0 w-[30px] h-full pointer-events-none"
          style={{
            background: onRed
              ? `linear-gradient(90deg, rgba(185,28,28,0), ${bandBg} 72%)`
              : "linear-gradient(90deg, rgba(246,248,250,0), #f6f8fa 72%)",
          }}
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
            style={{ background: onRed ? DUP_SO_WASH : "#eceff3" }}
          >
            <ChevronRight size={16} style={{ color: onRed ? "#ffffff" : "#8b93a0" }} />
          </span>
        </button>
      )}
      {trailing}
    </div>
  );
}
