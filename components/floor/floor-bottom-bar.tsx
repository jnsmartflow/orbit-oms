"use client";

// Floor Control — THE bottom bar. One bar, one job, two readings (v3 mockup §01/§02).
//
// 🔴 IT REPLACES assign-bar.tsx AND trip-selection-bar.tsx ON THIS SCREEN.
// The old bar offered Change slot, Choose picker and Assign. The desk does none
// of those any more: the slot arrives from the trip, and assigning a picker is
// the supervisor's job on /picking (one bill at a time is still reachable from
// the detail panel). What is left is the one thing the planner actually does
// with a selection — move it on or off a trip.
//
//   pool selected  → + New trip   (an EXISTING trip is clicked on the rail —
//                                  see trip-rail.tsx addMode, 2026-09-16)
//   trip selected  → Remove from trip
//
// ⚠ THE ✕ GLOBAL CLEAR STAYS. `toggleAll()` is PER GROUP and selects-all on a
// partial selection (lib/floor/selection.ts), so a selection spanning two route
// groups or two stops cannot be cleared by any header checkbox. This is the only
// control that clears everything, which is why it is on the bar and not in a
// menu.
//
// ⚠ NO CONFIRM ON EITHER ACTION. Both are reversible in one press — Remove puts
// a bill back in the pool, Add to trip puts it back on one — and neither touches
// the bill's workflowStage. A dialog on an action repeated all afternoon is a
// tax, not a safety net.

export function FloorBottomBar({
  count,
  litres,
  weight,
  weightIsPartial,
  articles,
  routes,
  mode,
  busy,
  newTripBlockedReason,
  addTargetLabel,
  onAddToTarget,
  onNewTripWithSelection,
  onRemoveFromTrip,
  onClear,
  contextLabel,
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
   * therefore a LOWER BOUND. The bar renders "67+ kg" and puts the count on the
   * title.
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
   * Why "+ New trip" cannot be pressed, or null. The one case (owner): the
   * selection MIXES delivery types, and a trip is Local or Upcountry or IGT,
   * never a blend. Naming both types is the point — "a trip is one or the
   * other" without saying which two would send the planner hunting.
   *
   * ⚠ NO FALLBACK TO THE FORM. Opening a form to ask which type is exactly the
   * question this flow exists to remove, and any answer it gave would be a guess.
   */
  newTripBlockedReason: string | null;
  /**
   * The trip number being FILLED — "+ Add bills" was pressed inside it, and the
   * pool is open under its band (trip-add-band.tsx). Null in the ordinary pool.
   *
   * 🔴 IT REPLACES "+ New trip" RATHER THAN JOINING IT (owner): you are filling
   * a trip, not starting one, and the button says exactly what will happen —
   * "Add 2 bills to L-260916-04", with nothing to choose after pressing it.
   */
  addTargetLabel: string | null;
  onAddToTarget: () => void;
  onNewTripWithSelection: () => void;
  onRemoveFromTrip: () => void;
  onClear: () => void;
  /** e.g. "on L-260910-02" — a short reminder of what is selected. */
  contextLabel?: string | null;
}) {
  if (count === 0) return null;

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 flex h-[60px] items-center border-t border-gray-200 bg-white px-[18px] shadow-[0_-6px_18px_-12px_rgba(0,0,0,0.25)]">
      <div className="flex min-w-0 items-center gap-[7px]">
        <span className="whitespace-nowrap text-[13px] font-semibold text-gray-900">
          {count} selected
        </span>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          title="Clear selection"
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        {/* The four numbers a planner checks before a selection goes on a van:
            how much it holds, what it weighs, how many pieces there are to
            stack, and how many parts of town it covers. Litres is what the depot
            talks in; KILOS is what a vehicle's capacity is measured in
            (vehicle_master.capacityKg), which is why the two sit together. */}
        <span className="truncate whitespace-nowrap text-[11px] tabular-nums text-gray-400">
          &middot; {litres} L
          {weight !== null && (
            <span
              title={
                weightIsPartial
                  ? "Some selected bills have no weight recorded — this total is a lower bound"
                  : undefined
              }
            >
              {" · "}
              {weight}
              {weightIsPartial ? "+" : ""} kg
            </span>
          )}
          {articles > 0 && ` · ${articles} article${articles === 1 ? "" : "s"}`}
          {routes > 0 && ` · ${routes} route${routes === 1 ? "" : "s"}`}
          {contextLabel ? ` · ${contextLabel}` : ""}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {mode === "pool" && addTargetLabel !== null ? (
          <button
            type="button"
            onClick={onAddToTarget}
            disabled={busy}
            className="inline-flex h-[34px] items-center rounded-md border border-brand-600 bg-brand-600 px-4 text-[12px] font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
          >
            {busy ? "Working…" : `Add ${count} bill${count === 1 ? "" : "s"} to ${addTargetLabel}`}
          </button>
        ) : mode === "pool" ? (
          <>
            {/* The reason, in the bar as well as on hover — a disabled button
                fires no mouse events, so a tooltip alone can go unread. */}
            {newTripBlockedReason && (
              <span className="max-w-[420px] truncate text-[11.5px] text-[#8a5d0c]" title={newTripBlockedReason}>
                {newTripBlockedReason}
              </span>
            )}
            {/* 🔴 THE ONLY BUTTON LEFT ON THIS BAR (2026-09-16). "Add to trip ▾"
                — a <select> listing every trip by number — is gone: the RAIL is
                the picker now, and it shows the route, the load and the driver
                that the menu never did. An existing trip is a card on the left; a
                new one is this button. Two answers, two places, neither behind a
                menu (owner's design). */}
            <span title={newTripBlockedReason ?? undefined} className="inline-flex">
              <button
                type="button"
                onClick={onNewTripWithSelection}
                disabled={busy || newTripBlockedReason !== null}
                className="inline-flex h-[34px] items-center rounded-md border border-brand-600 bg-brand-600 px-4 text-[12px] font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
              >
                {busy ? "Working…" : "+ New trip"}
              </button>
            </span>
          </>
        ) : (
          <button
            type="button"
            onClick={onRemoveFromTrip}
            disabled={busy}
            className="inline-flex h-[34px] items-center rounded-md border border-[#d6a3a3] bg-white px-4 text-[12px] font-semibold text-[#b91c1c] hover:bg-[#fef2f2] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Working…" : "Remove from trip"}
          </button>
        )}
      </div>
    </div>
  );
}
