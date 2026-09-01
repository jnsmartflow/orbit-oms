"use client";

// THE SPINE — the shared row grammar for CI's two detail screens.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 ONE SCREEN, TYPED INTO OR READ. THAT IS WHY THIS FILE EXISTS.
// ═══════════════════════════════════════════════════════════════════════════
//
// components/ci/details-step.tsx (the create flow, typed into) and
// components/ci/submitted-detail.tsx (a submitted CI, read) show THE SAME FOUR
// FACTS in the same order. Until step 11 they were two different objects: one
// was full-width stacked bands with tiny uppercase labels, the other was the
// approved label-left / value-right spine. They drifted because the tokens were
// typed out twice — which is exactly what step 10 fixed for the card and step 9
// fixed for the sheets, both times by moving the tokens into one file.
//
// So: every size, weight, colour, gutter and hairline on either screen comes
// from here. Change one and BOTH move. There is no local override, and adding
// one is how this comes apart again.
//
// ⚠ THE VALUES ARE PICKING'S, NOT NEW ONES — each constant names its source.
// The one role Picking has no equivalent for is a label-left/value-right facts
// row; its nearest neighbour is the detail STAT STRIP
// (picking-board-mobile.tsx:3555-3566), whose own comment states the rule this
// spine is built on: "both halves are 13px and only their WEIGHT separates
// them. Weight is the dial here, not size."

/** Card gutter. ⚠ DELIBERATELY THE SAME STRING AS `SECTION_INSET`, so a field
 *  label and a section title sit on ONE left edge. That is why both exist as
 *  named constants rather than as literals typed twice. */
export const CARD_PAD = "px-[14px]";
export const SECTION_INSET = "px-[14px]";

/** picking-board-mobile.tsx:3555 — the stat strip's left half. */
export const FACT_LABEL = "text-[13px] font-medium text-[#667085]";
/** picking-board-mobile.tsx:3559 — the stat strip's right half. */
export const FACT_VALUE = "text-[13px] font-semibold text-[#1d2939]";
/** picker-my-picks-board.tsx:1925 — "a section rule, not a chip". */
export const SECTION_HEAD =
  "text-[11px] font-bold uppercase tracking-[0.06em] text-[#8a929c]";
/** picker-my-picks-board.tsx:1928 — the count opposite it. */
export const SECTION_COUNT = "text-[11px] font-semibold text-[#b6bcc4] tabular-nums";
/** A full-bleed white band on the grey ground, the way Picking's strips sit. */
export const CARD_SURFACE = "bg-white border-y border-gray-200";
/** Between rows INSIDE a card — lighter than the card's own edge, or the card
 *  reads as four cards. */
export const ROW_HAIRLINE = "border-b border-gray-100";

// ═══════════════════════════════════════════════════════════════════════════
// 🔴 THE HEADER STRIP — 15px, AND THE CEILING IS 16
// ═══════════════════════════════════════════════════════════════════════════
//
// "31 Aug 2026 · I536226556 · 60 L" is the most-read line on either screen and
// was set at 12.5px, smaller than the facts underneath it. It steps up to 15px:
// Picking's SLOT-HERO size (picking-board-mobile.tsx card title row), which is
// exactly this role — a prominent value sitting beside a title.
//
// ⚠ NOT 16. That is Picking's CARD TITLE size and it is the ceiling, not the
// target: on these screens 16px/600 is already taken by the CI number in the
// teal header, and a strip that tied with it would leave the screen with two
// loudest things. One step under the ceiling keeps the identity on top.
export const STRIP_MUTED = "text-[15px] font-medium text-[#667085]";
export const STRIP_VALUE = "text-[15px] font-semibold text-[#1d2939]";
/** The unit after a number — always a size down and grey, never the same weight
 *  as the figure it qualifies (picking-board-mobile.tsx:3561). */
export const UNIT_SUFFIX = "text-[11px] font-medium text-[#8a929c]";

// ═══════════════════════════════════════════════════════════════════════════
// 🔴 THE SELECTED CHIP IS PICKING'S TypeFilterPills TOKEN, VERBATIM
// ═══════════════════════════════════════════════════════════════════════════
//
// picking-board-mobile.tsx:1025-1028. A DARK FILL, not a white pill inside a
// grey trough: the segmented control this replaces put white-on-white for the
// selected side, which on a depot phone in daylight is no signal at all — the
// supervisor could not tell which one he had picked.
export const CHIP_BASE =
  "text-[12.5px] font-medium px-3 py-1.5 rounded-full border whitespace-nowrap transition-colors";
export const CHIP_ON = "bg-gray-900 border-gray-900 text-white font-semibold";
export const CHIP_OFF = "bg-white border-gray-200 text-gray-700";

/**
 * One row on the spine: label left, anything right, hairline under.
 *
 * ⚠ THE RIGHT SIDE WRAPS RATHER THAN TRUNCATES. The values here are dates,
 * numbers and reason labels — half of any of those is worse than two lines, and
 * the spine survives a wrap because the right edge is where the TEXT ends, not
 * where the box does.
 */
export function CiSpineRow({
  label,
  children,
  last = false,
  onClick,
}: {
  label: string;
  /** The right-hand side: a value, a pair of chips, a value plus a glyph. */
  children: React.ReactNode;
  /** Drops the hairline on a card's last row. */
  last?: boolean;
  /** Makes the WHOLE ROW the tap target. Used by Reason and Received on — a
   *  value that opens something must be tappable across the row, not only on
   *  the four words themselves. */
  onClick?: () => void;
}): React.JSX.Element {
  const cls =
    CARD_PAD +
    " py-3 flex items-center justify-between gap-4 w-full text-left " +
    (last ? "" : ROW_HAIRLINE);

  const body = (
    <>
      <span className={FACT_LABEL + " shrink-0"}>{label}</span>
      <span className="min-w-0 flex items-center justify-end gap-2 text-right">{children}</span>
    </>
  );

  if (onClick === undefined) return <div className={cls}>{body}</div>;
  return (
    <button type="button" onClick={onClick} className={cls + " active:bg-gray-50"}>
      {body}
    </button>
  );
}

/** A plain read value on the right of a spine row. */
export function CiSpineValue({
  children,
  mono = false,
  muted = false,
}: {
  children: React.ReactNode;
  mono?: boolean;
  /** For a placeholder — "Choose" before a reason is picked. */
  muted?: boolean;
}): React.JSX.Element {
  return (
    <span
      className={
        (muted ? "text-[13px] font-medium text-[#98a2b3]" : FACT_VALUE) +
        " min-w-0 " +
        (mono ? "font-mono" : "")
      }
    >
      {children}
    </span>
  );
}
