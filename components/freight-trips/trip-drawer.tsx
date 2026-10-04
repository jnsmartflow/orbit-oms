"use client";

// Freight Trips — the right-hand drawer for a NEW trip and for EDITING one.
//
// 🔴 BUILT FROM THE FLOOR DRAWER'S PIECES (Smart Flow, 2026-10-04) so the two
// look the same: the shell (TripDrawer), the card style, the Timing card's
// ManualDispatchField and the Vehicle card's TransporterVehiclePickers all come
// from components/floor/trip-fields.tsx / components/trips/. Freight adds only
// what Floor does not have — the Trip date at create, the Driver name / phone
// inputs — and leaves out what it does not want: no slot, no delivery type, no
// vehicle size, no diesel. The Floor drawer itself is untouched.
//
// Vehicle: a master vehicle from /api/freight-trips/options, OR a typed plate —
// never both (chk_freight_trips_vehicle_one_of). The vehicle list is the chosen
// transporter's fleet (Floor's rule); a plate not in it is offered as a typed
// plate. Picking a vehicle copies its driver into the driver inputs; both stay
// editable (a typed driver wins — owner, 2026-10-02). SNAPSHOTS on the trip.
//
// 🔴 THE MANUAL DISPATCH TIME IS REQUIRED on create AND on every edit save,
// with or without a vehicle — the Freight Report reads it. Save / Create trip
// stays disabled, with the inline error showing, until both are set. The two
// routes refuse it too (400). Transporter and Vehicle stay OPTIONAL on freight
// (owner, 2026-10-04) — no red *.
//
// ONE brand button: Create trip / Save.

import { useEffect, useState } from "react";
import { Clock, Lock, Truck } from "lucide-react";
import { formatLitres } from "@/components/floor/status-pill";
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  TRIP_GROUP,
  TRIP_GROUP_LABEL,
  TRIP_INPUT,
  TRIP_LABEL,
  TransporterVehiclePickers,
  TripDrawer as DrawerShell,
  type VehiclePick,
} from "@/components/floor/trip-fields";
import { ManualDispatchField } from "@/components/trips/manual-dispatch-field";
import { initialManualDispatch, manualDispatchIso } from "@/lib/trips/diesel-dispatch";
import { shortDate, todayIST, type FreightOptions, type FreightTripDetail, type TripFields } from "./api";

/** The stored vehicle, even when it is no longer in the active list. */
function initialVehicle(trip: FreightTripDetail | null): VehiclePick | null {
  if (!trip) return null;
  if (trip.vehicleId !== null) {
    return { kind: "master", id: trip.vehicleId, plate: trip.vehicleNo ?? `#${trip.vehicleId}`, driver: trip.driverName };
  }
  if (trip.adhocVehicleNo !== null) return { kind: "typed", plate: trip.adhocVehicleNo };
  return null;
}

