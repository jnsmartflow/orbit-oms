"use client";

import { useMemo, useRef } from "react";

// ── Swipe-between-bills, shared by BOTH picking faces ──────────────────────
// Extracted 2026-07-30 from picking-board-mobile.tsx (Detail-interactions
// Build A + Detail-polish Build B, 2026-07-19) when the picker's "My Picks"
// detail screen gained the same gesture. The supervisor adopted this by
// IMPORT SWAP — nothing about its behaviour or rendering changed; the same
// seam card-atoms.tsx already occupies for the two faces' card language.
//
// What stays with the CALLER, deliberately:
//   • WHICH list to page (`list`) — the supervisor picks one of four already-
//     memoized arrays off a DetailListKey; the picker picks pending-or-done.
//   • WHAT per-bill state to reset on a swap (`onSwitch`) — supervisor resets
//     search + pack filter + line ticks; the picker resets the pack filter.
// That split is why this hook is shareable at all: nothing here knows about
// ticks, search, Approve or Mark done.
//
// ⚠ THE FOUR TUNING CONSTANTS BELOW WERE TUNED TOGETHER AND ARE ONE SETTING.
// The edge exclusion, the deadzone, the axis-lock ratio and the commit
// threshold decide, between them, how the OS back gesture, native vertical
// scrolling and bill-paging share one touch region (CLAUDE_PICKING.md §5.3:
// "the back gesture and the paging gesture SHARE the touch region and were
// designed together. Do not tune one without the other"). Changing one alone
// is how a gesture starts feeling wrong in a way nobody can describe.
//
// EDGE_EXCLUSION: touches starting within this many px of either screen edge
// are never claimed — leaves the OS's own edge-swipe-back untouched.
// DEADZONE: movement below this (on both axes) is ignored, so ordinary taps
// never trigger axis-lock. Once past it, the gesture locks to whichever axis
// dominates (horizontal only if dx > dy * 1.5) — a vertical drag inside the
// line-items list hands off to the browser's native scroll immediately.
// THRESHOLD: total horizontal drag needed at touchend to commit to a page
// change; short of it the content snaps back to rest.
const SWIPE_EDGE_EXCLUSION_PX = 24;
const SWIPE_DEADZONE_PX = 10;
const SWIPE_THRESHOLD_PX = 80;

// DRAG_FOLLOW: fraction of raw finger delta the content translates by while
// dragging — under 1.0 so the content feels anchored/weighted rather than
// glued 1:1 to the finger.
// SLIDE_MS: duration of EACH half of the commit animation (exit, then enter)
// — ~260ms total end to end, per the approved spec.
const SLIDE_DRAG_FOLLOW = 0.65;
const SLIDE_MS = 130;

/**
 * Opt-out marker. A touch STARTING inside an element carrying this attribute
 * is never claimed by the pager — the element keeps its own gesture.
 *
 * Why it exists (2026-07-30): the handlers sit on the detail screen's ROOT, so
 * they claim every horizontal drag in the body. That is right for the line
 * list, and wrong for a horizontally-SCROLLABLE strip inside it — the pack
 * filter chips overflow the screen on a normal multi-pack bill, and the only
 * way to reach the chips past the right edge is to scroll that strip. Without
 * this, that scroll fights the pager and a long drag pages to the next bill
 * instead, which makes every off-screen chip unreachable.
 *
 * Add it to any strip that owns its own horizontal scroll. Do NOT add it to
 * the line list — vertical scrolling there is already handled by the axis lock,
 * and swiping across the list is the primary way to change bills.
 */
export const NO_BILL_SWIPE_ATTR = "data-no-bill-swipe";

/** Structural minimum — both faces pass full PickingQueueRow arrays. */
interface PagerItem {
  orderId: number;
}

