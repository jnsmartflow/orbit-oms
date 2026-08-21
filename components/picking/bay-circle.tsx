"use client";

// ── The loading-bay circle — DETAIL SCREEN ONLY, both faces ────────────────
// (2026-08-21) `route_master.bayNumber`, reached through the row's own route
// (lib/picking/queue.ts). It answers the one question a picker has the moment
// he opens a bill: WHICH BAY DO I WALK TO.
//
// ⚠ WHY THIS IS ITS OWN FILE. It is rendered by BOTH detail headers
// (picking-board-mobile.tsx and picker-my-picks-board.tsx), and it encodes a
// colour plus an exact geometry — precisely the pair that drifts the day
// someone edits one copy. The module's usual home for that is
// ./card-atoms.tsx, which was explicitly out of scope for the commit that
// introduced this; moving it there later is a one-line import swap and a
// row in CLAUDE_PICKING.md §8. Do not solve this by re-typing #f59e0b at a
// call site — that is the exact mistake components/shared/duplicate-so-tag.tsx
// exists to prevent.
//
// 🔴 NULL RENDERS NOTHING. No circle, no wrapper, no dash, no placeholder, no
// zero-width box. `return null` produces no DOM node at all, so the header's
// `gap-2.5` is not spent on it and a HAND / No Route bill renders a header
// byte-identical to the one it had before this shipped. That is also why the
// call sites render `<BayCircle …/>` BARE, with no conditional wrapper span:
// a wrapper WOULD be a real flex child and would eat the gap. (The SMU badge on
// the CARD needed one only because it wraps a second element beside it — a
// different problem, same trap; see picking-board-mobile.tsx's whereRightNode.)
//
// ⚠ AMBER (#f59e0b) IS USED HERE AND NOWHERE ELSE ON A PICKING SURFACE — do not
// put it on a card. The cards already carry an amber age badge (CLAUDE_UI.md
// §62.1) and an amber urgent bolt; a second amber object there would read as a
// second warning. On the detail header it is the only warm colour, which is
// what makes it findable across a warehouse.
//   Known, accepted overlap: the picker header's FindingTriangleButton turns
//   amber WHILE RECORDING IS ARMED (finding-recorder.tsx — `bg-[#fbbf24]/30`).
//   Un-armed it is frosted white, so the two coincide only in record mode, and
//   the triangle is a translucent 30% wash against this solid fill. Noted so
//   nobody reads it as a violation of the one-amber rule.
//
// ⚠ FONT-WEIGHT 800 IS DELIBERATE AND IS NOT A §60 VIOLATION. CLAUDE_UI.md §60's
// "nothing is 700" rule governs mobile CARDS, where competing weights make a
// list read dense. This is a detail-screen HEADER, whose title is already
// `font-extrabold` (800) on both faces. Do not "fix" it down to 600.

/**
 * 44x44 solid amber disc: the bay number over the word BAY.
 *
 * Sits at the right end of the teal detail header, in the same cluster as the
 * search / kebab / findings controls, on both boards.
 */
export function BayCircle({ bayNumber }: { bayNumber: number | null }): React.JSX.Element | null {
  if (bayNumber === null) return null;
  return (
    <div
      // 44px is the tap-target floor CLAUDE_UI.md §60 sets for controls. This is
      // NOT a control — no handler, no button element — but it borrows the size
      // because the number has to be readable at arm's length from a trolley,
      // and matching an existing figure beats inventing one.
      className="w-11 h-11 rounded-full bg-[#f59e0b] shrink-0 flex flex-col items-center justify-center leading-none"
      aria-label={`Loading bay ${bayNumber}`}
    >
      <span className="text-[19px] font-extrabold text-white tabular-nums">{bayNumber}</span>
      <span className="text-[7.5px] font-bold uppercase tracking-[0.09em] text-white opacity-80 mt-px">
        Bay
      </span>
    </div>
  );
}
