"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, ChevronDown, Check, Star, Zap, ArrowRight, ChevronLeft, ChevronRight, LayoutGrid } from "lucide-react";
import { toast } from "sonner";
import { MOBILE_NAV_CLEARANCE } from "@/components/shared/mobile-shell";
import { useMobileShell } from "@/components/shared/mobile-shell-context";
import { usePickingBoard } from "./picking-mobile-shell";
import type { PickingQueueRow } from "@/lib/picking/types";

// Real /api/warehouse/pickers response shape — do not invent fields.
interface Picker {
  id: number;
  name: string;
  avatarInitial: string;
  status: "available" | "picking";
  assignedCount: number;
  pickedCount: number;
  pendingCount: number;
  totalKg: number;
}

interface AssignResponse {
  assigned?: number;
  failed?: { orderId: number; error: string }[];
  error?: string;
}

// Real GET /api/picking/order/[orderId] response shape — see that route.
interface LineItem {
  id: number;
  name: string | null;
  sku: string;
  pack: string | null;
  qty: number;
}

// Card shell shadow — lifted verbatim from app/po/po-page.tsx's SOFT_CARD_SHADOW
// (the /po visual reference this board is styled to match).
const SOFT_CARD_SHADOW = "0 1px 2px rgba(16,24,40,0.04), 0 3px 12px rgba(16,24,40,0.05)";

// Chip identity for lines with a null pack — kept out of the "ALL" sentinel
// so a picker can isolate exactly the lines missing pack data (a real, live
// risk — see SKU 5961032 on OBD 9108267692).
const NO_PACK_KEY = "__no_pack__";

type TypeFilter = "All" | "Local" | "Upcountry";

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

// Swipe tuning for the detail screen's prev/next-bill gesture.
// EDGE_EXCLUSION: touches starting within this many px of either screen
// edge are never claimed — leaves the OS's own edge-swipe-back untouched.
// DEADZONE: movement below this (on both axes) is ignored, so ordinary taps
// never trigger axis-lock. Once past it, the gesture locks to whichever axis
// dominates (horizontal only if dx > dy * 1.5) — a vertical drag inside the
// line-items list hands off to the browser's native scroll immediately.
// THRESHOLD: total horizontal drag needed at touchend to commit to a page
// change; short of it, the gesture is a no-op (no snap-back animation needed
// since nothing ever visually followed the finger — see the touch handlers).
const SWIPE_EDGE_EXCLUSION_PX = 24;
const SWIPE_DEADZONE_PX = 10;
const SWIPE_THRESHOLD_PX = 80;

