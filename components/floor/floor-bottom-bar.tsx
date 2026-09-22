"use client";

// Floor Control — THE bottom bar. One bar, one job, two readings (v3 mockup §01/§02).
//
// 🔴 IT REPLACES assign-bar.tsx AND trip-selection-bar.tsx ON THIS SCREEN.
// The old bar offered Change slot, Choose picker and Assign. The desk does none
// of those any more: the slot arrives from the trip, and assigning a picker is
// the supervisor's job on /picking (one bill at a time is still reachable from
// the detail panel). What is left is the one thing the planner actually does
// with a selection — move it on or off a trip — plus ··· More.
//
//   pool selected  → + New trip   (an EXISTING trip is clicked on the rail —
//                                  see trip-rail.tsx addMode, 2026-09-16)
//   trip selected  → Remove from trip
//   either         → ··· More → Hold (bulk, 8 s Undo — floor-page.tsx bulkHold)
//
// 🔴 IT RENDERS INSIDE THE BILLS COLUMN (2026-09-22). floor-page builds it and
// TripDesk places it in its `relative` bills column, so it never runs under the
// trip rail. The shell (size, figures, ✕ Clear, the menu) is floor-action-bar.tsx,
// shared with the Hold tab's bar.
//
// ⚠ ONE BRAND BUTTON: the main CTA — "+ New trip", "Remove from trip" or
// "Add N bills to {trip}". floor-page greys the tab row's own "+ New trip" while
// this bar is up, so only one brand button is ever on screen (CLAUDE_UI §10).
//
// ⚠ NO CONFIRM ON THE CTA. Remove puts a bill back in the pool, Add to trip puts
// it back on one — both reversible in one press, neither touches the bill's
// workflowStage. A dialog on an action repeated all afternoon is a tax, not a
// safety net. Hold has no confirm either: its toast carries an Undo.

import { Pause } from "lucide-react";
import { FloorActionBar, MoreMenu, BarDivider, BAR_PRIMARY, type BarFigure } from "./floor-action-bar";

export function FloorBottomBar({
  count,
  litres,
  weight,
  weightIsPartial,
  articles,
  routes,
  mode,
  busy,
  addTargetLabel,
  onAddToTarget,
  onNewTripWithSelection,
  onRemoveFromTrip,
  onClear,
  contextLabel,
  menuOpen,
  onMenuOpenChange,
  onHold,
}: {
  count: number;
  /** Already formatted by the caller through formatLitres. */
  litres: string;
  /**
   * Already formatted by the caller through formatWeightKg. NULL when NO
   * selected bill has a recorded weight, and then the bar prints no kg at all
   * rather than "0 kg" — see formatWeightKg for why zero is not a weight.
   */
  weight: string | null;
  /**
   * 🔴 TRUE WHEN AT LEAST ONE SELECTED BILL HAS NO WEIGHT, and the total is
   * therefore a LOWER BOUND. The bar renders "67+ kg" and says so on the title.
   *
   * This exists because the alternative is silent under-counting. A planner
   * checks a selection against `vehicle_master.capacityKg` before putting it on
   * a van; a total that quietly omitted three bills would say the load fits when
   * it does not. Nothing here estimates the missing weight — a "+" is the honest
   * width of what we know.
   */
  weightIsPartial: boolean;
  /** Physical pieces across the selection, from countArticles. */
  articles: number;
  /** How many distinct routes the selection spans. */
  routes: number;
  /** Which reading — decided by the rail's selection, not by the rows. */
  mode: "pool" | "trip";
  busy: boolean;
  /**
   * The trip number being FILLED — "+ Add bills" was pressed inside it, and the
   * pool is open under its band (trip-add-band.tsx). Null in the ordinary pool.
   *
   * 🔴 IT REPLACES "+ New trip" RATHER THAN JOINING IT (owner): you are filling
   * a trip, not starting one, and the button says exactly what will happen —
   * "Add 2 bills to L-260916-04", with nothing to choose after pressing it.
   *
   * ⚠ IT ALSO REPLACES "Remove from trip", AND IT IS READ BEFORE `mode`. The
   * rail stays on the trip being filled, so `mode` says "trip" throughout;
   * Remove must never appear under the add band (owner, 2026-09-18).
   */
  addTargetLabel: string | null;
  onAddToTarget: () => void;
  onNewTripWithSelection: () => void;
  onRemoveFromTrip: () => void;
  onClear: () => void;
  /** e.g. "on L-260910-02" — a short reminder of what is selected. */
  contextLabel?: string | null;
  /** ··· More — controlled by floor-page, the single Esc owner. */
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  /** Hold every ticked bill (floor-page.tsx bulkHold). */
  onHold: () => void;
}) {
  // The four numbers a planner checks before a selection goes on a van: how
  // much it holds, what it weighs, how many pieces there are to stack, and how
  // many parts of town it covers. Litres is what the depot talks in; KILOS is
  // what a vehicle's capacity is measured in (vehicle_master.capacityKg), which
  // is why the two sit together.
  const figures: BarFigure[] = [{ key: "l", value: litres, unit: "L" }];
  if (weight !== null) {
    figures.push({
      key: "kg",
      value: `${weight}${weightIsPartial ? "+" : ""}`,
      unit: "kg",
      title: weightIsPartial ? "Some selected bills have no weight recorded — this total is a lower bound" : undefined,
    });
  }
  if (articles > 0) figures.push({ key: "art", value: String(articles), unit: articles === 1 ? "article" : "articles" });
  if (routes > 0) figures.push({ key: "rt", value: String(routes), unit: routes === 1 ? "route" : "routes" });

  // 🔴 THE TARGET WINS OVER THE MODE (2026-09-18). "+ Add bills" keeps the rail
  // on the trip, so `mode` is "trip" for the whole of targeted add — and this
  // branch used to require "pool", which put "Remove from trip" under the pink
  // band from the day it shipped (6136b423). While a named trip is being filled
  // the bar ADDS, and nothing else.
  const cta =
    addTargetLabel !== null ? (
      <button type="button" onClick={onAddToTarget} disabled={busy} className={BAR_PRIMARY}>
        {busy ? "Working…" : `Add ${count} bill${count === 1 ? "" : "s"} to ${addTargetLabel}`}
      </button>
    ) : mode === "pool" ? (
      // ⚠ NEVER DISABLED BY A MIXED SELECTION (owner, 2026-09-18). A trip may
      // carry Local and Upcountry bills on one truck; the number takes the
      // majority type's letter (lib/trips/type-choice.ts).
      <button type="button" onClick={onNewTripWithSelection} disabled={busy} className={BAR_PRIMARY}>
        {busy ? "Working…" : "+ New trip"}
      </button>
    ) : (
      // Brand since 2026-09-22 — inside a trip, taking bills off is the state's
      // real job, so it is the one brand button (CLAUDE_UI §10).
      <button type="button" onClick={onRemoveFromTrip} disabled={busy} className={BAR_PRIMARY}>
        {busy ? "Working…" : "Remove from trip"}
      </button>
    );

  return (
    <FloorActionBar count={count} figures={figures} extra={contextLabel ?? undefined} onClear={onClear}>
      {cta}
      <BarDivider />
      <MoreMenu
        open={menuOpen}
        onOpenChange={onMenuOpenChange}
        disabled={busy}
        items={[
          {
            key: "hold",
            label: "Hold",
            hint: "Off the floor until released · Undo for 8s",
            icon: <Pause size={15} strokeWidth={2.2} />,
            onSelect: onHold,
          },
        ]}
      />
    </FloorActionBar>
  );
}
