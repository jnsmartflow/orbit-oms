"use client";

// Floor Control — the trip header in the MIDDLE, above its bills (v3 mockup §02).
//
// Number · type · slot · state chip on line one; vehicle / transporter / driver
// and the totals on line two; the four-colour bar with its legend; then the
// action row.
//
// ⚠ THE ACTIONS ARE THE WHOLE TRIP'S, and they live here rather than on the rail
// card because the card is a summary the operator scans and this is the thing he
// is working on. One primary at most — Confirm/Release on a draft — and it is
// the state's real job (CLAUDE_UI §1's one-teal rule).
//
// ⚠ A CANCELLED OR DISPATCHED TRIP OFFERS NOTHING. Every write path refuses both
// server-side; showing buttons that will 409 is worse than showing none.

import type { ReactNode } from "react";
import { ProgressBar } from "./progress-bar";
import { formatLitres } from "./status-pill";
import { toStatusCounts, tripStateMeta } from "./trip-rail";
import { tripWording } from "@/lib/floor/trip-wording";
import type { TripSummary } from "@/lib/trips/queries";

const ACTION =
  "inline-flex h-[28px] items-center rounded-[7px] border border-gray-300 bg-white px-3 text-[11.5px] font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY =
  "inline-flex h-[28px] items-center rounded-[7px] bg-brand-600 px-3.5 text-[11.5px] font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400";

