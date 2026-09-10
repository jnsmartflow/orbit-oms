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
  gateOn,
  busy,
  readOnly,
  onRelease,
  onAddBills,
  onChangeVehicle,
  onCancelTrip,
}: {
  trip: TripSummary;
  gateOn: boolean;
  busy: boolean;
  /** History — a past day is a record, not a thing to edit. */
  readOnly: boolean;
  onRelease: () => void;
  /** Switches the rail back to the pool, where bills are ticked. */
  onAddBills: () => void;
  onChangeVehicle: () => void;
  onCancelTrip: () => void;
}) {
  const counts = toStatusCounts(trip.counts);
  const meta = tripStateMeta(trip, gateOn);
  const wording = tripWording(gateOn);
  const vehicle = trip.vehicleNo ?? trip.adhocVehicleNo;
  const isClosed = trip.status === "cancelled" || trip.status === "dispatched";
  const isDraft = trip.status === "draft";

  // Line two — everything known about who is carrying it, then the totals.
  // Blanks are dropped rather than rendered as dashes: a trip with no vehicle
  // yet is normal, and four em dashes in a row reads as missing data.
  const whoBits = [vehicle, trip.transporterName, trip.driverName].filter(Boolean) as string[];
  const totalBits = [
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
            {counts.total > 0 && counts.done === counts.total && (
              <span className="text-gray-400">nothing pending</span>
            )}
          </div>
        </>
      )}

      {!isClosed && !readOnly && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {isDraft && (
            <button
              type="button"
              onClick={onRelease}
              disabled={busy || counts.total === 0 || trip.dispatchWindowId === null}
              title={
                counts.total === 0
                  ? "Add bills to this trip first"
                  : trip.dispatchWindowId === null
                    ? "Set a slot first — the release writes it onto every bill"
                    : wording.releaseButton
              }
              className={PRIMARY}
            >
              {busy ? "Working…" : wording.releaseButton}
            </button>
          )}
          <button type="button" onClick={onAddBills} disabled={busy} className={ACTION}>
            Add bills
          </button>
          <button type="button" onClick={onChangeVehicle} disabled={busy} className={ACTION}>
            Change vehicle
          </button>
          {/* ⚠ NOT BUILT. There is no route that writes trip_drops.dropSeq, and
              this step was told to add none. Rendered disabled rather than
              omitted so the mockup's action row is recognisable and the gap is
              visible rather than silently missing. */}
          <button
            type="button"
            disabled
            title="Not built yet — stop order is the order bills were added"
            className={ACTION}
          >
            Reorder stops
          </button>
          <button
            type="button"
            onClick={onCancelTrip}
            disabled={busy}
            className={`${ACTION} !text-[#b91c1c] hover:!bg-[#fef2f2]`}
          >
            Cancel trip
          </button>

          {isDraft && wording.releaseCaveat && (
            <span className="basis-full text-[10.5px] text-gray-400">{wording.releaseCaveat}</span>
          )}
        </div>
      )}
    </div>
  );
}
