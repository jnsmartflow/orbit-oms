"use client";

// Floor Control — the trip header in the MIDDLE, above its bills (v3 mockup §02).
//
// Number · type · slot · Ready/Dispatched chip on line one; vehicle /
// transporter / driver and the totals on line two; the four-colour bar with its
// legend; then the action row.
//
// ⚠ THE ACTIONS ARE THE WHOLE TRIP'S, and they live here rather than on the rail
// card because the card is a summary the operator scans and this is the thing he
// is working on.
//
// 🔴 THE ROW IS  Add bills | Set vehicle | ···  (slice 7, 2026-09-15).
//   - MARK DISPATCHED IS NOT HERE. The planner at this desk cannot see whether a
//     truck left; the supervisor standing next to it can. Finishing the loading
//     on the supervisor's future loading screen is what will mark the bills
//     dispatched — through POST /api/floor/trips/[id]/dispatch, which is KEPT
//     for that screen. The not-dispatched banner and its "press again" wording
//     went with the button.
//   - "Set vehicle", not "Change vehicle": one name for one action, which both
//     sets a missing vehicle and changes a present one.
//   - CANCEL TRIP IS BEHIND ···. A destructive action does not belong one button
//     away from Add bills.
//   - NO "Hand off" GROUP YET. Show to floor is slice 8 and Send to billing is
//     slice 9; the group appears when it has something in it.
//
// ⚠ KNOWN AND ACCEPTED UNTIL THE LOADING SCREEN (owner, slice 7): with nothing on
// the floor writing the dispatch, no trip closes. So the Dispatched chip does
// not appear on new trips, and Add bills / Set vehicle / Cancel stay offered on
// a truck that has already left. Slice 10 handles the board.
//
// 🔴 NO CONFIRM PLAN BUTTON, NO "Draft", NO "Confirmed" (slice 6, 2026-09-15).
// Entering a vehicle is what moves a trip out of draft now, on the server. A
// trip with no vehicle says "Vehicle not set" in amber on line two.
//
// ⚠ A CANCELLED OR DISPATCHED TRIP OFFERS NOTHING. Every write path refuses both
// server-side; showing buttons that will 409 is worse than showing none.
//
// ⚠ NO Esc HANDLER FOR THE ··· MENU. floor-page.tsx is the single window-level Esc
// owner for the floor tree (FLOOR §4.6). The menu closes on a click outside —
// the same transparent-backdrop pattern detail-panel.tsx's ⋯ menu uses — and on
// choosing its item.

import { useState, type ReactNode } from "react";
import { ProgressBar } from "./progress-bar";
import { formatLitres } from "./status-pill";
import { toStatusCounts, tripStateMeta } from "./trip-rail";
import type { TripSummary } from "@/lib/trips/queries";

const ACTION =
  "inline-flex h-[28px] items-center rounded-[7px] border border-gray-300 bg-white px-3 text-[11.5px] font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";

