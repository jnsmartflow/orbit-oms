"use client";

import { useEffect } from "react";
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
 * @param active pass false to hold the hook without taking the lock. Lets a
 *   caller own the lock for a whole span (any-overlay-open) rather than for
 *   one component's lifetime.
 */
export function useBodyScrollLock(active = true): void {
  useEffect(() => {
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
  useBodyScrollLock();

  return (
    /* 🔴 SIZED TO THE VISUAL VIEWPORT, NOT `inset-0`.
       This is the fix for "Change dealer opens on a blank screen". `inset-0`
       spans the LAYOUT viewport, which the soft keyboard does not shrink — so a
       sheet anchored to its bottom had its bottom edge underneath the keyboard
       and pushed its own title, search box and list off the top of what the
       salesman could see. He had to scroll a sheet that had only just opened.

       --vvh carries window.visualViewport.height, written by the effect in
       po-v2-page (CLAUDE_UI.md §55 — the same mechanism /po already uses, not a
       second invention of it). app/globals.css declares `html { --vvh: 100vh }`
       as the SSR fallback and app/layout.tsx's viewport export already sets
       `interactiveWidget: "resizes-content"`, which is what makes Chromium
       shrink rather than overlay; both are app-wide and neither is edited. */
    <div className="fixed inset-x-0 top-0 z-50" style={{ height: "var(--vvh, 100vh)" }}>
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
        className={`v2-sheet${fixedHeight ? " v2-sheet-fixed" : ""} absolute inset-x-0 bottom-0 flex flex-col overflow-hidden bg-white`}
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
            style={{ borderTop: `1px solid ${RULE}`, paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}
          >
            {footer}
          </div>
        )}
      </section>
    </div>
  );
}
