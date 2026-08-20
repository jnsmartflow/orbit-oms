"use client";

// ── Duplicate-SO treatment — THE ONE OWNER of the red ──────────────────────
//
// Renders the fact that `hasDuplicateSo` is true on a row/card (data layer:
// lib/picking/duplicate-so.ts, commit 4f21b7da). Approved treatment "A · solid
// red fill, with tag".
//
// 🔴 NEVER RENDER THE SO NUMBER. Not here, not at any call site, not in a
// tooltip or an aria-label. The row payloads deliberately carry only a boolean
// (PickingQueueRow / FloorBoardRow / FloorRailCard) — the number itself is read
// on a detail panel, which fetches it separately. The tag says "Same SO", full
// stop; the supervisor opens the bills to see which is which.
//
// ⚠ ONE OWNER, and this is it. Both Picking and Floor import these tokens.
// NEVER re-type #dc2626 / #b91c1c / #fecaca at a call site — two screens with
// their own copy of a colour is exactly how they drift, and this treatment
// spans five surfaces across two modules.
//
// ⚠ WHY THIS IS NOT A ONE-LINE className SWAP. A solid red fill eats every
// other red and amber signal on the card: AgeBadge's 2d+/4d+ pills, the
// supervisor's grey/amber/red elapsed pill, the urgent ⚡, Floor's StatusPill.
// Each of those has to flip to a WHITE pill with #b91c1c text or it vanishes
// into the fill. That is what BADGE_CLASS below is for — one class string, so
// every flipped badge on every surface looks identical.
//
// NOT flagged today (known gap, deliberate): Floor's Hold and Cancelled tabs.
// They are separate feeds (getFloorHold / getFloorCancelled) whose row types do
// not carry `hasDuplicateSo` at all, so there is nothing to render. A held or
// cancelled twin therefore shows no red anywhere.

/** Card / row fill. */
export const DUP_SO_FILL = "#dc2626";
/** Card / row border, and the text colour of any badge flipped onto white. */
export const DUP_SO_BORDER = "#b91c1c";
/** Primary text on red — dealer name, OBD, hero numbers. */
export const DUP_SO_TEXT = "#ffffff";
/** Secondary / muted text on red — area, captions, timestamps, units. */
export const DUP_SO_MUTED = "#fecaca";
/** Hairlines and middots on red. */
export const DUP_SO_DIVIDER = "rgba(255,255,255,0.45)";

/** Chips, arrow circles and secondary buttons — a white alpha wash so they
 *  stay visible on the fill without competing with the white text. */
export const DUP_SO_WASH = "rgba(255,255,255,0.20)";
/** Wash for a control that also needs an edge (rail Hold / ✕ buttons). */
export const DUP_SO_WASH_BORDER = "rgba(255,255,255,0.45)";

/** The shelf band on a red card. An OPAQUE darker red rather than a wash: the
 *  band's right-edge fade is a gradient, and a gradient to a semi-transparent
 *  colour over a red parent composites differently along its length. Opaque
 *  keeps the fade behaving exactly as it does on a white card. */
export const DUP_SO_BAND = "#b91c1c";

/** THE flipped-badge class. Any pill that is normally red, amber, green or grey
 *  wears this on a red card: white fill, #b91c1c text. Used by AgeBadge, the
 *  supervisor elapsed/picked pills, the upcoming-day badge, the released chip
 *  and Floor's StatusPill. One string so they cannot drift apart. */
export const DUP_SO_BADGE_CLASS = "bg-white text-[#b91c1c] border border-white";

/** Floor table row classes — fill plus a working hover. Deliberately Tailwind
 *  classes rather than an inline style: an inline background would beat the
 *  `hover:` rule and kill the row hover the board relies on. This file is under
 *  `components/**`, which is in tailwind.config's content glob, so these
 *  arbitrary values are generated. */
export const DUP_SO_ROW_CLASS = "bg-[#dc2626] hover:bg-[#b91c1c]";

/**
 * The tag itself — "SAME SO", never the number.
 *
 * White fill + #b91c1c text, i.e. the same flipped-badge language as every
 * other pill on a red card, so it reads as one of them rather than as chrome.
 * Uppercase at 10.5px matches CLAUDE_UI.md §60's chip scale.
 *
 * `title` is intentionally a plain instruction and NOT the SO number.
 */
export function DuplicateSoTag({ className = "" }: { className?: string }): React.JSX.Element {
  return (
    <span
      title="Another live order shares this SO number — open both and check"
      className={
        "shrink-0 whitespace-nowrap rounded-full px-2 py-[3px] text-[10.5px] font-bold uppercase tracking-[0.03em] " +
        DUP_SO_BADGE_CLASS +
        (className ? " " + className : "")
      }
    >
      Same SO
    </span>
  );
}
