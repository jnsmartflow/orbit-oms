"use client";

import { Check } from "lucide-react";

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
export const CARD_PAD = "px-4";
export const SECTION_INSET = "px-4";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 EVERY SPINE ROW IS THE SAME HEIGHT (step 12)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 60px minimum, 16px padding. The Material row used to carry a pair of CHIPS,
 * which set their own height and pushed that row taller than the two beside it
 * — and an uneven row in a card of four reads as a broken card, not as
 * emphasis. With Material now a value-plus-chevron row like Reason, the three
 * are the same object and must measure the same.
 *
 * ⚠ THIS APPLIES TO BOTH SCREENS. submitted-detail.tsx renders the same rows,
 * read rather than typed, so the height lives here and not at either call site.
 */
export const ROW_BASE =
  "min-h-[60px] px-4 py-4 flex items-center justify-between gap-4 w-full text-left";

/** The affordance glyph at the end of a row that opens something — one size and
 *  one colour, so a chevron and a calendar never disagree. */
export const ROW_GLYPH = "text-[#98a2b3] shrink-0";
export const ROW_GLYPH_SIZE = 15;

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
  overlay,
}: {
  label: string;
  /** The right-hand side: a value, or a value plus its affordance glyph. */
  children: React.ReactNode;
  /** Drops the hairline on a card's last row. */
  last?: boolean;
  /** Makes the WHOLE ROW the tap target. A value that opens something must be
   *  tappable across the row, not only on the four words themselves. */
  onClick?: () => void;
  /**
   * An absolutely-positioned control laid over the whole row — the native date
   * input, which is the one case a plain `onClick` cannot serve.
   *
   * ⚠ MUTUALLY EXCLUSIVE WITH `onClick` by construction: a row with an overlay
   * renders a <div>, because a form control inside a <button> is invalid HTML
   * and the outer button would swallow the tap before the input ever saw it.
   */
  overlay?: React.ReactNode;
}): React.JSX.Element {
  const cls = ROW_BASE + " " + (last ? "" : ROW_HAIRLINE);

  const body = (
    <>
      <span className={FACT_LABEL + " shrink-0"}>{label}</span>
      <span className="min-w-0 flex items-center justify-end gap-2 text-right">{children}</span>
    </>
  );

  if (overlay !== undefined) {
    return (
      <div className={cls + " relative"}>
        {body}
        {overlay}
      </div>
    );
  }
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

// ═══════════════════════════════════════════════════════════════════════════
// 🔴 THE HEADER STRIP — ONE IMPLEMENTATION, TWO SCREENS (step 12)
// ═══════════════════════════════════════════════════════════════════════════
//
// new-return.tsx and submitted-detail.tsx each hand-rolled this band. They
// shared the TOKENS after step 11 but not the MARKUP, and that gap is where the
// stray separator lived: the entry step laid out
//
//     date  ·  invoice  ·  [ml-auto] litres
//
// so the second "·" stayed with the text on the left while the litres were
// pushed to the right edge — leaving a separator dangling after the invoice
// number, pointing at nothing, and the litres carrying none at all.
//
// 🔴 SEPARATORS ONLY EVER SIT BETWEEN TWO THINGS ON THE SAME SIDE. The left
// group owns its one "·" and nothing else does; the right-hand value is a
// separate group and takes no leading separator. Written once here so the fix
// cannot be applied to one screen and forgotten on the other.
export function CiHeaderStrip({
  isoDate,
  invoiceNo,
  litres,
}: {
  /** A date-only string or a full instant; both are handled. */
  isoDate: string | null;
  /** A blank invoice is NORMAL — 5% of dispatched bills have none when the CI
   *  is raised and SAP sends it later. Said in words, never an em-dash. */
  invoiceNo: string | null;
  litres: number;
}): React.JSX.Element {
  return (
    <div className="bg-white border-b border-gray-200 shrink-0 px-4 py-3 flex items-center gap-3">
      {/* ONE group, so its separator always has something on both sides. */}
      <span className={STRIP_MUTED + " truncate min-w-0"}>
        {formatCiDay(isoDate)}
        <span className="text-[#c3c9d0]">{" · "}</span>
        {invoiceNo ?? "No invoice yet"}
      </span>
      {/* A SEPARATE group at the right edge — NO leading separator. */}
      <span className={STRIP_VALUE + " tabular-nums shrink-0 ml-auto"}>
        {litres}
        <span className={UNIT_SUFFIX}>{" L"}</span>
      </span>
    </div>
  );
}

/**
 * "31 Aug 2026" from a date-only string or a full instant. Blank → em-dash.
 *
 * ⚠ ONE FORMATTER, NOT TWO. details-step.tsx and submitted-detail.tsx each
 * carried a byte-identical copy of this, one of them with a comment promising it
 * "matches the other exactly" — which is a promise a second copy cannot keep.
 * The two screens must never print a date differently.
 */
export function formatCiDay(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔴 SHEET OPTION ROWS — SHARED BY THE REASON AND MATERIAL PICKERS (step 12)
// ═══════════════════════════════════════════════════════════════════════════
//
// Material became a sheet in step 12, and the instruction was explicit: use THE
// SAME CiSheet the reason picker uses, not a second sheet implementation. The
// shell was already shared (components/ci/sheet.tsx); its ROWS were not, so a
// second picker would have re-typed the row padding, the 15px label and the
// tick. These are those, once.
export const SHEET_TITLE = "px-4 pb-2 text-[15px] font-semibold text-gray-900";
/** A note inside a sheet — loading, or an error. Colour is the caller's, since
 *  "could not load" and "still loading" are different things to say. */
export const SHEET_NOTE = "px-4 py-6 text-[13px]";
/** A text ACTION inside a sheet ("More") — the option row's size, in teal. */
export const SHEET_ACTION =
  "w-full text-left px-4 py-3.5 text-[15px] font-semibold text-teal-700 active:bg-gray-50";

/** A typed value. FACT_VALUE's size and colour WITHOUT its weight: what he has
 *  typed is not yet a recorded fact, and bolding a draft overstates it. */
export const INPUT_TEXT = "text-[13px] text-[#1d2939] bg-transparent outline-none";

export function CiSheetOption({
  label,
  selected,
  onPick,
}: {
  label: string;
  selected: boolean;
  onPick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onPick}
      className="w-full text-left px-4 py-3.5 flex items-center justify-between gap-3 active:bg-gray-50"
    >
      <span className="text-[15px] text-gray-900 truncate min-w-0">{label}</span>
      {selected && <Check size={16} className="text-teal-600 shrink-0" strokeWidth={2.6} />}
    </button>
  );
}
