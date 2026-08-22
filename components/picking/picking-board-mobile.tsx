"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  ChevronDown,
  Check,
  Star,
  Zap,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { MOBILE_NAV_CLEARANCE } from "@/components/shared/mobile-shell";
import { useMobileShell } from "@/components/shared/mobile-shell-context";
import { ModuleMobileHeader } from "@/components/shared/module-mobile-header";
import { AgeBadge, CardShelf, CARD_SHADOW_V2, RouteDot, SmuBadge, isSmuBadged } from "./card-atoms";
// Duplicate-SO red — tokens and tag from the ONE owner. Never re-type a hex.
import {
  DuplicateSoTag,
  DUP_SO_BADGE_CLASS,
  DUP_SO_BORDER,
  DUP_SO_DIVIDER,
  DUP_SO_FILL,
  DUP_SO_MUTED,
  DUP_SO_TEXT,
} from "@/components/shared/duplicate-so-tag";
import { usePickingBoard } from "./picking-mobile-shell";
import { useBillPager } from "./use-bill-pager";
import { CancelSheet } from "./cancel-sheet";
// Stage vocabulary — imported, never hard-coded. pickingRowStage() is the ONE
// owner of the booleans→stage mapping; PICKING_CANCELLABLE_STAGES is exported
// by the route that enforces it, so the ⋯ can never offer what the API refuses.
import { pickingRowStage, PICKING_CANCELLABLE_STAGES } from "@/lib/workflow-stages";
import type { CancelReason } from "@/lib/picking/cancel-reasons";
import { sortPackLabels } from "@/lib/picking/pack-sort";
// The pick-bundling engine, shared with Floor's By-group view and used AS-IS.
// Where the phone's shape differed, this caller adapted — the engine did not.
import { buildPickGroups, buildOilGroups } from "@/lib/picking/grouping";
import {
  FindingNote,
  FindingPopup,
  FindingRecordBanner,
  FindingStatusBadge,
  FindingTriangleButton,
  findingState,
  useFindingRecorder,
} from "./finding-recorder";
import { BillBand } from "./bill-band";
import type { PickingDetailLine, PickingLineFinding, PickingQueueRow } from "@/lib/picking/types";

// Real /api/warehouse/pickers response shape — do not invent fields.
//
// ⚠ SHRANK 2026-08-22, in step with the route. `assignedCount`, `pickedCount`
// and `totalKg` are gone from BOTH sides. They were derived from a broken
// date window (see that route's header); the first had one reader — the
// sheet's "N jobs" label, which now reads `pendingCount` — and the other two
// had none at all.
//
// `pendingCount` is now how many OPEN bills the man is holding (order still at
// pick_assigned), with no date fence, and `status` is derived from it
// server-side. Do not recompute either here.
interface Picker {
  id: number;
  name: string;
  avatarInitial: string;
  status: "available" | "picking";
  pendingCount: number;
}

interface AssignResponse {
  assigned?: number;
  failed?: { orderId: number; error: string }[];
  error?: string;
}

// The GET /api/picking/order/[orderId] line shape now lives in
// lib/picking/types.ts as PickingDetailLine — shared with the picker board
// instead of each face keeping a private copy. The copies were harmless while
// the shape was four scalars; they stopped being harmless the moment it grew a
// nested `finding` object that drives colour AND the Approve gate.
type LineItem = PickingDetailLine;

// Card shell shadow — lifted verbatim from app/po/po-page.tsx's SOFT_CARD_SHADOW
// (the /po visual reference this board is styled to match).
const SOFT_CARD_SHADOW = "0 1px 2px rgba(16,24,40,0.04), 0 3px 12px rgba(16,24,40,0.05)";

// Chip identity for lines with a null pack — kept out of the "ALL" sentinel
// so a picker can isolate exactly the lines missing pack data (a real, live
// risk — see SKU 5961032 on OBD 9108267692).
const NO_PACK_KEY = "__no_pack__";

type TypeFilter = "All" | "Local" | "Upcountry";

// THE type-pill predicate, in one place (2026-08-21). Extracted when the route
// sheet's option list started reading it: the list, the counts and the
// reset-on-type-change below must agree about what "under this type" means, and
// three hand-written copies of `t !== "All" && r.deliveryType !== t` is exactly
// how the sheet came to list a route its own counts said had nothing in it.
// Deliberately NOT applied to the Assign / Picking / Done list filters — those
// are correct, out of scope, and changing them would be a silent refactor
// inside a bug-fix commit.
function matchesType(row: PickingQueueRow, type: TypeFilter): boolean {
  return type === "All" || row.deliveryType === type;
}

// Detail-interactions Build A (2026-07-19) — which of the four already-
// memoized lists (waitingRows/needsCheck/stillPicking/checked) a bill's
// detail was opened from. Needed so goNext/goPrev page through the SAME
// list the tapped card came from — one tab renders two sections, so
// activeTab alone can't disambiguate. (That tab was Check until the
// 2026-07-20 re-slot; it is now Done — "Check now" + "Checked".)
//
// ⚠ These are LIST identities, NOT tab identities, and that distinction is
// load-bearing: it is exactly why the 2026-07-20 tab re-slot needed no change
// here. Each openDetail(id, key) call site sits inside the band that renders
// that array, so a band carries its key with it when it moves tabs. Keep it
// that way — deriving a DetailListKey from activeTab would re-couple them and
// break paging the next time a band moves.
type DetailListKey = "waiting" | "needsCheck" | "stillPicking" | "checked";

// The swipe/slide tuning constants that used to sit here (edge exclusion,
// deadzone, axis-lock ratio, commit threshold, drag-follow, slide duration)
// moved to ./use-bill-pager.ts on 2026-07-30, verbatim and unchanged, when the
// picker face adopted the same gesture. They were tuned together as ONE
// setting — that is exactly why they now live in one file. This board's
// behaviour and rendering are unchanged: an import swap, nothing else.

// Fixed locale — same rationale as picking-queue.tsx (the desktop sibling):
// identical thousands-separator output depot PC vs Vercel, regardless of
// device locale settings.
const NUMBER_LOCALE = "en-US";

// Litres for display. Rounds to 1 decimal FIRST — that's the precision floor
// that kills genuine floating-point noise (e.g. summed volumeLitres landing
// on 12131.199999999999 instead of 12131.2) without discarding a real
// half-litre difference from small packs (200/100/50ML). Then drops the
// decimal entirely when that rounds to a whole litre (the common case) —
// otherwise keeps exactly 1 decimal. Always thousands-separated. Never
// renders a raw float. Display layer only — the underlying number is untouched.
function formatLitres(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  const isWhole = Number.isInteger(rounded);
  return rounded.toLocaleString(NUMBER_LOCALE, {
    minimumFractionDigits: isWhole ? 0 : 1,
    maximumFractionDigits: 1,
  });
}

// Elapsed time since assignedAt, bucketed into the three urgency tiers a
// supervisor scans for at a glance. Returns null when assignedAt is missing
// (Step 1 report — never fake this value; the pill is simply omitted).
type ElapsedTier = "grey" | "amber" | "red";
// Amber threshold — also the single source of truth for the Check summary
// strip's "M over 30m" count (FIX 4). Never hardcode 30 a second time.
const ELAPSED_AMBER_MINUTES = 30;
const ELAPSED_RED_MINUTES = 60;
function elapsedSinceAssigned(
  assignedAt: Date | string | null,
  nowMs: number,
): { label: string; tier: ElapsedTier; minutes: number } | null {
  if (assignedAt === null) return null;
  const then = new Date(assignedAt).getTime();
  if (Number.isNaN(then)) return null;
  const minutes = Math.max(0, Math.floor((nowMs - then) / 60000));
  const label = minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  const tier: ElapsedTier =
    minutes >= ELAPSED_RED_MINUTES ? "red" : minutes >= ELAPSED_AMBER_MINUTES ? "amber" : "grey";
  return { label, tier, minutes };
}
const ELAPSED_PILL_CLASS: Record<ElapsedTier, string> = {
  grey: "bg-gray-100 text-gray-500",
  amber: "bg-amber-50 text-amber-700 border border-amber-200",
  red: "bg-red-50 text-red-700 border border-red-200",
};

// The ONE right-side pill for every CheckCard, whichever tab renders it
// (2026-07-20: "still" now sits on the Picking tab, "needs"/"checked" on the
// Done tab; this helper was written when all three shared one tab and is
// unchanged by that move — it keys off the SECTION, never the tab).
// "Still picking" keeps the
// existing grey/amber/red elapsed-since-assigned pill unchanged; "Needs
// check" gets a flat green "Picked Xm ago" pill (no tiering — it's not an
// urgency signal the way the assign-elapsed pill is, just a receipt of when
// the picker finished). Reuses elapsedSinceAssigned's minute/hour label
// formatting for both — only the source timestamp and the pill style differ.
// `onRed` — on a duplicate-SO card EVERY tier here (green receipt, grey/amber/
// red elapsed) is a pale wash that the #dc2626 fill swallows, so all of them
// flip to the ONE shared white pill with #b91c1c text. The elapsed TEXT is
// unchanged, so "how long has he had it" still reads; only the skin swaps.
// The "checked" arm is plain grey TEXT rather than a pill, so it just needs a
// colour that survives the fill.
function checkCardPill(
  row: PickingQueueRow,
  section: "needs" | "still" | "checked",
  nowTick: number,
  onRed = false,
): React.ReactNode {
  if (section === "needs") {
    const p = elapsedSinceAssigned(row.pickedAt, nowTick);
    if (!p) return null;
    return (
      <span
        className={
          "text-[10.5px] font-semibold px-2 py-[3px] rounded-full shrink-0 " +
          (onRed ? DUP_SO_BADGE_CLASS : "bg-green-50 text-green-700 border border-green-200")
        }
      >
        Picked {p.label} ago
      </span>
    );
  }
  if (section === "checked") {
    // Plain grey text, not a pill — this bill is finished, nothing is
    // ticking, so it gets a timestamp (like the picker Done tab's "done
    // {time}"), never an elapsed clock.
    const t = formatCheckedTime(row.checkedAt);
    if (t === null) return null;
    return (
      <span
        className="text-[11px] font-semibold whitespace-nowrap"
        style={onRed ? { color: DUP_SO_MUTED } : undefined}
      >
        <span className={onRed ? "" : "text-gray-400"}>checked {t}</span>
      </span>
    );
  }
  const p = elapsedSinceAssigned(row.assignedAt, nowTick);
  if (!p) return null;
  return (
    <span
      className={
        "text-[10.5px] font-semibold px-2 py-[3px] rounded-full shrink-0 " +
        (onRed ? DUP_SO_BADGE_CLASS : ELAPSED_PILL_CLASS[p.tier])
      }
    >
      {p.label}
    </span>
  );
}

// Same locale/timezone convention as picker-my-picks-board.tsx's
// formatPickedTime — duplicated (that function is private to that file, and
// this board already duplicates its own copies of formatLitres etc. from
// there for the same reason) — operates on checkedAt instead of pickedAt.
function formatCheckedTime(checkedAt: Date | string | null): string | null {
  if (checkedAt === null) return null;
  const d = new Date(checkedAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });
}

