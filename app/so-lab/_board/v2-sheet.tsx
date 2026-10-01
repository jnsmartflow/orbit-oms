"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { RULE, SCRIM } from "./v2-data";

// The ONE bottom-sheet shell in v2. Extracted from product-drawer.tsx when a
// second and third sheet arrived (change-customer, cancel-order) so there is
// exactly one implementation of the scrim, the slide-up, the height cap, the
// grab bar and the body-scroll lock. A second copy of this is how two sheets
// start behaving differently on a phone for reasons nobody can find.
//
// 🔴 CONTAINMENT — imports ./v2-data and node_modules only.

// Scoped <style> rather than a globals.css entry — same containment rule as
// the colours. Class names are v2-prefixed so they cannot collide.
// prefers-reduced-motion disables both animations outright.
//
// 🔴 THE HEIGHTS ARE PERCENTAGES OF THE CONTAINER, NOT vh OR dvh.
//
// The container is sized to `var(--vvh)` — the VISUAL viewport — so a sheet is
// 94% of what the salesman can actually see rather than 94% of a layout
// viewport the keyboard is sitting on top of. That single change is the whole
// keyboard fix; see the container's own note below.
//
// Height is AUTO, capped at 94%, so only the header strip shows above an open
// sheet. A CAP for most sheets, because a two-row confirm should open short
// rather than stretch into a white void. `.v2-sheet-fixed` is the exception,
// opted into by `fixedHeight` — see the prop's note.
const SHEET_CSS = `
@keyframes v2SheetUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
@keyframes v2ScrimIn { from { opacity: 0; } to { opacity: 1; } }
.v2-sheet { animation: v2SheetUp .26s cubic-bezier(.32,.72,0,1) both; max-height: 94%; }
.v2-sheet-fixed { height: 94%; }
/* 🔴 THE LAST 6% IS WORTH HAVING WHEN THE KEYBOARD IS UP, and only then. The
   94% exists so a strip of the screen behind the sheet stays visible and the
   thing reads as a sheet rather than a page. With the keyboard open there is
   nothing behind it worth seeing — the board is off screen anyway — and on a
   320x568 phone that 6% is 18.5px, which is the difference between about 37px
   and about 56px of pack rows. Half as much again of the only region he is
   using. It reverts the moment the keyboard goes. */
.v2-sheet-kb { max-height: 100%; }
.v2-sheet-kb.v2-sheet-fixed { height: 100%; }
.v2-scrim { animation: v2ScrimIn .2s ease-out both; }
@media (prefers-reduced-motion: reduce) {
  .v2-sheet, .v2-scrim { animation: none; }
}
`;

// ── The body-scroll lock, REF-COUNTED ──────────────────────────────────────
//
// 🔴 THIS USED TO BE PER-SHEET, AND IT LOST THE SCROLL POSITION.
//
// Each sheet locked and unlocked the body on its own. That is fine for one
// sheet and wrong the moment two overlap, which the board does routinely: the
// dealer sheet closing and the product drawer opening happen in the SAME React
// commit, and React runs every cleanup before any setup. So the body went
// fixed -> static -> fixed inside one frame. Restoring `position` collapses and
// re-expands the document, `window.scrollTo` writes against whatever the
// scrollable extent is at that instant, and before layout has settled that
// extent is one viewport — so the restore CLAMPED TO ZERO and the salesman was
// thrown back to the top of the board.
//
// A timer would have hidden it. Instead the lock is shared and counted: the
// body is touched only on the 0 -> 1 and 1 -> 0 transitions, so overlapping
// consumers never toggle it at all. The count and the saved offset are
// module-level because there is exactly one <body> to own.
//
// ⚠ Counting alone does not close the gap: in a handoff commit the count still
// dips 1 -> 0 -> 1, because the outgoing cleanup runs before the incoming
// setup. The page therefore holds a lock of its own for as long as ANY overlay
// is open (see useBodyScrollLock(overlayOpen) in po-v2-page), which keeps the
// count at 1 across the swap. That is what actually makes the handoff silent.

let lockCount = 0;
let lockedY = 0;
let lockedPrev: Record<string, string> = {};