export function TripDetailHeader({
  trip,
  busy,
  readOnly,
  onRelease,
  onDispatch,
  onAddBills,
  onChangeVehicle,
  onCancelTrip,
  recent,
}: {
  trip: TripSummary;
  busy: boolean;
  /** History — a past day is a record, not a thing to edit. */
  readOnly: boolean;
  onRelease: () => void;
  /** Mark this released trip’s checked bills dispatched. Absent on a History
   *  band — a past day is a record, and the button is suppressed with every
   *  other write by `readOnly`. */
  onDispatch?: () => void;
  /** Switches the rail back to the pool, where bills are ticked. */
  onAddBills: () => void;
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
  const counts = toStatusCounts(trip.counts, trip.dispatchedCount);
  const meta = tripStateMeta(trip);
  const wording = tripWording();
  const vehicle = trip.vehicleNo ?? trip.adhocVehicleNo;
  const isClosed = trip.status === "cancelled" || trip.status === "dispatched";
  const isDraft = trip.status === "draft";
  // What a Mark-dispatched press would actually move, right now. `counts.checked`
  // folds `dispatched` into `checked` (bucketFor, lib/trips/queries.ts), so the
  // subtraction is what separates “finished” from “finished and still here”.
  // Floored at 0 — the two figures come from one payload and cannot disagree,
  // but a negative in a button label would be worse than a stale zero.
  const readyToDispatch = Math.max(0, trip.counts.checked - trip.dispatchedCount);

  // ── WHAT DID NOT GO (2026-09-13) ─────────────────────────────────────────
  //
  // 🔴 A SKIPPED BILL MUST BE VISIBLE ON THE TRIP, NOT ONLY IN A TOAST.
  // Confirming marks every CHECKED bill dispatched and deliberately leaves
  // anything still being picked exactly where it is (lib/floor/dispatch.ts).
  // That skip is rare — one trip in 55, measured 2026-09-13 — which is precisely
  // why it cannot live only in a success line the operator has already
  // dismissed. At that rate nobody is watching for it, and a trip that quietly
  // left two bills behind looks identical to one that did not.
  //
  // ⚠ `counts` folds `dispatched` INTO `checked` (bucketFor, lib/trips/queries.ts)
  // so the bucket cannot tell "checked and gone" from "checked and still here";
  // `dispatchedCount` is the figure that separates them. A held bill is never in
  // `checked` — `bucketFor` tests the hold first, whatever the stage.
  //
  // ⚠ ONLY AFTER A CONFIRM. On a draft every bill is undispatched and saying so
  // would be noise on the one state where it means nothing.
  //
  // 🔴 THREE PARTS, EACH COUNTED FROM ITS OWN BUCKET, NEVER BY SUBTRACTION
  // (2026-09-15). This read `total - dispatchedCount - held` and called the
  // result "still being picked" — which swept in every bill that was CHECKED and
  // waiting for the press. A trip whose bills all wore "Done" in the table got a
  // banner saying "2 of 2 bills not dispatched — 2 still being picked" directly
  // above them (L-260914-28, the slice 3 acceptance test).
  //   · ready   — checked, not yet gone: the SAME figure the button counts, so
  //               the banner and "Mark dispatched (N)" cannot disagree.
  //   · picking — every bucket short of checked. `other` rides with them because
  //               the legend above already folds it into "waiting".
  //   · held    — a human said not this one; named on its own, never as work.
  const heldCount = trip.counts.held;
  const pickingCount = trip.counts.waiting + trip.counts.withPicker + trip.counts.picked + trip.counts.other;
  const notDispatched = readyToDispatch + pickingCount + heldCount;
  const showNotDispatched = !isDraft && trip.counts.total > 0 && notDispatched > 0;
  const notDispatchedParts = [
    readyToDispatch > 0 ? `${readyToDispatch} checked and ready` : null,
    pickingCount > 0 ? `${pickingCount} still being picked` : null,
    heldCount > 0 ? `${heldCount} on hold` : null,
  ].filter(Boolean) as string[];

  // Line two — everything known about who is carrying it, then the totals.
  // Blanks are dropped rather than rendered as dashes: a trip with no vehicle
  // yet is normal, and four em dashes in a row reads as missing data.
  const whoBits = [vehicle, trip.transporterName, trip.driverName].filter(Boolean) as string[];
  // ⚠ AN EMPTY TRIP SAYS SO, here as on the rail card (2026-09-10 c). Three
  // zeroes in a row read as a rendering fault rather than as a fact, and an
  // empty draft is the state a trip is in for as long as it takes the planner
  // to go and tick its bills. The Release button below is already disabled and
  // already explains itself ("Add bills to this trip first"), so this line only
  // has to stop contradicting it.
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
          {trip.windowTime ? ` · ${trip.windowTime}` : " · no slot yet"}
        </span>
        <span
          className={`rounded-full px-2.5 py-[3px] text-[10px] font-bold uppercase tracking-[0.07em] ${meta.cls}`}
        >
          {meta.label}
        </span>
      </div>

      <div className="mt-1.5 text-[12px] text-gray-600">
        {whoBits.length > 0 && (
          <>
            {whoBits.join(" · ")}
            {trip.driverPhone ? ` ${trip.driverPhone}` : ""}
            <span className="mx-1.5 text-gray-300">·</span>
          </>
        )}
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
                a single state. It confused the operator on live today. The pill
                was always right; this is the surface that was not. */}
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

      {/* The skip, stated on the trip and not only in a toast. Amber, because
          it is something to come back to rather than something that went wrong
          — a red band on a correct confirm would teach the operator to ignore
          it, which is the opposite of the point. */}
      {showNotDispatched && (
        <div className="mt-2 rounded-[7px] border border-[#fde3b4] bg-[#fffaf0] px-2.5 py-1.5 text-[11.5px] text-[#92400e]">
          <b className="font-bold tabular-nums">{notDispatched}</b> of{" "}
          <span className="tabular-nums">{trip.counts.total}</span> bill
          {trip.counts.total === 1 ? "" : "s"} not dispatched — {notDispatchedParts.join(", ")}.
          {pickingCount > 0 && <> Press Mark dispatched again once {pickingCount === 1 ? "it is" : "they are"} checked.</>}
        </div>
      )}

      {!isClosed && !readOnly && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {isDraft && (
            <button
              type="button"
              onClick={onRelease}
              // 🔴 THE SLOT GATE IS GONE (2026-09-13). This read
              // `|| trip.dispatchWindowId === null` and stranded 104 bills
              // across 19 slot-less trips with no way forward. The slot only
              // ever mattered to the RELEASE write, which a checked bill never
              // receives, so the gate moved into the route and onto that write
              // alone. Slice 3 (2026-09-14) deleted that route: the trip's slot
              // is now DISPLAY-ONLY and nothing branches on it. The rail groups
              // by it, and "No slot yet" is a fine group to sit in.
              disabled={busy || counts.total === 0}
              title={counts.total === 0 ? "Add bills to this trip first" : wording.releaseButton}
              className={PRIMARY}
            >
              {busy ? "Working…" : wording.releaseButton}
            </button>
          )}
          {/* ── MARK DISPATCHED (2026-09-14) ──────────────────────────────
              🔴 THE PRESS THAT USED TO BE PART OF RELEASE. Confirm plan
              settles the trip; THIS says the goods have gone. They were one
              button until today, so the single morning press shipped whatever
              was already checked and nothing could ship afterwards.

              ⚠ ALWAYS RENDERED ON A RELEASED TRIP, DISABLED AT ZERO, NEVER
              HIDDEN. It is pressed repeatedly through the day as bills become
              checked, so it has to be in the same place every time the operator
              looks. A button that vanishes when idle is one he stops looking
              for — and this is the only way to dispatch anything from the app.

              ⚠ THE COUNT IS LIVE AND IT IS WHAT WILL ACTUALLY MOVE:
              `counts.checked` minus what has already gone. `bucketFor` folds
              `dispatched` into `checked` (lib/trips/queries.ts), so the
              subtraction is what turns "finished" into "finished and still
              here". A held bill is not in it — holds never dispatch. */}
          {!isDraft && onDispatch && (
            <button
              type="button"
              onClick={onDispatch}
              disabled={busy || readyToDispatch === 0}
              title={
                readyToDispatch === 0
                  ? "Nothing on this trip is checked and waiting to go"
                  : `Mark ${readyToDispatch} checked bill${readyToDispatch === 1 ? "" : "s"} dispatched`
              }
              className={PRIMARY}
            >
              {busy ? "Working…" : `Mark dispatched (${readyToDispatch})`}
            </button>
          )}
          <button type="button" onClick={onAddBills} disabled={busy} className={ACTION}>
            Add bills
          </button>
          <button type="button" onClick={onChangeVehicle} disabled={busy} className={ACTION}>
            Change vehicle
          </button>
          <button
            type="button"
            onClick={onCancelTrip}
            disabled={busy}
            className={`${ACTION} !text-[#b91c1c] hover:!bg-[#fef2f2]`}
          >
            Cancel trip
          </button>
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
