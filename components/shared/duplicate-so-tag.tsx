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
// ⚠ THIS FILE NOW OWNS **TWO** TREATMENTS (2026-08-25), and the split is by
// MODULE, not by taste:
//   SOLID (DUP_SO_*, the original)  — every PICKING surface: picking-board-
//                                     mobile, picker-my-picks-board, card-atoms,
//                                     bill-symbols. Byte-identical to before.
//   SOFT  (DUP_SO_SOFT_*, below)    — every FLOOR surface: floor-table,
//                                     rail-card, detail-panel.
// The soft set was added ADDITIVELY — not one solid token was edited, renamed or
// re-valued — because the picking boards read them and a floor ticket must not
// move a picking screen (CLAUDE_FLOOR §1: Floor reuses Picking as a CALLER and
// does not modify it). Same pattern `lib/hooks/use-picking-marker` took when
// Floor needed it: optional params, every existing call site untouched.
// `DuplicateSoTag`'s `variant` prop defaults to "solid", so the five picking call
// sites omit it and render exactly what they rendered yesterday.
//
// ⚠ CONSEQUENCE, AND IT IS KNOWN: a Same-SO bill looks DIFFERENT on the phone
// (solid red card) and on the desk (soft tinted row). Bringing the phone boards
// across is a PICKING change and needs that module's sign-off — ROADMAP, filed
// under Picking. The `variant` prop is the mechanism; do not rebuild it.
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

// ── SOFT treatment — FLOOR ONLY (2026-08-25) ────────────────────────────────
//
// Mockup `docs/prompts/drafts/duplicate-so-highlight-mockup_1.html`, the
// left-bar shape, softened: 3px not 6px, red-500 not red-600, red-50 ground.
//
// 🔴 THE COLOUR IS A DECISION, NOT AN OVERSIGHT. `#ef4444` is ALSO the urgent ⚡
// glyph on this board (floor-table, rail-card, hold-tab, cancelled-tab) and
// CLAUDE_UI §3 hands `bg-red-50` to Urgent, Hold AND Voided/Removed. Smart Flow
// ruled on 2026-08-25, knowing that: on a FLOOR ROW, red-50 + a red-500 left bar
// means Same-SO; Urgent keeps the ⚡ glyph and nothing else. Do not "fix" this
// to amber or violet in a later pass — it was weighed and chosen.
//
// WHY A BAR AND A WASH INSTEAD OF A FILL: a whole row of white-on-red ate every
// other signal it carried (age chip, elapsed pill, ⚡, StatusPill), which is what
// DUP_SO_BADGE_CLASS exists to paper over. The soft variant needs none of that —
// every badge on a soft row renders exactly as it does on a white row, so there
// is deliberately no DUP_SO_SOFT_BADGE_CLASS. Its absence is the feature.

/** Row / card ground. Tailwind classes, not an inline style: an inline
 *  background beats the `hover:` rule and kills the row hover (same reason
 *  DUP_SO_ROW_CLASS above is a class string). */
export const DUP_SO_SOFT_ROW_CLASS = "bg-[#fef2f2] hover:bg-[#fee2e2]";

/** The 3px left accent, as an INSET BOX-SHADOW on the first cell.
 *  ⚠ NEVER `border-left`. The floor table is `table-layout: fixed` with colgroup
 *  percentage widths (CLAUDE_UI §27) and its first column carries
 *  `pl-[10px] pr-[4px]` — a real border consumes that padding and shifts the row.
 *  A shadow paints inside the box and costs no layout. */
export const DUP_SO_SOFT_BAR = "inset 3px 0 0 #ef4444";

/** Card surface + edge, for the rail card and the detail panel — the same two
 *  values the row uses, in the form a bordered card needs them. */
export const DUP_SO_SOFT_SURFACE = "#fef2f2";
export const DUP_SO_SOFT_ACCENT = "#ef4444";
/** Card hairline. red-200 — visible against the wash without becoming a second
 *  accent competing with the bar. */
export const DUP_SO_SOFT_BORDER = "#fecaca";

/** Chip on a soft surface: red-50 ground, red-200 hairline, red-700 text.
 *  A quiet chip, because the bar is already carrying the signal. */
export const DUP_SO_SOFT_BADGE_CLASS =
  "bg-[#fef2f2] border border-[#fecaca] text-[#b91c1c]";

/**
 * The tag itself — "SAME", never the number.
 *
 * `variant` picks the skin, and DEFAULTS TO "solid" so all five picking call
 * sites omit it and are byte-identical:
 *   solid → white fill + #b91c1c text, the flipped-badge language every other
 *           pill on a red card speaks, so it reads as one of them not as chrome.
 *   soft  → red-50 ground + red-200 hairline + red-700 text, for Floor's tinted
 *           row/card, where there is no fill to fight and a white pill would
 *           float.
 *
 * ⚠ THE LABEL IS ONE WORD (2026-08-25, was "Same SO"). It rides the floor
 * table's OBD cell — a 14% track (CLAUDE_UI §27) already carrying the OBD
 * number, an optional `Nd` age badge and a date sub-line — and the second word
 * pushed it past the cell's `text-ellipsis`, so it shipped reading "SAME …".
 * The dropped "SO" told the operator nothing the tooltip does not; the fix is
 * one word, NOT a wider column. Geometry, `shrink-0 whitespace-nowrap` and the
 * tooltip are all unchanged. Uppercase at 10.5px matches CLAUDE_UI §60's scale.
 *
 * 🔴 `title` is intentionally a plain instruction and NEVER the SO number —
 * the file-top rule, unchanged.
 */
export function DuplicateSoTag({
  className = "",
  variant = "solid",
}: {
  className?: string;
  variant?: "solid" | "soft";
}): React.JSX.Element {
  return (
    <span
      title="Another live order shares this SO number — open both and check"
      className={
        "shrink-0 whitespace-nowrap rounded-full px-2 py-[3px] text-[10.5px] font-bold uppercase tracking-[0.03em] " +
        (variant === "soft" ? DUP_SO_SOFT_BADGE_CLASS : DUP_SO_BADGE_CLASS) +
        (className ? " " + className : "")
      }
    >
      Same
    </span>
  );
}