export function TripDrawer({
  mode,
  trip,
  options,
  billCount,
  billLitres,
  busy,
  onClose,
  onSubmit,
}: {
  mode: "new" | "edit";
  /** The trip being edited (edit mode). */
  trip: FreightTripDetail | null;
  options: FreightOptions | null;
  /** New mode: the ticked bills going on the trip. */
  billCount: number;
  billLitres: number;
  busy: boolean;
  onClose: () => void;
  /** `tripDate` (YYYY-MM-DD) is read on CREATE only — the number F-YYMMDD-NN comes from it. */
  onSubmit: (fields: TripFields, tripDate: string) => void;
}) {
  const editing = mode === "edit" ? trip : null;
  const [transporter, setTransporter] = useState<{ id: number; name: string } | null>(() =>
    editing?.transporterId != null
      ? { id: editing.transporterId, name: editing.transporterName ?? `#${editing.transporterId}` }
      : null,
  );
  const [vehicle, setVehicle] = useState<VehiclePick | null>(() => initialVehicle(editing));
  const [driverName, setDriverName] = useState(editing?.driverName ?? "");
  const [driverPhone, setDriverPhone] = useState(editing?.driverPhone ?? "");
  const [note, setNote] = useState(editing?.note ?? "");
  // New trip: default today IST; edit: the trip's own date, read-only.
  const [tripDate, setTripDate] = useState(editing?.tripDate ?? todayIST());
  // Edit: the saved time in IST. New (or an older trip with none): today IST + an empty time.
  const [dispatch, setDispatch] = useState(() => initialManualDispatch(editing?.manualDispatchAt ?? null));
  const dispatchMissing = dispatch.date === "" || dispatch.time === "";
  const badTripDate = mode === "new" && !/^\d{4}-\d{2}-\d{2}$/.test(tripDate);

  // Esc closes the drawer — the freight page has no single Esc owner like
  // Floor's, so the drawer keeps its own (pool-view stands down while the
  // data-freight-overlay attribute is present).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  function submit() {
    if (busy || dispatchMissing || badTripDate) return;
    const clean = (s: string) => (s.trim() === "" ? null : s.trim());
    onSubmit(
      {
        vehicleId: vehicle?.kind === "master" ? vehicle.id : null,
        adhocVehicleNo: vehicle?.kind === "typed" ? vehicle.plate : null,
        transporterId: transporter?.id ?? null,
        driverName: clean(driverName),
        driverPhone: clean(driverPhone),
        note: clean(note),
        manualDispatchAt: manualDispatchIso(dispatch.date, dispatch.time),
      },
      tripDate,
    );
  }

  // Header — Floor's shape: the number (mono) + a locked chip, then a summary.
  const title =
    mode === "new" ? (
      <h4 className="m-0 text-[16px] font-semibold text-gray-900">New freight trip</h4>
    ) : (
      <>
        <h4 className="m-0 font-mono text-[16px] font-semibold text-gray-900">{trip?.tripNumber ?? ""}</h4>
        <span
          className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-[12px] text-gray-500"
          title="Trip date cannot be changed — the trip number is built from it."
        >
          <Lock size={11} strokeWidth={2} />
          {shortDate(tripDate)} {tripDate.slice(0, 4)}
        </span>
      </>
    );
  const meta =
    mode === "new"
      ? billCount > 0
        ? `${billCount} held bill${billCount === 1 ? "" : "s"} · ${formatLitres(billLitres)} L`
        : "An empty trip — add bills afterwards"
      : trip && trip.counts.bills > 0
        ? [
            ...(trip.routeLabel ? [trip.routeLabel] : []),
            `${trip.counts.stops} stop${trip.counts.stops === 1 ? "" : "s"}`,
            `${trip.counts.bills} bill${trip.counts.bills === 1 ? "" : "s"}`,
            `${formatLitres(trip.counts.litres)} L`,
          ].join(" · ")
        : null;

  return (
    <DrawerShell
      busy={busy}
      onClose={onClose}
      overlayAttr="data-freight-overlay"
      title={title}
      meta={meta}
      footer={
        <div className="flex w-full flex-col gap-3">
          <p className="m-0 text-[11.5px] text-gray-500">
            Only the freight report uses this. The bills stay on hold on the floor.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className={BUTTON_SECONDARY}>
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || dispatchMissing || badTripDate}
              className={BUTTON_PRIMARY}
            >
              {mode === "new" ? (busy ? "Creating…" : "Create trip") : busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      }
    >
      {mode === "new" && (
        <div>
          <label className={TRIP_LABEL} htmlFor="freight-trip-date">Trip date</label>
          <input
            id="freight-trip-date"
            type="date"
            className={`${TRIP_INPUT} h-[38px]`}
            value={tripDate}
            onChange={(e) => setTripDate(e.target.value)}
          />
        </div>
      )}

      {/* ── Timing ─────────────────────────────────────────────────────── */}
      <section className={TRIP_GROUP} aria-label="Timing">
        <div className={TRIP_GROUP_LABEL}>
          <Clock size={13} strokeWidth={1.8} />
          Timing
        </div>
        <ManualDispatchField
          id="freight-dispatch-date"
          date={dispatch.date}
          time={dispatch.time}
          onChange={setDispatch}
          error={dispatchMissing ? "Enter the dispatch date and time" : undefined}
        />
      </section>

      {/* ── Vehicle ────────────────────────────────────────────────────── */}
      <section className={TRIP_GROUP} aria-label="Vehicle">
        <div className={TRIP_GROUP_LABEL}>
          <Truck size={13} strokeWidth={1.8} />
          Vehicle
        </div>
        <TransporterVehiclePickers
          transporter={transporter}
          vehicle={vehicle}
          onChange={(p) => {
            if (p.transporter !== undefined) setTransporter(p.transporter);
            if (p.vehicle !== undefined) setVehicle(p.vehicle);
          }}
          vehicles={options?.vehicles ?? []}
          transporters={options?.transporters ?? []}
          required={false}
          // The master vehicle's driver goes into the inputs below — editable.
          onVehiclePicked={(v) => {
            setDriverName(v.driverName ?? "");
            setDriverPhone(v.driverPhone ?? "");
          }}
        />
        {options?.transportersFallback && (
          <p className="-mt-2 text-[11px] text-gray-400">
            Showing all active transporters — none is marked as a real carrier yet.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={TRIP_LABEL} htmlFor="freight-driver-name">Driver name</label>
            <input
              id="freight-driver-name"
              className={`${TRIP_INPUT} h-[38px]`}
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
            />
          </div>
          <div>
            <label className={TRIP_LABEL} htmlFor="freight-driver-phone">Driver mobile</label>
            <input
              id="freight-driver-phone"
              className={`${TRIP_INPUT} h-[38px] tabular-nums`}
              inputMode="tel"
              value={driverPhone}
              onChange={(e) => setDriverPhone(e.target.value)}
            />
          </div>
        </div>
      </section>

      <div>
        <label className={TRIP_LABEL} htmlFor="freight-note">Reason / note</label>
        <textarea
          id="freight-note"
          rows={2}
          className={`${TRIP_INPUT} h-16 resize-none py-2`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </DrawerShell>
  );
}