/**
 * 🔴 THE LOCK RUNS BEFORE PAINT, AND THAT IS THE WHOLE OF THIS HOOK'S TIMING.
 *
 * It used to be a plain useEffect, which React runs AFTER the browser has
 * painted. The sheet's slide-up is a CSS animation, so it starts on that same
 * first paint — and `position: fixed` on <body> takes the document out of flow
 * and COLLAPSES ITS HEIGHT. So frame 1 painted the sheet at translateY(100%)
 * with the page still in flow, and the effect then reflowed everything
 * underneath it. One frame of the animation ran against a layout that no
 * longer existed by frame 2. That is the jitter, and it was never the
 * animation: v2SheetUp touches transform only, which is as cheap as it gets.
 *
 * A layout effect runs after the DOM is committed and BEFORE the paint, so the
 * animation's first frame already sees the locked layout and there is nothing
 * left to reflow.
 *
 * ⚠ ISOMORPHIC, AND NOT AS A STYLE CHOICE. This hook is called from
 * po-v2-page.tsx:521 as a TOP-LEVEL hook, above every early return, so it runs
 * during the SERVER render too — po-v2-page is "use client" but a client
 * component is still pre-rendered unless it is dynamically imported with
 * ssr:false, and none is. A bare useLayoutEffect there logs React's "does
 * nothing on the server" warning on every request. useEffect is a no-op during
 * SSR anyway, so the server arm loses nothing.
 *
 * ⚠ THE UNLOCK MOVED WITH IT, DELIBERATELY. A layout effect's cleanup is also
 * synchronous within the commit, so lock and unlock stay on the same side of a
 * paint as each other — which is the property that keeps the scroll restore
 * below symmetrical. It also removes a small flash that existed before: the
 * old passive cleanup let one frame paint with the sheet gone and <body> still
 * fixed.
 *
 * ⚠ NOTHING ABOUT THE MECHANISM CHANGED. The ref count, the module-level
 * offset, the choice of position:fixed over overflow:hidden and the order of
 * the reads and writes inside are all exactly as they were — see the note
 * above for why each exists. This changed WHEN, not WHAT.
 */
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * @param active pass false to hold the hook without taking the lock. Lets a
 *   caller own the lock for a whole span (any-overlay-open) rather than for
 *   one component's lifetime.
 */
export function useBodyScrollLock(active = true): void {
  useIsomorphicLayoutEffect(() => {
    if (!active) return;
    const body = document.body;
    if (lockCount === 0) {
      lockedY = window.scrollY;
      // Read first and restored individually rather than reset to "", so this
      // cannot clobber a style something else set.
      lockedPrev = {
        position: body.style.position, top: body.style.top,
        left: body.style.left, right: body.style.right, width: body.style.width,
      };
      // `position: fixed`, NOT `overflow: hidden`: iOS Safari ignores
      // overflow-hidden on body and keeps scrolling the page under the sheet.
      body.style.position = "fixed";
      body.style.top      = `-${lockedY}px`;
      body.style.left     = "0";
      body.style.right    = "0";
      body.style.width    = "100%";
    }
    lockCount += 1;
    return () => {
      lockCount -= 1;
      if (lockCount > 0) return;      // somebody else still has it
      body.style.position = lockedPrev.position;
      body.style.top      = lockedPrev.top;
      body.style.left     = lockedPrev.left;
      body.style.right    = lockedPrev.right;
      body.style.width    = lockedPrev.width;
      window.scrollTo(0, lockedY);
    };
  }, [active]);
}