interface UseBillPagerOptions<T extends PagerItem> {
  /** The list to page through — the one the bill was OPENED from. Re-resolved
   *  by the caller every render (never a snapshot captured at open time), so
   *  a refetch that changes the list is reflected immediately. */
  list: readonly T[];
  /** The bill currently on screen. */
  currentOrderId: number | null;
  /** Swap to a neighbour bill: set the id AND reset that face's per-bill
   *  state. Called at the animation's phase boundary, never on every frame. */
  onSwitch: (orderId: number) => void;
}

export interface BillPager {
  /** Position of the open bill in `list`, or -1 when it is not in it (the
   *  bill left the list while it was open). Derived every render. */
  index: number;
  /** `list.length` — for the "N of M" counter and the arrows' disabled state. */
  count: number;
  /** Attach to the element wrapping everything that should SLIDE (i.e. the
   *  detail body BELOW the header — the header does not slide; its text just
   *  updates at the swap instant). */
  contentRef: React.RefObject<HTMLDivElement>;
  goNext: () => void;
  goPrev: () => void;
  /** Un-animated snap to rest. Call from openDetail so a fresh open can never
   *  inherit a transform a previous session's gesture left behind. */
  resetTransform: () => void;
  /** Spread onto the detail screen's ROOT element. */
  touchHandlers: {
    onTouchStart: (e: React.TouchEvent<HTMLDivElement>) => void;
    onTouchMove: (e: React.TouchEvent<HTMLDivElement>) => void;
    onTouchEnd: (e: React.TouchEvent<HTMLDivElement>) => void;
  };
}

