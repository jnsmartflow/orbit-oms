"use client";

import { ChevronRight } from "lucide-react";

// The CI list card — shared by BOTH supervisor tabs.
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴 THIS IS PICKING'S CARD, SLOT FOR SLOT (2026-09-01, step 9).
// ═══════════════════════════════════════════════════════════════════════════
//
// Not "like" Picking's, and not the mockup's. The owner saw both on a real
// phone and ruled that CI's card and Picking's card are the SAME OBJECT, so the
// anatomy is copied from components/picking/picking-board-mobile.tsx's
// PickingCard (its render body) and components/picking/card-atoms.tsx's
// CardShelf, and CI's data is mapped onto those slots:
//
//   ROW 1 · caption   mono identifier (11.5px, #98a0aa) · secondary (#98a2b3)
//                     OBD · invoice date        (search)
//                     CI number · time          (Submitted)
//   ROW 2 · title     the DEALER NAME, 16px/600 #1d2939, truncating,
//                     with a right-hand value that never truncates
//                     → the volume, "120 L"
//   ROW 3 · meta      the second identifier, 12px #667085, truncating
//                     · right end: the STATUS PILL
//                     invoice no  · (no pill — a bill has no status)  (search)
//                     OBD number  · With billing / Done               (Submitted)
//   ROW 4 · shelf     the grey band (#f6f8fa, border-t #eef1f4) carrying chips
//                     that scroll under a fade, with the CHEVRON at its right
//                     → "12 lines", "Full bill" / "Part"
//
// ⚠ WHERE CI DIVERGES FROM PICKING, AND WHY — three places, all forced:
//
//   1. NO RouteDot before the meta text. The dot keys on `deliveryType`
//      (card-atoms.tsx, CLAUDE_UI.md §62.3), which is a property of a DISPATCH.
//      A CI is not dispatched, so there is no value to colour it by and a
//      decorative dot would be inventing a signal.
//   2. THE CHEVRON IS A CUE, NOT A BUTTON. Picking's is a real control because
//      an Assign card's BODY toggles selection, so detail needs its own target.
//      CI cards have no selection — the whole card opens — so a second tap
//      target for the same action would be noise. Same 30px #eceff3 circle and
//      the same 16px #8b93a0 ChevronRight, `pointer-events-none`, so the tap
//      lands on the card.
//   3. NO `variant`. Picking has five (assign, assignLocked, picking,
//      doneCheck, doneChecked) because one board shows a bill at five stages.
//      CI shows two things — a bill you might return, and a return — and the
//      difference is carried by the PILL and the CHIPS, which is what those
//      slots are for.
//
// ⚠ SHARED, NOT COPIED, ACROSS THE TWO CI TABS — and that does not contradict
// components/ci/line-list.tsx's "COPIED, NOT IMPORTED". That rule is about
// crossing MODULE lines: picking does not export PickingCard, and MRN's row is
// module-private, so CI carries its own copy of each. Tokens travel between
// modules; components do not. Within ONE module, two screens rendering one
// object share it — the precedent components/ci/sheet.tsx set — because the
// alternative is what actually happened in step 7c, when the search card was
// rebuilt and the Submitted card silently stayed behind.

/** Picking's card shadow, verbatim (card-atoms.tsx:240). */
const CARD_SHADOW_V2 = "0 1px 2px rgba(16,24,40,.03), 0 14px 26px -20px rgba(16,24,40,.2)";

/** `.chip` tones. Neutral is Picking's FamilyChip; the other two are the CI
 *  mockup's amber/green, used only for a status pill. */
export type CiChipTone = "neutral" | "amber" | "green" | "violet";

const PILL_TONE: Record<CiChipTone, string> = {
  neutral: "bg-[#EDF1F2] text-[#5C666E]",
  amber: "bg-[#FDF4E3] text-[#A8620A]",
  green: "bg-[#E7F6EE] text-[#0A7C4A]",
  violet: "bg-[#F5F1FE] text-[#6941C6]",
};

