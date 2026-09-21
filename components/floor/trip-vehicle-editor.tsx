"use client";

// Floor Control — the Edit trip drawer, behind the trip header's pencil
// (docs/mockups/floor-trips/trip-form-v1.html, LOCKED 2026-09-21). The fields
// are the shared body in trip-fields.tsx; this file owns the header, the footer
// and the PATCH /api/floor/trips/[id].
//
// ⚠ IT SENDS ONLY WHAT CHANGED. The PATCH distinguishes an ABSENT key ("leave
// alone") from an explicit null ("clear"), so a form that posted every field on
// every save would overwrite columns the operator never looked at — and would
// re-snapshot the driver on a save that only edited the note.
//
// ⚠ EXCEPT: A VEHICLE CHANGE ALWAYS CARRIES THE TRANSPORTER. The route defaults
// the transporter from the vehicle whenever `vehicleId` is sent without
// `transporterId` ([id]/route.ts). Sending them together keeps what the planner
// sees equal to what is saved. A transporter-only change sends `transporterId`
// alone — no vehicle key, so no driver re-snapshot and no default to fight.
//
// ⚠ DELIVERY TYPE IS NOT EDITABLE, deliberately. The route refuses it: the trip
// number is built from the type (chk_trips_number_shape), so changing it is a
// re-number, not an edit. It sits locked in the header.
//
// ⚠ NO WINDOW-LEVEL KEY LISTENER. floor-page.tsx is the SINGLE Esc owner for the
// whole floor tree (FLOOR §4.6). This closes on its ✕ and its backdrop.

import { useState } from "react";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import type {
  DeliveryTypeOption,
  DispatchWindowOption,
  TransporterOption,
  VehicleOption,
} from "./trip-options";
import type { TripSummary } from "@/lib/trips/queries";
import { formatLitres, formatWeightKg } from "./status-pill";
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  TripDrawer,
  TripFields,
  findDefaultTransporter,
  type TripFieldValues,
  type VehiclePick,
} from "./trip-fields";

function initialVehicle(trip: TripSummary): VehiclePick | null {
  // The STORED vehicle, even when it is not in the current transporter's fleet
  // (or not active any more) — a legacy trip must not silently lose it.
  if (trip.vehicleId !== null) {
    return { kind: "master", id: trip.vehicleId, plate: trip.vehicleNo ?? `#${trip.vehicleId}`, driver: trip.driverName };
  }
  if (trip.adhocVehicleNo !== null) return { kind: "typed", plate: trip.adhocVehicleNo };
  return null;
}

export function TripVehicleEditor({
  trip,
  windows,
  vehicles,
  transporters,
  deliveryTypes,
  onClose,
  onSaved,
}: {
  trip: TripSummary;
  windows: DispatchWindowOption[];
  vehicles: VehicleOption[];
  transporters: TransporterOption[];
  /** Read-only, for the locked chip — the type cannot be changed here. */
  deliveryTypes: DeliveryTypeOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<TripFieldValues>(() => ({
    deliveryTypeId: trip.deliveryTypeId,
    dispatchWindowId: trip.dispatchWindowId,
    // A trip with no transporter opens on the default — a change on Save, by
    // design (owner, 2026-09-21).
    transporter:
      trip.transporterId !== null
        ? { id: trip.transporterId, name: trip.transporterName ?? `#${trip.transporterId}` }
        : findDefaultTransporter(transporters),
    vehicle: initialVehicle(trip),
    docket: trip.transporterTripNo ?? "",
    note: trip.note ?? "",
  }));
  const [busy, setBusy] = useState(false);

  const typeName =
    deliveryTypes.find((d) => d.id === trip.deliveryTypeId)?.name ?? trip.deliveryTypeName ?? trip.typeCode;

  const canSave = !busy;

  // The trip's summary, from props only. Dropped on an empty trip.
  const kg = formatWeightKg(Math.round(trip.totalWeightKg));
  const meta =
    trip.counts.total > 0
      ? [
          ...(trip.areaLabel ? [trip.areaLabel] : []),
          `${trip.dropCount} stop${trip.dropCount === 1 ? "" : "s"}`,
          `${trip.counts.total} bill${trip.counts.total === 1 ? "" : "s"}`,
          `${formatLitres(trip.totalLitres)} L`,
          ...(kg ? [`${kg}${trip.weightUnknownCount > 0 ? "+" : ""} kg`] : []),
        ].join(" · ")
      : null;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    try {
      const patch: Record<string, unknown> = {};

      const v = values.vehicle;
      const nextVehicleId = v?.kind === "master" ? v.id : null;
      const nextAdhoc = v?.kind === "typed" ? v.plate : null;
      const nextTransporter = values.transporter?.id ?? null;
      const vehicleChanged = nextVehicleId !== trip.vehicleId || nextAdhoc !== trip.adhocVehicleNo;
      const transporterChanged = nextTransporter !== trip.transporterId;
      if (vehicleChanged) {
        patch.vehicleId = nextVehicleId;
        patch.adhocVehicleNo = nextAdhoc;
        patch.transporterId = nextTransporter;
      } else if (transporterChanged) {
        patch.transporterId = nextTransporter;
      }

      if (values.dispatchWindowId !== trip.dispatchWindowId) patch.dispatchWindowId = values.dispatchWindowId;

      const nextNote = values.note.trim() === "" ? null : values.note.trim();
      if (nextNote !== trip.note) patch.note = nextNote;

      const nextDocket = values.docket.trim() === "" ? null : values.docket.trim();
      if (nextDocket !== trip.transporterTripNo) patch.transporterTripNo = nextDocket;

      if (Object.keys(patch).length === 0) {
        toast.success("Nothing changed.");
        onClose();
        return;
      }

      const res = await fetch(`/api/floor/trips/${trip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const bodyJson = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(`Could not save — ${bodyJson?.error ?? `HTTP ${res.status}`}`);
        return;
      }
      toast.success(`${trip.tripNumber} updated`);
      onSaved();
    } catch {
      toast.error("Could not save — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  // The stored slot, when it has left the active list, still shows selected.
  const extraWindow =
    trip.dispatchWindowId !== null && trip.windowTime !== null
      ? { id: trip.dispatchWindowId, windowTime: trip.windowTime }
      : null;

  return (
    <TripDrawer
      busy={busy}
      onClose={onClose}
      title={
        <>
          <h4 className="m-0 font-mono text-[16px] font-semibold text-gray-900">{trip.tripNumber}</h4>
          <span
            className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-[12px] text-gray-500"
            title="Delivery type cannot be changed — the trip number is built from it. Cancel and rebuild if the type is wrong."
          >
            <Lock size={11} strokeWidth={2} />
            {typeName}
          </span>
        </>
      }
      meta={meta}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className={BUTTON_SECONDARY}>
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={!canSave} className={BUTTON_PRIMARY}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <TripFields
        mode="edit"
        values={values}
        onChange={setValues}
        deliveryTypes={deliveryTypes}
        windows={windows}
        vehicles={vehicles}
        transporters={transporters}
        extraWindow={extraWindow}
      />
    </TripDrawer>
  );
}