export function useBillPager<T extends PagerItem>({
  list, currentOrderId, onSwitch,
}: UseBillPagerOptions<T>): BillPager {
  // Style writes go straight to this DOM node, never through React state —
  // a setState per touchmove would be a render storm for zero visual benefit,
  // since nothing else in the tree needs to react to the live drag position
  // (same reason po-page.tsx's --vvh updater avoids state).
  const contentRef = useRef<HTMLDivElement>(null);

  // Derived LIVE on every render, never frozen at open time: both faces
  // refetch their rows, and a captured index would go stale. -1 when the open
  // bill is no longer in the list at all — see canGo/triggerPageTransition,
  // which both treat -1 as "nothing to page to" rather than paging from a
  // phantom position.
  const index = useMemo(
    () => list.findIndex((r) => r.orderId === currentOrderId),
    [list, currentOrderId],
  );

  const touchStateRef = useRef<{ startX: number; startY: number; tracking: boolean; locked: boolean } | null>(null);

  function prefersReducedMotion(): boolean {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function setContentTransform(px: number, animated: boolean): void {
    const el = contentRef.current;
    if (!el) return;
    el.style.transition = animated && !prefersReducedMotion() ? `transform ${SLIDE_MS}ms ease-out` : "none";
    el.style.transform = px === 0 ? "" : `translateX(${px}px)`;
  }

  // Below-threshold release (or a boundary drag with nothing to page to) —
  // animate back to rest from wherever the finger left the content.
  function snapContentBack(): void {
    setContentTransform(0, true);
  }

  /** Is there a bill in that direction? False at either end (NO WRAP) and
   *  false when the open bill has left the list (index === -1). The ONE
   *  bounds rule — the touch release and the transition both read it, so a
   *  release can never commit to a transition that then no-ops and strands
   *  the content off-screen. */
  function canGo(direction: "next" | "prev"): boolean {
    if (index === -1) return false;
    return direction === "next" ? index < list.length - 1 : index > 0;
  }

  // THE single entry point for a bill change — called identically by the
  // swipe release and by the caller's counter arrows. No history push/pop
  // here ON PURPOSE: paging through several bills still costs exactly ONE
  // history entry for the whole detail session, so a single Back press from
  // bill #3 returns straight to the list, not to bill #2. Nothing in this
  // file touches window.history — the caller's openDetail owns the one push.
  function triggerPageTransition(direction: "next" | "prev"): void {
    if (!canGo(direction)) return;
    const target = list[index + (direction === "next" ? 1 : -1)];
    if (prefersReducedMotion()) {
      onSwitch(target.orderId);
      setContentTransform(0, false);
      return;
    }
    const vw = window.innerWidth;
    const exitPx = direction === "next" ? -vw : vw;
    // Phase 1 — exit: slide the CURRENT content fully off-screen, animated
    // from wherever it already sits (0 at rest, or a live drag offset).
    setContentTransform(exitPx, true);
    window.setTimeout(() => {
      // Phase boundary — swap the data. The caller's line-items effect, keyed
      // on its own order id, refires on its own.
      onSwitch(target.orderId);
      // Instant, un-animated snap to the OPPOSITE off-screen edge — this is
      // the "next bill slides in from the other side" half. No transition on
      // this write, or the browser would animate the snap itself.
      setContentTransform(-exitPx, false);
      // Double rAF (the same style-flush trick /po's own touch/scroll code
      // uses) — guarantees the browser has committed the un-animated snap
      // above as a separate paint before Phase 2's transition is armed, or it
      // can coalesce the snap and the entrance into one no-op jump.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          // Phase 2 — enter: animate from the opposite edge back to rest.
          setContentTransform(0, true);
        });
      });
    }, SLIDE_MS);
  }

  // A plain tap (movement under SWIPE_DEADZONE_PX on both axes) never reaches
  // the axis-lock branch, so preventDefault() never fires for taps — every
  // button inside the swipe zone (Back, search toggle, CTAs, line ticks)
  // keeps working untouched. touchStateRef is a plain ref, not state: this is
  // a per-gesture scratchpad and a re-render would be wasted work.
  function handleTouchStart(e: React.TouchEvent<HTMLDivElement>): void {
    const t = e.touches[0];
    if (!t) return;
    // Opted-out subtree (a strip that owns its own horizontal scroll) — never
    // claim or track it. Checked BEFORE the edge strip so the two exclusions
    // read in the order they matter: what the element owns, then what the OS
    // owns. A caller with no such element pays one null `closest` per touch.
    if (e.target instanceof Element && e.target.closest(`[${NO_BILL_SWIPE_ATTR}]`) !== null) {
      touchStateRef.current = null;
      return;
    }
    const vw = window.innerWidth;
    if (t.clientX < SWIPE_EDGE_EXCLUSION_PX || t.clientX > vw - SWIPE_EDGE_EXCLUSION_PX) {
      // Starts inside the edge-exclusion strip — leave it entirely to the
      // OS's own edge-swipe-back gesture; never claim or track it.
      touchStateRef.current = null;
      return;
    }
    touchStateRef.current = { startX: t.clientX, startY: t.clientY, tracking: true, locked: false };
  }

  function handleTouchMove(e: React.TouchEvent<HTMLDivElement>): void {
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

  function handleTouchEnd(e: React.TouchEvent<HTMLDivElement>): void {
    const state = touchStateRef.current;
    touchStateRef.current = null;
    if (!state || !state.locked) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - state.startX;
    const direction: "next" | "prev" = dx < 0 ? "next" : "prev";
    const pastThreshold = Math.abs(dx) >= SWIPE_THRESHOLD_PX;
    if (pastThreshold && canGo(direction)) {
      triggerPageTransition(direction);
    } else {
      // Below threshold, OR past it with nothing to page to (either end of
      // the list — NO WRAP — or the open bill has left the list) — snap back
      // rather than calling triggerPageTransition, whose own guard would
      // otherwise leave the content stranded off-screen with nothing
      // committed. The bill never closes on a swipe.
      snapContentBack();
    }
  }

  return {
    index,
    count: list.length,
    contentRef,
    goNext: () => triggerPageTransition("next"),
    goPrev: () => triggerPageTransition("prev"),
    resetTransform: () => setContentTransform(0, false),
    touchHandlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
  };
}