// Order date-time for the caption line (Assign / Picking) — "19 Jul, 4:05 PM"
// in IST. Date part en-GB (day-then-month order), time part en-US (uppercase
// AM/PM), both pinned to Asia/Kolkata so the depot phone and Vercel render the
// same text regardless of device locale. Null on a missing/invalid timestamp —
// the caller drops the segment rather than printing "Invalid Date".
function formatObdDateTime(v: Date | string | null): string | null {
  if (v === null) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const date = d.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
  const time = d.toLocaleTimeString("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${date}, ${time}`;
}

// RouteDot (+ its colour map) and CARD_SHADOW_V2 moved to ./card-atoms.tsx
// (2026-07-29) when the picker card adopted this card's language — colour
// values live in exactly one place. Imported at the top of this file; every
// call site below is unchanged.

// ── Article-tag chips — THIS BOARD'S shelf content (2026-08-14) ────────────
// The supervisor's shelf carries the bill's PACK BREAKDOWN, not its product
// families: at the dispatch point the question is "how many physical things is
// this", and articleTag is the order-level roll-up that answers it
// (orders → import_obd_query_summary.articleTag, already on the row —
// PickingQueueRow.articleTag, no new fetch). The picker's own board is
// unchanged and still shows families.
//
// Split on commas, trim, drop empties. NOTHING ELSE — no abbreviation, no
// re-casing, no re-ordering, no re-totalling: the value is rendered VERBATIM,
// the same rule CLAUDE_PICKING.md §5.2 states for this field everywhere it
// appears. "124 Drum, 27 Carton, 6 Tin" → three chips; "4 Drum" → one.
//
// ⚠ Deliberately NOT lib/floor/format.ts's formatArticleTag/ARTICLE_WORD_ABBR.
// Those abbreviate to "18 D · 14 C" for Floor's dense table and by-picker card;
// this shelf has room for the whole word and the floor reads the word.
//
// A null or blank tag yields [] — an empty chip list, which the shelf treats
// exactly as it treats a bill with no families: the Assign card still renders
// its shelf for the arrow (CLAUDE_UI.md §62), the other variants render none.
function articleTagChips(tag: string | null): string[] {
  if (tag === null) return [];
  return tag
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

// CardShelf moved to ./card-atoms.tsx (2026-07-29) — the divider, the grey
// band, the fade gradient and the chips are now ONE copy shared with the picker
// card. Its props gained defaults (muted/showViewItems false, onViewItems
// optional) plus an optional `trailing` slot the picker uses for its done-time
// receipt; this board passes all three explicitly, exactly as before, so its
// rendered shelf is unchanged.

// ── The ONE shared Picking card ────────────────────────────────────────────
// Every tab renders THIS — the four-way fork (inline Assign card + CheckCard)
// is gone. Variants differ only by SLOTS, per the locked design
// (docs/mockups/picking/picking-cards-final-v2.html +
//  web-update-2026-07-21-picking-card-redesign.md §2):
//   lead          — checkbox (assign) / lock (assignLocked) / none
//   caption 2nd   — order date-time (assign/picking) / slot (done)
//   caption-right — flags (assign) / elapsed pill (picking) / green (doneCheck) / none
//   name-right    — slot hero (assign/picking) / none (done)
//   where-right   — picker (picking/done) / none (assign)
//   shelf         — RICH on assign + picking; LEAN (no shelf) on done.
//                   RICH = the grey band of article-tag chips (2026-08-14,
//                   was family chips). "Done" here means BOTH done variants:
//                   doneCheck and doneChecked render no shelf at all, so the
//                   Done tab shows no chips of either kind.
//   checker line  — doneChecked only ("✓ Checked by {name} · {time}")
type PickingCardVariant = "assign" | "assignLocked" | "picking" | "doneCheck" | "doneChecked";

function PickingCard({
  row,
  variant,
  nowTick = 0,
  selected = false,
  stripe = null,
  onOpen,
  onToggleSelect,
  onLockTap,
}: {
  row: PickingQueueRow;
  variant: PickingCardVariant;
  nowTick?: number;
  selected?: boolean;
  /**
   * Pick-bundling hint (2026-08-18) — a 4px full-height bar on the card's LEFT
   * EDGE, inside its rounded corners. `"teal"` = SAME MATERIAL (Rule 1),
   * `"amber"` = MOSTLY SAME (Rule 2), null/omitted = no bar.
   *
   * ⚠ OPTIONAL AND DEFAULTED, so every existing call site is byte-identical —
   * this adds nothing to the card's layout, props-in-use, or render for any
   * caller that does not pass it.
   *
   * It is a HINT, not a control: it carries no tap target and changes no
   * behaviour. The supervisor still taps the card to select and uses the assign
   * bar he already has.
   */
  stripe?: "teal" | "amber" | null;
  onOpen: () => void;
  onToggleSelect?: () => void;
  onLockTap?: () => void;
}): React.JSX.Element {
  const rich = variant === "assign" || variant === "assignLocked" || variant === "picking";
  const muted = variant === "assignLocked" || variant === "doneChecked";
  // ── Duplicate-SO red ──────────────────────────────────────────────────────
  // ALL FIVE VARIANTS. A duplicate is a duplicate at every stage: the case this
  // exists for includes "already handed to a picker when the twin arrives", so
  // gating it to the Assign tab would hide it exactly when it matters most.
  // Sort order is deliberately untouched — a red card stays where the spine put
  // it and is never floated or grouped (lib/picking/sort.ts is not involved).
  const dup = row.hasDuplicateSo;
  const showSlotHero = rich && row.windowTime !== null;
  const secondary =
    variant === "doneCheck" || variant === "doneChecked" ? row.windowTime : formatObdDateTime(row.obdDateTime);

  // Caption-right cluster by variant. Tint reuses Support's exact indicator
  // (🎨 in purple — components/support/shared/table-cells.tsx CustomerCell) so
  // the two boards read identically; field is row.isTint (orders.orderType).
  // Urgent bolt stays AMBER (not the mockup's red) — red already means
  // "overdue" on the Picking elapsed badge; a second red would collide.
  //
  // ⚠ On a red card the amber ★ and ⚡ GLYPHS go white rather than becoming
  // white pills. The flip-to-a-white-pill rule is for BADGES (AgeBadge, the
  // elapsed pills, the day badge) — a white pill around each of three bare
  // icons would out-shout the fill and the tag it exists to carry. The glyphs
  // keep their shapes, which is what distinguishes them from each other.
  const iconOnRed = dup ? { color: DUP_SO_TEXT, fill: DUP_SO_TEXT } : undefined;
  let captionRight: React.ReactNode = null;
  if (variant === "assign") {
    captionRight = (
      <span className="flex items-center gap-[7px] shrink-0">
        {row.isKeyCustomer && (
          <Star size={14} className={dup ? "" : "text-amber-500 fill-amber-500"} style={iconOnRed} />
        )}
        {row.priorityLevel === 1 && (
          <Zap size={14} className={dup ? "" : "text-amber-500 fill-amber-500"} style={iconOnRed} />
        )}
        {row.isTint && <span className="text-[13px] text-purple-500 leading-none shrink-0">🎨</span>}
        {row.isEarlyReleased && (
          <span
            className={
              "text-[10.5px] font-semibold px-2 py-[3px] rounded-full shrink-0 whitespace-nowrap " +
              (dup ? DUP_SO_BADGE_CLASS : "bg-slate-100 text-slate-600 border border-slate-200")
            }
            title={row.earlyReleasedByName !== null ? `Released early by ${row.earlyReleasedByName}` : "Released early"}
          >
            released
          </span>
        )}
        <AgeBadge row={row} onRed={dup} />
      </span>
    );
  } else if (variant === "assignLocked") {
    captionRight = (
      <span className="flex items-center gap-1.5 shrink-0">
        {row.isKeyCustomer && (
          <Star size={14} className={dup ? "" : "text-amber-500 fill-amber-500"} style={iconOnRed} />
        )}
        {row.isTint && <span className="text-[13px] text-purple-500 leading-none shrink-0">🎨</span>}
        <UpcomingDayBadge row={row} onRed={dup} />
      </span>
    );
  } else if (variant === "picking") {
    captionRight = checkCardPill(row, "still", nowTick, dup);
  } else if (variant === "doneCheck") {
    captionRight = checkCardPill(row, "needs", nowTick, dup);
  } // doneChecked: none — the checked time moves down to the checker line.

  const whereRight =
    (variant === "picking" || variant === "doneCheck" || variant === "doneChecked") && row.assignedToName !== null ? (
      <span className="text-[12px] font-semibold shrink-0" style={{ color: dup ? DUP_SO_MUTED : "#8a929c" }}>
        {row.assignedToName}
      </span>
    ) : null;

  // Where-row right end: the picker name (as before) plus the SMU badge, on
  // EVERY variant — the where-row itself is variant-independent, so a 74/77
  // bill is marked whether it is waiting, locked, being picked or done.
  //
  // ⚠ NO WRAPPER WHEN THERE IS NO BADGE. `isSmuBadged` is checked here rather
  // than leaning on SmuBadge's own null-return, because an element that renders
  // null is still a flex CHILD: wrapping unconditionally would put a zero-width
  // box at the end of a `justify-between gap-2.5` row and cost the area text
  // 10px of truncation width on the ~81% of cards that show no badge. On that
  // majority this expression is `whereRight` itself — byte-identical DOM to
  // before this change, no gap, no alignment shift.
  const whereRightNode = !isSmuBadged(row.smuCode) ? (
    whereRight
  ) : (
    <span className="flex items-center gap-1.5 shrink-0">
      {whereRight}
      <SmuBadge code={row.smuCode} />
    </span>
  );

  // Lead gutter (self-stretch to card height).
  //   assign       — NO lead anymore (2026-07-21): the checkbox was removed so
  //                  the name row runs full-width to the card's left edge.
  //                  Selection now shows as the card teal tint + a floating teal
  //                  check badge in the top-left corner (rendered on the card
  //                  wrapper below), only when selected. Tapping the card body
  //                  still toggles selection — logic unchanged.
  //   assignLocked — still a real lock button here: stopPropagation so a lock
  //                  tap never fires the card's own onOpen (locked cards keep
  //                  body-tap → open detail; they are NOT selectable).
  const lead =
    variant === "assignLocked" ? (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onLockTap?.();
        }}
        aria-label={`Locked until ${formatDispatchDay(row.dispatchTargetDate) ?? "its dispatch date"} — tap to release early`}
        className="w-11 shrink-0 self-stretch min-h-[48px] flex items-center justify-center pt-px active:opacity-60"
      >
        {/* Grey-400 vanishes on the red fill — white on a duplicate. */}
        <LockGlyph className={dup ? "w-5 h-5 text-white" : "w-5 h-5 text-gray-400"} />
      </button>
    ) : null;

  return (
    <div className="relative mb-[11px]">
      {/* Selected badge — floating teal check in the top-left corner, shown
          ONLY when this Assign card is selected. Replaces the old inline
          checkbox: same teal-600 + white-tick language, now a ~20px round badge
          overhanging the corner (white ring separates it from the card's teal
          tint). Sits on this overflow-visible wrapper (the card itself keeps
          overflow-hidden for its shelf), and is pointer-events-none so a tap
          still hits the card body and toggles. Never rendered for
          locked/picking/done variants. */}
      {variant === "assign" && selected && (
        <span
          className="absolute -top-[7px] -left-[7px] z-10 w-5 h-5 rounded-full bg-teal-600 flex items-center justify-center pointer-events-none"
          style={{ boxShadow: "0 0 0 2px #fff" }}
          aria-hidden="true"
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="white" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
      <div
        className={
          "relative rounded-[20px] overflow-hidden cursor-pointer border-[1.5px] " +
          // On a duplicate the fill/border come from the style object below, so
          // no colour class is emitted here at all — a `bg-*` class plus an
          // inline background is a fight nobody needs to read later.
          (dup ? "" : selected ? "bg-teal-50 border-teal-600 " : "bg-white border-[#eceef2] ") +
          // ⚠ doneChecked's opacity-75 is SUPPRESSED on a duplicate. Dimming is
          // "this one is settled, stop looking at it" — the exact opposite of
          // what a flagged card is for. Full strength, always.
          (variant === "doneChecked" && !dup ? "opacity-75" : "")
        }
        style={{
          // ⚠ SELECTION ON RED. Teal fill is unavailable (red owns it), so a
          // selected duplicate is marked by a ring OUTSIDE the border box —
          // white gap then teal — while the floating teal check badge above
          // stays exactly as it is. Two independent signals, neither of which
          // needs the fill. The ring is a box-shadow, so it adds no layout and
          // is not clipped by this card's own overflow-hidden; the list's 16px
          // px-4 padding leaves room for its 4px.
          boxShadow:
            dup && selected
              ? `${CARD_SHADOW_V2}, 0 0 0 2px #ffffff, 0 0 0 4px #0d9488`
              : CARD_SHADOW_V2,
          // ⚠ ORDER MATTERS. assignLocked sets an inline background of its own
          // (#fcfcfd); the duplicate spread comes AFTER it so the red wins, and
          // the locked arm is additionally gated on !dup so the two can never
          // both be live. Inline-vs-inline is resolved here, in one place,
          // rather than by className precedence — which would have lost.
          ...(variant === "assignLocked" && !dup ? { background: "#fcfcfd" } : null),
          ...(dup ? { background: DUP_SO_FILL, borderColor: DUP_SO_BORDER } : null),
        }}
        // Assign (unlocked) card body toggles SELECTION (2026-07-21) — detail
        // opens only via the arrow button in the shelf. Every OTHER variant
        // (picking, doneCheck, doneChecked, assignLocked) keeps body-tap → open
        // detail, unchanged.
        onClick={variant === "assign" ? () => onToggleSelect?.() : onOpen}
      >
      {/* THE STRIPE. Absolutely positioned, so it takes NO part in layout —
          nothing below it moves by a pixel, which is why the card's padding is
          untouched. It overlays the leftmost 4px of the existing 16px (`px-4`)
          left padding, i.e. it is absorbed by padding that was already there
          rather than paid for with new space. `inset-y-0` makes it full-height
          including the shelf; the card's own `overflow-hidden` clips it to the
          20px corner radius, so it reads as part of the card, not a bar beside
          it. `pointer-events-none` so it can never eat a tap meant for the card
          body — this is a hint, and a hint must not be tappable.
          ⚠ Only rendered when `stripe` is passed, so every other call site's
          DOM is unchanged. */}
      {stripe !== null && (
        <span
          aria-hidden="true"
          className={
            "absolute left-0 inset-y-0 w-[4px] pointer-events-none " +
            (stripe === "teal" ? "bg-teal-500" : "bg-amber-400")
          }
        />
      )}
      <div className={"flex items-start gap-3 " + (lead ? "pl-3.5 pr-4 pt-3.5 pb-3" : "px-4 pt-3.5 pb-3")}>
        {lead}
        <div className="flex-1 min-w-0">
          {/* Caption: OBD (mono) · secondary (date-time or slot) — right cluster */}
          <div className="flex items-center justify-between gap-2.5 mb-1.5">
            <span
              className="flex items-center gap-1.5 min-w-0 text-[11.5px] overflow-hidden whitespace-nowrap"
              style={{ color: dup ? DUP_SO_MUTED : "#98a2b3" }}
            >
              <span className="font-mono shrink-0" style={{ color: dup ? DUP_SO_TEXT : "#98a0aa" }}>
                {row.obdNumber}
              </span>
              {secondary !== null && (
                <>
                  <span className="shrink-0" style={{ color: dup ? DUP_SO_DIVIDER : "#d8dce1" }}>
                    &middot;
                  </span>
                  <span className="truncate">{secondary}</span>
                </>
              )}
            </span>
            {/* The tag leads the right-hand cluster so it is the first thing
                read after the OBD. Wrapped ONLY on a duplicate, so every other
                card's caption row is byte-identical DOM. */}
            {dup ? (
              <span className="flex items-center gap-1.5 shrink-0">
                <DuplicateSoTag />
                {captionRight}
              </span>
            ) : (
              captionRight
            )}
          </div>
          {/* Title: customer name (truncates, never pushes the slot) + slot hero */}
          <div className="flex items-baseline justify-between gap-3">
            <span
              className="text-[16px] font-semibold leading-[1.25] truncate min-w-0"
              style={{ color: dup ? DUP_SO_TEXT : "#1d2939" }}
            >
              {row.dealerName}
            </span>
            {showSlotHero && (
              <span
                className="text-[15px] font-semibold tabular-nums shrink-0"
                style={{ color: dup ? DUP_SO_TEXT : "#475467" }}
              >
                {row.windowTime}
              </span>
            )}
          </div>
          {/* Where: route dot + area (truncates) · volume (rich only) — picker
              on the right. Volume moved here from the shelf (Option G): it sits
              inline after the area, shrink-0 so it is NEVER clipped, while the
              area truncates first when the line is tight. */}
          <div className="flex items-center justify-between gap-2.5 mt-1.5">
            <span className="flex items-center gap-2 min-w-0">
              <RouteDot deliveryType={row.deliveryType} onRed={dup} />
              <span
                className="text-[12px] font-medium truncate min-w-0"
                style={{ color: dup ? DUP_SO_MUTED : "#667085" }}
              >
                {/* ROUTE, not area (2026-08-21). The area is a sub-lane inside
                    a route; two bills on one truck read "Pal" and "Rander",
                    which tells a supervisor nothing about which van they go on.
                    The route is the work lane the whole board already filters
                    and sorts by. Same `?? "—"` fallback, same everything else.
                    ⚠ The dot to the left still keys on deliveryType, NOT on
                    route (card-atoms.tsx RouteDot, CLAUDE_UI.md §62.3) — it did
                    not become a route colour when the text beside it did. */}
                {row.route ?? "—"}
              </span>
              {rich && row.volumeLitres != null && (
                <>
                  <span className="shrink-0" style={{ color: dup ? DUP_SO_DIVIDER : "#d3d8de" }}>
                    &middot;
                  </span>
                  <span className="flex items-baseline gap-[3px] shrink-0">
                    <span
                      className="text-[12px] font-semibold tabular-nums"
                      style={{ color: dup ? DUP_SO_TEXT : "#667085" }}
                    >
                      {formatLitres(row.volumeLitres)}
                    </span>
                    <span className="text-[10.5px] font-medium" style={{ color: dup ? DUP_SO_MUTED : "#98a2b3" }}>
                      L
                    </span>
                  </span>
                </>
              )}
            </span>
            {whereRightNode}
          </div>
        </div>
      </div>
      {rich && (
        // `chips` is what makes this shelf the PACK breakdown rather than the
        // family strip (see articleTagChips above). Passing it also suppresses
        // the "+N unlisted" pill, which only means anything against families.
        <CardShelf
          row={row}
          chips={articleTagChips(row.articleTag)}
          muted={muted}
          onRed={dup}
          showViewItems={variant === "assign"}
          onViewItems={onOpen}
        />
      )}
      {variant === "doneChecked" && row.checkedByName !== null && (
        // Its OWN line, never folded into the where line (a long area + long
        // checker name overflow the card; this is the fact the tab exists to
        // show, so it must never be the piece a truncate silently clips).
        <div
          className="px-4 pb-3.5 flex items-center gap-1.5 text-[12px] font-semibold"
          style={{ color: dup ? DUP_SO_MUTED : "#8a929c" }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke={dup ? DUP_SO_TEXT : "#22a06b"}
            strokeWidth={2.4}
            className="shrink-0"
          >
            <path d="M5 13l4 4L19 7" />
          </svg>
          <span>Checked by {row.checkedByName}</span>
          {formatCheckedTime(row.checkedAt) !== null && (
            <>
              <span style={{ color: dup ? DUP_SO_DIVIDER : "#d0d5db" }}>&middot;</span>
              <span style={{ color: dup ? DUP_SO_MUTED : "#a2aab4" }}>{formatCheckedTime(row.checkedAt)}</span>
            </>
          )}
        </div>
      )}
      </div>
    </div>
  );
}

// ── Pick-bundling headings (2026-08-18) ──────────────────────────────────
//
// One small grey caps line with a coloured dot, sitting above each bundle. The
// dot is the ONLY colour, and it is the same colour as that bundle's card
// stripe — so the eye joins heading to cards without a box, a border or a
// background band, none of which this board uses anywhere else.
//
// THE WORDS ARE THE FLOOR'S WORDS, deliberately: SAME MATERIAL / MOSTLY SAME /
// SINGLE PICKS. One supervisor moves between the desk screen and his phone
// inside one shift; two vocabularies for the same two ideas is a defect, not a
// detail. "· one picker" is the phone's own tail — the desk screen has an
// assign bar in view that says it, the phone does not.
//
// ⚠ NOT ON THIS HEADING, all considered and rejected: a bill count (the cards
// under it are countable and few), a "saves N trips" figure (Rule 2 has no such
// number and showing one only for Rule 1 would make the two kinds read as
// different sorts of thing), and any button — this is a hint, not a control.
function BundleHeading({
  label,
  tone,
}: {
  label: string;
  tone: "teal" | "amber" | "grey";
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-[7px] text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-[7px] px-[2px]">
      {tone !== "grey" && (
        <span
          aria-hidden="true"
          className={
            "w-[7px] h-[7px] rounded-full shrink-0 " + (tone === "teal" ? "bg-teal-500" : "bg-amber-400")
          }
        />
      )}
      {label}
    </div>
  );
}

// ── Assign-tab date zones (2026-07-20, step 5a) ──────────────────────────
// Fidelity source: docs/mockups/picking/assign-two-zones.html +
// assign-stale-and-nodate.html + locked-bill-open.html (all approved).

/**
 * "2026-07-23" → "Thu 23 Jul". Parses the ISO date-only string the
 * PARTS way — split on "-", rebuild via Date.UTC(y, m-1, d) — never
 * `new Date(str)`, the documented footgun lib/picking/queue.ts's
 * resolveTargetDate() avoids for the identical reason.
 *
 * Formatted at timeZone "UTC" against the same UTC-midnight anchor the
 * column itself uses, so no offset can shift the rendered day. Locale is
 * pinned to "en-GB" for the same reason sort.ts pins its collator: the
 * depot phone and Vercel must produce identical text regardless of device
 * locale. Weekday/day/month are read as separate parts and re-joined, so
 * no locale's comma or day-month order can leak into the output.
 *
 * Returns null on a malformed string rather than rendering "Invalid Date"
 * on a live bill — the caller drops the badge entirely in that case.
 */
function formatDispatchDay(iso: string | null): string | null {
  if (iso === null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [, y, mo, d] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (Number.isNaN(dt.getTime())) return null;
  const opts = { timeZone: "UTC" } as const;
  const weekday = dt.toLocaleDateString("en-GB", { ...opts, weekday: "short" });
  const month = dt.toLocaleDateString("en-GB", { ...opts, month: "short" });
  return `${weekday} ${d} ${month}`;
}

// AgeBadge moved to ./card-atoms.tsx (2026-07-29) when the picker's "My Picks"
// card gained the same badge — the days→colour scale must exist in exactly one
// place. Imported at the top of this file; rendered unchanged at its call sites.

// Neutral "for Thu 23 Jul" badge for the Upcoming (locked) zone. Slate, NOT
// amber and NOT red: a bill scheduled for Thursday is EARLY, not late.
// Colouring it on the staleness scale would teach the floor to discount
// amber everywhere else on the board.
function UpcomingDayBadge({
  row,
  onRed = false,
}: {
  row: PickingQueueRow;
  onRed?: boolean;
}): React.JSX.Element | null {
  const label = formatDispatchDay(row.dispatchTargetDate);
  if (label === null) return null;
  return (
    <span
      className={
        "text-[10.5px] font-semibold px-2 py-[3px] rounded-full shrink-0 whitespace-nowrap " +
        (onRed ? DUP_SO_BADGE_CLASS : "bg-slate-100 text-slate-600 border border-slate-200")
      }
    >
      for {label}
    </span>
  );
}

function LockGlyph({ className }: { className: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="10.5" width="16" height="10" rx="2" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </svg>
  );
}

// [All][Local][UPC] delivery-type pills — the Assign tab's exact UI,
// extracted so the Check tab's FIX 3 pills reuse this verbatim instead of a
// second copy. Each tab passes its OWN state (Assign's activeType, Check's
// own checkTypeFilter) — the two filters are deliberately independent, never
// shared, so setting one tab's type filter can never silently change the
// other tab's results (constraint: no behaviour change to Assign).
function TypeFilterPills({
  value, onChange,
}: {
  value: TypeFilter;
  onChange: (t: TypeFilter) => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      {(["All", "Local", "Upcountry"] satisfies TypeFilter[]).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={
            "text-[12.5px] font-medium px-3 py-1.5 rounded-full border whitespace-nowrap " +
            (value === t
              ? "bg-gray-900 border-gray-900 text-white font-semibold"
              : "bg-white border-gray-200 text-gray-700")
          }
        >
          {t === "Upcountry" ? "UPC" : t}
        </button>
      ))}
    </div>
  );
}

// ── Shared bottom-sheet geometry — SINGLE SOURCE for every bottom sheet on
// this board (FilterBottomSheet's Route/Picker-filter sheets AND the
// Assign-to-picker sheet further down this file). Read from here, never
// hand-copied — two sheets each picking their own numbers is exactly how
// the Assign-to-picker sheet drifted out of sync and ended up rendering
// under the mobile shell's fixed bottom nav while FilterBottomSheet's
// sheets, patched once already for the identical symptom, stayed correct.
//
// bottomOffset reads MOBILE_NAV_CLEARANCE (components/shared/mobile-shell.tsx)
// rather than hand-copying the "76px + safe-area" figure again — that
// number has now been missed three times as a local literal (this
// component's own two sheets, then both detail-screen CTAs below); it has
// exactly one source from here on, in the file that renders the nav itself.
// z-index — 65/75 were chosen to clear mobile-shell's OWN full stack (nav
// z-40 → its own scrim z-50 → menu/you sheets z-[60] → sign-out confirm
// z-[70]), not just to out-rank the nav alone. A sheet that lands on the
// SAME number as one of mobile-shell's own layers is a landmine even when
// today's DOM order happens to paint it correctly.
const SHEET_GEOMETRY = {
  scrimZ: "z-[65]",
  panelZ: "z-[75]",
  maxHeight: "max-h-[70vh]",
  bottomOffset: MOBILE_NAV_CLEARANCE,
} as const;

// Single-select bottom sheet — the Route dropdown's exact UI, generalised so
// FIX 3's picker filter can reuse it verbatim rather than a second copy.
// value === null means "all" (the first, un-narrowed row).
interface FilterSheetOption {
  value: string;
  label: string;
  count: number;
}
function FilterBottomSheet({
  open, onClose, title, subtitle, allLabel, allCount, options, value, onChange,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  allLabel: string;
  allCount: number;
  options: FilterSheetOption[];
  value: string | null;
  onChange: (v: string | null) => void;
}): React.JSX.Element | null {
  if (!open) return null;
  return (
    <>
      <div className={`fixed inset-0 bg-black/40 ${SHEET_GEOMETRY.scrimZ}`} onClick={onClose} aria-hidden="true" />
      <div
        className={`fixed left-0 right-0 ${SHEET_GEOMETRY.panelZ} bg-white rounded-t-[18px] p-5 ${SHEET_GEOMETRY.maxHeight} overflow-y-auto`}
        style={{ bottom: SHEET_GEOMETRY.bottomOffset }}
      >
        <div className="w-9 h-1 rounded-full bg-gray-300 mx-auto mb-3.5" />
        <h3 className="text-[16px] font-extrabold text-gray-900">{title}</h3>
        <p className="text-[12.5px] text-gray-400 mt-[3px] mb-3.5">{subtitle}</p>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            onClose();
          }}
          className="w-full flex items-center justify-between gap-2 py-3 px-1 border-b border-gray-100"
        >
          <span
            className={
              "text-[14px] flex items-center gap-2 " +
              (value === null ? "text-teal-700 font-semibold" : "text-gray-900 font-medium")
            }
          >
            {value === null && <Check size={16} className="text-teal-600" />}
            {allLabel}
          </span>
          <span className="text-[12px] text-gray-400">{allCount}</span>
        </button>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              onChange(opt.value);
              onClose();
            }}
            className="w-full flex items-center justify-between gap-2 py-3 px-1 border-b border-gray-100 last:border-b-0"
          >
            <span
              className={
                "text-[14px] flex items-center gap-2 min-w-0 " +
                (value === opt.value ? "text-teal-700 font-semibold" : "text-gray-900 font-medium")
              }
            >
              {value === opt.value && <Check size={16} className="text-teal-600 shrink-0" />}
              <span className="truncate">{opt.label}</span>
            </span>
            <span className="text-[12px] text-gray-400 shrink-0">{opt.count}</span>
          </button>
        ))}
      </div>
    </>
  );
}