export function TripDetailHeader({
  trip,
  busy,
  readOnly,
  onAddBills,
  onChangeVehicle,
  onCancelTrip,
  recent,
}: {
  trip: TripSummary;
  busy: boolean;
  /** History — a past day is a record, not a thing to edit. */
  readOnly: boolean;
  /** Switches the rail back to the pool, where bills are ticked. */
  onAddBills: () => void;
  /** Opens the vehicle editor — labelled "Set vehicle" (slice 7). */
  onChangeVehicle: () => void;
  onCancelTrip: () => void;
  /**
   * The trip's last two or three activity lines (2026-09-14, slice 2).
   *
   * ⚠ A NODE, NOT DATA. This component composes the header; it does not decide
   * what a history line says. lib/trips/activity.ts writes every summary at the
   * source and components/floor/trip-history.tsx renders it — passing rows here
   * would put a second spelling of the same event in a second file, which is
   * the drift that let the release toast and the release button disagree before
   * slice 1.
   */
  recent?: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const counts = toStatusCounts(trip.counts, trip.dispatchedCount);
  const chip = tripStateMeta(trip);
  const vehicle = trip.vehicleNo ?? trip.adhocVehicleNo;
  const isClosed = trip.status === "cancelled" || trip.status === "dispatched";

  // Line two — everything known about who is carrying it, then the totals.
  // Blanks are dropped rather than rendered as dashes, EXCEPT the vehicle: since
  // slice 6 a missing vehicle is said out loud, "Vehicle not set" in amber, the
  // same words the rail card uses. The transporter and driver stay silent.
  const whoBits = [trip.transporterName, trip.driverName].filter(Boolean) as string[];
  // ⚠ AN EMPTY TRIP SAYS SO, here as on the rail card (2026-09-10 c). Three
  // zeroes in a row read as a rendering fault rather than as a fact, and an
  // empty trip is a normal morning state — the floor plans trucks before the
  // bills exist.
  const isEmpty = counts.total === 0;
  const totalBits = isEmpty
    ? ["No bills yet"]
    : [
        `${trip.dropCount} stop${trip.dropCount === 1 ? "" : "s"}`,
        `${counts.total} bill${counts.total === 1 ? "" : "s"}`,
        `${formatLitres(trip.totalLitres)} L`,
      ];

  return (
    <div className="border-b border-gray-200 px-4 pb-3 pt-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="rounded-[6px] bg-gray-900 px-2.5 py-[3px] font-mono text-[12px] font-semibold tracking-[0.02em] text-white">
          {trip.tripNumber}
        </span>
        <span className="text-[12.5px] text-gray-500">
          {trip.deliveryTypeName ?? trip.typeCode}
          {/* The slot when set, and nothing when not (slice 6) — no "no slot yet". */}
          {trip.windowTime ? ` · ${trip.windowTime}` : ""}
        </span>
        {chip && (
          <span
            className={`rounded-full px-2.5 py-[3px] text-[10px] font-bold uppercase tracking-[0.07em] ${chip.cls}`}
          >
            {chip.label}
          </span>
        )}
      </div>

      <div className="mt-1.5 text-[12px] text-gray-600">
        {vehicle ? (
          <span className="font-semibold text-gray-900">{vehicle}</span>
        ) : (
          <span className="font-semibold text-[#b45309]">Vehicle not set</span>
        )}
        {whoBits.length > 0 && <>{" · "}{whoBits.join(" · ")}</>}
        {trip.driverPhone ? ` ${trip.driverPhone}` : ""}
        <span className="mx-1.5 text-gray-300">·</span>
        <span className="tabular-nums">{totalBits.join(" · ")}</span>
        {trip.transporterTripNo && (
          <>
            <span className="mx-1.5 text-gray-300">·</span>
            <span className="text-gray-500">their no. {trip.transporterTripNo}</span>
          </>
        )}
      </div>

      {trip.note && <div className="mt-1 text-[11.5px] italic text-gray-400">{trip.note}</div>}

      {counts.total > 0 && (
        <>
          <ProgressBar counts={counts} className="mt-2.5 !h-2" />
          <div className="mt-1.5 flex flex-wrap gap-3 text-[11.5px] tabular-nums text-gray-600">
            {/* 🔴 DISPATCHED LEADS, AND IT IS ITS OWN WORD (2026-09-14). The bar
                read "8 done" while two of those eight wore a Dispatched pill one
                column over — `bucketFor` folds the two stages into `checked` so
                `isReady` keeps working, and the legend was printing that fold as
                a single state. ⚠ Since slice 7 nothing on the floor writes the
                stage, so this entry appears only on trips whose bills were
                dispatched before, or by the future loading screen. */}
            {counts.dispatched > 0 && (
              <span>
                <i className="mr-1.5 inline-block h-2 w-2 rounded-[3px] bg-[#94a3b8]" />
                <b className="font-bold">{counts.dispatched}</b> dispatched
              </span>
            )}
            {counts.done > 0 && (
              <span>
                <i className="mr-1.5 inline-block h-2 w-2 rounded-[3px] bg-[#22c55e]" />
                <b className="font-bold">{counts.done}</b> done
              </span>
            )}
            {counts.needsCheck > 0 && (
              <span>
                <i className="mr-1.5 inline-block h-2 w-2 rounded-[3px] bg-[#fbbf24]" />
                <b className="font-bold">{counts.needsCheck}</b> need check
              </span>
            )}
            {counts.withPicker > 0 && (
              <span>
                <i className="mr-1.5 inline-block h-2 w-2 rounded-[3px] bg-[#0284C7]" />
                <b className="font-bold">{counts.withPicker}</b> with picker
              </span>
            )}
            {counts.waiting > 0 && (
              <span>
                <i className="mr-1.5 inline-block h-2 w-2 rounded-[3px] bg-[#d1d5db]" />
                <b className="font-bold">{counts.waiting}</b> waiting
              </span>
            )}
            {/* On hold — its own entry since 2026-09-14, because it is its own
                answer. A held bill used to bucket as `waiting` and read as work
                somebody was about to do; it is the opposite, a human saying not
                this one. Slate rather than red: a hold is a decision, not a
                fault. */}
            {trip.counts.held > 0 && (
              <span>
                <i className="mr-1.5 inline-block h-2 w-2 rounded-[3px] bg-[#64748b]" />
                <b className="font-bold">{trip.counts.held}</b> on hold
              </span>
            )}
            {counts.total > 0 && counts.done + counts.dispatched + trip.counts.held === counts.total && (
              <span className="text-gray-400">nothing pending</span>
            )}
          </div>
        </>
      )}

      {/* ⚠ THE NOT-DISPATCHED BANNER WAS HERE UNTIL SLICE 7 (2026-09-15). It
          reported a Mark dispatched press that left bills behind, and told the
          operator to press again. The press left this screen, so the banner has
          nothing to report. */}

      {!isClosed && !readOnly && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={onAddBills} disabled={busy} className={ACTION}>
            Add bills
          </button>
          <button type="button" onClick={onChangeVehicle} disabled={busy} className={ACTION}>
            Set vehicle
          </button>
          {/* ··· — Cancel trip lives here, one deliberate step away from the
              everyday buttons. ⚠ THIS MENU IS THE ONLY STEP: cancelTrip in
              floor-page.tsx posts straight away, with no confirmation prompt. */}
          <div className="relative">
            <button
              type="button"
              aria-label="More trip actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              disabled={busy}
              className={`${ACTION} !px-2.5 tracking-[0.12em]`}
            >
              ···
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div
                  role="menu"
                  className="absolute left-0 z-20 mt-1 w-[150px] overflow-hidden rounded-[8px] border border-gray-200 bg-white shadow-lg"
                >
                  <button
                    type="button"
                    role="menuitem"
                    disabled={busy}
                    onClick={() => {
                      setMenuOpen(false);
                      onCancelTrip();
                    }}
                    className="block w-full px-3 py-2 text-left text-[11.5px] text-[#b91c1c] hover:bg-[#fef2f2] disabled:opacity-40"
                  >
                    Cancel trip
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── THE LAST FEW LINES (2026-09-14, slice 2) ──────────────────────
          OUTSIDE the `!isClosed && !readOnly` guard above, deliberately. A
          cancelled trip has no action row at all, and its history — including
          the bill list the cancel row carries, which is the only surviving
          record of what was on it — is exactly what a planner opens it to read.
          Suppressing it with the buttons would hide the answer on the one trip
          state where the question always gets asked. */}
      {recent}
    </div>
  );
}
