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
// Height is AUTO, capped at 94% of the viewport, so only the search strip
// shows above an open sheet and most products need no scrolling inside it. A
// CAP for most sheets: the cancel sheet is two rows and a button and should
// open short rather than stretch into a white void.
//
// `.v2-sheet-fixed` is the exception, opted into by `fixedHeight` - see the
// prop's own note below for why the product drawer takes it. `dvh` is the
// correct unit on a phone because `vh` measures the viewport with the toolbar
// COLLAPSED; @supports keeps the vh value on engines that lack dvh.
const SHEET_CSS = `
@keyframes v2SheetUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
@keyframes v2ScrimIn { from { opacity: 0; } to { opacity: 1; } }
.v2-sheet { animation: v2SheetUp .26s cubic-bezier(.32,.72,0,1) both; max-height: 94vh; }
.v2-sheet-fixed { height: 94vh; }
.v2-scrim { animation: v2ScrimIn .2s ease-out both; }
@supports (max-height: 94dvh) { .v2-sheet { max-height: 94dvh; } }
@supports (height: 94dvh) { .v2-sheet-fixed { height: 94dvh; } }
@media (prefers-reduced-motion: reduce) {
  .v2-sheet, .v2-scrim { animation: none; }
}
`;

/**
 * Locks the page behind the scrim and restores both the styles and the scroll
 * position on close.
 *
 * `position: fixed` on <body>, NOT `overflow: hidden`: iOS Safari ignores
 * overflow-hidden on body and keeps scrolling the page under the sheet. Fixing
 * the body collapses its scroll to zero, so the offset is stashed in `top` and
 * handed back to window.scrollTo on cleanup. Each property is read first and
 * restored individually rather than reset to "", so this cannot clobber a
 * style something else set.
 */
function useBodyScrollLock(): void {
  useEffect(() => {
    const body = document.body;
    const y = window.scrollY;
    const prev = {
      position: body.style.position, top: body.style.top,
      left: body.style.left, right: body.style.right, width: body.style.width,
    };
    body.style.position = "fixed";
    body.style.top      = `-${y}px`;
    body.style.left     = "0";
    body.style.right    = "0";
    body.style.width    = "100%";
    return () => {
      body.style.position = prev.position;
      body.style.top      = prev.top;
      body.style.left     = prev.left;
      body.style.right    = prev.right;
      body.style.width    = prev.width;
      window.scrollTo(0, y);
    };
  }, []);
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
   * 🔴 ALWAYS 94% OF THE VIEWPORT, WHATEVER THE CONTENT. The product drawer
   * sets this; every other sheet stays content-sized, where the height IS the
   * information.
   *
   * Content-sizing made Cement SB (one pack) open as a neat short sheet and
   * Gloss (seven) as a tall one - which moved Cancel and Add under the thumb
   * from product to product. A salesman putting forty lines into an order
   * builds muscle memory for where Add is, standing on a warehouse floor and
   * not looking. A tidy short sheet is not worth costing him that, so a
   * one-pack product now opens with white space above a footer that has not
   * moved a pixel.
   */
  fixedHeight?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  useBodyScrollLock();

  return (
    <div className="fixed inset-0 z-50">
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