// ── IS THE KEYBOARD ACTUALLY OPEN ──────────────────────────────────────────
//
// 🔴 A REAL HEIGHT DROP, NEVER FOCUS. CLAUDE_UI §55: "All floating footers gate
// on `keyboardOpen` (real keyboard), never `inputFocused`." Focus is the wrong
// signal in both directions — Android's down-caret closes the keyboard while
// the input keeps focus, so a focus-gated footer would stay hidden with half
// the screen free; and iOS can focus a field a frame before the keys arrive.
//
// The shape is /po's, at po-page.tsx:961, and so are both numbers:
//   THRESHOLD 120px — a drop smaller than this is the URL bar collapsing, not
//                     a keyboard. Nothing in v2 argues for a different figure:
//                     the noise is the browser's, not the page's.
//   DEBOUNCE  100ms — the open ramp reports several intermediate heights, and
//                     without this the chips and strip would flicker out and
//                     back on the way up.
//
// 🔴 ONE LISTENER FOR THE WHOLE APP, REF-COUNTED, exactly like the lock above.
// Subscribers share it; it attaches on the first and detaches on the last. A
// per-component listener would be one visualViewport handler per open sheet.
//
// 🔴 AND NO STATE CHURN. The measure runs on every resize frame of the ramp but
// only ever calls a subscriber when the BOOLEAN FLIPS — at most twice per
// keyboard cycle. That is the discipline the --vvh writer documents ("never
// React state, which would cause a render storm"); the difference is that a
// boolean has two values and a height has hundreds.
//
// ⚠ IT DOES NOT SHARE THE --vvh WRITER'S LISTENER, and that is a deliberate
// limit of this step rather than a design view. That writer lives in
// po-v2-page.tsx, which IMPORTS this file, so it cannot be the publisher
// without a cycle — and the brief for this change forbids editing it. So the
// app now has two visualViewport handlers reading the same height for two
// different outputs. There is exactly ONE source of truth for the boolean,
// which is what matters; merging the two handlers is a tidy-up for whoever
// next has both files open.

const KB_THRESHOLD = 120;
const KB_DEBOUNCE  = 100;

let kbFullH = -1;
let kbOpen  = false;
let kbTimer: ReturnType<typeof setTimeout> | null = null;
let kbDetach: (() => void) | null = null;
const kbSubs = new Set<(next: boolean) => void>();

function kbMeasure(): void {
  const vv = window.visualViewport;
  const h = vv ? vv.height : window.innerHeight;
  // Grows on rotation and on an iOS URL-bar expand, never shrinks — the
  // reference has to be the tallest this viewport has ever been, or the first
  // measurement taken WITH the keyboard already up becomes "full".
  if (h > kbFullH) kbFullH = h;
  const next = (kbFullH - h) > KB_THRESHOLD;
  if (next === kbOpen) return;
  if (kbTimer) clearTimeout(kbTimer);
  kbTimer = setTimeout(() => {
    kbTimer = null;
    if (next === kbOpen) return;
    kbOpen = next;
    kbSubs.forEach((notify) => notify(next));
  }, KB_DEBOUNCE);
}