export function PickingBoardMobile(): React.JSX.Element {
  // Stage 3/4 (2026-07-19) — data/loading/error/activeTab/refetchQueue now
  // live in PickingMobileShell (an ancestor — RoleLayoutClient's workflow-tab
  // slot needs them one level up; see that file's header comment for why).
  // Shared via context so the bottom-bar tab counts and this board's cards
  // read the exact same fetch and can never drift. Same identifier names as
  // the pre-Stage-3 local state, so every usage below is unchanged.
  // Detail-interactions Build A — detailOpen/setDetailOpen now also come
  // from context (lifted up to SupervisorPickingShell, which needs the
  // boolean to drive RoleLayoutClient's hideBar). Same identifier names as
  // before, so every existing usage below is unchanged.
  const { data, loading, error, activeTab, refetchQueue, detailOpen, setDetailOpen, setOverlayBusy } = usePickingBoard();
  // Direction-A header (avatar/grid/search) reaches the shared Menu/You
  // sheets + the signed-in user's initials via the Stage-1 provider —
  // userInitials is a Stage-3/4 addition to that context's value.
  const { openMenu, openYou, userInitials } = useMobileShell();

  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [activeType, setActiveType] = useState<TypeFilter>("All");
  const [activeRoute, setActiveRoute] = useState<string | null>(null); // null = "All routes"
  const [routeSheetOpen, setRouteSheetOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // FIX 3 — Check tab's picker filter (by PERSON, not lane). Same shape as
  // the Assign tab's route filter, entirely separate state/sheet.
  const [activePicker, setActivePicker] = useState<string | null>(null); // null = "All pickers"
  const [pickerFilterSheetOpen, setPickerFilterSheetOpen] = useState(false);
  // FIX 3 (reversed decision) — Check's OWN delivery-type filter. Deliberately
  // NOT shared with Assign's activeType: switching one tab's type pills must
  // never silently change what the other tab shows (no behaviour change to
  // Assign, per constraints).
  const [checkTypeFilter, setCheckTypeFilter] = useState<TypeFilter>("All");

  // Checked tab (2026-07-18) — its OWN type filter + picker filter, same
  // "never share state across tabs" rule as Check's own filters above. The
  // picker dropdown here filters by PICKER (assignedToName), the same
  // semantic Check already uses — not by checker — so the one dropdown
  // control means the same thing on every tab; the checker's identity is a
  // display concern (the card's grey line), not a filter axis.
  const [checkedTypeFilter, setCheckedTypeFilter] = useState<TypeFilter>("All");
  const [activeCheckedPicker, setActiveCheckedPicker] = useState<string | null>(null);
  const [checkedPickerFilterSheetOpen, setCheckedPickerFilterSheetOpen] = useState(false);

  // Live clock for the Check tab's elapsed pill — ticks independently of any
  // data fetch so "4m" keeps advancing toward "5m" without a refetch.
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const [pickers, setPickers] = useState<Picker[]>([]);
  // Starts FALSE, not true (changed 2026-08-22 with the fetch trigger below).
  // Nothing loads on mount any more, so an unopened sheet is not "loading".
  const [pickersLoading, setPickersLoading] = useState(false);
  const [pickerSheetOpen, setPickerSheetOpen] = useState(false);
  // Sheet default is FREE PICKERS ONLY; this reveals the busy ones too. Reset
  // on every open (in the fetch effect) so the sheet always opens collapsed —
  // a supervisor who expanded it once should not find it expanded next week.
  const [showAllPickers, setShowAllPickers] = useState(false);
  // In-flight guard — disables the Assign button + every picker row so a
  // double-tap can't fire two overlapping POSTs.
  const [assigning, setAssigning] = useState(false);
  // Per-row Undo in-flight guard — a Set (not a single scalar) so tapping
  // Undo on one assigned row never disables another row's Undo, and two
  // rows undone in quick succession can't lose track of each other.
  const [unassigningIds, setUnassigningIds] = useState<Set<number>>(new Set());

  // Detail screen — a full-screen overlay that stays MOUNTED (translateX
  // slide, per the approved mockup) rather than conditionally rendered, so
  // the board underneath (filters + scroll position) is never torn down.
  const [detailOrderId, setDetailOrderId] = useState<number | null>(null);
  // Which list this bill's detail was opened from — see DetailListKey.
  const [detailListKey, setDetailListKey] = useState<DetailListKey>("waiting");
  const [lineItems, setLineItems] = useState<LineItem[] | null>(null);
  const [lineItemsLoading, setLineItemsLoading] = useState(false);
  const [lineItemsError, setLineItemsError] = useState<string | null>(null);
  // Detail screen's own search + pack filter — same collapsible pattern as
  // the board's search, scoped to this screen only.
  const [detailSearching, setDetailSearching] = useState(false);
  const [detailQuery, setDetailQuery] = useState("");
  const [activePackFilter, setActivePackFilter] = useState<string>("ALL");

  // Check tab's tick state (step 6) — EPHEMERAL, plain component state, by
  // design (discovery §D3): a forcing function, not an audit trail. Nothing
  // persists it, nothing reads it once this screen closes. Keyed by line
  // item id so a pack-chip filter hiding some lines never lets the Approve
  // gate check anything but the FULL line set (see allLinesChecked below).
  // Reset in openDetail() and again in the detailOrderId-keyed fetch effect
  // so ticks never bleed from one bill into the next.
  const [checkedLineIds, setCheckedLineIds] = useState<Set<number>>(new Set());
  const [approving, setApproving] = useState(false);

  // ── Shortfall recording (2026-08-08) ─────────────────────────────────────
  // The SAME triangle / banner / popup the picker uses — the mockup is explicit
  // that both roles get one screen (docs/mockups/picking/picking-shortfall-
  // design.html). Only `mode` differs: "confirm" posts to the supervisor route
  // and labels the CTA "Confirm".
  const [lineItemsReloadKey, setLineItemsReloadKey] = useState(0);

  const applyFinding = useCallback((rawLineItemId: number, finding: PickingLineFinding) => {
    setLineItems((prev) =>
      prev === null ? prev : prev.map((li) => (li.id === rawLineItemId ? { ...li, finding } : li)),
    );
  }, []);

  const recorder = useFindingRecorder({
    mode: "confirm",
    orderId: detailOrderId,
    onSaved: applyFinding,
    onConflict: () => setLineItemsReloadKey((k) => k + 1),
  });

  // Early-release (5b) — which locked bill the confirm sheet is asking about
  // (null = closed), plus an in-flight guard so a double-tap can't fire two
  // overlapping POSTs. Deliberately its OWN state, not folded into
  // assignTarget: the two flows target different zones and must never share
  // a slot (the same reasoning that keeps assignTarget separate from
  // `selected`).
  const [releaseTarget, setReleaseTarget] = useState<PickingQueueRow | null>(null);
  const [releasing, setReleasing] = useState(false);

  // Which rows the OPEN picker sheet will act on — bulk (floating bar, from
  // the current selection) or single (detail screen's own CTA). Decoupled
  // from `selected` so the two flows never fight over the same state.
  const [assignTarget, setAssignTarget] = useState<PickingQueueRow[]>([]);

  // Report list-view mid-action state UP to the shell so its 15s live-sync poll
  // pauses onChange while the user is committing to specific rows: the picker
  // sheet (bulk/single assign) or the release-confirm sheet. detailOpen already
  // covers the detail / line-tick / Approve screen (and any sheet floating over
  // it), so it is NOT re-included here. View-only filter sheets (route/picker
  // filters) are deliberately excluded — a background refresh behind a filter is
  // harmless and pausing on them would only starve the board of updates.
  // ── Cancel bill (3b) — the ⋯ in the detail header opens this ──────────────
  // `cancelTarget` is the OPEN bill being cancelled, or null. A row, not a
  // boolean, so the sheet always renders the bill it was opened for even if the
  // board's rows change underneath it.
  const [cancelTarget, setCancelTarget] = useState<PickingQueueRow | null>(null);
  const [cancelMenuOpen, setCancelMenuOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    // The cancel sheet joins the pause set. `detailOpen` already covers it
    // TODAY (the sheet only opens over the detail screen), but wiring it here
    // makes the pause a property of the SHEET rather than of where it happens
    // to be reachable from — so it stays safe if a later build ever opens it
    // from the list. Never gate on detailOrderId: that is never reset to null
    // (CLAUDE_PICKING.md §10), so it would pause forever after the first bill.
    setOverlayBusy(pickerSheetOpen || releaseTarget !== null || cancelTarget !== null);
  }, [pickerSheetOpen, releaseTarget, cancelTarget, setOverlayBusy]);

  // ── Detail-interactions Build A — in-module back navigation ─────────────
  // Copies the ESSENCE of /po's single-authority popstate model (discovery
  // 2026-07-19 "po-mobile-mechanics" §3), deliberately scaled down: this
  // board has exactly ONE history-aware overlay (the detail screen) plus one
  // narrow nested case (the Assign-to-picker sheet opened FROM detail), so
  // there's no need for /po's full suppressPopRef machinery — every
  // history.back() call here (button tap or real gesture) is meant to
  // trigger the exact same close logic, with nothing to disambiguate.
  //
  // depthRef counts entries WE pushed above the base /picking URL — kept
  // (rather than dropped, since this build only ever pushes 0 or 1) so a
  // future session extending back-nav to the other 4 sheets can reuse it.
  // navStateRef mirrors detailOpen/pickerSheetOpen for the popstate handler
  // to read live, never a stale closure (same reason /po uses navStateRef).
  const depthRef = useRef(0);
  // findingOpen joins the pair 2026-08-08 — the record popup is a second nested
  // overlay over the detail screen, and it needs the same close-and-re-push
  // treatment the picker sheet already gets.
  // cancelOpen joins the set 2026-08-20 (3b) — the cancel sheet is another
  // nested overlay over the detail screen and needs the same close-and-re-push
  // treatment the picker sheet and the record popup already get.
  const navStateRef = useRef({
    detailOpen: false,
    pickerSheetOpen: false,
    findingOpen: false,
    cancelOpen: false,
  });
  // The popstate listener registers ONCE, so it must not close over a
  // `recorder` object rebuilt on every render.
  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;

  // Push one entry at the CURRENT url (pushState with no url arg navigates
  // nowhere) — a "back" from it is purely an in-app state change, never a
  // real page transition. Only openDetail() calls this; goNext/goPrev swap
  // detailOrderId WITHOUT pushing, so paging through several bills still
  // costs exactly one history entry for the whole detail "session".
  function pushScreen(): void {
    if (typeof window === "undefined") return;
    window.history.pushState({ pickingScreen: "detail" }, "");
    depthRef.current += 1;
  }

  // Picker roster for the assign sheet.
  //
  // 🔴 REFETCHED ON EVERY SHEET OPEN (2026-08-22). This used to run once on
  // mount with an empty dep array, and its comment justified that with "the
  // picker roster doesn't change within a session" — TRUE of a list of NAMES,
  // and false of the live pending count that rides along with it. The moment
  // three bills were assigned, every number in the sheet was wrong until the
  // page was reloaded, and a man who had just been given four bills still read
  // "Free". The count is the whole basis of the free/busy split the sheet now
  // renders, so a stale one does not just mislabel a card — it puts the man in
  // the wrong half of the sheet.
  //
  // The sheet is open for a few seconds at a time and this is a two-query
  // endpoint, so its open is the cheapest correct trigger. Deliberately NOT on
  // the 15s live-sync marker: that marker keys on MAX(orders.updatedAt) and
  // must stay cheap (CORE §3 + CLAUDE_PICKING.md §10 both forbid adding work
  // to it). Deliberately not on an interval either — nobody is watching this
  // sheet, they are acting on it.
  //
  // The early return means this fires ONLY on the false → true edge: the
  // effect re-runs on both transitions, and the close is discarded here.
  useEffect(() => {
    if (!pickerSheetOpen) return;
    let cancelled = false;
    // Collapse back to free-only for this open, whatever the last one left.
    setShowAllPickers(false);
    setPickersLoading(true);
    async function loadPickers() {
      try {
        const res = await fetch("/api/warehouse/pickers");
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const json = (await res.json()) as { pickers?: Picker[] };
        if (!cancelled) setPickers(json.pickers ?? []);
      } catch (err) {
        if (!cancelled) toast.error(err instanceof Error ? err.message : "Failed to load pickers");
      } finally {
        if (!cancelled) setPickersLoading(false);
      }
    }
    void loadPickers();
    return () => {
      cancelled = true;
    };
  }, [pickerSheetOpen]);

  // Line items for the detail screen — fetched on demand per the task brief
  // ("do NOT bloat the main queue payload"). Re-fires only when the target
  // order changes, not on every open/close of the same order.
  useEffect(() => {
    if (detailOrderId === null) return;
    let cancelled = false;
    setLineItemsLoading(true);
    setLineItemsError(null);
    setLineItems(null);
    setCheckedLineIds(new Set());
    async function load() {
      try {
        const res = await fetch(`/api/picking/order/${detailOrderId}`);
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const json = (await res.json()) as { lines?: LineItem[] };
        if (!cancelled) setLineItems(json.lines ?? []);
      } catch (err) {
        if (!cancelled) setLineItemsError(err instanceof Error ? err.message : "Failed to load line items");
      } finally {
        if (!cancelled) setLineItemsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // lineItemsReloadKey lets a 409 force a re-read of the SAME bill — the
    // server knows something this screen does not (someone else confirmed a
    // line while it sat open).
  }, [detailOrderId, lineItemsReloadKey]);

  // data.rows arrives already sorted server-side (lib/picking/sort.ts
  // PICKING_SPINE — assigned-sink leads, window next). Array.filter preserves
  // that order; NOTHING here re-sorts or re-groups.
  //
  // `&& !r.isDone && !r.isChecked` — a PICK_DONE or PICK_CHECKED row has
  // isAssigned: false (that boolean is strictly PICK_ASSIGNED-only, see
  // lib/picking/queue.ts's KNOWN GAP comment), so without this it would
  // wrongly reappear here as if untouched and re-offerable to Assign. It
  // does NOT need the equivalent guard on the assigned/Check side —
  // assignedRows below already excludes both correctly, since isAssigned
  // is false for them either way.
  const waitingRows: PickingQueueRow[] = useMemo(
    () => (data ? data.rows.filter((r) => !r.isAssigned && !r.isDone && !r.isChecked) : []),
    [data],
  );
  const assignedRows: PickingQueueRow[] = useMemo(
    () => (data ? data.rows.filter((r) => r.isAssigned) : []),
    [data],
  );
  // "Check now" pool — the Done tab's top band since the 2026-07-20 re-slot
  // (it was the Check tab's "Needs check" band, step 5) — bills the
  // picker has marked done. Parallel to assignedRows above, same source
  // data, no new fetch. isDone is strict-per-stage (=== PICK_DONE), so a
  // PICK_CHECKED row is false here on its own — no !isChecked guard needed,
  // it already has its own home (checkedRows below).
  const doneRows: PickingQueueRow[] = useMemo(
    () => (data ? data.rows.filter((r) => r.isDone) : []),
    [data],
  );
  // Checked tab pool (2026-07-18) — bills the supervisor has approved.
  const checkedRows: PickingQueueRow[] = useMemo(
    () => (data ? data.rows.filter((r) => r.isChecked) : []),
    [data],
  );

  // Route counts — one bill each, narrowed by the active Type pill.
  //
  // ⚠ NOT ZONE-FILTERED, on purpose. An "upcoming" (locked) bill still counts
  // its route as present: the supervisor can open and read a locked bill, so a
  // route that has one is a route he may legitimately want to filter to. This
  // is why the number here can exceed the lane strip's `{filteredWaitingDue
  // .length} due` — different questions, both correct.
  const routeCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of waitingRows) {
      if (r.route === null) continue;
      if (!matchesType(r, activeType)) continue;
      map.set(r.route, (map.get(r.route) ?? 0) + 1);
    }
    return map;
  }, [waitingRows, activeType]);

  // ⚠ THE OPTION LIST COMES OFF THE COUNT MAP — this is the whole 2026-08-21 fix.
  //
  // It used to be a SECOND memo (`availableRoutes`) that walked `waitingRows`
  // and never read `activeType`, so the list and the counts answered two
  // different questions: with Local selected the sheet still offered "Vapi",
  // an Upcountry-only route, and the `?? 0` below printed a literal 0 beside
  // it. Deriving the keys from the already-narrowed map means a route with no
  // bill under the active type CANNOT appear — the zero row is unreachable by
  // construction rather than filtered out after the fact, and `?? 0` is now
  // dead code kept only for the type.
  //
  // Same shape as `pickerOptions` / `checkedPickerOptions` below, which have
  // always been built this way and have never had this bug. Three sheets, one
  // pattern.
  const routeOptions: FilterSheetOption[] = useMemo(() => {
    return Array.from(routeCounts.keys())
      .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }))
      .map((route) => ({ value: route, label: route, count: routeCounts.get(route) ?? 0 }));
  }, [routeCounts]);

  const q = query.trim().toLowerCase();
  const filteredWaitingAll: PickingQueueRow[] = useMemo(() => {
    return waitingRows.filter((r) => {
      if (activeType !== "All" && r.deliveryType !== activeType) return false;
      if (activeRoute !== null && r.route !== activeRoute) return false;
      if (q && !(r.dealerName.toLowerCase().includes(q) || r.obdNumber.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [waitingRows, activeType, activeRoute, q]);

  // ── Zone partition (step 5a) ─────────────────────────────────────────────
  // A DISPLAY partition, not a sort. Array.filter preserves the server's
  // PICKING_SPINE order inside each zone, and lib/picking/sort.ts is
  // untouched — zone is a grouping the UI applies, never a spine rule (that
  // was a locked decision in step 3; do not add a byZone rule to the spine).
  const filteredWaitingDue: PickingQueueRow[] = useMemo(
    () => filteredWaitingAll.filter((r) => r.zone === "due"),
    [filteredWaitingAll],
  );
  // ── Pick bundling — ASSIGN TAB, ZONE 1 ONLY (2026-08-18) ─────────────────
  //
  // Runs over `filteredWaitingDue`, i.e. AFTER the type/route/search filters,
  // for the same reason Floor's By-group view does: those narrow "which bills
  // are we talking about", a fair question to ask of a bundle. Zone 2 is never
  // fed in — an upcoming bill is not assignable, so bundling it would offer the
  // supervisor work he is not allowed to hand out.
  //
  // ⚠️ ORDER OF PLAY, owned by the engine's contract: Rule 1 FIRST over the
  // whole set, Rule 2 only over what Rule 1 left. A bill is never in both.
  //
  // ⚠ THE ENGINE IS USED AS-IS (lib/picking/grouping.ts, shared with Floor).
  // Where the phone's shape differed, THE CALLER ADAPTED: the engine wants
  // { orderId, obdNumber, skus }, so we build that from the payload's
  // `waitingSkus` sibling here rather than teaching the engine about
  // PickingQueueRow. Both boards therefore hand it the identical shape and can
  // never disagree about a bundle.
  //
  // With PICKING_GROUPING_ENABLED false the payload's two arrays are empty, so
  // `skusById` is empty, every candidate has zero SKUs, the engine drops them
  // all, and this yields no groups and an `ungrouped` that is the whole list —
  // which renders as today's flat list.
  const bundles = useMemo(() => {
    const skusById = new Map((data?.waitingSkus ?? []).map((w) => [w.orderId, w.skus] as const));
    const oil = new Set<string>();
    for (const entry of data?.oilSkus ?? []) {
      for (const code of entry.skus) oil.add(code);
    }
    const rowById = new Map(filteredWaitingDue.map((r) => [r.orderId, r] as const));
    const candidates = filteredWaitingDue.map((r) => ({
      orderId: r.orderId,
      obdNumber: r.obdNumber,
      skus: skusById.get(r.orderId) ?? [],
    }));

    const one = buildPickGroups(candidates);
    const leftover = new Set(one.ungrouped);
    const two = buildOilGroups(candidates.filter((c) => leftover.has(c.orderId)), oil);

    const rowsFor = (ids: { orderId: number }[]) =>
      ids.map((m) => rowById.get(m.orderId)).filter((r): r is PickingQueueRow => r !== undefined);

    return {
      same: one.groups.map((g) => rowsFor([g.main, ...g.riders])).filter((rs) => rs.length > 0),
      mostly: two.groups.map((g) => ({
        rows: rowsFor(g.members),
        hasNonOil: g.hasNonOil,
      })).filter((g) => g.rows.length > 0),
      singles: rowsFor(two.ungrouped.map((id) => ({ orderId: id }))),
    };
  }, [data?.waitingSkus, data?.oilSkus, filteredWaitingDue]);

  const filteredWaitingUpcoming: PickingQueueRow[] = useMemo(
    () => filteredWaitingAll.filter((r) => r.zone === "upcoming"),
    [filteredWaitingAll],
  );
  // Due-then-upcoming, matching what is actually on screen. This — NOT
  // filteredWaitingAll — is what the detail screen's prev/next pager walks
  // (DetailListKey "waiting" → activeDetailList), so paging order and visual
  // order cannot diverge. Paging deliberately crosses INTO the upcoming zone:
  // reading a locked bill is allowed, so the pager must not be stricter than
  // a tap, and the Assign CTA is gated per-ROW (on `zone`) rather than per
  // list, so it correctly swaps to the locked variant mid-page.
  const filteredWaiting: PickingQueueRow[] = useMemo(
    () => [...filteredWaitingDue, ...filteredWaitingUpcoming],
    [filteredWaitingDue, filteredWaitingUpcoming],
  );

  // Lane strip counts the WORKING list only. An upcoming bill is not "ready
  // to load" — folding it in would overstate the floor's actual workload.
  const totalLitres = filteredWaitingDue.reduce((sum, r) => sum + (r.volumeLitres ?? 0), 0);
  // Unchanged, and now provably consistent: the options ARE `routeCounts`'
  // keys, so this sum is exactly the sum of the numbers on screen. Before the
  // fix it was already the sum of the counts — but the list carried extra rows
  // at 0, so "All routes 306" sat above rows that did not add up to it.
  const allRoutesCount = Array.from(routeCounts.values()).reduce((a, b) => a + b, 0);

  // The sheet describes what it is actually showing. The old string,
  // "counts reflect the current Type filter", stopped being the interesting
  // fact the moment the LIST started reflecting it too.
  const routeSheetSubtitle =
    activeType === "Local"
      ? "Single-select · only routes with a Local bill"
      : activeType === "Upcountry"
        ? "Single-select · only routes with an Upcountry bill"
        : "Single-select · every route with a waiting bill";

  // ⚠ CHANGING THE TYPE CAN ORPHAN THE SELECTED ROUTE. Vapi is Upcountry-only,
  // so switching to Local leaves `activeRoute = "Vapi"` pointing at a route the
  // sheet no longer offers: the board goes empty and the pill keeps showing a
  // confident teal "Vapi" with nothing on screen explaining why. Reset to All
  // routes when — and only when — the selection has no bill under the new type.
  //
  // ⚠ THIS LIVES IN THE PILL'S HANDLER, NOT AN EFFECT, and that is load-bearing.
  // An effect keyed on `routeCounts` would also fire on the 15s marker refetch
  // (§10), clearing a supervisor's filter the instant somebody else assigned the
  // last bill on his route — a background refresh must never move the ground
  // under a hand. Here it can only ever be the consequence of his own tap.
  //
  // ⚠ There was NO existing reset to lean on. `setActiveRoute` had exactly one
  // caller (the sheet's own onChange) and nothing reset it on tab change either
  // — CLAUDE_PICKING.md §3 claims the route filter "resets to 'All' on tab
  // change"; the code has never done that. Doc drift, reported, not fixed here.
  const handleTypeChange = useCallback(
    (next: TypeFilter): void => {
      setActiveType(next);
      if (activeRoute === null) return;
      const survives = waitingRows.some((r) => r.route === activeRoute && matchesType(r, next));
      if (!survives) setActiveRoute(null);
    },
    [activeRoute, waitingRows],
  );

  // FIX 3 — pickers who currently have bills out on the floor, client-derived
  // from the already-loaded rows (no new fetch). Counts reflect the current
  // Picking-tab type pill (live) — same convention as routeCounts reflecting
  // activeType above. Rows with a null assignedToName (shouldn't happen for an
  // assigned bill, but the field is nullable) are skipped from the option
  // list — they still show up under "All pickers", just never become a
  // selectable filter value.
  // Tab re-slot (2026-07-20) — NARROWED from [...assignedRows, ...doneRows] to
  // assignedRows alone. This dropdown now belongs to the Picking tab, which
  // holds exactly one band (pick_assigned); the done rows it used to cover
  // moved to the Done tab and are counted by checkedPickerCounts below.
  // Leaving the old union here would show picker counts higher than the
  // number of cards actually on screen.
  const pickerCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of assignedRows) {
      if (checkTypeFilter !== "All" && r.deliveryType !== checkTypeFilter) continue;
      if (r.assignedToName === null) continue;
      map.set(r.assignedToName, (map.get(r.assignedToName) ?? 0) + 1);
    }
    return map;
  }, [assignedRows, checkTypeFilter]);
  const pickerOptions: FilterSheetOption[] = useMemo(() => {
    return Array.from(pickerCounts.keys())
      .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }))
      .map((name) => ({ value: name, label: name, count: pickerCounts.get(name) ?? 0 }));
  }, [pickerCounts]);
  const allPickersCount = Array.from(pickerCounts.values()).reduce((a, b) => a + b, 0);

  // Done tab's picker filter (2026-07-18, WIDENED 2026-07-20) — same shape as
  // pickerCounts above. Was scoped to checkedRows alone when "Checked" was its
  // own single-band tab; the re-slot gave that tab a second band on top
  // (needs-check / pick_done), so this dropdown must cover BOTH bands or its
  // counts undercount what the tab actually shows. Still filters by PICKER
  // (who fetched the bill), never by checker — one dropdown, one meaning,
  // every tab.
  const checkedPickerCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of [...doneRows, ...checkedRows]) {
      if (checkedTypeFilter !== "All" && r.deliveryType !== checkedTypeFilter) continue;
      if (r.assignedToName === null) continue;
      map.set(r.assignedToName, (map.get(r.assignedToName) ?? 0) + 1);
    }
    return map;
  }, [doneRows, checkedRows, checkedTypeFilter]);
  const checkedPickerOptions: FilterSheetOption[] = useMemo(() => {
    return Array.from(checkedPickerCounts.keys())
      .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }))
      .map((name) => ({ value: name, label: name, count: checkedPickerCounts.get(name) ?? 0 }));
  }, [checkedPickerCounts]);
  const allCheckedPickersCount = Array.from(checkedPickerCounts.values()).reduce((a, b) => a + b, 0);

  // FIX 2 + FIX 3 — Check tab lists, narrowed by type, picker, and the SAME
  // search query the Assign tab uses (`q`, defined above). Type + picker +
  // search all STACK (AND, not OR) — Check has the same two-axis filter
  // shape as Assign (type pills + one dropdown), just picker instead of
  // route. Step 5 split the single "assigned" list into two sections
  // sharing this SAME filter state — "one filter state, two rendered
  // slices" — rather than giving each section its own type/picker/search.
  const filteredStillPicking: PickingQueueRow[] = useMemo(() => {
    return assignedRows.filter((r) => {
      if (checkTypeFilter !== "All" && r.deliveryType !== checkTypeFilter) return false;
      if (activePicker !== null && r.assignedToName !== activePicker) return false;
      if (q && !(r.dealerName.toLowerCase().includes(q) || r.obdNumber.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [assignedRows, checkTypeFilter, activePicker, q]);

  // REPOINTED 2026-07-20 — was driven by checkTypeFilter/activePicker (the
  // Check tab's filter state) back when this band lived there. The re-slot
  // moved it into the Done tab, so it must obey the DONE tab's filter row
  // (checkedTypeFilter/activeCheckedPicker) — the controls actually visible
  // above it. Left on the old state it would render silently narrowed by a
  // dropdown sitting one tab away, with no on-screen explanation for the
  // missing cards. Same AND-stacking shape as before, same shared `q`.
  const filteredNeedsCheck: PickingQueueRow[] = useMemo(() => {
    return doneRows.filter((r) => {
      if (checkedTypeFilter !== "All" && r.deliveryType !== checkedTypeFilter) return false;
      if (activeCheckedPicker !== null && r.assignedToName !== activeCheckedPicker) return false;
      if (q && !(r.dealerName.toLowerCase().includes(q) || r.obdNumber.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [doneRows, checkedTypeFilter, activeCheckedPicker, q]);

  // Checked tab (2026-07-18) — own type/picker filters + the shared search
  // query, same AND-stacking shape as filteredStillPicking/filteredNeedsCheck
  // above. Unlike those (which keep server sort order), this is explicitly
  // re-sorted newest-first by checkedAt — a flat activity record, not a
  // work queue, so "most recently approved on top" is the useful order, not
  // PICKING_SPINE's window/route ranking. sort.ts itself is untouched; this
  // is a display-only re-order of an already-filtered slice.
  const filteredChecked: PickingQueueRow[] = useMemo(() => {
    const filtered = checkedRows.filter((r) => {
      if (checkedTypeFilter !== "All" && r.deliveryType !== checkedTypeFilter) return false;
      if (activeCheckedPicker !== null && r.assignedToName !== activeCheckedPicker) return false;
      if (q && !(r.dealerName.toLowerCase().includes(q) || r.obdNumber.toLowerCase().includes(q))) return false;
      return true;
    });
    return filtered.slice().sort((a, b) => {
      const at = a.checkedAt !== null ? new Date(a.checkedAt).getTime() : 0;
      const bt = b.checkedAt !== null ? new Date(b.checkedAt).getTime() : 0;
      return bt - at;
    });
  }, [checkedRows, checkedTypeFilter, activeCheckedPicker, q]);

  // FIX 4 — count of the CURRENTLY VISIBLE (filtered) "Still picking" bills
  // whose elapsed-since-assigned time has crossed the amber threshold.
  // Needs-check rows are deliberately excluded — their pill counts minutes
  // since PICKED, a different clock, and the summary strip's "over 30m"
  // has only ever meant "still picking too long," unchanged by the split.
  // Reuses elapsedSinceAssigned (and therefore ELAPSED_AMBER_MINUTES)
  // rather than re-deriving elapsed time with a second, possibly-drifting
  // calculation.
  const overThresholdCount = useMemo(() => {
    return filteredStillPicking.filter((r) => {
      const e = elapsedSinceAssigned(r.assignedAt, nowTick);
      return e !== null && e.minutes >= ELAPSED_AMBER_MINUTES;
    }).length;
  }, [filteredStillPicking, nowTick]);

  function toggleSelect(orderId: number): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  const laneLabel =
    [activeType !== "All" ? (activeType === "Upcountry" ? "UPC" : activeType) : null, activeRoute]
      .filter(Boolean)
      .join(" · ") || "All routes";

  // Selected rows narrowed to what's currently VISIBLE under the active
  // type/route/search filters — a row hidden by a later filter change drops
  // out of the bar/assign payload rather than silently riding along
  // uncounted (its checkbox still shows checked if the filter is reverted;
  // it just doesn't count or get submitted while hidden).
  //
  // ⚠ DUE ZONE ONLY (step 5a) — this is THE chokepoint that enforces the
  // lock on the bulk path. Both the floating bar's count and `assignTarget`
  // (and therefore the POST /api/picking/assign body) read this one array,
  // so an upcoming bill cannot reach either even if its id somehow entered
  // the `selected` Set. That is defence at the layer that matters, not at
  // the checkbox: the locked card renders a lock INSTEAD of a checkbox, so
  // toggleSelect is already unreachable for it — this is the second,
  // independent guard, and the one that would still hold if the card markup
  // were ever changed. Derived from filteredWaitingDue, NOT filteredWaiting.
  const selectedRows = filteredWaitingDue.filter((r) => selected.has(r.orderId));
  const selectedLitres = selectedRows.reduce((sum, r) => sum + (r.volumeLitres ?? 0), 0);
  const pickerSheetSubtitle =
    assignTarget.length === 1
      ? `1 bill · ${assignTarget[0].dealerName}`
      : `${assignTarget.length} bills selected`;

  // The row the detail screen is currently showing — looked up fresh from
  // `data` each render (not a captured snapshot) so it reflects the latest
  // fetch if something changed the row while the screen was open.
  const detailRow: PickingQueueRow | null = useMemo(() => {
    if (!data || detailOrderId === null) return null;
    return data.rows.find((r) => r.orderId === detailOrderId) ?? null;
  }, [data, detailOrderId]);

  // Shared reset used by BOTH the original open (openDetail, below) and
  // paging to a neighbour bill (goNext/goPrev) — same per-bill ephemeral
  // state (search/pack-filter/ticks) must never carry from one bill to the
  // next either way. Re-setting detailOpen(true) on every call is harmless
  // (already true during goNext/goPrev).
  function switchDetailTo(orderId: number, listKey: DetailListKey): void {
    setDetailOrderId(orderId);
    setDetailListKey(listKey);
    setDetailOpen(true);
    setDetailSearching(false);
    setDetailQuery("");
    setActivePackFilter("ALL");
    setCheckedLineIds(new Set());
    // The popup belongs to ONE line of ONE bill — paging away must close it.
    // `recordMode` deliberately does NOT reset here (screen-level mode); it
    // resets on a fresh open, in openDetail.
    recorderRef.current.close();
  }

  // Detail-interactions Build A — `listKey` says which of the four already-
  // memoized lists this bill's card came from (the Done tab has two sections
  // sharing one activeTab value, so activeTab alone can't disambiguate).
  // Pushes ONE history entry for the whole detail "session" — see pushScreen.
  function openDetail(orderId: number, listKey: DetailListKey): void {
    switchDetailTo(orderId, listKey);
    // Recording is OFF on every fresh open — the bill he opens looks exactly
    // like the bill he opens today, and arming the mode is a deliberate tap.
    recorderRef.current.setRecordMode(false);
    // Defensive reset (Build B) — a fresh open from a card tap must always
    // start at rest, in case a prior session's gesture left the ref mid-
    // transform. The pager's own paging flow deliberately does NOT reset
    // here — it manages the transform itself across its 3 phases.
    // (`pager` is declared below; this only ever runs from a tap, long after
    // the render that initialises it.)
    pager.resetTransform();
    pushScreen();
  }

  // The REAL close — only ever called from the popstate handler below, so
  // every close path (header Back tap, Android back, iOS edge-swipe) runs
  // through this exact same logic, never a direct setDetailOpen(false).
  function closeDetail(): void {
    setDetailOpen(false);
  }

  // Live-resolved list for the open detail's prev/next paging — re-picked
  // every render from `detailListKey`, off the SAME already-memoized arrays
  // the board itself renders, so a post-Undo refetch is reflected
  // automatically (never a frozen snapshot captured at open time).
  const activeDetailList: PickingQueueRow[] = useMemo(() => {
    switch (detailListKey) {
      case "waiting": return filteredWaiting;
      case "needsCheck": return filteredNeedsCheck;
      case "stillPicking": return filteredStillPicking;
      case "checked": return filteredChecked;
    }
  }, [detailListKey, filteredWaiting, filteredNeedsCheck, filteredStillPicking, filteredChecked]);

  // ── Swipe/slide paging — the SHARED hook (./use-bill-pager.ts) ───────────
  // Build A's gesture gate + Build B's Option-1 slide animation moved there
  // VERBATIM on 2026-07-30 when the picker face adopted the same gesture;
  // this board's behaviour, timings and rendering are unchanged. What stayed
  // here is exactly what is board-specific: WHICH list to page
  // (activeDetailList, off detailListKey) and WHAT to reset on a swap
  // (switchDetailTo — search, pack filter, line ticks).
  //
  // pager.contentRef wraps everything below the detail header (stat strip /
  // pack filter / line items / the 3 CTAs) — the header itself does NOT
  // slide; its dealer-name/OBD text just updates at the swap instant, as the
  // counter's "N of M" and the stat strip do (conventional for mobile
  // page-transition UI, e.g. Mail's conversation swipe).
  //
  // ⚠ NO history push/pop lives in the hook: paging through twelve bills
  // still costs exactly ONE history entry for the whole detail session.
  const pager = useBillPager({
    list: activeDetailList,
    currentOrderId: detailOrderId,
    onSwitch: (orderId) => switchDetailTo(orderId, detailListKey),
  });
  const detailIndex = pager.index;

  // ── Detail-interactions Build A — the ONE popstate authority ─────────────
  // Keeps navStateRef synced to live detailOpen/pickerSheetOpen so the
  // handler (registered once below) never reads a stale closure.
  useEffect(() => {
    navStateRef.current = {
      detailOpen,
      pickerSheetOpen,
      findingOpen: recorder.target !== null,
      cancelOpen: cancelTarget !== null,
    };
  }, [detailOpen, pickerSheetOpen, recorder.target, cancelTarget]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    function onPop(): void {
      depthRef.current = Math.max(0, depthRef.current - 1);
      // Topmost layer is the Assign-to-picker sheet opened FROM detail
      // (openPickerForRow, below) — approved minimal guard: close just the
      // sheet and re-push, so the single "detail" entry this build relies on
      // stays available for the NEXT back-press to actually close detail.
      // The sheet itself never pushes its own entry (out of scope — the
      // other 4 sheets + the bulk-bar opening of this same sheet are a
      // separate, later cleanup); this only intercepts the nested case.
      // The record popup is the topmost layer when it is up — same
      // close-just-this-and-re-push treatment as the picker sheet below it, so
      // the single "detail" entry survives for the NEXT back-press.
      if (navStateRef.current.findingOpen && navStateRef.current.detailOpen) {
        recorderRef.current.close();
        pushScreen();
        return;
      }
      if (navStateRef.current.pickerSheetOpen && navStateRef.current.detailOpen) {
        setPickerSheetOpen(false);
        pushScreen();
        return;
      }
      // The cancel sheet — same shape as the two branches above. A back-press
      // while it is open closes the SHEET and re-pushes, so the single "detail"
      // entry survives for the NEXT back-press to close the bill. Without the
      // re-push the depth desyncs and one more back would leave /picking
      // entirely. It is NOT a branch on its own: like the picker sheet, it only
      // ever floats over the detail screen, so it is guarded on both.
      if (navStateRef.current.cancelOpen && navStateRef.current.detailOpen) {
        setCancelTarget(null);
        setCancelMenuOpen(false);
        pushScreen();
        return;
      }
      if (navStateRef.current.detailOpen) {
        closeDetail();
      }
      // Nothing tracked open (depth already 0) — let the pop fall through:
      // the browser's real previous entry, whatever that is.
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /**
   * Tick/untick ONE ROW — which since the 2026-08-10 split-SKU merge may cover
   * several raw lines (see PickingDetailLine.lineIds).
   *
   * Takes the row's whole id array and moves ALL of them together, so a merged
   * row can never end up half-ticked: there is one circle on screen, so there
   * must be one state behind it. The set stays keyed by RAW line id (unchanged)
   * — it is the Approve gate's currency, and that gate counts raw lines.
   */
  function toggleLineChecked(lineIds: readonly number[]): void {
    setCheckedLineIds((prev) => {
      const next = new Set(prev);
      // "Already ticked" means EVERY underlying line is — the same test the row
      // renders from, so tapping always flips what the picker sees.
      const allChecked = lineIds.every((id) => next.has(id));
      for (const id of lineIds) {
        if (allChecked) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  // Approve gate — checks the FULL line set, never filteredLineItems, so an
  // active pack-chip filter hiding some lines can never let a partially-
  // resolved bill through (task brief: "Approve must still require ALL lines
  // ticked, not just visible ones"). A zero-line bill stays permanently
  // disabled rather than vacuously passing `.every()` on an empty array —
  // a bill with no lines shouldn't be in picking at all.
  //
  // ⚠ WIDENED 2026-08-08: a line counts as RESOLVED if it is plain-ticked OR
  // it carries a CONFIRMED finding. The two are alternatives, not both — a
  // line the supervisor recorded as short is resolved by that record; making
  // him also tick it would be asking the same question twice.
  //
  // ⚠ A PENDING finding does NOT count. A picker's report is a claim awaiting
  // review, and Approve is the review — letting it satisfy the gate would let
  // a supervisor approve a bill on the strength of the picker's own say-so
  // without ever looking. The mockup states this outright ("an amber 'picker
  // recorded' line does NOT count until the supervisor actually confirms it").
  // This is the single most important line in this memo; do not relax it.
  //
  // ⚠ COUNTED IN RAW LINES, NOT ROWS (2026-08-10, the split-SKU merge). One row
  // may now stand for several `import_raw_line_items` (li.lineIds), so both the
  // numerator and the denominator run over lineIds rather than over rows.
  // Keeping the gate in raw lines means the merge cannot change what Approve
  // demands — before and after, it is "every underlying line of this bill".
  // Rows and lines are equal on a bill with no split SKUs, which is most of them.
  const totalRawLineCount = useMemo(
    () => (lineItems ?? []).reduce((sum, li) => sum + li.lineIds.length, 0),
    [lineItems],
  );
  const resolvedLineCount = useMemo(
    () =>
      (lineItems ?? []).reduce((sum, li) => {
        // A confirmed finding resolves the whole row. Only single-line rows can
        // carry one (the route never merges a group that has a finding), so
        // this adds exactly 1 — written as lineIds.length so it stays correct
        // if that ever changes.
        if (findingState(li.finding) === "confirmed") return sum + li.lineIds.length;
        return sum + li.lineIds.filter((id) => checkedLineIds.has(id)).length;
      }, 0),
    [lineItems, checkedLineIds],
  );
  const allLinesResolved =
    lineItems !== null && totalRawLineCount > 0 && resolvedLineCount === totalRawLineCount;

  // Distinct packs present on this bill, for the pack-filter chip row.
  // Sorted SMALLEST FIRST by real pack size, with "No pack" trailing last (an
  // exception category, not a real pack value).
  //
  // ⚠ The ordering lives in lib/picking/pack-sort.ts, shared with the picker
  // board — NOT inline here. The two faces build this same strip from the same
  // payload and have drifted before; one helper is what stops them disagreeing
  // about what order sizes go in.
  //
  // Was `a.localeCompare(b)` until 2026-08-10, which is alphabetical on the
  // LABEL: a bill with 100ML / 1L / 20L / 4L / 500ML rendered its chips in
  // exactly that order ("100ML" before "1L" because "0" < "L"). See pack-sort.ts.
  const distinctPackKeys = useMemo(() => {
    if (!lineItems) return [];
    const set = new Set<string>();
    for (const li of lineItems) set.add(li.pack ?? NO_PACK_KEY);
    const keys = Array.from(set);
    const real = sortPackLabels(keys.filter((k) => k !== NO_PACK_KEY));
    return keys.includes(NO_PACK_KEY) ? [...real, NO_PACK_KEY] : real;
  }, [lineItems]);

  // Operates on the GROUPED rows the route now returns (2026-08-10) — `lineItems`
  // is one entry per (SKU, pack), not per raw line. Both filters read fields
  // that are identical across a merged group by construction (sku, name, pack
  // all resolve FROM the SAP code the group is keyed on), so a merged row is
  // matched or excluded as a unit and can never be half-filtered. Unchanged in
  // behaviour for the single-line rows that are most of them.
  const detailQueryNorm = detailQuery.trim().toLowerCase();
  const filteredLineItems = useMemo(() => {
    if (!lineItems) return [];
    return lineItems.filter((li) => {
      if (activePackFilter !== "ALL") {
        const key = li.pack ?? NO_PACK_KEY;
        if (key !== activePackFilter) return false;
      }
      if (
        detailQueryNorm &&
        !(li.sku.toLowerCase().includes(detailQueryNorm) || (li.name ?? "").toLowerCase().includes(detailQueryNorm))
      ) {
        return false;
      }
      return true;
    });
  }, [lineItems, activePackFilter, detailQueryNorm]);

  // Opens the shared picker sheet targeted at a single row — the detail
  // screen's own "Assign to picker" CTA, independent of the bulk selection.
  function openPickerForRow(row: PickingQueueRow): void {
    setAssignTarget([row]);
    setPickerSheetOpen(true);
  }

  const handleAssign = useCallback(
    async (pickerId: number, pickerName: string) => {
      if (assignTarget.length === 0 || assigning) return;
      setAssigning(true);
      try {
        const res = await fetch("/api/picking/assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderIds: assignTarget.map((r) => r.orderId), pickerId }),
        });
        const json = (await res.json().catch(() => ({}))) as AssignResponse;
        if (!res.ok) {
          // Hard error / non-200 — keep selection intact so they can retry,
          // sheet stays open.
          toast.error(json.error ?? `Request failed (${res.status})`);
          return;
        }
        const assignedCount = json.assigned ?? 0;
        const failedList = json.failed ?? [];
        if (failedList.length > 0) {
          // Partial failure — the endpoint didn't abort the batch; never
          // report this as a clean success.
          toast(`${assignedCount} assigned, ${failedList.length} couldn't be assigned`);
        } else {
          toast.success(`${assignedCount} ${assignedCount === 1 ? "bill" : "bills"} → ${pickerName}`);
        }
        setSelected(new Set());
        // The sheet itself isn't history-tracked (approved plan — out of
        // scope this build), so it always closes via plain state, never
        // history.back().
        setPickerSheetOpen(false);
        // Detail-interactions Build A — only route through history.back()
        // when this assign actually came from the detail screen's own CTA
        // (detailOpen true). From the bulk floating bar, detail was never
        // open and never pushed an entry, so calling history.back()
        // unconditionally here would incorrectly pop/exit instead of being
        // the harmless no-op this comment used to describe.
        if (detailOpen) {
          window.history.back();
        }
        await refetchQueue();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Assign failed");
      } finally {
        setAssigning(false);
      }
    },
    [assignTarget, assigning, refetchQueue, detailOpen],
  );

  // Undo — mirrors picking-queue.tsx's handleUnassign: single-order payload
  // (no batch endpoint exists), refetch-after-action rather than patching
  // rows locally, and the same 409 handling (bill already moved out from
  // under us — refetch and say so honestly instead of a generic failure).
  // ── Cancel bill (3b) ──────────────────────────────────────────────────────
  // Modelled on handleApprove, NOT handleAssign. Cancel exists only inside the
  // detail screen and has no bulk equivalent, so the history pop is
  // UNCONDITIONAL — handleAssign's `if (detailOpen)` guard exists purely
  // because the bulk floating bar reaches that function without ever having
  // pushed an entry, which is not a case this action has.
  //
  // Order on success: close the sheet → pop the detail entry → toast → refetch.
  // The pop is fired BEFORE the await so the screen leaves immediately (the
  // bill is gone; keeping it on screen while a fetch resolves would be showing
  // a dead order), and refetchQueue's own errors are swallowed by design.
  const handleCancel = useCallback(
    async (row: PickingQueueRow, reason: CancelReason, note: string) => {
      if (cancelling) return; // in-flight guard — same double-tap shape as the other writes
      setCancelling(true);
      try {
        const res = await fetch("/api/picking/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: row.orderId, reason, note: note.trim() || undefined }),
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok) {
          if (res.status === 409) {
            // The bill moved out from under him. EXISTING 409 copy and shape,
            // word for word — same as handleUndo/handleAssign/handleApprove, so
            // the module says this one thing one way.
            setCancelTarget(null);
            toast("Already changed — refreshed.");
            if (detailOpen) window.history.back();
            await refetchQueue();
          } else {
            toast.error(json.error ?? `Request failed (${res.status})`);
          }
          return;
        }
        setCancelTarget(null);
        setCancelMenuOpen(false);
        window.history.back();
        toast.success(`Bill cancelled · ${row.obdNumber}`);
        await refetchQueue();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Cancel failed");
      } finally {
        setCancelling(false);
      }
    },
    [cancelling, detailOpen, refetchQueue],
  );

  const handleUndo = useCallback(
    async (row: PickingQueueRow) => {
      if (unassigningIds.has(row.orderId)) return;
      setUnassigningIds((prev) => new Set(prev).add(row.orderId));
      try {
        const res = await fetch("/api/picking/unassign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: row.orderId }),
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok) {
          if (res.status === 409) {
            toast("Already changed — refreshed.");
            await refetchQueue();
          } else {
            toast.error(json.error ?? `Request failed (${res.status})`);
          }
          return;
        }
        toast.success(`${row.dealerName} released`);
        await refetchQueue();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Undo failed");
      } finally {
        setUnassigningIds((prev) => {
          const next = new Set(prev);
          next.delete(row.orderId);
          return next;
        });
      }
    },
    [unassigningIds, refetchQueue],
  );

  // Early release (5b) — single-order payload, refetch-after-action, same
  // 409 handling as handleUndo/handleApprove. The released bill re-renders
  // under "Due now" purely because the server sends it back with
  // zone: "due" — there is NO client-side move and no optimistic patch, so
  // the board can never show a bill as released that the write didn't
  // actually persist.
  const handleRelease = useCallback(
    async (row: PickingQueueRow) => {
      if (releasing) return;
      setReleasing(true);
      try {
        const res = await fetch("/api/picking/release", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: row.orderId }),
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok) {
          if (res.status === 409) {
            // Someone else released it, or its date rolled over to today
            // while this screen sat open — refetch and say so honestly
            // rather than reporting a generic failure.
            toast("Already changed — refreshed.");
            await refetchQueue();
          } else {
            toast.error(json.error ?? `Request failed (${res.status})`);
          }
          return;
        }
        toast.success(`${row.dealerName} released for picking`);
        setReleaseTarget(null);
        await refetchQueue();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Release failed");
      } finally {
        setReleasing(false);
      }
    },
    [releasing, refetchQueue],
  );

  // Approve — step 6. Single-order payload, refetch-after-action (never
  // patch rows locally), same 409 handling as handleUndo/handleAssign above.
  const handleApprove = useCallback(
    async (row: PickingQueueRow) => {
      if (approving) return;
      setApproving(true);
      try {
        const res = await fetch("/api/picking/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: row.orderId }),
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!res.ok) {
          if (res.status === 409) {
            toast("Already changed — refreshed.");
            await refetchQueue();
          } else {
            toast.error(json.error ?? `Request failed (${res.status})`);
          }
          return;
        }
        toast.success(`${row.dealerName} approved`);
        // Approve only ever renders inside the detail screen (no bulk
        // equivalent) — unconditional history.back(), unlike handleAssign.
        window.history.back();
        await refetchQueue();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Approve failed");
      } finally {
        setApproving(false);
      }
    },
    [approving, refetchQueue],
  );

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#f9fafb]">
      {/* Direction-A slim header (Stage 3/4, 2026-07-19) — replaces the old
          Assign/Check/Checked TopBarTab strip, which now lives in the shared
          bottom bar (workflow-tab-bar.tsx, driven by PickingMobileShell).
          Same STRUCTURE as before: a flex-shrink-0 sibling of the scroll
          area below; `fixed inset-0` on the root still escapes
          RoleLayoutClient's non-scrolling ancestor chain exactly as it did
          pre-Stage-3. Avatar (left, opens the shared You sheet) · title
          (center) · grid (opens the shared Menu sheet) + search (right) —
          per docs/mockups/picking/mobile-shell-v1.html.

          EXTRACTED 2026-07-29 to components/shared/module-mobile-header.tsx
          (CLAUDE_UI.md §59.6's [DEFERRED] "shared minimal header"). The
          markup moved verbatim — same classNames, aria-labels, tap targets,
          icon sizes and safe-area padding; only the OWNER moved, exactly as
          Stage 3 moved the tab state up to PickingMobileShell. The handlers
          stay here: the header takes them as props and never calls
          useMobileShell() itself, so a future module can point the avatar and
          grid somewhere else. */}
      <ModuleMobileHeader
        title="Picking"
        avatarInitials={userInitials}
        onAvatarClick={openYou}
        onMenuClick={openMenu}
        searchActive={searching}
        onSearchToggle={() => setSearching((v) => !v)}
      />

      {/* Scrollable content area — flex-1, ONLY this scrolls. Reserves 76px
          at the bottom for the fixed mobile-shell bar (WorkflowTabBar now,
          not the default Home/Menu/You nav — same MOBILE_NAV_CLEARANCE
          height either way, see workflow-tab-bar.tsx's own height-rule
          comment), since this root no longer benefits from
          RoleLayoutClient's own pb-[76px]. */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-[76px]">

      {/* Filter row (swaps for search when active) — shared by both tabs.
          Assign: type pills + route dropdown + lane strip. Check: the SAME
          type pills (own state) + picker dropdown + check summary strip
          (FIX 3/4) — mirrors Assign's row exactly, pills left/dropdown right. */}
      <div className="bg-white border-b border-gray-200 px-4 pt-2.5">
        {searching ? (
          <div className="flex items-center gap-2 pb-2.5">
            <div className="flex-1 flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-[10px] px-3 py-2.5">
              <Search size={16} className="text-gray-400 shrink-0" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search customer or OBD…"
                className="flex-1 bg-transparent border-none outline-none text-[15px] text-gray-900 placeholder:text-gray-400"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setSearching(false);
                setQuery("");
              }}
              className="text-[13px] font-semibold text-teal-700 px-1 shrink-0"
            >
              Cancel
            </button>
          </div>
        ) : activeTab === "assign" ? (
          <>
            <div className="flex items-center justify-between gap-2 pb-2.5">
              {/* handleTypeChange, not setActiveType — it also drops an
                  orphaned route selection. See its comment. */}
              <TypeFilterPills value={activeType} onChange={handleTypeChange} />
              <button
                type="button"
                onClick={() => setRouteSheetOpen(true)}
                className={
                  "flex-1 min-w-0 max-w-[150px] flex items-center justify-between gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-full border " +
                  (activeRoute !== null
                    ? "border-teal-500 bg-teal-50 text-teal-700"
                    : "border-gray-200 bg-white text-gray-500")
                }
              >
                <span className="truncate">{activeRoute ?? "All routes"}</span>
                <ChevronDown size={13} className="shrink-0" />
              </button>
            </div>

            <div className="mx-[-16px] bg-teal-50 border-t border-teal-200 px-4 py-2 text-[12px] font-medium text-teal-700 flex items-center gap-1">
              <b className="font-bold">{laneLabel}</b>
              <span>
                &nbsp;·&nbsp;{filteredWaitingDue.length} due&nbsp;·&nbsp;{formatLitres(totalLitres)} L ready to load
              </span>
            </div>
          </>
        ) : activeTab === "picking" ? (
          <>
            {/* FIX 3 (reversed decision) — SAME type pills as Assign (reused
                component, own independent state) on the left, picker dropdown
                on the right — same position/styling as the route dropdown.
                Mirrors Assign's row exactly; fixes BUG 2's lopsided layout.
                2026-07-20: this row followed the "Still picking" band to the
                Picking tab; it now filters ONE band, not two. */}
            <div className="flex items-center justify-between gap-2 pb-2.5">
              <TypeFilterPills value={checkTypeFilter} onChange={setCheckTypeFilter} />
              <button
                type="button"
                onClick={() => setPickerFilterSheetOpen(true)}
                className={
                  "flex-1 min-w-0 max-w-[150px] flex items-center justify-between gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-full border " +
                  (activePicker !== null
                    ? "border-teal-500 bg-teal-50 text-teal-700"
                    : "border-gray-200 bg-white text-gray-500")
                }
              >
                <span className="truncate">{activePicker ?? "All pickers"}</span>
                <ChevronDown size={13} className="shrink-0" />
              </button>
            </div>

            {/* FIX 4 — summary strip, same teal-tint style as the lane strip,
                reflecting ALL active filters (type + picker + search).
                2026-07-20: reverted to counting ONE band. Step 5 had widened
                this to needsCheck + stillPicking because the tab held both;
                needs-check has now moved to the Done tab, so counting it here
                would describe cards that aren't on this screen. "over 30m"
                was always scoped to still-picking (see overThresholdCount) and
                is unchanged. Segment omitted entirely when the count is 0. */}
            <div className="mx-[-16px] bg-teal-50 border-t border-teal-200 px-4 py-2 text-[12px] font-medium text-teal-700 flex items-center gap-1">
              <b className="font-bold">{activePicker ?? "All pickers"}</b>
              <span>
                &nbsp;·&nbsp;{filteredStillPicking.length} picking
                {overThresholdCount > 0 && (
                  <>&nbsp;·&nbsp;{overThresholdCount} over {ELAPSED_AMBER_MINUTES}m</>
                )}
              </span>
            </div>
          </>
        ) : (
          <>
            {/* Done tab (2026-07-18, re-slotted 2026-07-20) — same row shape as
                Picking: type pills left, its OWN picker dropdown right (filters
                by picker, same semantic as Picking's dropdown — see state
                comment above). This row now drives BOTH of the tab's bands
                ("Check now" + "Checked"), which is why filteredNeedsCheck was
                repointed onto this state. */}
            <div className="flex items-center justify-between gap-2 pb-2.5">
              <TypeFilterPills value={checkedTypeFilter} onChange={setCheckedTypeFilter} />
              <button
                type="button"
                onClick={() => setCheckedPickerFilterSheetOpen(true)}
                className={
                  "flex-1 min-w-0 max-w-[150px] flex items-center justify-between gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-full border " +
                  (activeCheckedPicker !== null
                    ? "border-teal-500 bg-teal-50 text-teal-700"
                    : "border-gray-200 bg-white text-gray-500")
                }
              >
                <span className="truncate">{activeCheckedPicker ?? "All pickers"}</span>
                <ChevronDown size={13} className="shrink-0" />
              </button>
            </div>

            {/* Two counts now — the actionable one first. "checked today" keeps
                its explicit "today" wording because that band alone is
                date-fenced (queue.ts's openPending scope); needs-check spans
                all dates, so it deliberately carries no day qualifier. */}
            <div className="mx-[-16px] bg-teal-50 border-t border-teal-200 px-4 py-2 text-[12px] font-medium text-teal-700 flex items-center gap-1">
              <b className="font-bold">{activeCheckedPicker ?? "All pickers"}</b>
              <span>
                &nbsp;·&nbsp;{filteredNeedsCheck.length} to check
                &nbsp;·&nbsp;{filteredChecked.length} checked today
              </span>
            </div>
          </>
        )}
      </div>

      {/* Card list — Assign tab, TWO ZONES (step 5a, 2026-07-20).
          Fidelity source: docs/mockups/picking/assign-two-zones.html.

          Zone 1 "Due now"  — dispatch date <= today, PLUS null-date bills
                              (the locked null→due rule in queue.ts). The
                              working list: checkbox, tap-to-open, assignable.
          Zone 2 "Upcoming" — dispatch date > today. Visible and READABLE but
                              not assignable; auto-graduates into Zone 1 when
                              the IST day rolls over (no job, no write — the
                              server recomputes `zone` on every fetch).

          The Due header is intentionally rendered ONLY when the Upcoming
          section is also present. With no upcoming bills the tab is a single
          flat list exactly as before, and a lone "DUE NOW" header over the
          whole screen would be chrome labelling the obvious. */}
      {activeTab === "assign" && (
      <div className="px-4 py-2.5">
        {loading && <p className="text-[13px] text-gray-400 text-center py-16">Loading queue&hellip;</p>}

        {!loading && error && (
          <p className="text-[13px] text-red-600 text-center py-16">
            Couldn&apos;t load the picking queue: {error}
          </p>
        )}

        {!loading && !error && data && (
          filteredWaitingDue.length === 0 && filteredWaitingUpcoming.length === 0 ? (
            <p className="text-[13px] text-gray-400 text-center py-16">No bills here right now.</p>
          ) : (
            <>
              {filteredWaitingUpcoming.length > 0 && (
                <div className="text-[11.5px] font-bold uppercase tracking-wider text-gray-700 mb-2 px-[2px]">
                  Due now<span className="tabular-nums ml-1.5">{filteredWaitingDue.length}</span>
                </div>
              )}

              {/* Due-empty but upcoming-present: say so gently and still show
                  the locked section below, so "nothing to do" and "nothing
                  exists" never look the same. */}
              {filteredWaitingDue.length === 0 ? (
                <p className="text-[12.5px] text-gray-400 text-center py-6">
                  Nothing to assign right now.
                </p>
              ) : bundles.same.length === 0 && bundles.mostly.length === 0 ? (
                /* NO BUNDLES TODAY — the flat list, exactly as it has always
                   been. No "SINGLE PICKS" heading over the whole screen: with
                   nothing to distinguish them FROM, it would be chrome
                   labelling the obvious, the same call this tab already makes
                   for its "Due now" header above. This is ALSO the branch
                   PICKING_GROUPING_ENABLED=false always lands in, which is what
                   makes the flag-off board byte-identical to today. */
                filteredWaitingDue.map((row) => (
                  <PickingCard
                    key={row.orderId}
                    row={row}
                    variant="assign"
                    selected={selected.has(row.orderId)}
                    onOpen={() => openDetail(row.orderId, "waiting")}
                    onToggleSelect={() => toggleSelect(row.orderId)}
                  />
                ))
              ) : (
                /* BUNDLES PRESENT. Order is locked: SAME MATERIAL, then MOSTLY
                   SAME, then SINGLE PICKS. Same-material leads because it is
                   unconditionally the better deal — the supervisor should spend
                   the ones that cost his picker nothing before he weighs one
                   that costs him steps. Inside each kind the engine's own order
                   is kept untouched. */
                <>
                  {bundles.same.map((rows) => (
                    <div key={`same-${rows[0].orderId}`} className="mb-[6px]">
                      <BundleHeading label="Same material · one picker" tone="teal" />
                      {rows.map((row) => (
                        <PickingCard
                          key={row.orderId}
                          row={row}
                          variant="assign"
                          stripe="teal"
                          selected={selected.has(row.orderId)}
                          onOpen={() => openDetail(row.orderId, "waiting")}
                          onToggleSelect={() => toggleSelect(row.orderId)}
                        />
                      ))}
                    </div>
                  ))}

                  {bundles.mostly.map((g) => (
                    <div key={`mostly-${g.rows[0].orderId}`} className="mb-[6px]">
                      <BundleHeading label="Mostly same · one picker" tone="amber" />
                      {/* The honest line. A MOSTLY SAME bundle earns its place
                          on the premise that the material sits in one end of
                          the depot — and sometimes part of it does not. Saying
                          so is the point: he decides, and he can only decide if
                          he is told. Grey, no red, no badge, no block. */}
                      {g.hasNonOil && (
                        <div className="text-[11px] leading-relaxed text-gray-400 mb-[7px] px-[2px]">
                          Some items here are outside the oil paint area
                        </div>
                      )}
                      {g.rows.map((row) => (
                        <PickingCard
                          key={row.orderId}
                          row={row}
                          variant="assign"
                          stripe="amber"
                          selected={selected.has(row.orderId)}
                          onOpen={() => openDetail(row.orderId, "waiting")}
                          onToggleSelect={() => toggleSelect(row.orderId)}
                        />
                      ))}
                    </div>
                  ))}

                  {bundles.singles.length > 0 && (
                    <div className="mb-[6px]">
                      {/* No dot: these are not a bundle, and a coloured dot
                          would imply they were a third kind. */}
                      <BundleHeading label="Single picks" tone="grey" />
                      {bundles.singles.map((row) => (
                        <PickingCard
                          key={row.orderId}
                          row={row}
                          variant="assign"
                          selected={selected.has(row.orderId)}
                          onOpen={() => openDetail(row.orderId, "waiting")}
                          onToggleSelect={() => toggleSelect(row.orderId)}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* ── ZONE 2 · UPCOMING (LOCKED) ──────────────────────────────
                  Header is NEUTRAL grey, never amber: a bill scheduled for
                  Thursday is early, not late. Painting it on the staleness
                  scale would teach the floor to discount amber elsewhere. */}
              {filteredWaitingUpcoming.length > 0 && (
                <>
                  <div className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-gray-400 mt-[22px] mb-2 px-[2px] pt-[14px] border-t border-gray-200">
                    <LockGlyph className="w-[13px] h-[13px]" />
                    Upcoming<span className="tabular-nums ml-1.5">{filteredWaitingUpcoming.length}</span>
                  </div>

                  {filteredWaitingUpcoming.map((row) => (
                    <PickingCard
                      key={row.orderId}
                      row={row}
                      variant="assignLocked"
                      onOpen={() => openDetail(row.orderId, "waiting")}
                      onLockTap={() => setReleaseTarget(row)}
                    />
                  ))}
                </>
              )}
            </>
          )
        )}
      </div>
      )}

      {/* Card list — Picking tab (re-slotted 2026-07-20): the former "Still
          picking" band, now the tab's ONLY content. Bills a picker is
          physically fetching (pick_assigned).

          Three things deliberately dropped in the move, all consequences of
          being alone on a tab rather than the lower half of a split:
            - the section header (nothing to distinguish it FROM),
            - `muted` (it was de-emphasised relative to needs-check; with no
              sibling band there is nothing to de-emphasise against, and a
              whole tab rendered at 75% opacity just looks broken),
            - the "N assigned" wording in the strip above (now "N picking").
          Everything else is untouched: same CheckCard, the same grey<30m /
          amber30m+ / red60m+ elapsed pill via checkCardPill(row,"still"), the
          same "stillPicking" DetailListKey, and Undo still living on the
          detail screen (gated on the ROW's isAssigned, not on this tab). */}
      {activeTab === "picking" && (
      <div className="px-4 py-2.5">
        {loading && <p className="text-[13px] text-gray-400 text-center py-16">Loading queue&hellip;</p>}

        {!loading && error && (
          <p className="text-[13px] text-red-600 text-center py-16">
            Couldn&apos;t load the picking queue: {error}
          </p>
        )}

        {!loading &&
          !error &&
          data &&
          (filteredStillPicking.length === 0 ? (
            <p className="text-[13px] text-gray-400 text-center py-16">
              {assignedRows.length === 0 ? "Nobody is picking right now." : "No bills match."}
            </p>
          ) : (
            filteredStillPicking.map((row) => (
              <PickingCard
                key={row.orderId}
                row={row}
                variant="picking"
                nowTick={nowTick}
                onOpen={() => openDetail(row.orderId, "stillPicking")}
              />
            ))
          ))}
      </div>
      )}

      {/* Card list — Done tab (re-slotted 2026-07-20): TWO bands, replacing
          what was a flat checked-only list. The split mirrors the one the
          Check tab used to own — same "one filter state, two rendered slices"
          shape, same section-header + muted-lower-band treatment — only the
          membership changed.

            "Check now" (top, plain)  = filteredNeedsCheck (pick_done),
                                        ALL dates — nothing unchecked is ever
                                        aged out and lost.
            "Checked"   (below, muted) = filteredChecked (pick_checked),
                                        TODAY only (fenced server-side by
                                        queue.ts's openPending scope), already
                                        sorted newest-checked-first.

          Approving a bill moves it from the top band to the bottom one
          without leaving this tab — the "collapse" the locked design
          describes. Both bands use the same CheckCard; only the lower one
          passes checkerName, so "✓ Checked by {name}" keeps its own
          never-truncated line and the upper band renders byte-identically to
          how it did on the old Check tab. */}
      {activeTab === "done" && (
      <div className="px-4 py-2.5">
        {loading && <p className="text-[13px] text-gray-400 text-center py-16">Loading queue&hellip;</p>}

        {!loading && error && (
          <p className="text-[13px] text-red-600 text-center py-16">
            Couldn&apos;t load the picking queue: {error}
          </p>
        )}

        {!loading && !error && data && (
          <>
            <div className="text-[11.5px] font-bold uppercase tracking-wider text-gray-700 mb-2 px-[2px]">
              Check now<span className="tabular-nums ml-1.5">{filteredNeedsCheck.length}</span>
            </div>
            {filteredNeedsCheck.length === 0 ? (
              <p className="text-[12.5px] text-gray-400 text-center py-6">
                {doneRows.length === 0 ? "Nothing waiting on a check right now." : "No bills match."}
              </p>
            ) : (
              filteredNeedsCheck.map((row) => (
                <PickingCard
                  key={row.orderId}
                  row={row}
                  variant="doneCheck"
                  nowTick={nowTick}
                  onOpen={() => openDetail(row.orderId, "needsCheck")}
                />
              ))
            )}

            <div className="text-[11.5px] font-semibold uppercase tracking-wider text-gray-400 mt-[18px] mb-2 px-[2px]">
              Checked<span className="tabular-nums ml-1.5">{filteredChecked.length}</span>
            </div>
            {filteredChecked.length === 0 ? (
              <p className="text-[12.5px] text-gray-400 text-center py-6">
                {checkedRows.length === 0 ? "Nothing checked today yet." : "No bills match."}
              </p>
            ) : (
              filteredChecked.map((row) => (
                <PickingCard
                  key={row.orderId}
                  row={row}
                  variant="doneChecked"
                  nowTick={nowTick}
                  onOpen={() => openDetail(row.orderId, "checked")}
                />
              ))
            )}
          </>
        )}
      </div>
      )}

      </div>
      {/* ^ closes the flex-1 overflow-y-auto scroll region opened above the
          filter row. Everything below is a fixed-position overlay (sheets,
          the detail screen, the floating bar) — unaffected by this root's
          fixed-inset-0 restructure since position:fixed always resolves
          against the true viewport regardless of ancestor layout. */}

      {/* Route bottom sheet (Assign) — reuses FilterBottomSheet */}
      <FilterBottomSheet
        open={routeSheetOpen}
        onClose={() => setRouteSheetOpen(false)}
        title="Filter by route"
        subtitle={routeSheetSubtitle}
        allLabel="All routes"
        allCount={allRoutesCount}
        options={routeOptions}
        value={activeRoute}
        onChange={setActiveRoute}
      />

      {/* Picker filter sheet (Check, FIX 3) — SAME reused sheet, different data */}
      <FilterBottomSheet
        open={pickerFilterSheetOpen}
        onClose={() => setPickerFilterSheetOpen(false)}
        title="Filter by picker"
        subtitle="Single-select · counts reflect the current Type filter"
        allLabel="All pickers"
        allCount={allPickersCount}
        options={pickerOptions}
        value={activePicker}
        onChange={setActivePicker}
      />

      {/* Picker filter sheet (Checked tab, 2026-07-18) — SAME reused sheet,
          own data/state — this dropdown filters by picker (who picked the
          bill), same semantic as Check's dropdown above. */}
      <FilterBottomSheet
        open={checkedPickerFilterSheetOpen}
        onClose={() => setCheckedPickerFilterSheetOpen(false)}
        title="Filter by picker"
        subtitle="Single-select · counts reflect the current Type filter"
        allLabel="All pickers"
        allCount={allCheckedPickersCount}
        options={checkedPickerOptions}
        value={activeCheckedPicker}
        onChange={setActiveCheckedPicker}
      />

      {/* Early-release confirm sheet (5b) — docs/mockups/picking/
          release-early-confirm.html. Reuses SHEET_GEOMETRY rather than
          hand-picking z-indexes and a bottom offset: that constant exists
          precisely because this figure was re-copied wrong three times
          before it was centralised (§7). Conditionally rendered (not an
          always-mounted slide) to match FilterBottomSheet's own pattern.

          This is the ONLY confirm on the whole board — assign, undo, mark
          done and approve are all fire-and-forget by design
          (CLAUDE_PICKING.md §6). Early release earns one because it is the
          single action that overrides a date Support set deliberately, it is
          rare, and it has no Undo. The sheet names the bill AND its
          scheduled date so the supervisor can verify he has the right one; a
          bare "Are you sure?" would give him nothing to check against. */}
      {releaseTarget !== null && (
        <>
          <div
            className={`fixed inset-0 bg-black/40 ${SHEET_GEOMETRY.scrimZ}`}
            onClick={() => {
              if (!releasing) setReleaseTarget(null);
            }}
            aria-hidden="true"
          />
          <div
            className={`fixed left-0 right-0 ${SHEET_GEOMETRY.panelZ} bg-white rounded-t-[18px] p-5`}
            style={{ bottom: SHEET_GEOMETRY.bottomOffset }}
            role="dialog"
            aria-modal="true"
          >
            <div className="w-9 h-1 rounded-full bg-gray-300 mx-auto mb-3.5" />
            <h3 className="text-[17px] font-extrabold text-gray-900 leading-snug">
              Release this bill for picking early?
            </h3>
            <p className="text-[13px] text-gray-500 mt-2 leading-relaxed">
              <b className="text-gray-700 font-bold">{releaseTarget.dealerName}</b>
              <span className="text-gray-400"> · {releaseTarget.obdNumber}</span>
              <br />
              {formatDispatchDay(releaseTarget.dispatchTargetDate) !== null && (
                <>
                  Scheduled for{" "}
                  <b className="text-gray-700 font-bold">
                    {formatDispatchDay(releaseTarget.dispatchTargetDate)}
                    {releaseTarget.windowTime !== null ? `, ${releaseTarget.windowTime}` : ""}
                  </b>
                  .{" "}
                </>
              )}
              Releasing moves it into <b className="text-gray-700 font-bold">Due now</b> so it can be
              assigned today.
            </p>
            <div className="flex gap-2.5 mt-[18px]">
              <button
                type="button"
                onClick={() => setReleaseTarget(null)}
                disabled={releasing}
                className="flex-1 h-12 rounded-full bg-white border border-gray-200 active:bg-gray-50 text-gray-700 text-[14.5px] font-bold disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleRelease(releaseTarget)}
                disabled={releasing}
                className="flex-1 h-12 rounded-full bg-teal-600 active:bg-teal-700 text-white text-[14.5px] font-bold shadow-[0_8px_22px_rgba(13,148,136,0.42)] disabled:opacity-60"
              >
                {releasing ? "Releasing…" : "Release"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Detail screen — always mounted, slides in via translate-x so the
          board underneath (filters + scroll) is never torn down. Redesigned
          for the PICKER (not the supervisor): pack is the shelf, SKU is the
          box, qty is the count — each gets its own fixed column below. */}
      <div
        className={
          "fixed inset-0 z-[35] bg-[#f9fafb] flex flex-col transition-transform duration-200 ease-out " +
          (detailOpen ? "translate-x-0" : "translate-x-full")
        }
        {...pager.touchHandlers}
      >
        {/* ⚠ SUPERVISOR detail header. On a duplicate-SO bill the teal band goes
            red and carries the same tag, so the flag survives from the card into
            the screen where the supervisor is actually comparing line items —
            which is where he decides which of the two bills is real.
            The teal is a className and the red an inline style, so the red wins
            without a class fight. The PICKER's detail header
            (picker-my-picks-board.tsx) is deliberately NOT touched. */}
        <div
          // TWO ROWS since 2026-08-22 (was one). The chips moved OUT of the
          // title block and became the header's own second line, indented to
          // sit under the title — which is what frees the whole first line for
          // the dealer name. `flex-col`; the row-1 wrapper below owns the
          // items-center that used to live here.
          //
          // Right padding is 6px, not 14px: the icon buttons are 44px tap
          // targets now, and their glyphs sit ~11px inside that box, so a 14px
          // gutter would push the visible glyph a clear 25px off the edge.
          className="bg-teal-600 pl-3.5 pr-1.5 pb-3.5 flex flex-col shrink-0"
          style={{
            paddingTop: "max(env(safe-area-inset-top, 0px), 12px)",
            ...(detailRow?.hasDuplicateSo ? { background: DUP_SO_FILL } : null),
          }}
        >
          {/* Row 1 — back · title + subtitle · icons. gap-1.5 (6px) is load-
              bearing: 38px back + 6px = the 44px the chip row below indents by,
              so the chips line up under the title rather than under the back
              button. Change one and change the other. */}
          <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => window.history.back()}
            aria-label="Back"
            className="w-[38px] h-[38px] rounded-[10px] bg-white/[0.16] flex items-center justify-center text-white shrink-0"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="min-w-0 flex-1">
            {/* 16.5px/600 — the name now gets the WHOLE line (the route left
                the subtitle and the bay circle left the right end), so it
                truncates far later than it did. Weight dropped 800 → 600: with
                nothing competing beside it, extrabold was carrying emphasis it
                no longer had to earn. */}
            <div className="text-[16.5px] font-semibold text-white truncate min-w-0">
              {detailRow?.dealerName ?? "—"}
            </div>
            <div
              className={"text-[11.5px] truncate " + (detailRow?.hasDuplicateSo ? "" : "text-white/70")}
              style={detailRow?.hasDuplicateSo ? { color: DUP_SO_MUTED } : undefined}
            >
              {/* ⚠ THE ROUTE IS GONE FROM HERE (2026-08-22) — it moved to the
                  band below, so it appears EXACTLY ONCE on this screen. Do not
                  put it back: two copies of a lane name is how one of them goes
                  stale. The `?? "Unmatched"` that used to sit here did not
                  simply disappear either — the band renders the route side even
                  when route is null, and prints "Unmatched" there, which is why
                  removing it from this line loses nothing. See bill-band.tsx. */}
              {detailRow
                ? `${detailRow.obdNumber}${
                    detailRow.windowTime !== null ? ` · ${detailRow.windowTime}` : ""
                  }`
                : "—"}
            </div>
          </div>
          {/* Icons — the pair this face has always had, at their new size.
              Glyphs 17 → 22px, each in a 44px tap target, and gap-0 so the two
              read as ONE control cluster rather than two loose buttons. The
              triangle is NOT here any more: it moved to the band (bill-band.tsx
              `trailing`), which is why this is a clean pair. */}
          <div className="flex items-center shrink-0">
            {/* ⋯ — cancel the whole bill (3b).

                ⚠ RENDERED ONLY when the bill's stage is cancellable. A
                pick_checked bill gets NO ⋯ at all — not a disabled one, not an
                empty menu: an approved bill is cancellable from Floor Control
                only, and a greyed control would invite a tap that can never
                succeed. Because the whole button is omitted rather than hidden,
                the header does not shift or leave a gap — it is the first child
                of this cluster, so its absence simply shortens the row (the
                same no-placeholder rule ModuleMobileHeader's `showSearch`
                follows).

                The stage comes from pickingRowStage() — the ONE owner of the
                booleans→stage mapping — tested against
                PICKING_CANCELLABLE_STAGES, the SAME list the route enforces. No
                stage name is written here. */}
            {detailRow !== null &&
              PICKING_CANCELLABLE_STAGES.includes(pickingRowStage(detailRow)) && (
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setCancelMenuOpen((v) => !v)}
                    aria-label="More actions"
                    aria-expanded={cancelMenuOpen}
                    className="w-11 h-11 rounded-[10px] flex items-center justify-center text-white active:bg-white/15 shrink-0"
                  >
                    <MoreVertical size={22} />
                  </button>
                  {cancelMenuOpen && (
                    <>
                      {/* Tap-outside catcher. Plain sibling, not a portal — the
                          menu is a transient popover, not a history-tracked
                          overlay, so it deliberately does NOT push an entry and
                          the popstate handler knows nothing about it. */}
                      <div
                        className="fixed inset-0 z-[60]"
                        onClick={() => setCancelMenuOpen(false)}
                        aria-hidden="true"
                      />
                      <div className="absolute right-0 top-[46px] z-[61] w-[176px] overflow-hidden rounded-[12px] border border-gray-200 bg-white shadow-[0_10px_30px_rgba(16,24,40,0.18)]">
                        {/* ONE item. Undo / Assign / Approve stay on the bottom
                            CTA row where they already live. */}
                        <button
                          type="button"
                          onClick={() => {
                            setCancelMenuOpen(false);
                            setCancelTarget(detailRow);
                          }}
                          className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left text-[14px] font-semibold text-red-600 active:bg-red-50"
                        >
                          <XCircle size={16} className="shrink-0" />
                          Cancel bill
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            <button
              type="button"
              onClick={() => setDetailSearching((v) => !v)}
              aria-label="Search line items"
              className="w-11 h-11 rounded-[10px] flex items-center justify-center text-white active:bg-white/15 shrink-0"
            >
              <Search size={22} />
            </button>
          </div>
          </div>
          {/* Row 2 — flag chips, the header's own second line now (2026-08-22).
              Indented 44px to sit under the title, NOT under the back button.

              ⚠ THREE OF THESE ARE SYMBOL-ONLY as of 2026-08-22 — a 26px
              coloured circle each, no words. Every one carries BOTH an
              aria-label and a title holding the words it replaced: a symbol
              with no accessible name is a regression, not a simplification.
              The glyph colours are the CARD's own, so a bill's flags still
              survive from the card into the detail.

              ⚠ min-h-[38px] so the row holds its height on a bill whose only
              chip is a 26px circle — without it the header's second line
              changes height depending on WHICH flags a bill carries.

              ⚠ THE GUARD BELOW KEEPS ALL FIVE DISJUNCTS. Two of them are
              recorded bug-fixes (SMU and duplicate-SO) and neither is
              removable; see their own comments inside it. */}
            {detailRow &&
              (detailRow.isKeyCustomer ||
                detailRow.priorityLevel === 1 ||
                detailRow.isTint ||
                // ⚠ The SMU badge MUST be in this guard, not only in the row
                // below it: a 74/77 bill that is not a key dealer, not urgent
                // and not a tint would otherwise have its whole flag row
                // suppressed and show no badge at all.
                isSmuBadged(detailRow.smuCode) ||
                // ⚠ SAME TRAP, SAME FIX — the duplicate tag lives in this row,
                // so a flagged bill that is none of the above would have the
                // whole row suppressed and lose the one signal it came for.
                detailRow.hasDuplicateSo) && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2 pl-[44px] min-h-[38px]">
                {/* Leads the row — it is the reason the header is red. */}
                {detailRow.hasDuplicateSo && <DuplicateSoTag />}
                {/* ★ ⚡ 🎨 — SYMBOL ONLY since 2026-08-22. Each was a frosted
                    pill carrying its own word ("Key dealer" / "Urgent" /
                    "Tint"); the words are now in the aria-label AND the title,
                    so the meaning is still announced to a screen reader and
                    still reachable on a long-press, while the row itself costs
                    a fraction of the width it used to.

                    ⚠ THE WORDS ARE NOT OPTIONAL. If you ever restyle these,
                    the aria-label and title go with them — three unlabelled
                    coloured dots is a puzzle, not a header. */}
                {detailRow.isKeyCustomer && (
                  <span
                    className="inline-flex items-center justify-center w-[26px] h-[26px] rounded-full shrink-0"
                    style={{ background: "#fef3c7", color: "#b45309" }}
                    aria-label="Key dealer"
                    title="Key dealer"
                    role="img"
                  >
                    <Star size={14} className="fill-current" />
                  </span>
                )}
                {detailRow.priorityLevel === 1 && (
                  <span
                    className="inline-flex items-center justify-center w-[26px] h-[26px] rounded-full shrink-0"
                    style={{ background: "#fee2e2", color: "#b91c1c" }}
                    aria-label="Urgent"
                    title="Urgent"
                    role="img"
                  >
                    <Zap size={14} className="fill-current" />
                  </span>
                )}
                {detailRow.isTint && (
                  <span
                    className="inline-flex items-center justify-center w-[26px] h-[26px] rounded-full shrink-0"
                    style={{ background: "#f3e8ff", color: "#7e22ce" }}
                    aria-label="Tint"
                    title="Tint"
                    role="img"
                  >
                    <span className="text-[13px] leading-none">🎨</span>
                  </span>
                )}
                {/* SMU — the SHARED atom, badge-to-badge with the three above.
                    Deliberately NOT re-skinned as a frosted white/16 pill like
                    its neighbours: those three carry their meaning in a WORD
                    and use colour only for a glyph, while this one carries its
                    meaning in the COLOUR (UI §1209's indigo/cyan), which a
                    frosted overlay would erase. Same component, same hexes as
                    the card, so a bill's SMU reads identically in both places.
                    Self-gates to 74/77; the row's own guard above matches. */}
                <SmuBadge code={detailRow.smuCode} />
              </div>
            )}
        </div>

        {/* ── The band (2026-08-22) — bay · route · triangle ────────────────
            Directly under the header, outside it, so the header keeps its own
            teal and this keeps its darker #0a5049.

            ⚠ THE ROUTE IS `row.route` — the SAME field the card renders and
            the route filter narrows on. Never delivery_point_master's
            primaryRouteId (bill-band.tsx says why).

            ⚠ THE TRIANGLE LIVES HERE NOW, on both faces, and never returns to
            the header. Its gate is unchanged (`isDone` on this face) and what
            it does is unchanged — one screen-level boolean, no write. A
            control that moves between two homes depending on the bill is worse
            than a band that is occasionally sparse, so on a bill with neither
            bay nor route the band still renders and holds it.

            Gated on `detailRow !== null` only: the detail screen is always
            mounted (it slides in via translate-x), so between bills and while
            closed there is no row to describe. */}
        {detailRow !== null && (
          <BillBand
            bayNumber={detailRow.bayNumber}
            route={detailRow.route}
            trailing={
              detailRow.isDone ? (
                <FindingTriangleButton
                  armed={recorder.recordMode}
                  onToggle={() => recorder.setRecordMode(!recorder.recordMode)}
                />
              ) : null
            }
          />
        )}

        {/* Recording banner — OUTSIDE pager.contentRef, same as the picker
            board: recording is a screen-level mode and must not slide away on
            every swipe between bills. */}
        {recorder.recordMode && detailRow?.isDone && (
          <FindingRecordBanner onDone={() => recorder.setRecordMode(false)} />
        )}

        {/* Detail-polish Build B — everything below the header (stat strip /
            pack filter / line items / CTAs) is wrapped in ONE ref'd
            container so triggerPageTransition can translate it as a single
            unit. The header itself sits OUTSIDE this wrapper and does not
            slide — its dealer-name/OBD text just updates at the swap
            instant, same as the stat strip and counter below it. */}
        <div ref={pager.contentRef} className="flex-1 min-h-0 flex flex-col">
        {detailSearching ? (
          <div className="bg-white border-b border-gray-200 px-3.5 pt-2.5 pb-2.5 flex items-center gap-2 shrink-0">
            <div className="flex-1 flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-[10px] px-3 py-2.5">
              <Search size={16} className="text-gray-400 shrink-0" />
              <input
                autoFocus
                type="text"
                value={detailQuery}
                onChange={(e) => setDetailQuery(e.target.value)}
                placeholder="Search SKU or product…"
                className="flex-1 bg-transparent border-none outline-none text-[15px] text-gray-900 placeholder:text-gray-400"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setDetailSearching(false);
                setDetailQuery("");
              }}
              className="text-[13px] font-semibold text-teal-700 px-1 shrink-0"
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            {/* Stat strip — Detail-polish Build B (Option-F): LEFT now
                combines packs (articleTag) + volume into one line ("2 Drum ·
                20 L") instead of two separately-aligned blocks; RIGHT is the
                bill-position counter, omitted entirely when this list has
                only one bill (nothing to page between). Weight/KG and any
                line count are deliberately gone — a picker doesn't need
                them here. */}
            <div className="bg-white border-b border-gray-200 px-[14px] py-3 flex items-center justify-between gap-3 shrink-0">
              <div className="min-w-0">
                {/* ⚠ THIS LINE WRAPS — the `truncate` came off 2026-08-22 and
                    must not go back. It is the one place on this screen where a
                    truncation was cutting REAL information rather than a name
                    the reader already knows: "4 Drum, 23 Carton, 27 Tin · 612 L"
                    is a live bill, and what it lost to the ellipsis was the tail
                    of the pack list — exactly the part a supervisor is reading
                    it for. Two lines here cost less than a wrong trolley. */}
                <div className="text-[15px] font-bold leading-snug" style={{ color: "#2a323c" }}>
                  {detailRow?.articleTag ?? "—"}
                  {detailRow?.volumeLitres != null && (
                    <span className="font-semibold" style={{ color: "#8a929c" }}>
                      {" "}&middot; {formatLitres(detailRow.volumeLitres)}{" "}
                      <span className="text-[11px]" style={{ color: "#aab2bb" }}>
                        L
                      </span>
                    </span>
                  )}
                </div>
                {/* Denominator is RAW LINES, not rows on screen — the same
                    number the Approve gate uses, so the counter can never read
                    "8 / 8 resolved" beside a disabled button. See
                    totalRawLineCount. */}
                {detailRow?.isDone && lineItems !== null && (
                  <div className="text-[11.5px] text-gray-400 tabular-nums mt-0.5">
                    {resolvedLineCount} / {totalRawLineCount} resolved
                  </div>
                )}
              </div>
              {/* Neutral gray throughout (CLAUDE_UI §1) — teal stays
                  reserved for the Assign CTA only; this is navigation, not
                  a primary action. Both arrows call the SAME
                  triggerPageTransition the swipe gesture uses, so arrow taps
                  and swipes produce an identical slide. */}
              {/* gap-[10px] (was gap-0.5 = 2px) so the two arrows are
                  separately tappable — at 2px apart a thumb aiming at ‹ on the
                  move regularly caught the counter or ›, and paging the wrong
                  way costs two more taps to undo. */}
              {pager.count > 1 && (
                <div className="flex items-center gap-[10px] shrink-0">
                  <button
                    type="button"
                    onClick={pager.goPrev}
                    disabled={detailIndex <= 0}
                    aria-label="Previous bill"
                    className="w-11 h-11 flex items-center justify-center rounded-[9px] text-gray-500 active:bg-gray-100 disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <span className="text-[12.5px] font-medium text-gray-500 tabular-nums whitespace-nowrap">
                    {detailIndex + 1} of {pager.count}
                  </span>
                  <button
                    type="button"
                    onClick={pager.goNext}
                    disabled={detailIndex >= pager.count - 1}
                    aria-label="Next bill"
                    className="w-11 h-11 flex items-center justify-center rounded-[9px] text-gray-500 active:bg-gray-100 disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <ChevronRight size={17} />
                  </button>
                </div>
              )}
            </div>

            {/* Pack filter — only when the bill actually has more than one
                pack to tell apart; a single-pack bill shows no row at all.

                WRAPS, never scrolls (2026-08-20). This strip used to be
                `overflow-x-auto`, which put every chip past the right edge
                behind a horizontal drag on a 390px phone — chips the picker
                could not see and had no reason to believe were there.
                `flex-wrap` breaks onto a second row instead and the line list
                below simply shifts down (`shrink-0` here is what makes it push
                rather than compress).
                The chips keep `whitespace-nowrap shrink-0`: with wrap those are
                right — each chip holds its natural size and the ROW breaks. At
                320px the container leaves 292px and the widest chip ("No pack")
                is ~74px, so nothing clips; a narrow screen just wraps sooner.
                `gap-1.5` is both axes, so the second row spaces itself. */}
            {distinctPackKeys.length >= 2 && (
              <div className="bg-white border-b border-gray-200 px-3.5 py-2.5 flex items-center flex-wrap gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setActivePackFilter("ALL")}
                  className={
                    "text-[12.5px] font-medium px-3 py-[7px] rounded-full border whitespace-nowrap shrink-0 " +
                    (activePackFilter === "ALL"
                      ? "bg-[#2a323c] border-[#2a323c] text-white font-semibold"
                      : "bg-white border-gray-200 text-[#6b7480]")
                  }
                >
                  All
                </button>
                {distinctPackKeys.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActivePackFilter(key)}
                    className={
                      "text-[12.5px] font-medium px-3 py-[7px] rounded-full border whitespace-nowrap shrink-0 " +
                      (activePackFilter === key
                        ? "bg-[#2a323c] border-[#2a323c] text-white font-semibold"
                        : "bg-white border-gray-200 text-[#6b7480]")
                    }
                  >
                    {key === NO_PACK_KEY ? "No pack" : key}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        <div className="flex-1 overflow-y-auto px-3.5 pt-3 pb-24">
          {lineItemsLoading && (
            <p className="text-[13px] text-gray-400 text-center py-10">Loading line items&hellip;</p>
          )}
          {!lineItemsLoading && lineItemsError && (
            <p className="text-[13px] text-red-600 text-center py-10">
              Couldn&apos;t load line items: {lineItemsError}
            </p>
          )}
          {!lineItemsLoading && !lineItemsError && lineItems !== null && (
            lineItems.length === 0 ? (
              <p className="text-[13px] text-gray-400 text-center py-10">No line items found for this bill.</p>
            ) : filteredLineItems.length === 0 ? (
              <p className="text-[13px] text-gray-400 text-center py-10">No lines match.</p>
            ) : (
              // Flat — filtered, never restructured or grouped by pack.
              filteredLineItems.map((li) => {
                // Every underlying line, or none — a merged row has ONE circle,
                // so a half-ticked group must not be representable on screen.
                const isChecked =
                  detailRow?.isDone === true && li.lineIds.every((id) => checkedLineIds.has(id));
                // ⚠ ONE place decides none/pending/confirmed — findingState().
                const state = findingState(li.finding);
                // A merged row (several raw lines behind one SKU — 2026-08-10).
                const isMerged = li.lineIds.length > 1;
                // A PENDING line is tappable regardless of the mode: the
                // picker already flagged it and confirming is the supervisor's
                // job, so it must not hide behind an extra toggle (the
                // mockup's "always tappable, even without the triangle on").
                // An untouched line needs the mode armed; a CONFIRMED line
                // stays tappable so a wrong number can be corrected.
                //
                // ⚠ NOT ON A MERGED ROW. pick_findings is UNIQUE on
                // rawLineItemId, so a shortage recorded against a summed row
                // would have to pick ONE of its lines to land on, arbitrarily —
                // and "found 22 of 31" says nothing about which batch was
                // short. Recording a shortage against a merged row is DEFERRED:
                // it needs a real design (distribute across lines? a
                // group-level findings row?), and that design does not exist
                // yet. Until it does, the honest behaviour is no entry point.
                // A row that already HAS a finding is never merged (the route
                // splits it back out), so nothing recorded is ever hidden here.
                const rowTappable =
                  detailRow?.isDone === true &&
                  !isMerged &&
                  (recorder.recordMode || state !== "none");
                return (
                <div
                  key={li.id}
                  onClick={rowTappable ? () => recorder.openFor(li) : undefined}
                  // ⚠ NO status fill or border — the row stays white like every
                  // other row and the status lives in the badge + note only.
                  // (The picker board briefly tinted whole rows; live testing
                  // said it read as alarming end to end. Same rule both faces.)
                  className={
                    "flex bg-white rounded-[14px] overflow-hidden mb-2 " +
                    (rowTappable ? "cursor-pointer active:opacity-90" : "")
                  }
                  style={{ boxShadow: SOFT_CARD_SHADOW }}
                >
                  {/* PACK TILE — fixed 56px, full card height (flex stretch),
                      SLATE when known (was teal — recoloured 2026-07-21 so the
                      teal 'Assign to picker' CTA is the only teal on screen,
                      one-teal rule CLAUDE_UI §1/§6), muted em-dash when missing
                      (never an error/chip style). This column is what makes
                      packs align down the left edge — must not flex. */}
                  <div className="w-14 shrink-0 bg-[#f8fafa] border-r border-gray-200 flex items-center justify-center px-1 py-2.5">
                    <span
                      className="text-[13px] font-bold text-center"
                      style={{ color: li.pack !== null ? "#3d4650" : "#9ca3af" }}
                    >
                      {li.pack ?? "—"}
                    </span>
                  </div>
                  {/* BODY — SKU is the loudest thing on the card; product name
                      is muted confirmation underneath. Mutes slightly once
                      ticked (Check tab only) — per the approved mockup, no
                      ring, no left border, just a quiet row. */}
                  <div className={"flex-1 min-w-0 px-3 py-2.5 transition-opacity " + (isChecked && state === "none" ? "opacity-55" : "")}>
                    <div className="font-mono text-[17px] font-bold text-gray-900 truncate">{li.sku}</div>
                    <div className="text-[12px] text-gray-500 truncate mt-0.5">{li.name ?? "—"}</div>
                    {/* With the row fill gone, this note and the badge ARE the
                        status. mode="confirm" makes a pending line read "tap to
                        confirm" — the supervisor is the one who acts on it. */}
                    {li.finding !== null && (
                      <FindingNote finding={li.finding} mode="confirm" />
                    )}
                  </div>
                  {/* QTY — fixed, plain, no "x" prefix. */}
                  <div className="shrink-0 flex items-center justify-center px-3.5">
                    <span className="text-[26px] font-extrabold text-gray-900 tabular-nums">{li.qty}</span>
                  </div>
                  {/* TICK — needs-check rows only (detailRow.isDone; the Done
                      tab's top band since 2026-07-20), in the gutter
                      the QTY column already reserved. 44px tap zone, 20px/
                      2px-border circle, filled teal + white check when
                      ticked — no border on the column itself (a tap zone,
                      not a compartment), per the approved mockup
                      (docs/mockups/picking/supervisor-check-ticks.html).
                      Freely toggleable — a forcing function, not a lock. */}
                  {/* ⚠ THE CIRCLE IS SHARED BY TWO FEATURES and shows the
                      STRONGER one. With no finding it is the plain tick,
                      exactly as before. Once something is recorded it becomes
                      the finding's badge and its tap opens the popup — a
                      recorded line is resolved BY that record, so asking for a
                      tick as well would be the same question twice (and the
                      Approve gate treats them as alternatives for exactly that
                      reason). The ephemeral tick for that line is not cleared,
                      only hidden. */}
                  {detailRow?.isDone && state !== "none" && (
                    <FindingStatusBadge state={state} onOpen={() => recorder.openFor(li)} />
                  )}
                  {detailRow?.isDone && state === "none" && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleLineChecked(li.lineIds);
                      }}
                      aria-label={isChecked ? "Mark line unchecked" : "Mark line checked"}
                      className="w-11 shrink-0 flex items-center justify-center"
                    >
                      <span
                        className={
                          "w-5 h-5 rounded-full border-2 flex items-center justify-center " +
                          (isChecked ? "bg-teal-600 border-teal-600" : "bg-white border-gray-300")
                        }
                      >
                        {isChecked && (
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                            <path
                              d="M5 13l4 4L19 7"
                              stroke="white"
                              strokeWidth={3.5}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </span>
                    </button>
                  )}
                </div>
                );
              })
            )
          )}
        </div>

        {/* !detailRow.isDone && !detailRow.isChecked — defense-in-depth: a
            PICK_DONE or PICK_CHECKED row is already excluded from
            waitingRows above (so its card won't normally be tapped into),
            but this stops the "Assign to picker" CTA from ever rendering
            for one if this screen is reached some other way (2026-07-18:
            !isChecked added — a checked/approved bill must never offer to
            re-assign itself, same reasoning as the isDone guard it joins).
            Detail-polish Build B (2026-07-19) — paddingBottom switched from
            MOBILE_NAV_CLEARANCE to the plain /po safe-area floor. It read
            MOBILE_NAV_CLEARANCE only because the shared bottom bar used to
            paint OVER the open detail screen (z-40 above this screen's
            z-[35]); Build A's hideBar now removes that bar entirely while
            detail is open, so reserving its height here was excess space —
            the button floated well above the true bottom edge.

            ⚠ `zone !== "upcoming"` (step 5a, 2026-07-20) is NOT
            defense-in-depth like the three guards above it — it is the ONLY
            thing shutting this path for a locked bill, and without it the
            lock is one tap from defeat. An upcoming row is genuinely
            pending: isAssigned/isDone/isChecked are all false, so it passes
            every other guard here. Its card is deliberately tappable (read
            access is allowed), which means this screen is a NORMAL
            destination for a locked bill, not an unreachable edge case. The
            card-level guards — no checkbox, and selectedRows deriving from
            filteredWaitingDue — cover the bulk path only; they do nothing
            here. Locked bills get the disabled variant below instead. */}
        {detailRow && !detailRow.isAssigned && !detailRow.isDone && !detailRow.isChecked && detailRow.zone !== "upcoming" && (
          <div
            className="shrink-0 px-3.5 pb-3.5"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 16px)" }}
          >
            <button
              type="button"
              onClick={() => openPickerForRow(detailRow)}
              className="w-full h-12 rounded-full bg-teal-600 active:bg-teal-700 text-white text-[14.5px] font-bold shadow-[0_8px_22px_rgba(13,148,136,0.42)]"
            >
              Assign to picker
            </button>
          </div>
        )}

        {/* Locked variant — an upcoming bill, opened to read. Everything
            above this is at full contrast; only the verb is shut. The hint
            answers the obvious next question ("then when?") rather than just
            refusing, so nobody has to go hunting for the dispatch date they
            were denied. Fidelity source:
            docs/mockups/picking/locked-bill-open.html.
            `disabled` is real, not cosmetic — a greyed button that still
            fires would be the same bypass with extra steps. */}
        {detailRow && detailRow.zone === "upcoming" && !detailRow.isAssigned && !detailRow.isDone && !detailRow.isChecked && (
          <div
            className="shrink-0 px-3.5 pb-3.5"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 16px)" }}
          >
            <button
              type="button"
              disabled
              className="w-full h-12 rounded-full bg-gray-100 text-gray-400 text-[14.5px] font-bold flex items-center justify-center gap-2 cursor-not-allowed"
            >
              <LockGlyph className="w-[17px] h-[17px]" />
              Assign to picker
            </button>
            {formatDispatchDay(detailRow.dispatchTargetDate) !== null && (
              <p className="text-center text-[12px] text-gray-400 mt-2">
                Opens {formatDispatchDay(detailRow.dispatchTargetDate)}
              </p>
            )}
          </div>
        )}

        {/* Step 5 — Undo, moved off the Check-tab card onto this screen
            (task brief: "keep Undo reachable somehow" until step 6's tick
            screen). detailRow.isAssigned is true ONLY for "Still picking"
            rows — that's deliberate, not an oversight: /api/picking/
            unassign's own guard requires workflowStage === PICK_ASSIGNED,
            so a "Needs check" (PICK_DONE) row would 409 on this exact call.
            No Undo CTA renders for those; step 6 widens that guard on
            purpose and gives them their own Undo there. Detail-polish Build
            B — paddingBottom is the plain /po safe-area floor, see the
            Assign CTA's comment above for why. */}
        {detailRow && detailRow.isAssigned && (
          <div
            className="shrink-0 px-3.5 pb-3.5"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 16px)" }}
          >
            <button
              type="button"
              onClick={() => void handleUndo(detailRow)}
              disabled={unassigningIds.has(detailRow.orderId)}
              className="w-full h-12 rounded-full bg-white border border-gray-200 active:bg-gray-50 text-gray-700 text-[14.5px] font-bold disabled:opacity-50"
            >
              {unassigningIds.has(detailRow.orderId) ? "Undoing…" : "Undo"}
            </button>
          </div>
        )}

        {/* Step 6 — Approve. Renders only for "Needs check" (PICK_DONE)
            rows. Disabled until allLinesChecked (every line ticked, gated
            against the FULL line set — see that memo's comment for the
            pack-filter interaction). No Undo on this screen, deliberately —
            a picked bill goes forward only; see the build-session notes.
            Detail-polish Build B — paddingBottom is the plain /po safe-area
            floor, see the Assign CTA's comment above for why. */}
        {detailRow && detailRow.isDone && (
          <div
            className="shrink-0 px-3.5 pb-3.5"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 16px)" }}
          >
            <button
              type="button"
              onClick={() => void handleApprove(detailRow)}
              disabled={!allLinesResolved || approving}
              className={
                "w-full h-12 rounded-full text-[14.5px] font-bold " +
                (allLinesResolved
                  ? "bg-teal-600 active:bg-teal-700 text-white shadow-[0_8px_22px_rgba(13,148,136,0.42)]"
                  : "bg-gray-200 text-gray-400")
              }
            >
              {approving ? "Approving…" : "Approve"}
            </button>
          </div>
        )}
        </div>
        {/* ^ closes the Detail-polish Build B sliding content wrapper
            (ref={pager.contentRef}) opened above the stat-strip/search
            block. */}

        {/* Record popup — the SHARED component, the same one the picker board
            renders. It carries its own NO_BILL_SWIPE opt-out. */}
        <FindingPopup {...recorder.popupProps} />

        {/* Cancel sheet (3b). Mounted INSIDE the detail screen but OUTSIDE
            pager.contentRef — same placement rule as the recording banner:
            cancelling is a screen-level mode and must not slide away and back
            on every swipe between bills. It is `fixed inset-0` anyway, so the
            position in the tree costs nothing; what matters is that the pager's
            transform never applies to it.

            Rendered off `cancelTarget` (the row captured when ⋯ was tapped),
            not off `detailRow`, so a background refetch that drops the row
            cannot blank the sheet mid-decision. `lineCount` comes from the
            already-loaded line items — no second fetch. */}
        {cancelTarget !== null && (
          <CancelSheet
            row={cancelTarget}
            stage={pickingRowStage(cancelTarget)}
            lineCount={lineItems?.length ?? null}
            busy={cancelling}
            onClose={() => {
              if (!cancelling) setCancelTarget(null);
            }}
            onConfirm={(reason, note) => void handleCancel(cancelTarget, reason, note)}
          />
        )}
      </div>

      {/* Floating assign bar — matches docs/mockups/picking/supervisor-assign-board.html's
          .assignbar exactly (bg-gray-900 pill, teal Assign CTA), sitting just
          above the fixed mobile shell (76px, per components/shared/mobile-shell.tsx). */}
      {selectedRows.length > 0 && (
        <div
          className="fixed left-3 right-3 z-30 bg-gray-900 rounded-2xl px-3.5 py-3 flex items-center justify-between gap-2.5 shadow-[0_10px_26px_rgba(0,0,0,0.28)]"
          style={{ bottom: "calc(76px + env(safe-area-inset-bottom, 0px) + 12px)" }}
        >
          <div className="text-[13px] font-semibold text-white min-w-0 truncate">
            {selectedRows.length} {selectedRows.length === 1 ? "bill" : "bills"}
            <span className="text-gray-400 font-normal"> · {formatLitres(selectedLitres)} L selected</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              disabled={assigning}
              className="text-[12.5px] font-semibold text-gray-400 px-1 py-2 disabled:opacity-50"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => {
                setAssignTarget(selectedRows);
                setPickerSheetOpen(true);
              }}
              disabled={assigning}
              className="flex items-center gap-1.5 bg-teal-600 active:bg-teal-700 text-white text-[13px] font-bold rounded-[10px] px-[15px] py-[9px] disabled:opacity-60"
            >
              Assign
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ── Assign-to-picker sheet — REBUILT 2026-08-22 ────────────────────
          Tap a card to fire the assign immediately (no separate confirm step),
          exactly as the row version did. POST /api/picking/assign, its
          payload, and its two-write order (CLAUDE_PICKING.md §4) are all
          untouched — only what the supervisor is looking at when he taps.

          GEOMETRY. z-indexes and the bottom offset still read from
          SHEET_GEOMETRY, the same single source FilterBottomSheet uses. Only
          the HEIGHT is this sheet's own: it is a near-full-height sheet now
          (a 12-man roster two-up does not fit in 70vh), so `maxHeight` is the
          one field it does not take from the shared constant. Do NOT "fix"
          that by raising SHEET_GEOMETRY.maxHeight — that would drag the route
          and picker FILTER sheets up with it.
          ⚠ The bottom offset is NOT optional and is not decoration: this
          sheet used to be pinned at `bottom: 0` with no mobile-shell-nav
          reservation and no internal scroll, and rendered its last row under
          the fixed bottom nav (CLAUDE_PICKING.md §7's MOBILE_NAV_CLEARANCE
          note). The pinned header + scrolling grid below makes that failure
          mode MORE likely, not less — the grid is the part that runs long. */}
      {pickerSheetOpen && (
        <>
          <div
            className={`fixed inset-0 bg-black/40 ${SHEET_GEOMETRY.scrimZ}`}
            onClick={() => {
              if (!assigning) setPickerSheetOpen(false);
            }}
            aria-hidden="true"
          />
          <div
            className={`fixed left-0 right-0 ${SHEET_GEOMETRY.panelZ} bg-white rounded-t-[18px] flex flex-col`}
            style={{
              bottom: SHEET_GEOMETRY.bottomOffset,
              height: "90vh",
              // 90vh would overflow the top of the screen once the nav
              // clearance is subtracted from the bottom; this clamps it to
              // whatever is actually left, with 16px of air above.
              maxHeight: `calc(100vh - ${SHEET_GEOMETRY.bottomOffset} - 16px)`,
            }}
          >
            {/* PINNED header — outside the scroll container, so "Assign to
                picker · N bills selected" stays legible while the grid moves
                under it. Copy is unchanged. */}
            <div className="shrink-0 px-5 pt-3.5 pb-3">
              <div className="w-9 h-1 rounded-full bg-gray-300 mx-auto mb-3.5" />
              <h3 className="text-[16px] font-extrabold text-gray-900">Assign to picker</h3>
              <p className="text-[12.5px] text-gray-400 mt-[3px]">{pickerSheetSubtitle}</p>
            </div>

            {/* SCROLLING grid. The safe-area floor is the /po convention
                (CLAUDE_UI.md §55) rather than a bare 16px — the sheet's own
                bottom already clears the nav, so on a device with no inset
                this simply resolves to the 16px it would have had. */}
            <div
              className="flex-1 min-h-0 overflow-y-auto px-5"
              style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 16px)" }}
            >
              {pickersLoading && pickers.length === 0 ? (
                <p className="text-[13px] text-gray-400 text-center py-6">Loading pickers&hellip;</p>
              ) : pickers.length === 0 ? (
                <p className="text-[13px] text-gray-400 text-center py-6">No active pickers found.</p>
              ) : (
                <>
                  {/* ⚠ WHILE A REFETCH IS IN FLIGHT WITH STALE DATA ON SCREEN,
                      the free/busy SPLIT is suspended and every picker is
                      shown, with the counts replaced by a quiet placeholder.
                      Rendering the old split would be worse than rendering
                      nothing: the count is what decides which half of the
                      sheet a man appears in, so a stale one does not merely
                      print an old number — it hides a picker who has since
                      become busy, or offers one who has. Showing everyone,
                      unlabelled, for the ~200ms of the fetch is honest about
                      what is not yet known. */}
                  {(() => {
                    const refreshing = pickersLoading;
                    const freePickers = pickers.filter((p) => p.status === "available");
                    const busyPickers = pickers.filter((p) => p.status === "picking");
                    // ZERO FREE — everyone is out. Show the busy list
                    // immediately with a quiet line; the sheet must never open
                    // empty, and a "Show all" row would be the only thing on
                    // screen. Also no row when there is nothing to reveal
                    // (busy === 0), which with a 12-man roster is the ordinary
                    // state, not an edge case.
                    const noneFree = !refreshing && freePickers.length === 0;
                    const visible = refreshing
                      ? pickers
                      : noneFree
                        ? busyPickers
                        : showAllPickers
                          ? [...freePickers, ...busyPickers]
                          : freePickers;
                    const showRow =
                      !refreshing && !noneFree && !showAllPickers && busyPickers.length > 0;
                    return (
                      <>
                        {noneFree && (
                          <p className="text-[12.5px] text-gray-400 pb-2.5">
                            Everyone is picking right now.
                          </p>
                        )}
                        <div className="grid grid-cols-2 gap-2.5">
                          {visible.map((p) => {
                            const free = p.status === "available";
                            return (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => void handleAssign(p.id, p.name)}
                                disabled={assigning}
                                className={
                                  "flex items-center gap-2.5 rounded-[14px] border p-[11px] min-w-0 text-left active:opacity-70 disabled:opacity-50 " +
                                  (free || refreshing
                                    ? "border-gray-200 bg-white"
                                    : "border-gray-200 bg-gray-50")
                                }
                              >
                                <span
                                  className={
                                    "w-8 h-8 rounded-full text-white text-[12px] font-bold flex items-center justify-center shrink-0 " +
                                    (free || refreshing ? "bg-teal-600" : "bg-gray-400")
                                  }
                                >
                                  {p.avatarInitial}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-[12.5px] font-semibold text-gray-900 truncate">
                                    {p.name}
                                  </span>
                                  {/* ⚠ THE DOT IS NEVER THE ONLY SIGNAL — the
                                      word "Free" or the count sits beside it.
                                      A dot alone fails for anyone who cannot
                                      separate the two hues, and this is a
                                      warehouse floor, not a design review.

                                      🔴 THE TWO HEXES COME FROM
                                      components/floor/status-pill.tsx:30,32 —
                                      Floor's own "With picker" violet #6d28d9
                                      and "Done" green #15803d, whose own file
                                      header says the colour lives there and
                                      nowhere else on the floor. Same meaning,
                                      same values, no new colours.
                                      Do NOT harmonise these with either
                                      near-miss in that folder: picker-card.tsx
                                      's NEEDS_CHECK_TAG is a Tailwind purple
                                      meaning "needs check" (a retired status),
                                      and progress-bar.tsx's #a78bfa/#22c55e
                                      are stated in its own comment to be
                                      deliberately distinct segment tones. */}
                                  <span className="mt-[3px] flex items-center gap-1.5 text-[10.5px] font-semibold whitespace-nowrap">
                                    <span
                                      className="w-[7px] h-[7px] rounded-full shrink-0"
                                      style={{
                                        background: refreshing
                                          ? "#d1d5db"
                                          : free
                                            ? "#15803d"
                                            : "#6d28d9",
                                      }}
                                      aria-hidden="true"
                                    />
                                    <span
                                      style={{
                                        color: refreshing
                                          ? "#9ca3af"
                                          : free
                                            ? "#15803d"
                                            : "#6d28d9",
                                      }}
                                    >
                                      {refreshing
                                        ? "…"
                                        : free
                                          ? "Free"
                                          : `${p.pendingCount} picking`}
                                    </span>
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                        {/* GREY, not teal — this reveals a list, it does not
                            act on a bill, and teal on this screen belongs to
                            the Assign CTA (CLAUDE_UI.md §1's one-teal rule).
                            Rendered ONLY when it has something to reveal:
                            never "Show all · 0", never a disabled row. */}
                        {showRow && (
                          <button
                            type="button"
                            onClick={() => setShowAllPickers(true)}
                            className="mt-3 w-full rounded-[12px] border border-gray-200 bg-gray-50 px-3 py-3 text-[13px] font-semibold text-gray-600 active:bg-gray-100"
                          >
                            Show all pickers
                            <span className="font-medium text-gray-400">
                              {" "}&middot; {busyPickers.length} picking
                            </span>
                          </button>
                        )}
                      </>
                    );
                  })()}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
