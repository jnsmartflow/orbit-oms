"use client";

// ── The bay / route band — DETAIL SCREEN ONLY, both faces ──────────────────
// (2026-08-22) Replaces the 44px amber `BayCircle` that shipped in f7c8d232
// one day earlier. Same field (`route_master.bayNumber`, reached through the
// row's own route in lib/picking/queue.ts), same question — WHICH BAY DO I
// WALK TO — but the answer now sits on its own full-width strip under the
// header instead of squeezing a 44px disc into the header's icon cluster.
//
// ⚠ WHY THIS IS ITS OWN FILE — unchanged from bay-circle.tsx's reasoning.
// BOTH detail headers render it, and it encodes a colour plus an exact
// geometry: precisely the pair that drifts the day someone edits one copy.
// It would naturally live in ./card-atoms.tsx; that file is deliberately out
// of scope (it holds CARD atoms, and nothing here goes on a card), so moving
// it there is a later one-line import swap.
//
// ⚠ THE ROUTE COMES FROM `row.route` AND NOTHING ELSE — the same field the
// card renders and the route filter narrows on. NEVER read
// delivery_point_master.primaryRouteId here: the bay is read through
// area.primaryRoute one line below `route` in queue.ts specifically so the
// number and the name on this strip can never describe different routes.
//
// 🔴 THE BAND IS WHITE (2026-08-22). It shipped one day earlier as a dark
// #0a5049 strip. White puts the bay number on the same ground as everything
// below it and stops the screen reading as two headers stacked.
//
// ⚠ #d97706, NOT #fbbf24, AND THE VALUE IS BOUND TO THE BACKGROUND. #fbbf24 was
// chosen to carry on dark teal and it does not survive white — at arm's length
// from a moving trolley a light amber on white is a smudge, which defeats the
// one thing this number exists for. If the band's background ever changes
// again, this hex changes with it: they are one decision, not two.
//
// ⚠ THE SEAM IS NOW A BORDER, NOT AN INSET SHADOW. A shadow seam is what two
// DARK surfaces need; white meeting white needs a line, and a shadow there
// reads as a smudge rather than a division.

import type { ReactNode } from "react";

/** Caption pair — "BAY" and "ROUTE" are the same type by design. */
const CAPTION_CLASS =
  "text-[8.5px] font-bold uppercase tracking-[0.16em] leading-none";
const CAPTION_COLOR = "#98a2b3";

/**
 * The band under the detail header: bay number · rule · route · triangle.
 *
 * 🔴 WHAT RENDERS WHEN — the rule, in one place:
 *   bayNumber !== null   → number block + rule. Otherwise BOTH are omitted and
 *                          the band shows the route side only.
 *   route === null       → the text block still renders, reading "—".
 *                          It does NOT collapse — that half of the 2026-08-22
 *                          rule is unchanged and still load-bearing: the route
 *                          came OFF the header subtitle when this landed, so a
 *                          band that also collapsed would leave the screen
 *                          saying nothing at all about the lane.
 *   trailing === null    → no triangle. The band still renders.
 *
 * ⚠ IT WAS THE WORD "Unmatched" UNTIL 2026-09-01, and the comment here argued
 * for it. THE OWNER HAS DECIDED OTHERWISE — reviewed on a real phone, along
 * with the short-lived "not in master" card chip (47791643), which was removed
 * in the same pass. Both said the same thing twice and neither earned its
 * space. Two reasons the word is not missed: "Unmatched" sat under a caption
 * reading ROUTE, so it could be read as "no route" rather than "no dealer";
 * and the dealer name in the header above is now the real SAP name
 * (lib/picking/queue.ts's fallback, which STAYS), so the screen no longer has
 * a nameless bill to explain. Finding these bills is the SEARCH BOX's job —
 * typing "unmatched" still returns exactly them (lib/picking/search.ts), and
 * that clause is now the only route to them. Do not re-derive a word or a badge
 * here; see docs/prompts/drafts/code-update-2026-08-31-picking-sap-name-fallback.md §9.
 *
 * The caller decides whether there is a bill at all; this component is not
 * rendered when `detailRow` is null.
 *
 * The route TRUNCATES and the number NEVER SHRINKS — a bay read wrong is a
 * trolley in the wrong aisle, a route name read short is still recognisable.
 */
export function BillBand({
  bayNumber,
  route,
  trailing = null,
}: {
  bayNumber: number | null;
  route: string | null;
  /** The recording triangle, or null. Right-aligned via `ml-auto`. */
  trailing?: ReactNode;
}): React.JSX.Element {
  return (
    <div
      className="shrink-0 w-full flex items-center gap-3 border-b pl-[14px] pr-[6px] py-[9px]"
      style={{ background: "#ffffff", borderColor: "#e7eaee" }}
    >
      {bayNumber !== null && (
        <>
          <div className="shrink-0 flex flex-col items-center leading-none">
            <span
              className="text-[30px] font-extrabold tabular-nums leading-none"
              style={{ color: "#d97706" }}
            >
              {bayNumber}
            </span>
            <span className={CAPTION_CLASS + " mt-[3px]"} style={{ color: CAPTION_COLOR }}>
              Bay
            </span>
          </div>
          {/* 1px rule, stretched to the band's height less a 3px inset top and
              bottom — a divider, not a full-bleed border. */}
          <div
            className="w-px shrink-0 self-stretch my-[3px]"
            style={{ background: "#e7eaee" }}
            aria-hidden="true"
          />
        </>
      )}
      <div className="min-w-0 flex flex-col">
        <span className={CAPTION_CLASS} style={{ color: CAPTION_COLOR }}>
          Route
        </span>
        <span
          className="text-[15px] font-semibold truncate mt-1"
          style={{ color: "#1d2939" }}
        >
          {route ?? "—"}
        </span>
      </div>
      {trailing !== null && <div className="ml-auto shrink-0 flex items-center">{trailing}</div>}
    </div>
  );
}