export function CiResultCard({
  identifier,
  caption,
  name,
  value,
  meta,
  pillLabel,
  pillTone = "neutral",
  chips,
  onClick,
}: {
  /** Row 1 left, mono — the OBD on search, the CI number on Submitted. */
  identifier: string;
  /** Row 1 right of the dot — a date or a time. */
  caption: string;
  /** Row 2 — the dealer. The reason this is a card and not a list row. */
  name: string;
  /** Row 2's right end. Never truncates; the name truncates first. */
  value: string;
  /** Row 3 left — the OTHER identifier. */
  meta: string;
  /** Row 3's right end. Omitted on a card with no status (a bill). */
  pillLabel?: string;
  pillTone?: CiChipTone;
  /** Row 4 — the shelf. Rendered verbatim, in order; no formatting happens
   *  here. An empty array still renders the shelf, because the CHEVRON lives in
   *  it and a card without one would lose its "this opens" cue. */
  chips: readonly string[];
  onClick: () => void;
}): React.JSX.Element {
  return (
    <div className="relative mb-[11px]">
      <div
        className="relative rounded-[20px] overflow-hidden cursor-pointer border-[1.5px] bg-white border-[#eceef2]"
        style={{ boxShadow: CARD_SHADOW_V2 }}
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
      >
        <div className="flex items-start gap-3 px-4 pt-3.5 pb-3">
          <div className="flex-1 min-w-0">
            {/* ── ROW 1 · caption ─────────────────────────────────────────── */}
            <div className="flex items-center justify-between gap-2.5 mb-1.5">
              <span className="flex items-center gap-1.5 min-w-0 text-[11.5px] overflow-hidden whitespace-nowrap text-[#98a2b3]">
                <span className="font-mono shrink-0 text-[#98a0aa]">{identifier}</span>
                {caption !== "" && (
                  <>
                    <span className="shrink-0 text-[#d8dce1]">&middot;</span>
                    <span className="truncate">{caption}</span>
                  </>
                )}
              </span>
            </div>

            {/* ── ROW 2 · title ───────────────────────────────────────────── */}
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[16px] font-semibold leading-[1.25] truncate min-w-0 text-[#1d2939]">
                {name}
              </span>
              {/* `shrink-0` — the value is never the piece that gets clipped;
                  a long dealer name truncates instead. Picking's slot hero. */}
              <span className="text-[15px] font-semibold tabular-nums shrink-0 text-[#475467]">
                {value}
              </span>
            </div>

            {/* ── ROW 3 · meta ────────────────────────────────────────────── */}
            <div className="flex items-center justify-between gap-2.5 mt-1.5">
              <span className="text-[12px] font-medium truncate min-w-0 text-[#667085]">
                {meta}
              </span>
              {pillLabel !== undefined && (
                <span
                  className={
                    "shrink-0 whitespace-nowrap rounded-full px-2 py-[3px] text-[10.5px] font-semibold " +
                    PILL_TONE[pillTone]
                  }
                >
                  {pillLabel}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── ROW 4 · the shelf ───────────────────────────────────────────── */}
        <div
          className="border-t px-[14px] flex items-stretch gap-1"
          style={{ background: "#f6f8fa", borderColor: "#eef1f4" }}
        >
          <div className="relative flex-1 min-w-0 flex items-center py-[10px]">
            <div
              className="flex flex-nowrap gap-1.5 overflow-x-auto pr-[26px] w-full [&::-webkit-scrollbar]:hidden"
              style={{ scrollbarWidth: "none" }}
            >
              {/* Keyed by index+label, not by label alone: a caller-supplied
                  list can legitimately repeat a value. Picking's rule. */}
              {chips.map((label, i) => (
                <span
                  key={`${i}-${label}`}
                  className="shrink-0 whitespace-nowrap text-[10.5px] font-semibold rounded-[7px] py-[3px] px-[8px] text-[#667085] bg-[#eef1f5]"
                >
                  {label}
                </span>
              ))}
            </div>
            {/* The fade cue — chips dissolve under it into the chevron. Both
                stops are the band colour, so it fades to itself. */}
            <div
              className="absolute top-0 right-0 w-[30px] h-full pointer-events-none"
              style={{
                background: "linear-gradient(90deg, rgba(246,248,250,0), #f6f8fa 72%)",
              }}
              aria-hidden="true"
            />
          </div>
          {/* ⚠ A CUE, NOT A CONTROL — see this file's header. `pointer-events-none`
              so the tap falls through to the card. */}
          <span
            className="shrink-0 self-stretch min-h-[44px] min-w-[44px] pl-1.5 flex items-center justify-center pointer-events-none"
            aria-hidden="true"
          >
            <span
              className="w-[30px] h-[30px] rounded-full flex items-center justify-center shrink-0"
              style={{ background: "#eceff3" }}
            >
              <ChevronRight size={16} style={{ color: "#8b93a0" }} />
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
