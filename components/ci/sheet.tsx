"use client";

// CI's bottom-sheet primitives — the scrim, the panel and the grab handle, in
// ONE place so no CI sheet hand-rolls a z-index or a radius again.
//
// COPIED from components/picking/picking-board-mobile.tsx's SHEET_GEOMETRY +
// FilterBottomSheet, which do not export either. Tokens, not rules — the same
// copy-don't-import convention components/ci/line-list.tsx records for the line
// row, and components/mrn/line-list.tsx before it.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 ONE DELIBERATE DIVERGENCE FROM PICKING: `bottomOffset` IS 0, NOT
//    MOBILE_NAV_CLEARANCE.
// ═══════════════════════════════════════════════════════════════════════════
//
// Picking's sheets float over its LIST view, where the module tab bar is still
// mounted, so they must clear 76px + the safe area or they sit under it. That
// figure has been hand-copied wrong four separate times (CLAUDE_PICKING.md §7),
// which is why it lives in one constant.
//
// CI's sheets — the quantity sheet and the reason sheet — only ever open over
// the BILL screen, and that screen sets `hideBar`, so there is no nav to clear.
// Using MOBILE_NAV_CLEARANCE here would strand the sheet 76px above the bottom
// edge with a strip of page showing beneath it.
//
// ⚠ IF A CI SHEET IS EVER OPENED FROM THE LIST OR THE SUBMITTED TAB, where the
// tab bar IS mounted, it needs MOBILE_NAV_CLEARANCE — import it from
// components/shared/mobile-shell and pass it, never re-type "76px".
//
// The z-values are Picking's verbatim and are NOT arbitrary: they clear
// mobile-shell's OWN stack (nav z-40 → its scrim z-50 → menu/you sheets z-[60]
// → sign-out confirm z-[70]), not merely the nav.
export const CI_SHEET = {
  scrimZ: "z-[65]",
  panelZ: "z-[75]",
  maxHeight: "max-h-[70vh]",
  /** See the header — 0 because every CI sheet opens over a hidden tab bar. */
  bottomOffset: 0,
} as const;

/**
 * The scrim + panel shell every CI sheet sits in.
 *
 * ⚠ The caller decides whether to render this at all; there is no `open` prop
 * and no internal mount animation. Picking's sheets are conditionally rendered
 * with no transition either, and matching that is the point — a sheet that
 * slides while Picking's appear would be a NEW dialect, not a fix.
 */
export function CiSheet({
  label,
  onDismiss,
  children,
}: {
  /** Accessible name for the dialog. */
  label: string;
  /** Scrim tap. Callers route this through history.back() so the ONE popstate
   *  authority stays the only thing that closes anything (see new-return.tsx). */
  onDismiss: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <>
      <div
        className={`fixed inset-0 bg-black/40 ${CI_SHEET.scrimZ}`}
        onClick={onDismiss}
        aria-hidden="true"
      />
      <div
        className={
          `fixed left-0 right-0 ${CI_SHEET.panelZ} bg-white rounded-t-[18px] ` +
          `${CI_SHEET.maxHeight} overflow-y-auto`
        }
        style={{
          bottom: CI_SHEET.bottomOffset,
          paddingBottom: "max(env(safe-area-inset-bottom, 0px), 16px)",
        }}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        {/* The grab handle — Picking's exact token. Not decoration: it is the
            affordance that says "this drags/dismisses", and every sheet in the
            app has one. */}
        <div className="w-9 h-1 rounded-full bg-gray-300 mx-auto mt-3 mb-3.5" />
        {children}
      </div>
    </>
  );
}