// Detail-polish Build B (2026-07-19) — Option-1 slide animation on top of
// Build A's gesture gate above (unchanged: edge exclusion, deadzone, axis
// lock, threshold — this only adds a visual transform once those already
// decided a horizontal drag is happening).
// DRAG_FOLLOW: fraction of raw finger delta the content translates by while
// dragging — under 1.0 so the content feels anchored/weighted rather than
// glued 1:1 to the finger.
// SLIDE_MS: duration of EACH half of the commit animation (exit, then
// enter) — ~260ms total end to end, per the approved spec.
const SLIDE_DRAG_FOLLOW = 0.65;
const SLIDE_MS = 130;

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
function checkCardPill(
  row: PickingQueueRow,
  section: "needs" | "still" | "checked",
  nowTick: number,
): React.ReactNode {
  if (section === "needs") {
    const p = elapsedSinceAssigned(row.pickedAt, nowTick);
    if (!p) return null;
    return (
      <span className="text-[10.5px] font-semibold px-2 py-[3px] rounded-full shrink-0 bg-green-50 text-green-700 border border-green-200">
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
    return <span className="text-[11px] font-semibold text-gray-400 whitespace-nowrap">checked {t}</span>;
  }
  const p = elapsedSinceAssigned(row.assignedAt, nowTick);
  if (!p) return null;
  return (
    <span className={"text-[10.5px] font-semibold px-2 py-[3px] rounded-full shrink-0 " + ELAPSED_PILL_CLASS[p.tier]}>
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

// Route colour dot — colour ONLY, no text (CLAUDE_CORE.md §3 delivery dots +
// design spec §2). Local blue, Upcountry orange, Cross rose; IGT / unknown /
// null → neutral grey. Deliberately NO teal here — the one-teal rule reserves
// teal for the Assign CTA, so a teal IGT dot (UI §3's nominal colour) is
// overridden to grey on this card.
const ROUTE_DOT_COLOR: Record<string, string> = {
  Local: "#2563eb",
  Upcountry: "#ea580c",
  Cross: "#e11d48",
};
function RouteDot({ deliveryType }: { deliveryType: string | null }): React.JSX.Element {
  const color = (deliveryType !== null && ROUTE_DOT_COLOR[deliveryType]) || "#9ca3af";
  return <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} aria-hidden="true" />;
}

// Card shadow — the locked v2 look (docs/mockups/picking/picking-cards-final-v2.html).
// Distinct from SOFT_CARD_SHADOW, which the detail line-item rows still use.
const CARD_SHADOW_V2 = "0 1px 2px rgba(16,24,40,.03), 0 14px 26px -20px rgba(16,24,40,.2)";

// Rich-card shelf — FAMILY CHIPS + (Assign only) a right-pinned soft round
// arrow button that opens detail. The old goods/breakdown line (articleTag +
// volume) is gone (Option G, 2026-07-21); volume moved to the route line. Chips
// are ONE horizontally-scrollable line that NEVER wraps (flex-nowrap + per-chip
// shrink-0) so every card keeps a uniform height; a right-edge fade cues the
// overflow, fading the chips into the arrow (or the card edge on Picking, which
// has no arrow).
//
// Layout: a flex row — [chips: flex-1 min-w-0, scrolling] + [arrow: shrink-0].
// `families` arrives already display-resolved + alpha-sorted from
// lib/picking/queue.ts — rendered AS-IS. The "+N unlisted" chip trails only when
// unresolvedLineCount > 0.
//
// showViewItems (Assign only, 2026-07-21): renders the arrow AND forces the
// shelf to render even with zero chips, so detail is always reachable now that a
// card-body tap toggles SELECTION instead of opening detail. The arrow
// stopPropagation()s and calls onViewItems (the card's own open handler, =
// openDetail) — it must NEVER toggle selection, and it sits at the right edge,
// away from the card centre, so rapid select-taps don't land on it. The button
// owns a 44px min tap target. NOT teal (one-teal rule reserves teal for the
// selected tint) — a quiet slate #eceff3 circle. Picking cards pass
// showViewItems=false and keep the null-when-empty behaviour (no arrow, and a
// Picking card-body tap still opens detail as before — unchanged).
function CardShelf({
  row,
  muted,
  showViewItems,
  onViewItems,
}: {
  row: PickingQueueRow;
  muted: boolean;
  showViewItems: boolean;
  onViewItems: () => void;
}): React.JSX.Element | null {
  const hasStrip = row.families.length > 0 || row.unresolvedLineCount > 0;
  if (!hasStrip && !showViewItems) return null;
  return (
    <div className="border-t px-[14px] flex items-stretch gap-1" style={{ background: "#f6f8fa", borderColor: "#eef1f4" }}>
      <div className="relative flex-1 min-w-0 flex items-center py-[10px]">
        <div
          className="flex flex-nowrap gap-1.5 overflow-x-auto pr-[26px] w-full [&::-webkit-scrollbar]:hidden"
          style={{ scrollbarWidth: "none" }}
        >
          {row.families.map((f) => (
            <span
              key={f}
              className="shrink-0 whitespace-nowrap text-[10.5px] font-semibold rounded-[7px] py-[3px] px-[8px]"
              style={{ color: muted ? "#8a929c" : "#667085", background: muted ? "#f1f3f6" : "#eef1f5" }}
            >
              {f}
            </span>
          ))}
          {row.unresolvedLineCount > 0 && (
            <span
              key="__unlisted"
              className="shrink-0 whitespace-nowrap text-[11.5px] font-semibold rounded-[8px] px-[9px] py-1 border border-dashed"
              style={{ color: "#9aa2ac", borderColor: "#d8dce1" }}
            >
              +{row.unresolvedLineCount} unlisted
            </span>
          )}
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
            onViewItems();
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
    </div>
  );
}

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
//   shelf         — RICH on assign + picking; LEAN (no shelf) on done
//   checker line  — doneChecked only ("✓ Checked by {name} · {time}")
type PickingCardVariant = "assign" | "assignLocked" | "picking" | "doneCheck" | "doneChecked";

function PickingCard({
  row,
  variant,
  nowTick = 0,
  selected = false,
  onOpen,
  onToggleSelect,
  onLockTap,
}: {
  row: PickingQueueRow;
  variant: PickingCardVariant;
  nowTick?: number;
  selected?: boolean;
  onOpen: () => void;
  onToggleSelect?: () => void;
  onLockTap?: () => void;
}): React.JSX.Element {
  const rich = variant === "assign" || variant === "assignLocked" || variant === "picking";
  const muted = variant === "assignLocked" || variant === "doneChecked";
  const showSlotHero = rich && row.windowTime !== null;
  const secondary =
    variant === "doneCheck" || variant === "doneChecked" ? row.windowTime : formatObdDateTime(row.obdDateTime);

  // Caption-right cluster by variant. Tint reuses Support's exact indicator
  // (🎨 in purple — components/support/shared/table-cells.tsx CustomerCell) so
  // the two boards read identically; field is row.isTint (orders.orderType).
  // Urgent bolt stays AMBER (not the mockup's red) — red already means
  // "overdue" on the Picking elapsed badge; a second red would collide.
  let captionRight: React.ReactNode = null;
  if (variant === "assign") {
    captionRight = (
      <span className="flex items-center gap-[7px] shrink-0">
        {row.isKeyCustomer && <Star size={14} className="text-amber-500 fill-amber-500" />}
        {row.priorityLevel === 1 && <Zap size={14} className="text-amber-500 fill-amber-500" />}
        {row.isTint && <span className="text-[13px] text-purple-500 leading-none shrink-0">🎨</span>}
        {row.isEarlyReleased && (
          <span
            className="text-[10.5px] font-semibold px-2 py-[3px] rounded-full shrink-0 whitespace-nowrap bg-slate-100 text-slate-600 border border-slate-200"
            title={row.earlyReleasedByName !== null ? `Released early by ${row.earlyReleasedByName}` : "Released early"}
          >
            released
          </span>
        )}
        <AgeBadge row={row} />
      </span>
    );
  } else if (variant === "assignLocked") {
    captionRight = (
      <span className="flex items-center gap-1.5 shrink-0">
        {row.isKeyCustomer && <Star size={14} className="text-amber-500 fill-amber-500" />}
        {row.isTint && <span className="text-[13px] text-purple-500 leading-none shrink-0">🎨</span>}
        <UpcomingDayBadge row={row} />
      </span>
    );
  } else if (variant === "picking") {
    captionRight = checkCardPill(row, "still", nowTick);
  } else if (variant === "doneCheck") {
    captionRight = checkCardPill(row, "needs", nowTick);
  } // doneChecked: none — the checked time moves down to the checker line.

  const whereRight =
    (variant === "picking" || variant === "doneCheck" || variant === "doneChecked") && row.assignedToName !== null ? (
      <span className="text-[12px] font-semibold shrink-0" style={{ color: "#8a929c" }}>
        {row.assignedToName}
      </span>
    ) : null;

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
        <LockGlyph className="w-5 h-5 text-gray-400" />
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
          "rounded-[20px] overflow-hidden cursor-pointer border-[1.5px] " +
          (selected ? "bg-teal-50 border-teal-600 " : "bg-white border-[#eceef2] ") +
          (variant === "doneChecked" ? "opacity-75" : "")
        }
        style={{ boxShadow: CARD_SHADOW_V2, ...(variant === "assignLocked" ? { background: "#fcfcfd" } : null) }}
        // Assign (unlocked) card body toggles SELECTION (2026-07-21) — detail
        // opens only via the arrow button in the shelf. Every OTHER variant
        // (picking, doneCheck, doneChecked, assignLocked) keeps body-tap → open
        // detail, unchanged.
        onClick={variant === "assign" ? () => onToggleSelect?.() : onOpen}
      >
      <div className={"flex items-start gap-3 " + (lead ? "pl-3.5 pr-4 pt-3.5 pb-3" : "px-4 pt-3.5 pb-3")}>
        {lead}
        <div className="flex-1 min-w-0">
          {/* Caption: OBD (mono) · secondary (date-time or slot) — right cluster */}
          <div className="flex items-center justify-between gap-2.5 mb-1.5">
            <span
              className="flex items-center gap-1.5 min-w-0 text-[11.5px] overflow-hidden whitespace-nowrap"
              style={{ color: "#98a2b3" }}
            >
              <span className="font-mono shrink-0" style={{ color: "#98a0aa" }}>
                {row.obdNumber}
              </span>
              {secondary !== null && (
                <>
                  <span className="shrink-0" style={{ color: "#d8dce1" }}>
                    &middot;
                  </span>
                  <span className="truncate">{secondary}</span>
                </>
              )}
            </span>
            {captionRight}
          </div>
          {/* Title: customer name (truncates, never pushes the slot) + slot hero */}
          <div className="flex items-baseline justify-between gap-3">
            <span
              className="text-[16px] font-semibold leading-[1.25] truncate min-w-0"
              style={{ color: "#1d2939" }}
            >
              {row.dealerName}
            </span>
            {showSlotHero && (
              <span className="text-[15px] font-semibold tabular-nums shrink-0" style={{ color: "#475467" }}>
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
              <RouteDot deliveryType={row.deliveryType} />
              <span className="text-[12px] font-medium truncate min-w-0" style={{ color: "#667085" }}>
                {row.area ?? "—"}
              </span>
              {rich && row.volumeLitres != null && (
                <>
                  <span className="shrink-0" style={{ color: "#d3d8de" }}>
                    &middot;
                  </span>
                  <span className="flex items-baseline gap-[3px] shrink-0">
                    <span className="text-[12px] font-semibold tabular-nums" style={{ color: "#667085" }}>
                      {formatLitres(row.volumeLitres)}
                    </span>
                    <span className="text-[10.5px] font-medium" style={{ color: "#98a2b3" }}>
                      L
                    </span>
                  </span>
                </>
              )}
            </span>
            {whereRight}
          </div>
        </div>
      </div>
      {rich && (
        <CardShelf row={row} muted={muted} showViewItems={variant === "assign"} onViewItems={onOpen} />
      )}
      {variant === "doneChecked" && row.checkedByName !== null && (
        // Its OWN line, never folded into the where line (a long area + long
        // checker name overflow the card; this is the fact the tab exists to
        // show, so it must never be the piece a truncate silently clips).
        <div className="px-4 pb-3.5 flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: "#8a929c" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22a06b" strokeWidth={2.4} className="shrink-0">
            <path d="M5 13l4 4L19 7" />
          </svg>
          <span>Checked by {row.checkedByName}</span>
          {formatCheckedTime(row.checkedAt) !== null && (
            <>
              <span style={{ color: "#d0d5db" }}>&middot;</span>
              <span style={{ color: "#a2aab4" }}>{formatCheckedTime(row.checkedAt)}</span>
            </>
          )}
        </div>
      )}
      </div>
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
function AgeBadge({ row }: { row: PickingQueueRow }): React.JSX.Element | null {
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

// Neutral "for Thu 23 Jul" badge for the Upcoming (locked) zone. Slate, NOT
// amber and NOT red: a bill scheduled for Thursday is EARLY, not late.
// Colouring it on the staleness scale would teach the floor to discount
// amber everywhere else on the board.
function UpcomingDayBadge({ row }: { row: PickingQueueRow }): React.JSX.Element | null {
  const label = formatDispatchDay(row.dispatchTargetDate);
  if (label === null) return null;
  return (
    <span className="text-[10.5px] font-semibold px-2 py-[3px] rounded-full shrink-0 whitespace-nowrap bg-slate-100 text-slate-600 border border-slate-200">
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
  const { data, loading, error, activeTab, refetchQueue, detailOpen, setDetailOpen } = usePickingBoard();
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
  const [pickersLoading, setPickersLoading] = useState(true);
  const [pickerSheetOpen, setPickerSheetOpen] = useState(false);
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
  const navStateRef = useRef({ detailOpen: false, pickerSheetOpen: false });

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

  // Picker roster for the assign sheet — same endpoint desktop uses, fetched
  // once (the picker roster doesn't change within a session).
  useEffect(() => {
    let cancelled = false;
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
  }, []);

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
  }, [detailOrderId]);

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

  // Route list — distinct non-null `route` across ALL waiting rows (stable,
  // not narrowed by the Type pill). Counts DO reflect the current Type pill
  // (live), mirroring the approved mockup's route sheet exactly.
  const availableRoutes = useMemo(() => {
    const set = new Set<string>();
    for (const r of waitingRows) {
      if (r.route !== null) set.add(r.route);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  }, [waitingRows]);

  const routeCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of waitingRows) {
      if (r.route === null) continue;
      if (activeType !== "All" && r.deliveryType !== activeType) continue;
      map.set(r.route, (map.get(r.route) ?? 0) + 1);
    }
    return map;
  }, [waitingRows, activeType]);

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
  const allRoutesCount = Array.from(routeCounts.values()).reduce((a, b) => a + b, 0);

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
  }

  // Detail-interactions Build A — `listKey` says which of the four already-
  // memoized lists this bill's card came from (the Done tab has two sections
  // sharing one activeTab value, so activeTab alone can't disambiguate).
  // Pushes ONE history entry for the whole detail "session" — see pushScreen.
  function openDetail(orderId: number, listKey: DetailListKey): void {
    switchDetailTo(orderId, listKey);
    // Defensive reset (Build B) — a fresh open from a card tap must always
    // start at rest, in case a prior session's gesture left the ref mid-
    // transform. triggerPageTransition's own paging flow deliberately does
    // NOT reset here — it manages the transform itself across its 3 phases.
    setContentTransform(0, false);
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

  const detailIndex = useMemo(
    () => activeDetailList.findIndex((r) => r.orderId === detailOrderId),
    [activeDetailList, detailOrderId],
  );

  // ── Detail-polish Build B — Option-1 slide animation ─────────────────────
  // detailContentRef wraps everything below the detail header (stat strip /
  // pack filter / line items / the 3 CTAs) — the header itself does NOT
  // slide (its dealer-name/OBD text just updates at the swap instant,
  // matching how the counter's "N of M" and the stat strip update too;
  // conventional for mobile page-transition UI, e.g. Mail's conversation
  // swipe). Style writes go straight to the DOM node via this ref, never
  // through React state — the same reason po-page.tsx's --vvh updater
  // avoids state for the equally high-frequency touchmove case (a setState
  // per touchmove would be a render storm for zero visual benefit, since
  // nothing else in the tree needs to react to the live drag position).
  const detailContentRef = useRef<HTMLDivElement>(null);

  function prefersReducedMotion(): boolean {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function setContentTransform(px: number, animated: boolean): void {
    const el = detailContentRef.current;
    if (!el) return;
    el.style.transition = animated && !prefersReducedMotion() ? `transform ${SLIDE_MS}ms ease-out` : "none";
    el.style.transform = px === 0 ? "" : `translateX(${px}px)`;
  }

  // Below-threshold release (or a boundary drag with nothing to page to) —
  // animate back to rest from wherever the finger left the content.
  function snapContentBack(): void {
    setContentTransform(0, true);
  }

  // THE single entry point for a bill change — called identically by the
  // swipe release (below) and the counter arrows (JSX below). No push/pop
  // here on purpose (approved plan) — paging through several bills still
  // costs exactly ONE history entry for the whole detail session; a single
  // Back press from bill #3 returns straight to the list, not to bill #2.
  // No-ops past either end of the list (no wrap).
  function triggerPageTransition(direction: "next" | "prev"): void {
    const nextIndex = detailIndex + (direction === "next" ? 1 : -1);
    if (detailIndex === -1 || nextIndex < 0 || nextIndex >= activeDetailList.length) return;
    const target = activeDetailList[nextIndex];
    if (prefersReducedMotion()) {
      switchDetailTo(target.orderId, detailListKey);
      setContentTransform(0, false);
      return;
    }
    const vw = window.innerWidth;
    const exitPx = direction === "next" ? -vw : vw;
    // Phase 1 — exit: slide the CURRENT content fully off-screen, animated
    // from wherever it already sits (0 at rest, or a live drag offset).
    setContentTransform(exitPx, true);
    window.setTimeout(() => {
      // Phase boundary — swap the data (Build A's unchanged mechanism; the
      // line-items effect keyed on detailOrderId refires on its own).
      switchDetailTo(target.orderId, detailListKey);
      // Instant, un-animated snap to the OPPOSITE off-screen edge — this is
      // the "next bill slides in from the other side" half. No transition
      // on this write, or the browser would animate the snap itself.
      setContentTransform(-exitPx, false);
      // Double rAF (same style-flush trick /po's own touch/scroll code
      // uses) — guarantees the browser has committed the un-animated snap
      // above as a separate paint before Phase 2's transition is armed, or
      // it can coalesce the snap and the entrance into one no-op jump.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          // Phase 2 — enter: animate from the opposite edge back to rest.
          setContentTransform(0, true);
        });
      });
    }, SLIDE_MS);
  }

  function goNextBill(): void {
    triggerPageTransition("next");
  }
  function goPrevBill(): void {
    triggerPageTransition("prev");
  }

  // ── Swipe-between-bills touch handlers ───────────────────────────────────
  // Attached to the detail screen's root. A plain tap (movement under
  // SWIPE_DEADZONE_PX on both axes) never reaches the axis-lock branch, so
  // preventDefault() never fires for taps — every button inside the swipe
  // zone (Back, search toggle, Assign/Undo/Approve, line-item ticks) keeps
  // working untouched. touchStateRef is a plain ref, not state — this is a
  // per-gesture scratchpad, re-render would just be wasted work.
  const touchStateRef = useRef<{ startX: number; startY: number; tracking: boolean; locked: boolean } | null>(null);

  function handleDetailTouchStart(e: React.TouchEvent<HTMLDivElement>): void {
    const t = e.touches[0];
    if (!t) return;
    const vw = window.innerWidth;
    if (t.clientX < SWIPE_EDGE_EXCLUSION_PX || t.clientX > vw - SWIPE_EDGE_EXCLUSION_PX) {
      // Starts inside the edge-exclusion strip — leave it entirely to the
      // OS's own edge-swipe-back gesture; never claim or track it.
      touchStateRef.current = null;
      return;
    }
    touchStateRef.current = { startX: t.clientX, startY: t.clientY, tracking: true, locked: false };
  }

  function handleDetailTouchMove(e: React.TouchEvent<HTMLDivElement>): void {
    const state = touchStateRef.current;
    if (!state || !state.tracking) return;
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - state.startX;
    const dy = t.clientY - state.startY;
    if (!state.locked) {
      if (Math.abs(dx) < SWIPE_DEADZONE_PX && Math.abs(dy) < SWIPE_DEADZONE_PX) return;
      if (Math.abs(dx) > Math.abs(dy) * 1.5) {
        state.locked = true;
      } else {
        // Vertical-dominant — hand off to the line-items list's own native
        // scroll; stop tracking so later touchmove events are a no-op.
        state.tracking = false;
        return;
      }
    }
    // Locked horizontal — suppress the page's own scroll/bounce while paging.
    e.preventDefault();
    // Option-1 finger-tracking — un-animated (transition:none), instant
    // 1:1-minus-follow so the content reads as attached to the finger.
    setContentTransform(dx * SLIDE_DRAG_FOLLOW, false);
  }

  function handleDetailTouchEnd(e: React.TouchEvent<HTMLDivElement>): void {
    const state = touchStateRef.current;
    touchStateRef.current = null;
    if (!state || !state.locked) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - state.startX;
    const direction: "next" | "prev" = dx < 0 ? "next" : "prev";
    const pastThreshold = Math.abs(dx) >= SWIPE_THRESHOLD_PX;
    const withinBounds = direction === "next" ? detailIndex < activeDetailList.length - 1 : detailIndex > 0;
    if (pastThreshold && withinBounds) {
      triggerPageTransition(direction);
    } else {
      // Below threshold, OR past it but already at the list's edge (no
      // wrap) — snap back rather than calling triggerPageTransition, whose
      // own bounds guard would otherwise leave the content stranded
      // off-screen with nothing having been committed.
      snapContentBack();
    }
  }

  // ── Detail-interactions Build A — the ONE popstate authority ─────────────
  // Keeps navStateRef synced to live detailOpen/pickerSheetOpen so the
  // handler (registered once below) never reads a stale closure.
  useEffect(() => {
    navStateRef.current = { detailOpen, pickerSheetOpen };
  }, [detailOpen, pickerSheetOpen]);

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
      if (navStateRef.current.pickerSheetOpen && navStateRef.current.detailOpen) {
        setPickerSheetOpen(false);
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

  function toggleLineChecked(lineId: number): void {
    setCheckedLineIds((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  }

  // Approve gate — checks the FULL line set, never filteredLineItems, so an
  // active pack-chip filter hiding some lines can never let a partially-
  // ticked bill through (task brief: "Approve must still require ALL lines
  // ticked, not just visible ones"). A zero-line bill stays permanently
  // disabled rather than vacuously passing `.every()` on an empty array —
  // a bill with no lines shouldn't be in picking at all.
  const allLinesChecked = useMemo(() => {
    if (!lineItems || lineItems.length === 0) return false;
    return lineItems.every((li) => checkedLineIds.has(li.id));
  }, [lineItems, checkedLineIds]);

  // Distinct packs present on this bill, for the pack-filter chip row.
  // Sorted alphabetically with "No pack" trailing last (an exception
  // category, not a real pack value).
  const distinctPackKeys = useMemo(() => {
    if (!lineItems) return [];
    const set = new Set<string>();
    for (const li of lineItems) set.add(li.pack ?? NO_PACK_KEY);
    const keys = Array.from(set);
    const real = keys.filter((k) => k !== NO_PACK_KEY).sort((a, b) => a.localeCompare(b));
    return keys.includes(NO_PACK_KEY) ? [...real, NO_PACK_KEY] : real;
  }, [lineItems]);

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
          pre-Stage-3 — only this header's CONTENT changed. Avatar (left,
          opens the shared You sheet) · title (center) · grid (opens the
          shared Menu sheet) + search (right) — per
          docs/mockups/picking/mobile-shell-v1.html. */}
      <div
        className="flex-shrink-0 bg-teal-600 flex items-center justify-between gap-2.5 px-3.5"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 11px)", paddingBottom: "10px" }}
      >
        <button
          type="button"
          onClick={openYou}
          aria-label="Open account menu"
          className="w-10 h-10 min-w-[44px] min-h-[44px] rounded-full bg-white/20 active:bg-white/30 flex items-center justify-center text-white text-[13px] font-bold shrink-0"
        >
          {userInitials}
        </button>
        <h1 className="text-[19px] font-extrabold text-white tracking-tight">Picking</h1>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={openMenu}
            aria-label="Open all pages menu"
            className="w-11 h-11 rounded-[10px] flex items-center justify-center text-white active:bg-white/15"
          >
            <LayoutGrid size={21} />
          </button>
          <button
            type="button"
            onClick={() => setSearching((v) => !v)}
            aria-label="Search"
            className="w-11 h-11 rounded-[10px] flex items-center justify-center text-white active:bg-white/15"
          >
            <Search size={20} />
          </button>
        </div>
      </div>

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
              <TypeFilterPills value={activeType} onChange={setActiveType} />
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
              ) : (
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
        subtitle="Single-select · counts reflect the current Type filter"
        allLabel="All routes"
        allCount={allRoutesCount}
        options={availableRoutes.map((route) => ({ value: route, label: route, count: routeCounts.get(route) ?? 0 }))}
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
        onTouchStart={handleDetailTouchStart}
        onTouchMove={handleDetailTouchMove}
        onTouchEnd={handleDetailTouchEnd}
      >
        <div
          className="bg-teal-600 px-3.5 pb-3.5 flex items-start gap-2.5 shrink-0"
          style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 12px)" }}
        >
          <button
            type="button"
            onClick={() => window.history.back()}
            aria-label="Back"
            className="w-8 h-8 rounded-[9px] bg-white/15 flex items-center justify-center text-white shrink-0"
          >
            <ChevronLeft size={17} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-extrabold text-white truncate">
              {detailRow?.dealerName ?? "—"}
            </div>
            <div className="text-[12px] text-white/75 truncate">
              {detailRow
                ? `${detailRow.obdNumber} · ${detailRow.area ?? "Unmatched"}${
                    detailRow.windowTime !== null ? ` · ${detailRow.windowTime}` : ""
                  }`
                : "—"}
            </div>
            {/* Row 3 — flag chips (frosted pills), each shown only when its
                field is true; the whole row is omitted when none are, so there
                is no empty gap. Reuses the CARD's EXACT glyphs (amber star,
                amber urgent bolt — NOT red, avoids clashing with any red;
                Support's purple 🎨) so a bill's flags survive from the card
                into the detail. All fields come from detailRow — already in
                memory, no fetch. */}
            {detailRow && (detailRow.isKeyCustomer || detailRow.priorityLevel === 1 || detailRow.isTint) && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                {detailRow.isKeyCustomer && (
                  <span className="inline-flex items-center gap-1 bg-white/[0.16] rounded-full pl-1.5 pr-2 py-[3px] text-[11px] font-semibold text-white">
                    <Star size={11} className="text-amber-500 fill-amber-500" />
                    Key dealer
                  </span>
                )}
                {detailRow.priorityLevel === 1 && (
                  <span className="inline-flex items-center gap-1 bg-white/[0.16] rounded-full pl-1.5 pr-2 py-[3px] text-[11px] font-semibold text-white">
                    <Zap size={11} className="text-amber-500 fill-amber-500" />
                    Urgent
                  </span>
                )}
                {detailRow.isTint && (
                  <span className="inline-flex items-center gap-1 bg-white/[0.16] rounded-full px-2 py-[3px] text-[11px] font-semibold text-white">
                    <span className="text-[11px] leading-none">🎨</span>
                    Tint
                  </span>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setDetailSearching((v) => !v)}
            aria-label="Search line items"
            className="w-8 h-8 rounded-[9px] flex items-center justify-center text-white active:bg-white/15 shrink-0"
          >
            <Search size={17} />
          </button>
        </div>

        {/* Detail-polish Build B — everything below the header (stat strip /
            pack filter / line items / CTAs) is wrapped in ONE ref'd
            container so triggerPageTransition can translate it as a single
            unit. The header itself sits OUTSIDE this wrapper and does not
            slide — its dealer-name/OBD text just updates at the swap
            instant, same as the stat strip and counter below it. */}
        <div ref={detailContentRef} className="flex-1 min-h-0 flex flex-col">
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
            <div className="bg-white border-b border-gray-200 px-3.5 py-3 flex items-center justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <div className="text-[15px] font-bold leading-snug truncate" style={{ color: "#2a323c" }}>
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
                {detailRow?.isDone && lineItems !== null && (
                  <div className="text-[11.5px] text-gray-400 tabular-nums mt-0.5">
                    {checkedLineIds.size} / {lineItems.length} checked
                  </div>
                )}
              </div>
              {/* Neutral gray throughout (CLAUDE_UI §1) — teal stays
                  reserved for the Assign CTA only; this is navigation, not
                  a primary action. Both arrows call the SAME
                  triggerPageTransition the swipe gesture uses, so arrow taps
                  and swipes produce an identical slide. */}
              {activeDetailList.length > 1 && (
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={goPrevBill}
                    disabled={detailIndex <= 0}
                    aria-label="Previous bill"
                    className="w-11 h-11 flex items-center justify-center rounded-[9px] text-gray-500 active:bg-gray-100 disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <span className="text-[12.5px] font-medium text-gray-500 tabular-nums px-0.5 whitespace-nowrap">
                    {detailIndex + 1} of {activeDetailList.length}
                  </span>
                  <button
                    type="button"
                    onClick={goNextBill}
                    disabled={detailIndex >= activeDetailList.length - 1}
                    aria-label="Next bill"
                    className="w-11 h-11 flex items-center justify-center rounded-[9px] text-gray-500 active:bg-gray-100 disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              )}
            </div>

            {/* Pack filter — only when the bill actually has more than one
                pack to tell apart; a single-pack bill shows no row at all. */}
            {distinctPackKeys.length >= 2 && (
              <div className="bg-white border-b border-gray-200 px-3.5 py-2.5 flex items-center gap-1.5 overflow-x-auto shrink-0">
                <button
                  type="button"
                  onClick={() => setActivePackFilter("ALL")}
                  className={
                    "text-[12.5px] font-medium px-3 py-1.5 rounded-full border whitespace-nowrap shrink-0 " +
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
                      "text-[12.5px] font-medium px-3 py-1.5 rounded-full border whitespace-nowrap shrink-0 " +
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
                const isChecked = detailRow?.isDone === true && checkedLineIds.has(li.id);
                return (
                <div
                  key={li.id}
                  className="flex bg-white rounded-[14px] overflow-hidden mb-2"
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
                  <div className={"flex-1 min-w-0 px-3 py-2.5 transition-opacity " + (isChecked ? "opacity-55" : "")}>
                    <div className="font-mono text-[17px] font-bold text-gray-900 truncate">{li.sku}</div>
                    <div className="text-[12px] text-gray-500 truncate mt-0.5">{li.name ?? "—"}</div>
                  </div>
                  {/* QTY — fixed, plain, no "x" prefix. */}
                  <div className="shrink-0 flex items-center justify-center px-3.5">
                    <span className="text-[26px] font-extrabold text-gray-900">{li.qty}</span>
                  </div>
                  {/* TICK — needs-check rows only (detailRow.isDone; the Done
                      tab's top band since 2026-07-20), in the gutter
                      the QTY column already reserved. 44px tap zone, 20px/
                      2px-border circle, filled teal + white check when
                      ticked — no border on the column itself (a tap zone,
                      not a compartment), per the approved mockup
                      (docs/mockups/picking/supervisor-check-ticks.html).
                      Freely toggleable — a forcing function, not a lock. */}
                  {detailRow?.isDone && (
                    <button
                      type="button"
                      onClick={() => toggleLineChecked(li.id)}
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
              disabled={!allLinesChecked || approving}
              className={
                "w-full h-12 rounded-full text-[14.5px] font-bold " +
                (allLinesChecked
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
            (ref={detailContentRef}) opened above the stat-strip/search
            block. */}
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

      {/* Picker sheet — tap a row to fire the assign immediately (no separate
          confirm step), per the approved mockup. Geometry (bottom offset,
          max-height/scroll, z-index) reads from SHEET_GEOMETRY — the same
          single source FilterBottomSheet above uses, so this sheet can't
          drift out of sync with it again (see that constant's comment for
          the bug this fixes: this sheet used to be pinned at `bottom: 0`
          with no mobile-shell-nav reservation and no internal scroll,
          rendering its last row under the fixed bottom nav). */}
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
            className={`fixed left-0 right-0 ${SHEET_GEOMETRY.panelZ} bg-white rounded-t-[18px] p-5 ${SHEET_GEOMETRY.maxHeight} overflow-y-auto`}
            style={{ bottom: SHEET_GEOMETRY.bottomOffset }}
          >
            <div className="w-9 h-1 rounded-full bg-gray-300 mx-auto mb-3.5" />
            <h3 className="text-[16px] font-extrabold text-gray-900">Assign to picker</h3>
            <p className="text-[12.5px] text-gray-400 mt-[3px] mb-3.5">{pickerSheetSubtitle}</p>
            {pickersLoading ? (
              <p className="text-[13px] text-gray-400 text-center py-6">Loading pickers&hellip;</p>
            ) : pickers.length === 0 ? (
              <p className="text-[13px] text-gray-400 text-center py-6">No active pickers found.</p>
            ) : (
              pickers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => void handleAssign(p.id, p.name)}
                  disabled={assigning}
                  className="w-full flex items-center gap-[11px] py-[11px] px-1 border-b border-gray-100 last:border-b-0 disabled:opacity-50"
                >
                  <span className="w-9 h-9 rounded-full bg-teal-600 text-white text-[13px] font-bold flex items-center justify-center shrink-0">
                    {p.avatarInitial}
                  </span>
                  <span className="flex-1 min-w-0 text-[14px] font-semibold text-gray-900 text-left truncate">
                    {p.name}
                  </span>
                  <span
                    className={
                      "text-[10.5px] font-semibold px-2.5 py-[3px] rounded-full shrink-0 " +
                      (p.status === "available"
                        ? "bg-green-50 text-green-700 border border-green-200"
                        : "bg-gray-100 text-gray-600 border border-gray-200")
                    }
                  >
                    {p.status === "available" ? "Free" : `${p.assignedCount} jobs`}
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
