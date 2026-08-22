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
// ⚠ #fbbf24, NOT #f59e0b. The darker amber the circle used goes muddy on this
// dark teal. This is also THE ONLY AMBER ON THE DETAIL SCREEN — do not add a
// second one. (The triangle, which lives on this same strip, is white when
// idle and goes amber only WHILE RECORDING IS ARMED, so the two coincide for
// the duration of a mode rather than standing side by side.)

import type { ReactNode } from "react";

/** Caption pair — "BAY" and "ROUTE" are the same type by design. */
const CAPTION_CLASS =
  "text-[8.5px] font-bold uppercase tracking-[0.16em] text-white/50 leading-none";

/**
 * The band under the detail header: bay number · rule · route · triangle.
 *
 * 🔴 WHAT RENDERS WHEN — the rule, in one place:
 *   bayNumber !== null   → number block + rule. Otherwise BOTH are omitted and
 *                          the band shows the route side only.
 *   route === null       → the text block still renders, reading "Unmatched".
 *                          It does NOT collapse. This is the whole reason the
 *                          band exists in the shape it does: the route came OFF
 *                          the header subtitle when this landed, so if an
 *                          unmatched bill also dropped its band the word
 *                          "Unmatched" would vanish from the screen entirely.
 *                          That is a loss of information, not a simplification.
 *   trailing === null    → no triangle. The band still renders.
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
      className="shrink-0 w-full flex items-center gap-3 pl-[14px] pr-[6px] py-[9px]"
      style={{
        background: "#0a5049",
        // A SEAM, not a border. Two teals meeting need a shadow — a 1px border
        // line between them reads as a mistake rather than a division.
        boxShadow: "inset 0 1px 0 rgba(0,0,0,.18)",
      }}
    >
      {bayNumber !== null && (
        <>
          <div className="shrink-0 flex flex-col items-center leading-none">
            <span
              className="text-[30px] font-extrabold tabular-nums leading-none"
              style={{ color: "#fbbf24" }}
            >
              {bayNumber}
            </span>
            <span className={CAPTION_CLASS + " mt-[3px]"}>Bay</span>
          </div>
          {/* 1px rule, stretched to the band's height less a 3px inset top and
              bottom — a divider, not a full-bleed border. */}
          <div
            className="w-px shrink-0 self-stretch my-[3px]"
            style={{ background: "rgba(255,255,255,.2)" }}
            aria-hidden="true"
          />
        </>
      )}
      <div className="min-w-0 flex flex-col">
        <span className={CAPTION_CLASS}>Route</span>
        <span className="text-[15px] font-semibold text-white truncate mt-1">
          {route ?? "Unmatched"}
        </span>
      </div>
      {trailing !== null && <div className="ml-auto shrink-0 flex items-center">{trailing}</div>}
    </div>
  );
}