/**
 * Whether the soft keyboard is up, as a boolean any sheet can read.
 *
 * ⚠ FALSE ON THE SERVER AND ON THE FIRST CLIENT FRAME, which is correct: a
 * sheet that has only just mounted has not raised a keyboard yet.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    kbSubs.add(setOpen);
    if (kbSubs.size === 1 && typeof window !== "undefined") {
      const vv = window.visualViewport;
      if (vv) {
        vv.addEventListener("resize", kbMeasure);
        vv.addEventListener("scroll", kbMeasure);
        kbDetach = () => {
          vv.removeEventListener("resize", kbMeasure);
          vv.removeEventListener("scroll", kbMeasure);
        };
      } else {
        window.addEventListener("resize", kbMeasure);
        kbDetach = () => window.removeEventListener("resize", kbMeasure);
      }
      kbMeasure();
    }
    // Adopt whatever the shared value already is — a second sheet opening on
    // top of a first must not think the keyboard is down.
    setOpen(kbOpen);
    return () => {
      kbSubs.delete(setOpen);
      if (kbSubs.size > 0) return;
      if (kbTimer) { clearTimeout(kbTimer); kbTimer = null; }
      kbDetach?.();
      kbDetach = null;
      // Reset the reference so the next sheet measures its own "full", rather
      // than inheriting a height from a rotation two screens ago.
      kbFullH = -1;
      kbOpen  = false;
    };
  }, []);
  return open;
}

/**
 * Keeps whatever is focused INSIDE the sheet visible when the keypad opens.
 *
 * 🔴 THE SHEET ITSELF NEVER MOVES TO ACHIEVE THIS. It is pinned to the visual
 * viewport (see the container below), so when the keys appear it simply becomes
 * the height of what is left — and the pack row he tapped can end up below that
 * shorter area. The answer is to scroll the sheet's OWN scroller, not to shove
 * the sheet somewhere.
 *
 * 🔴 THREE THINGS WERE WRONG AND ALL THREE HAD TO GO. The 20L row — last of
 * seven — kept ending up under the footer, and it kept coming back:
 *
 * 1. THIS LISTENED TO resize ONLY. CLAUDE_UI.md §55 says in so many words that
 *    on an iOS standalone PWA the keyboard does NOT emit a clean resize — its
 *    FINAL geometry arrives as a visualViewport scroll/offset adjustment. It is
 *    why the --vvh writer carries both listeners. So this ran against an
 *    intermediate, taller viewport and was never re-run once the keyboard had
 *    actually settled. That is the cause, and it was mine.
 *
 * 2. block: "nearest" does the least work that satisfies the rule — it stops
 *    the moment the row's edge touches the container's edge, which is flush
 *    against the footer's border. Technically visible; reads as half-hidden.
 *    "center" leaves room on both sides, so a late shift of a few pixels
 *    cannot re-hide it.
 *
 * 3. Centring the LAST row is impossible without trailing space, so the scroll
 *    container carries bottom padding (see the drawer). Without it, "center"
 *    degenerates to "scroll to the end" for exactly the worst case.
 *
 * ⚠ IF IT COMES BACK AFTER THIS, STOP FIGHTING THE OS KEYBOARD. The next step
 * is an in-sheet number pad — a small 3x4 grid drawn inside the sheet — which
 * takes the system keyboard out of the equation entirely. Do not reach for a
 * fourth round of viewport arithmetic.
 *
 * NO TIMER AND NO rAF. These run inside visualViewport's own events, which fire
 * after the viewport has already changed, and scrollIntoView forces the layout
 * it needs. A timer would be guessing at when the keyboard finished animating,
 * and that guess is what makes these bugs come back.
 */
function useKeepFocusVisible(ref: React.RefObject<HTMLElement>): void {
  useEffect(() => {
    const vv = typeof window === "undefined" ? null : window.visualViewport;
    if (!vv) return;
    const onResize = (): void => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return;
      // Only OUR sheet's fields. Another overlay's input is not our business.
      if (!ref.current || !ref.current.contains(active)) return;
      // 🔴 "nearest", NOT "center" — and note (2) above is what changed.
      //
      // That note argued for "center" so a late few-pixel shift could not
      // re-hide a row. It was reasoning about a row inside PackList, and it was
      // right about that. What it did not account for is that this handler also
      // fires for the SEARCH INPUT, which sits OUTSIDE any inner scroller — so
      // its nearest scrollable ancestor is the <section> itself. The section is
      // overflow-hidden, which clips but is still SCROLLABLE BY SCRIPT, and
      // "center" therefore scrolled the whole sheet to put the field in the
      // middle — dragging the footer up over the pack rows. That is the defect
      // in the screenshots.
      //
      // "nearest" is what /po uses for the same job (po-page.tsx:973) and it
      // scrolls the minimum, so with nothing overflowing it scrolls nothing.
      //
      // ⚠ THIS IS THE BELT, NOT THE BRACES. Collapsing the chips and the strip
      // (see product-drawer) is what stops the section overflowing in the first
      // place, and a section that does not overflow cannot be scrolled by any
      // block value. This makes the failure impossible rather than unlikely.
      active.scrollIntoView({ block: "nearest", behavior: "auto" });
    };
    // BOTH events. See (1) above — resize alone misses the settle on iOS.
    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);
    return () => {
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", onResize);
    };
  }, [ref]);
}

