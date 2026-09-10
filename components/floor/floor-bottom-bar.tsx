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
//   pool selected  → Add to trip ▾ , with New trip… at the bottom of the list
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

import type { TripSummary } from "@/lib/trips/queries";

export function FloorBottomBar({
  count,
  litres,
  weight,
  weightIsPartial,
  articles,
  routes,
  mode,
  trips,
  busy,
  onAddToTrip,
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
  /** Draft and confirmed trips only. Empty is fine — New trip… still shows. */
  trips: TripSummary[];
  busy: boolean;
  onAddToTrip: (tripId: number) => void;
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
        {mode === "pool" ? (
          // A <select> that fires on change and resets itself — an ACTION, not a
          // stored choice. Leaving a trip selected in it would read as "these
          // bills are on that trip" once the board refetches.
          <select
            aria-label="Add the selected bills to a trip"
            disabled={busy}
            value=""
            onChange={(e) => {
              const v = e.target.value;
              e.currentTarget.value = "";
              if (v === "__new__") onNewTripWithSelection();
              else {
                const id = Number(v);
                if (Number.isInteger(id) && id > 0) onAddToTrip(id);
              }
            }}
            className="h-[34px] cursor-pointer rounded-md border border-brand-600 bg-brand-600 px-3 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
          >
            <option value="">{busy ? "Working…" : "Add to trip ▾"}</option>
            {trips.map((t) => (
              <option key={t.id} value={t.id} className="bg-white text-gray-900">
                {t.tripNumber}
                {t.windowTime ? ` · ${t.windowTime}` : ""}
                {t.vehicleNo ?? t.adhocVehicleNo ? ` · ${t.vehicleNo ?? t.adhocVehicleNo}` : ""}
                {` · ${t.counts.total} bill${t.counts.total === 1 ? "" : "s"}`}
              </option>
            ))}
            {/* Last, deliberately — the common case is an existing trip, and a
                planner reaching the end of the list is the one who needs a new
                one. It opens the same form the New trip button does and adds the
                selection when the trip is created. */}
            <option value="__new__" className="bg-white text-gray-900">
              New trip…
            </option>
          </select>
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