export default function V2Sheet({
  onClose,
  footer,
  fixedHeight = false,
  children,
}: {
  onClose: () => void;
  /** Pinned below the scroll area, with its own border and safe-area inset. */
  footer?: React.ReactNode;
  /**
   * 🔴 ALWAYS 94% OF THE VISIBLE VIEWPORT, WHATEVER THE CONTENT.
   *
   * The product drawer takes this because content-sizing made Cement SB (one
   * pack) open short and Gloss (seven) open tall, which moved Cancel and Add
   * under the thumb from product to product. A salesman putting forty lines
   * into an order builds muscle memory for where Add is, standing on a
   * warehouse floor and not looking.
   *
   * The DEALER and SHIP-TO sheets take it for a different reason: their content
   * is a result list that changes length on every keystroke, so a content-sized
   * sheet grew and shrank under his thumb while he typed. Both are the same
   * height as each other and neither moves, whatever matches.
   */
  fixedHeight?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  const sheetRef = useRef<HTMLElement>(null);
  useBodyScrollLock();
  useKeepFocusVisible(sheetRef);
  /* Read by EVERY sheet, but it can only ever be true for one that holds an
     input — nothing else can raise a keyboard. A sheet with no field sees
     `false` for its whole life and renders exactly as it did before. */
  const keyboardOpen = useKeyboardOpen();

  return (
    /* 🔴 PINNED TO THE VISUAL VIEWPORT — BOTH ITS SIZE AND ITS POSITION, so
       the sheet DOES NOT MOVE when the keyboard opens. It is not positioned
       against the page, so it does not go where the page goes; it fills exactly
       what the user can see, and its contents scroll inside it.

       Those are two separate axes and only the first was fixed before.

       HEIGHT (--vvh) was added when the dealer sheet opened blank: `inset-0`
       spans the LAYOUT viewport, which the soft keyboard does not shrink, so a
       sheet anchored to its bottom had its bottom edge underneath the keyboard.

       OFFSET (--vvo) is the half that was missing, and it is why the product
       drawer still broke when the number keypad opened. `position: fixed` lays
       out against the LAYOUT viewport. When the keypad opens for an input near
       the BOTTOM of the screen, iOS scrolls the VISUAL viewport down inside the
       layout viewport to lift that input clear of the keys, and reports it as
       visualViewport.offsetTop. Nothing read it — not here and not /po — so the
       overlay stayed pinned to a layout-top that was now scrolled off screen,
       and its bottom edge landed offsetTop pixels ABOVE the real bottom. The
       board showed through the strip: "cut in half".

       That is also why the dealer sheet looked fixed by height alone. Its
       search box sits at the TOP of the sheet, so iOS never needed to scroll.
       The quantity field sits at the bottom, so it always does.

       Written by the effect in po-v2-page (CLAUDE_UI.md §55's mechanism).
       app/globals.css declares `html { --vvh: 100vh }` as the SSR fallback and
       app/layout.tsx's viewport export sets `interactiveWidget:
       "resizes-content"`; both are app-wide and neither is edited. */
    <div
      className="fixed inset-x-0 z-50"
      style={{ top: "var(--vvo, 0px)", height: "var(--vvh, 100vh)" }}
    >
      <style>{SHEET_CSS}</style>

      {/* Scrim — tapping anywhere outside the sheet closes it. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="v2-scrim absolute inset-0 h-full w-full cursor-default"
        style={{ background: SCRIM }}
      />

      <section
        ref={sheetRef}
        className={`v2-sheet${fixedHeight ? " v2-sheet-fixed" : ""}${keyboardOpen ? " v2-sheet-kb" : ""} absolute inset-x-0 bottom-0 flex flex-col overflow-hidden bg-white`}
        style={{
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          boxShadow: "0 -8px 32px rgba(18,14,26,.16)",
        }}
      >
        <div className="flex shrink-0 justify-center pt-2.5 pb-1">
          <span className="block rounded-full" style={{ width: 38, height: 4.5, background: RULE }} />
        </div>

        {children}

        {footer && (
          <div
            className="flex shrink-0 gap-2 px-4 pt-3"
            style={{
              // 🔴 ITS OWN GROUND. This carried a border and padding and no
              // background, and simply relied on the section's white being
              // behind it. That held right up until something scrolled the
              // section — then the pack rows slid UNDER a transparent footer
              // and read as printing straight through the Add button. A bar
              // that sits over content has to be opaque on its own account;
              // inheriting a colour from an ancestor is not the same promise.
              background: "#FFFFFF",
              borderTop: `1px solid ${RULE}`,
              paddingBottom: "max(env(safe-area-inset-bottom), 12px)",
            }}
          >
            {footer}
          </div>
        )}
      </section>
    </div>
  );
}
